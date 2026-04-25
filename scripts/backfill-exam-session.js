#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseExamSession, serializeExamSession } = require('../src/shared/examSession');

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const SERVICE_ACCOUNT = JSON.parse(process.env.SERVICE_ACCOUNT_JSON || '{}');
const DEFAULT_HEADER_ROW = parseInt(process.env.HEADER_ROW || '1', 10);
const DEFAULT_SPREADSHEET_ID = process.env.SHEET_ID || '';

let cachedToken = null;
let tokenExpiry = 0;

function usage() {
  console.log(`
Normalize ExamSession to compact session codes.

Usage:
  node scripts/backfill-exam-session.js --spreadsheet-id <id> (--gid <sheetId> | --tab <tabName>) [--header-row 1] [--dry-run] [--out-dir .local/migration_reports]

Examples:
  node scripts/backfill-exam-session.js --spreadsheet-id 1D1kJfMNcWk2yiXF16YH2XcqOCHpPo3rJjrhzkBIh40g --gid 215800335 --dry-run
  node scripts/backfill-exam-session.js --spreadsheet-id 1D1kJfMNcWk2yiXF16YH2XcqOCHpPo3rJjrhzkBIh40g --gid 215800335
`);
}

function parseArgs(argv) {
  const args = {
    spreadsheetId: DEFAULT_SPREADSHEET_ID,
    gid: '',
    tabName: '',
    headerRow: DEFAULT_HEADER_ROW,
    dryRun: false,
    outDir: path.join(process.cwd(), '.local', 'migration_reports'),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--spreadsheet-id') {
      args.spreadsheetId = String(next || '').trim();
      i += 1;
    } else if (arg === '--gid') {
      args.gid = String(next || '').trim();
      i += 1;
    } else if (arg === '--tab') {
      args.tabName = String(next || '').trim();
      i += 1;
    } else if (arg === '--header-row') {
      args.headerRow = parseInt(String(next || '').trim(), 10) || 1;
      i += 1;
    } else if (arg === '--out-dir') {
      args.outDir = path.resolve(String(next || '').trim() || args.outDir);
      i += 1;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.spreadsheetId) throw new Error('Missing --spreadsheet-id.');
  if (!args.gid && !args.tabName) throw new Error('Provide either --gid or --tab.');
  return args;
}

function ensureServiceAccount() {
  if (!SERVICE_ACCOUNT.client_email || !SERVICE_ACCOUNT.private_key) {
    throw new Error('SERVICE_ACCOUNT_JSON is missing or incomplete.');
  }
}

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function buildSheetsUrl(spreadsheetId, range) {
  return `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`;
}

function colToLetter(index) {
  let current = index + 1;
  let out = '';
  while (current > 0) {
    const rem = (current - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    current = Math.floor((current - 1) / 26);
  }
  return out;
}

function quoteSheetName(tabName) {
  return `'${String(tabName).replace(/'/g, "''")}'`;
}

function normalizeHeaderName(name) {
  return String(name || '').trim().toLowerCase().replace(/[\s_]+/g, '');
}

function compactString(value) {
  return String(value || '').trim();
}

function sameExamSessionValue(a, b) {
  return compactString(a) === compactString(b);
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function makeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry - 60000) return cachedToken;

  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: SERVICE_ACCOUNT.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const header = base64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = base64url(Buffer.from(JSON.stringify(claim)));
  const toSign = `${header}.${payload}`;
  const privateKey = String(SERVICE_ACCOUNT.private_key || '').replace(/\\n/g, '\n');

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(toSign);
  const signature = base64url(sign.sign(privateKey));
  const jwt = `${toSign}.${signature}`;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  const data = await resp.json();
  if (!data.access_token) throw new Error(`Token error: ${JSON.stringify(data)}`);

  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  return cachedToken;
}

async function googleJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let parsed = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch (error) {
    parsed = text;
  }
  if (!response.ok) {
    throw new Error(typeof parsed === 'string' ? parsed : JSON.stringify(parsed));
  }
  return parsed;
}

async function getSpreadsheetMetadata(token, spreadsheetId) {
  return googleJson(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function getSheetValues(token, spreadsheetId, range) {
  return googleJson(buildSheetsUrl(spreadsheetId, range), {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function batchUpdateSheetRanges(token, spreadsheetId, data) {
  return googleJson(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data,
    }),
  });
}

function resolveSheet(meta, args) {
  const sheets = meta.sheets || [];
  if (args.gid) {
    const wanted = String(args.gid).trim();
    const match = sheets.find((sheet) => String(sheet.properties?.sheetId) === wanted);
    if (!match) throw new Error(`Could not find sheet with gid=${wanted}.`);
    return {
      gid: String(match.properties.sheetId),
      title: match.properties.title,
    };
  }

  const wantedName = normalizeHeaderName(args.tabName);
  const match = sheets.find((sheet) => normalizeHeaderName(sheet.properties?.title) === wantedName);
  if (!match) throw new Error(`Could not find tab named "${args.tabName}".`);
  return {
    gid: String(match.properties.sheetId),
    title: match.properties.title,
  };
}

function headerIndex(headers, name) {
  const target = normalizeHeaderName(name);
  return headers.findIndex((header) => normalizeHeaderName(header) === target);
}

function buildUnresolvedReason(level, rotation, period) {
  const parsed = parseExamSession('', {
    level,
    legacyRotation: rotation,
    legacyPeriod: period,
  });
  if (parsed?.isValid) return '';

  const rawRotation = compactString(rotation);
  const rawPeriod = compactString(period);
  if (!rawRotation && !rawPeriod) return 'Both Rotation and Period are blank.';
  if ((/syth|synth/i).test(`${rawRotation} ${rawPeriod}`) && String(level || '').trim().toUpperCase() !== '6A') {
    return 'Synthese is allowed only for level 6A.';
  }
  return `Unsupported legacy combination: Rotation="${rawRotation}" Period="${rawPeriod}" Level="${compactString(level)}".`;
}

function collectRowDecision(row, rowNumber, columns) {
  const level = row[columns.level] || '';
  const examSession = row[columns.examSession] || '';
  const rotation = row[columns.rotation] || '';
  const period = row[columns.period] || '';

  const parsed = parseExamSession(examSession, {
    level,
    legacyRotation: rotation,
    legacyPeriod: period,
  });

  if (!parsed || !parsed.isValid) {
    return {
      rowNumber,
      status: 'unresolved',
      level,
      examSession: '',
      rotation,
      period,
      reason: buildUnresolvedReason(level, rotation, period),
    };
  }

  const serialized = serializeExamSession(parsed);
  const hasExamSessionValue = !!compactString(examSession);
  const isAlreadyCanonical = hasExamSessionValue && sameExamSessionValue(examSession, serialized);

  if (isAlreadyCanonical) {
    return {
      rowNumber,
      status: 'already_canonical',
      level,
      examSession,
      normalizedExamSession: serialized,
      rotation,
      period,
      sessionLabel: parsed.label,
      sessionShort: parsed.shortLabel,
    };
  }

  return {
    rowNumber,
    status: 'ready',
    level,
    examSession,
    normalizedExamSession: serialized,
    rotation,
    period,
    sessionLabel: parsed.label,
    sessionShort: parsed.shortLabel,
    source: hasExamSessionValue ? 'rewrite_existing' : 'backfill_legacy',
  };
}

function writeReports(outDir, summary, unresolvedRows) {
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = makeTimestamp();
  const baseName = `exam-session-backfill-${stamp}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const csvPath = path.join(outDir, `${baseName}.csv`);

  const jsonPayload = {
    generatedAt: new Date().toISOString(),
    summary,
    unresolvedRows,
  };
  fs.writeFileSync(jsonPath, `${JSON.stringify(jsonPayload, null, 2)}\n`, 'utf8');

  const csvLines = [
    ['rowNumber', 'level', 'rotation', 'period', 'reason'],
    ...unresolvedRows.map((row) => [row.rowNumber, row.level, row.rotation, row.period, row.reason]),
  ].map((parts) => parts.map(csvEscape).join(','));
  fs.writeFileSync(csvPath, `${csvLines.join('\n')}\n`, 'utf8');

  return { jsonPath, csvPath };
}

async function main() {
  ensureServiceAccount();
  const args = parseArgs(process.argv.slice(2));
  const token = await getAccessToken();
  const metadata = await getSpreadsheetMetadata(token, args.spreadsheetId);
  const targetSheet = resolveSheet(metadata, args);
  const range = `${quoteSheetName(targetSheet.title)}!A1:ZZ`;
  const data = await getSheetValues(token, args.spreadsheetId, range);
  const rows = data.values || [];
  const headerIndexZero = args.headerRow - 1;
  const headers = rows[headerIndexZero] || [];
  const columns = {
    level: headerIndex(headers, 'Level'),
    examSession: headerIndex(headers, 'ExamSession'),
    rotation: headerIndex(headers, 'Rotation'),
    period: headerIndex(headers, 'Period'),
  };

  for (const [key, idx] of Object.entries(columns)) {
    if (idx < 0) throw new Error(`Missing required header: ${key}`);
  }

  const dataRows = rows.slice(args.headerRow);
  const decisions = dataRows.map((row, index) =>
    collectRowDecision(row, args.headerRow + index + 1, columns)
  );

  const readyRows = decisions.filter((row) => row.status === 'ready');
  const unresolvedRows = decisions.filter((row) => row.status === 'unresolved');
  const alreadyCanonical = decisions.filter((row) => row.status === 'already_canonical');
  const rewriteExisting = readyRows.filter((row) => row.source === 'rewrite_existing');
  const backfillLegacy = readyRows.filter((row) => row.source === 'backfill_legacy');

  const summary = {
    spreadsheetId: args.spreadsheetId,
    sheetTitle: targetSheet.title,
    gid: targetSheet.gid,
    dryRun: args.dryRun,
    headerRow: args.headerRow,
    rowsScanned: decisions.length,
    rowsAlreadyCanonical: alreadyCanonical.length,
    rowsToRewriteExisting: rewriteExisting.length,
    rowsToBackfillLegacy: backfillLegacy.length,
    rowsToWrite: readyRows.length,
    rowsWritten: args.dryRun ? 0 : readyRows.length,
    rowsUnresolved: unresolvedRows.length,
  };

  const reportPaths = writeReports(args.outDir, summary, unresolvedRows);

  console.log(`Target sheet: ${targetSheet.title} (gid=${targetSheet.gid})`);
  console.log(`Rows scanned: ${summary.rowsScanned}`);
  console.log(`Rows already canonical: ${summary.rowsAlreadyCanonical}`);
  console.log(`Rows to rewrite existing ExamSession: ${summary.rowsToRewriteExisting}`);
  console.log(`Rows to backfill from Rotation/Period: ${summary.rowsToBackfillLegacy}`);
  console.log(`Rows ready to write: ${summary.rowsToWrite}`);
  console.log(`Rows unresolved: ${summary.rowsUnresolved}`);
  console.log(`Report JSON: ${reportPaths.jsonPath}`);
  console.log(`Report CSV: ${reportPaths.csvPath}`);

  if (unresolvedRows.length) {
    console.log('\nUnresolved rows:');
    unresolvedRows.slice(0, 20).forEach((row) => {
      console.log(`- row ${row.rowNumber}: ${row.reason}`);
    });
    if (unresolvedRows.length > 20) {
      console.log(`...and ${unresolvedRows.length - 20} more`);
    }
  }

  if (args.dryRun) {
    console.log('\nDry run only. No sheet changes were written.');
    return;
  }

  if (!readyRows.length) {
    console.log('\nNo writable rows found. Nothing to update.');
    return;
  }

  const examSessionColumnLetter = colToLetter(columns.examSession);
  const batchSize = 200;
  for (let start = 0; start < readyRows.length; start += batchSize) {
    const slice = readyRows.slice(start, start + batchSize);
    const dataToWrite = slice.map((row) => ({
      range: `${quoteSheetName(targetSheet.title)}!${examSessionColumnLetter}${row.rowNumber}`,
      values: [[row.normalizedExamSession]],
    }));
    await batchUpdateSheetRanges(token, args.spreadsheetId, dataToWrite);
    console.log(`Wrote rows ${slice[0].rowNumber}-${slice[slice.length - 1].rowNumber}`);
  }

  console.log(`\nNormalization complete. Wrote ${readyRows.length} ExamSession values.`);
}

main().catch((error) => {
  console.error(`Backfill failed: ${error.message}`);
  process.exit(1);
});
