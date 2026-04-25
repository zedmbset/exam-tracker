#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const SERVICE_ACCOUNT = JSON.parse(process.env.SERVICE_ACCOUNT_JSON || '{}');
const DEFAULT_HEADER_ROW = parseInt(process.env.HEADER_ROW || '1', 10);
const DEFAULT_SPREADSHEET_ID = process.env.SHEET_ID || '';

let cachedToken = null;
let tokenExpiry = 0;

const STATUS_MAP = new Map([
  ['completed', 'Completed'],
  ['pending', 'Pending'],
  ['new exam', 'New Exam'],
  ['missing', 'Missing'],
]);

function usage() {
  console.log(`
Normalize Status column values to plain text.

Usage:
  node scripts/normalize-status-column.js --spreadsheet-id <id> (--gid <sheetId> | --tab <tabName>) [--header-row 1] [--dry-run] [--out-dir .local/migration_reports]
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

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function makeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function normalizeStatusValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const lowered = raw.toLowerCase().replace(/\s+/g, ' ');
  return STATUS_MAP.get(lowered) || raw;
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
    return { gid: String(match.properties.sheetId), title: match.properties.title };
  }

  const wantedName = normalizeHeaderName(args.tabName);
  const match = sheets.find((sheet) => normalizeHeaderName(sheet.properties?.title) === wantedName);
  if (!match) throw new Error(`Could not find tab named "${args.tabName}".`);
  return { gid: String(match.properties.sheetId), title: match.properties.title };
}

function findRequiredColumnIndexes(headerRow) {
  const normalizedHeaders = headerRow.map(normalizeHeaderName);
  const statusIndex = normalizedHeaders.findIndex((name) => name === 'status');
  if (statusIndex < 0) throw new Error('Missing required header: Status');
  return { statusIndex };
}

function writeReports(outDir, timestamp, report) {
  fs.mkdirSync(outDir, { recursive: true });
  const baseName = `status-normalize-${timestamp}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const csvPath = path.join(outDir, `${baseName}.csv`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');

  const csvRows = [
    ['rowNumber', 'oldStatus', 'newStatus'],
    ...report.changes.map((item) => [item.rowNumber, item.oldStatus, item.newStatus]),
  ];
  fs.writeFileSync(csvPath, `${csvRows.map((row) => row.map(csvEscape).join(',')).join('\n')}\n`, 'utf8');
  return { jsonPath, csvPath };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  ensureServiceAccount();

  const token = await getAccessToken();
  const meta = await getSpreadsheetMetadata(token, args.spreadsheetId);
  const sheet = resolveSheet(meta, args);
  const sheetRef = quoteSheetName(sheet.title);
  const full = await getSheetValues(token, args.spreadsheetId, `${sheetRef}!A1:ZZ`);
  const rows = full.values || [];
  const headerIndex = Math.max(0, args.headerRow - 1);
  const headerRow = rows[headerIndex] || [];
  const { statusIndex } = findRequiredColumnIndexes(headerRow);

  const changes = [];
  const updates = [];
  const dataRows = rows.slice(headerIndex + 1);

  dataRows.forEach((row, idx) => {
    const rowNumber = headerIndex + 2 + idx;
    const oldStatus = String(row[statusIndex] || '').trim();
    const newStatus = normalizeStatusValue(oldStatus);
    if (!oldStatus || oldStatus === newStatus) return;

    changes.push({ rowNumber, oldStatus, newStatus });
    updates.push({
      range: `${sheetRef}!${colToLetter(statusIndex)}${rowNumber}`,
      values: [[newStatus]],
    });
  });

  if (!args.dryRun && updates.length) {
    const chunkSize = 200;
    for (let i = 0; i < updates.length; i += chunkSize) {
      await batchUpdateSheetRanges(token, args.spreadsheetId, updates.slice(i, i + chunkSize));
    }
  }

  const timestamp = makeTimestamp();
  const report = {
    spreadsheetId: args.spreadsheetId,
    sheetTitle: sheet.title,
    gid: sheet.gid,
    dryRun: args.dryRun,
    scannedRows: dataRows.length,
    changedRows: changes.length,
    changes,
  };
  const reportPaths = writeReports(args.outDir, timestamp, report);

  console.log(`Scanned rows: ${dataRows.length}`);
  console.log(`Changed rows: ${changes.length}`);
  console.log(`Mode: ${args.dryRun ? 'dry-run' : 'write'}`);
  console.log(`JSON report: ${reportPaths.jsonPath}`);
  console.log(`CSV report: ${reportPaths.csvPath}`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
