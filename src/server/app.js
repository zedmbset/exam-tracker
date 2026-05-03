const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const FormData = require('form-data');
const crypto = require('crypto');
const { buildBaseReportFilename, extractDriveFileId } = require('./reports/reportPdfShared');
const { buildAdminReportBuffer } = require('./reports/adminReportPdf');
const { buildPublicReportBuffer } = require('./reports/publicReportPdf');
const { parseActionString, serializeActionModel, summarizeActionModel } = require('../shared/telegramActionHelpers');
const ExamStatusUtils = require('../shared/status');
const { registerStaticRoutes } = require('./routes/staticPages');
const { registerExamCoreRoutes } = require('./routes/examCore');
const { registerTelegramFetchRoutes } = require('./routes/telegramFetch');
const { registerContactRoutes } = require('./routes/contacts');
const { registerTelegramBotRoutes } = require('./routes/telegramBot');
const { readJsonFileSafe, writeJsonFileSafe } = require('./services/runtimeJsonStore');
const { colToLetter, quoteSheetName, normalizeHeaderName } = require('./utils/sheetRange');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: '2mb' }));

const SHEET_ID = process.env.SHEET_ID || '';
const SHEET_TAB = process.env.SHEET_TAB || 'Sheet1';
const HEADER_ROW = parseInt(process.env.HEADER_ROW || '1', 10);
const SERVICE_ACCOUNT = JSON.parse(process.env.SERVICE_ACCOUNT_JSON || '{}');
const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const OWNER_GOOGLE_CLIENT_ID = process.env.OWNER_GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID || '';
const OWNER_GOOGLE_CLIENT_SECRET = process.env.OWNER_GOOGLE_CLIENT_SECRET || '';
const OWNER_GOOGLE_REFRESH_TOKEN = process.env.OWNER_GOOGLE_REFRESH_TOKEN || '';
const CONTACTS_SHEET_ID = process.env.CONTACTS_SHEET_ID || '';
const DRAFT_SPREADSHEET_ID = process.env.DRAFT_SPREADSHEET_ID || '';
const TELEGRAM_SPREADSHEET_ID = process.env.TELEGRAM_SPREADSHEET_ID || SHEET_ID || '';
const TELEGRAM_FETCH_CHANNELS_SPREADSHEET_ID = process.env.TELEGRAM_FETCH_CHANNELS_SPREADSHEET_ID || TELEGRAM_SPREADSHEET_ID || '';
const TELEGRAM_FETCH_CHANNELS_SHEET_NAME = process.env.TELEGRAM_FETCH_CHANNELS_SHEET_NAME || 'My_CHNs_Grps';
const TELEGRAM_FETCH_DEFAULT_SHEET = process.env.TELEGRAM_FETCH_DEFAULT_SHEET || 'All_Msgs';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const APP_URL = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
const WORKER_AUTH_TOKEN = String(process.env.WORKER_AUTH_TOKEN || '').trim();
const CONTACTS_SESSION_SECRET = process.env.CONTACTS_SESSION_SECRET || SERVICE_ACCOUNT.private_key_id || '';
const RAW_TELEGRAM_WORKER_URL = (process.env.TELEGRAM_WORKER_URL || '').trim();
const TELEGRAM_WORKER_URL = RAW_TELEGRAM_WORKER_URL.replace(/\/+$/, '');
const WORKER_URL_VALID = !TELEGRAM_WORKER_URL || /^https?:\/\//i.test(TELEGRAM_WORKER_URL);
const WORKER_PROXY_ERROR = WORKER_URL_VALID
  ? ''
  : 'TELEGRAM_WORKER_URL must start with http:// or https://. Worker proxy endpoints are disabled.';
const FETCH_CHANNELS_CACHE_PATH = path.join(ROOT_DIR, 'workers', 'telegram', 'runtime_data', 'fetch_channels_cache.json');
const FETCH_SHEETS_CACHE_PATH = path.join(ROOT_DIR, 'workers', 'telegram', 'runtime_data', 'fetch_sheets_cache.json');
const ACTION_PRESETS_PATH = path.join(ROOT_DIR, 'workers', 'telegram', 'runtime_data', 'collection_action_presets.json');
const ACTION_PRESETS_CACHE_PATH = path.join(ROOT_DIR, 'workers', 'telegram', 'runtime_data', 'action_presets_cache.json');
const FETCH_CHANNELS_CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_SHEETS_CACHE_TTL_MS = 5 * 60 * 1000;
const ACTION_PRESETS_CACHE_TTL_MS = 5 * 60 * 1000;
const HIDDEN_FETCH_CHANNEL_TAG = 'not load';
const ACTION_PRESETS_SPREADSHEET_ID = process.env.ACTION_PRESETS_SPREADSHEET_ID || DRAFT_SPREADSHEET_ID || TELEGRAM_SPREADSHEET_ID || '';
const ACTION_PRESETS_SHEET_NAME = process.env.ACTION_PRESETS_SHEET_NAME || 'Cache_presets';
const ACTION_PRESETS_SHEET_HEADERS = ['Key', 'JSON', 'Updated_At'];
const ACTION_PRESETS_STORAGE_KEY = 'collection_action_presets';

if (!WORKER_URL_VALID) {
  console.error(WORKER_PROXY_ERROR);
}
if (TELEGRAM_WEBHOOK_SECRET) {
  console.log('Telegram webhook secret is configured.');
} else {
  console.error('TELEGRAM_WEBHOOK_SECRET is missing. Telegram webhook requests will fail closed and webhook registration is disabled.');
}

const CONTACTS_HEADERS = {
  ZED_Contacts: ['ID_Contact', 'Full_Name', 'Notes', 'Tags', 'Created_At', 'Updated_At', 'Created_By', 'Updated_By'],
  ZED_Accounts: ['ID_Account', 'ID_Contact', 'Account_Type', 'Value', 'Normalized_Value', 'TG_User_ID', 'TG_Username', 'TG_Display_Name', 'Source', 'Created_At', 'Updated_At'],
  Telegram_Joins: ['ID_Join', 'Chat_ID', 'Channel_Name', 'Channel_Username', 'TG_User_ID', 'TG_Username', 'TG_Display_Name', 'Joined_At', 'Matched_ID_Contact', 'Update_ID', 'Raw_JSON'],
  ZED_Channels: ['ID_Channel', 'Channel_Name', 'Username', 'Type', 'Members_Count', 'Last_Sync'],
  ZED_Jobs: ['ID_Job', 'Type', 'Channel', 'Status', 'Progress', 'Total', 'Started', 'Finished', 'Error', 'Summary_JSON', 'Worker_Job_ID'],
};

const FETCH_SPREADSHEET_OPTIONS = [
  { key: 'Draft', label: 'Draft', spreadsheetId: DRAFT_SPREADSHEET_ID || TELEGRAM_SPREADSHEET_ID || '' },
  { key: 'Telegram', label: 'Telegram', spreadsheetId: TELEGRAM_SPREADSHEET_ID || '' },
].filter((entry, index, list) => entry.spreadsheetId && list.findIndex((candidate) => candidate.key === entry.key) === index);

let cachedToken = null;
let tokenExpiry = 0;
let cachedOwnerDriveToken = null;
let ownerDriveTokenExpiry = 0;

function nowIso() {
  return new Date().toISOString();
}

function compactString(value) {
  return String(value || '').trim();
}

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function redactSensitiveText(input) {
  return String(input || '')
    .replace(/Bearer\s+[A-Za-z0-9._\-~+/=]+/gi, 'Bearer [REDACTED]')
    .replace(/([?&](?:token|access_token|refresh_token|key|secret|password)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/\b[a-f0-9]{32,}\b/gi, '[REDACTED]')
    .replace(/\b[A-Za-z0-9+/_-]{40,}={0,2}\b/g, '[REDACTED]')
    .slice(0, 500);
}

function safeErrorMessage(error) {
  return redactSensitiveText(error?.message || error || 'Unexpected error.');
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return header.split(';').reduce((acc, part) => {
    const [key, ...rest] = part.trim().split('=');
    if (!key) return acc;
    acc[key] = decodeURIComponent(rest.join('=') || '');
    return acc;
  }, {});
}

function signSessionPayload(payload) {
  return crypto.createHmac('sha256', CONTACTS_SESSION_SECRET).update(payload).digest('hex');
}

function createContactsSessionToken() {
  const expiresAt = Date.now() + 12 * 60 * 60 * 1000;
  const nonce = crypto.randomBytes(12).toString('hex');
  const payload = `${expiresAt}.${nonce}`;
  return `${payload}.${signSessionPayload(payload)}`;
}

function verifyContactsSessionToken(token) {
  if (!CONTACTS_SESSION_SECRET) return false;
  const [expiresAtRaw, nonce, signature] = String(token || '').split('.');
  if (!expiresAtRaw || !nonce || !signature) return false;
  const payload = `${expiresAtRaw}.${nonce}`;
  const expected = signSessionPayload(payload);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return false;
  return Number(expiresAtRaw) > Date.now();
}

function ensureContactsSessionCookie(req, res) {
  const cookies = parseCookies(req);
  if (verifyContactsSessionToken(cookies.ct_session)) return;
  const token = createContactsSessionToken();
  res.append('Set-Cookie', `ct_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200`);
}

function requireContactsSession(req, res, next) {
  const cookies = parseCookies(req);
  if (!verifyContactsSessionToken(cookies.ct_session)) {
    return res.status(401).json({ error: 'Contacts session is missing or expired. Reload the contacts page and try again.' });
  }
  return next();
}

const EXAM_STATUS_HEADER_ALIASES = {
  Status: ['Status'],
  ExamDate: ['ExamDate', 'Exam Date'],
  OrigPDF: ['OrigPDF', 'Orig_PDF'],
  Quiz_Tbl: ['Quiz_Tbl', 'QuizTbl', 'Quiz Table'],
};

function resolveExamStatusColumns(headers) {
  const normalizedHeaders = headers.map(normalizeHeaderName);
  const resolved = {};

  for (const [key, aliases] of Object.entries(EXAM_STATUS_HEADER_ALIASES)) {
    const aliasSet = aliases.map(normalizeHeaderName);
    const index = normalizedHeaders.findIndex((header) => aliasSet.includes(header));
    if (index >= 0) resolved[key] = index;
  }

  if (resolved.Status == null) throw new Error('Missing required header: Status');
  return resolved;
}

function getExamStatusCell(row, cols, name) {
  const index = cols[name];
  return index == null ? '' : row[index] || '';
}

async function refreshExamStatuses(token) {
  const sheetRef = quoteSheetName(SHEET_TAB);
  const full = await getSheetValues(token, SHEET_ID, `${sheetRef}!A1:ZZ`);
  const rows = full.values || [];
  const headerIndex = Math.max(0, HEADER_ROW - 1);
  const headers = rows[headerIndex] || [];
  const cols = resolveExamStatusColumns(headers);
  const dataRows = rows.slice(headerIndex + 1);
  const updates = [];
  const changesSample = [];
  let manualCompletedPreserved = 0;
  let unchangedRows = 0;

  dataRows.forEach((row, index) => {
    const rowNumber = headerIndex + 2 + index;
    const getCell = (_row, name) => getExamStatusCell(_row, cols, name);
    const currentStatus = ExamStatusUtils.normalizeStatusValue(getCell(row, 'Status'));
    const nextStatus = ExamStatusUtils.deriveEffectiveStatus(row, getCell);
    const isManualCompleted = ExamStatusUtils.isManualCompletedOverride(row, getCell);

    if (isManualCompleted) manualCompletedPreserved += 1;
    if (currentStatus === nextStatus) {
      unchangedRows += 1;
      return;
    }

    updates.push({
      range: `${sheetRef}!${colToLetter(cols.Status)}${rowNumber}`,
      values: [[nextStatus]],
    });

    if (changesSample.length < 20) {
      changesSample.push({ rowNumber, oldStatus: currentStatus, newStatus: nextStatus });
    }
  });

  if (updates.length) {
    const chunkSize = 200;
    for (let i = 0; i < updates.length; i += chunkSize) {
      await batchUpdateSheetRanges(token, SHEET_ID, updates.slice(i, i + chunkSize));
    }
  }

  return {
    scannedRows: dataRows.length,
    changedRows: updates.length,
    manualCompletedPreserved,
    unchangedRows,
    changesSample,
  };
}

function normalizeTelegramUsername(value) {
  const trimmed = compactString(value).replace(/^@+/, '');
  return trimmed ? trimmed.toLowerCase() : '';
}

function normalizeAccountValue(type, value) {
  const raw = compactString(value);
  if (!raw) return '';
  if (type === 'telegram') return normalizeTelegramUsername(raw);
  if (type === 'email') return raw.toLowerCase();
  if (type === 'phone') return raw.replace(/[^\d+]/g, '');
  return raw.toLowerCase();
}

function getFetchSpreadsheetOptions() {
  return FETCH_SPREADSHEET_OPTIONS.map((option) => ({ ...option }));
}

function getFetchSpreadsheetByKey(key) {
  return getFetchSpreadsheetOptions().find((option) => option.key === key) || null;
}

function buildChannelTags(row) {
  const tags = new Set();
  for (const [header, value] of Object.entries(row)) {
    if (!value || header === '_rowIndex') continue;
    const normalizedHeader = String(header).trim().toLowerCase();
    if (/(group|tag|folder|category|section|year|bucket|label)/.test(normalizedHeader)) {
      String(value).split(/[;,|]/).map((part) => part.trim()).filter(Boolean).forEach((part) => tags.add(part));
    }
  }
  return [...tags];
}

function normalizeFetchTagValue(value) {
  return compactString(value).toLowerCase();
}

function isHiddenFetchChannel(channel) {
  return (channel?.tags || []).some((tag) => normalizeFetchTagValue(tag) === HIDDEN_FETCH_CHANNEL_TAG);
}

function normalizeChannelRecord(headers, row) {
  const payload = {};
  headers.forEach((header, index) => {
    payload[header] = compactString(row[index] || '');
  });
  const tags = buildChannelTags(payload);
  return {
    id: payload['Channel ID'] || payload.Channel_ID || payload.ID_Channel || '',
    name: payload['Channel Name'] || payload.Channel_Name || payload.Name || '',
    username: normalizeTelegramUsername(payload.Username || payload['Channel Username'] || payload['Username'] || ''),
    type: payload.Type || payload['Channel Type'] || '',
    membersCount: payload['Members Count'] || payload.Members_Count || '',
    tags,
    raw: payload,
  };
}

function inferFetchChannelColumns(headers) {
  return {
    id: findHeaderIndex(headers, ['Channel ID', 'Channel_ID', 'ID_Channel']),
    name: findHeaderIndex(headers, ['Channel Name', 'Channel_Name', 'Name']),
    username: findHeaderIndex(headers, ['Username', 'Channel Username', 'Channel_Username']),
    type: findHeaderIndex(headers, ['Type', 'Channel Type', 'Channel_Type']),
    membersCount: findHeaderIndex(headers, ['Members Count', 'Members_Count']),
  };
}

function ensureFetchChannelSheetShape(headers, rows) {
  const requiredHeaders = ['Channel ID', 'Channel Name', 'Username', 'Type', 'Members Count'];
  const nextHeaders = Array.isArray(headers) ? headers.map((header) => compactString(header)).filter(Boolean) : [];
  if (!nextHeaders.length) {
    return {
      headers: [...requiredHeaders],
      rows: Array.isArray(rows) ? rows.map((row) => [...row]) : [],
    };
  }

  const missingHeaders = requiredHeaders.filter((header) => findHeaderIndex(nextHeaders, [header]) < 0);
  if (!missingHeaders.length) {
    return {
      headers: [...nextHeaders],
      rows: Array.isArray(rows) ? rows.map((row) => [...row]) : [],
    };
  }

  const expandedHeaders = [...nextHeaders, ...missingHeaders];
  const expandedRows = (Array.isArray(rows) ? rows : []).map((row) => {
    const clone = Array.isArray(row) ? [...row] : [];
    while (clone.length < expandedHeaders.length) clone.push('');
    return clone;
  });
  return {
    headers: expandedHeaders,
    rows: expandedRows,
  };
}

function ensureFetchChannelsCacheDir() {
  fs.mkdirSync(path.dirname(FETCH_CHANNELS_CACHE_PATH), { recursive: true });
}

function ensureRuntimeDataDir() {
  fs.mkdirSync(path.dirname(FETCH_CHANNELS_CACHE_PATH), { recursive: true });
}

function readFetchSheetsCache() {
  const parsed = readJsonFileSafe(FETCH_SHEETS_CACHE_PATH, null);
  if (!parsed || typeof parsed !== 'object') return null;
  return {
    updatedAt: compactString(parsed.updatedAt),
    sheetsBySpreadsheetKey: parsed.sheetsBySpreadsheetKey && typeof parsed.sheetsBySpreadsheetKey === 'object'
      ? parsed.sheetsBySpreadsheetKey
      : {},
  };
}

function writeFetchSheetsCache(sheetsBySpreadsheetKey) {
  return writeJsonFileSafe(FETCH_SHEETS_CACHE_PATH, {
    updatedAt: nowIso(),
    sheetsBySpreadsheetKey,
  });
}

function buildCacheDescriptor(updatedAt, ttlMs, source, extra = {}) {
  const normalizedUpdatedAt = compactString(updatedAt);
  const updatedMs = normalizedUpdatedAt ? new Date(normalizedUpdatedAt).getTime() : NaN;
  const ageMs = Number.isFinite(updatedMs) ? Math.max(0, Date.now() - updatedMs) : null;
  const ttlSeconds = ttlMs > 0 ? Math.round(ttlMs / 1000) : 0;
  const ageSeconds = ageMs == null ? null : Math.round(ageMs / 1000);
  return {
    source: compactString(source) || 'unknown',
    updatedAt: normalizedUpdatedAt,
    ageSeconds,
    ttlSeconds,
    isFresh: ageMs != null && ttlMs > 0 ? ageMs < ttlMs : false,
    ...extra,
  };
}

function readActionPresets() {
  const parsed = readJsonFileSafe(ACTION_PRESETS_PATH, []);
  return Array.isArray(parsed) ? parsed : [];
}

function writeActionPresets(presets) {
  return writeJsonFileSafe(ACTION_PRESETS_PATH, presets);
}

function readActionPresetsCache() {
  const parsed = readJsonFileSafe(ACTION_PRESETS_CACHE_PATH, null);
  if (!parsed || typeof parsed !== 'object') return null;
  return {
    updatedAt: compactString(parsed.updatedAt),
    source: compactString(parsed.source),
    presets: Array.isArray(parsed.presets) ? parsed.presets : [],
  };
}

function writeActionPresetsCache(presets, meta = {}) {
  return writeJsonFileSafe(ACTION_PRESETS_CACHE_PATH, {
    updatedAt: nowIso(),
    source: compactString(meta.source) || 'google_sheets',
    presets: Array.isArray(presets) ? presets : [],
  });
}

async function saveSharedActionPresets(token, presets) {
  const normalizedPresets = Array.isArray(presets) ? presets : [];
  if (!ACTION_PRESETS_SPREADSHEET_ID) {
    writeActionPresets(normalizedPresets);
    writeActionPresetsCache(normalizedPresets, { source: 'local_file' });
    return normalizedPresets;
  }
  await ensureSheetTab(token, ACTION_PRESETS_SPREADSHEET_ID, ACTION_PRESETS_SHEET_NAME, ACTION_PRESETS_SHEET_HEADERS);
  await writeWholeSheet(token, ACTION_PRESETS_SPREADSHEET_ID, ACTION_PRESETS_SHEET_NAME, ACTION_PRESETS_SHEET_HEADERS, [{
    Key: ACTION_PRESETS_STORAGE_KEY,
    JSON: JSON.stringify(normalizedPresets, null, 2),
    Updated_At: nowIso(),
  }]);
  writeActionPresets(normalizedPresets);
  writeActionPresetsCache(normalizedPresets, { source: 'google_sheets' });
  return normalizedPresets;
}

async function loadSharedActionPresets(token, options = {}) {
  const forceFresh = Boolean(options?.forceFresh);
  const returnMeta = Boolean(options?.returnMeta);
  const cache = readActionPresetsCache();
  const isFresh = !forceFresh && cache?.updatedAt && (Date.now() - new Date(cache.updatedAt).getTime()) < ACTION_PRESETS_CACHE_TTL_MS;
  if (isFresh) {
    const payload = {
      presets: cache.presets,
      cache: buildCacheDescriptor(cache.updatedAt, ACTION_PRESETS_CACHE_TTL_MS, cache.source || 'cache', { hit: true }),
    };
    return returnMeta ? payload : payload.presets;
  }

  const legacyPresets = readActionPresets();
  if (!ACTION_PRESETS_SPREADSHEET_ID) {
    const written = writeActionPresetsCache(legacyPresets, { source: 'local_file' });
    const payload = {
      presets: legacyPresets,
      cache: buildCacheDescriptor(written?.updatedAt, ACTION_PRESETS_CACHE_TTL_MS, 'local_file', { hit: false }),
    };
    return returnMeta ? payload : payload.presets;
  }

  try {
    await ensureSheetTab(token, ACTION_PRESETS_SPREADSHEET_ID, ACTION_PRESETS_SHEET_NAME, ACTION_PRESETS_SHEET_HEADERS);
    const rows = await loadSheetObjects(token, ACTION_PRESETS_SPREADSHEET_ID, ACTION_PRESETS_SHEET_NAME, ACTION_PRESETS_SHEET_HEADERS);
    const record = rows.find((row) => compactString(row.Key) === ACTION_PRESETS_STORAGE_KEY) || null;
    const rawJson = compactString(record?.JSON);
    if (!rawJson) {
      if (legacyPresets.length) {
        await saveSharedActionPresets(token, legacyPresets);
        const writtenCache = readActionPresetsCache();
        const payload = {
          presets: legacyPresets,
          cache: buildCacheDescriptor(writtenCache?.updatedAt, ACTION_PRESETS_CACHE_TTL_MS, 'google_sheets', { hit: false }),
        };
        return returnMeta ? payload : payload.presets;
      }
      const written = writeActionPresetsCache([], { source: 'google_sheets' });
      const payload = {
        presets: [],
        cache: buildCacheDescriptor(written?.updatedAt, ACTION_PRESETS_CACHE_TTL_MS, 'google_sheets', { hit: false }),
      };
      return returnMeta ? payload : payload.presets;
    }
    const parsed = JSON.parse(rawJson);
    const presets = Array.isArray(parsed) ? parsed : [];
    writeActionPresets(presets);
    const written = writeActionPresetsCache(presets, { source: 'google_sheets' });
    const payload = {
      presets,
      cache: buildCacheDescriptor(written?.updatedAt, ACTION_PRESETS_CACHE_TTL_MS, 'google_sheets', { hit: false }),
    };
    return returnMeta ? payload : payload.presets;
  } catch (error) {
    if (cache?.presets?.length) {
      const payload = {
        presets: cache.presets,
        cache: buildCacheDescriptor(cache.updatedAt, ACTION_PRESETS_CACHE_TTL_MS, 'stale_cache', { hit: true, fallback: true }),
      };
      return returnMeta ? payload : payload.presets;
    }
    const payload = {
      presets: legacyPresets,
      cache: buildCacheDescriptor('', ACTION_PRESETS_CACHE_TTL_MS, 'local_file_fallback', { hit: false, fallback: true }),
    };
    return returnMeta ? payload : payload.presets;
  }
}

function buildActionPresetSummary(preset) {
  if (!preset || typeof preset !== 'object') return 'No preset action.';
  if (compactString(preset.mode) === 'raw_override') {
    const rawAction = compactString(preset.rawAction);
    return summarizeActionModel(parseActionString(rawAction));
  }
  return summarizeActionModel(preset.actionModel || {});
}

function normalizeActionPreset(input, existingPreset = null) {
  const mode = compactString(input?.mode).toLowerCase() === 'raw_override' ? 'raw_override' : 'structured';
  const now = nowIso();
  return {
    id: compactString(existingPreset?.id || input?.id) || makeId('preset'),
    name: compactString(input?.name),
    description: compactString(input?.description),
    mode,
    actionModel: mode === 'structured'
      ? {
          grouped: Boolean(input?.actionModel?.grouped),
          transferMode: compactString(input?.actionModel?.transferMode) || 'none',
          pubLnk: {
            enabled: Boolean(input?.actionModel?.pubLnk?.enabled),
            numSequence: Boolean(input?.actionModel?.pubLnk?.numSequence),
            punctBlank: Boolean(input?.actionModel?.pubLnk?.punctBlank),
            punctValue: compactString(input?.actionModel?.pubLnk?.punctValue),
            joinUs: Boolean(input?.actionModel?.pubLnk?.joinUs),
            commentJoinUsMode: compactString(input?.actionModel?.pubLnk?.commentJoinUsMode) || 'none',
          },
        }
      : {
          grouped: Boolean(input?.actionModel?.grouped),
          transferMode: compactString(input?.actionModel?.transferMode) || 'none',
          pubLnk: {
            enabled: Boolean(input?.actionModel?.pubLnk?.enabled),
            numSequence: Boolean(input?.actionModel?.pubLnk?.numSequence),
            punctBlank: Boolean(input?.actionModel?.pubLnk?.punctBlank),
            punctValue: compactString(input?.actionModel?.pubLnk?.punctValue),
            joinUs: Boolean(input?.actionModel?.pubLnk?.joinUs),
            commentJoinUsMode: compactString(input?.actionModel?.pubLnk?.commentJoinUsMode) || 'none',
          },
        },
    rawAction: mode === 'raw_override' ? compactString(input?.rawAction) : '',
    createdAt: compactString(existingPreset?.createdAt) || now,
    updatedAt: now,
  };
}

function serializePresetForResponse(preset) {
  return {
    ...preset,
    actionSummary: buildActionPresetSummary(preset),
    actionPreview: compactString(preset?.mode) === 'raw_override'
      ? compactString(preset?.rawAction)
      : serializeActionModel(preset?.actionModel || {}),
  };
}

function readFetchChannelsCache() {
  try {
    const raw = fs.readFileSync(FETCH_CHANNELS_CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return { updatedAt: '', channels: parsed };
    }
    if (Array.isArray(parsed?.channels)) {
      return { updatedAt: compactString(parsed.updatedAt), channels: parsed.channels };
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn(`Failed to read fetch channels cache: ${safeErrorMessage(error)}`);
    }
  }
  return null;
}

function writeFetchChannelsCache(channels, meta = {}) {
  ensureFetchChannelsCacheDir();
  const payload = {
    updatedAt: nowIso(),
    source: compactString(meta.source) || 'sheet',
    channels,
  };
  fs.writeFileSync(FETCH_CHANNELS_CACHE_PATH, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

function buildFetchChannelsResponse(channels, meta = {}) {
  const visibleChannels = channels.filter((channel) => !isHiddenFetchChannel(channel));
  const groups = [...new Set(visibleChannels.flatMap((channel) => channel.tags || []))].sort((a, b) => a.localeCompare(b));
  const cache = buildCacheDescriptor(compactString(meta.updatedAt), FETCH_CHANNELS_CACHE_TTL_MS, compactString(meta.source) || 'cache', {
    hit: ['cache', 'stale_cache'].includes(compactString(meta.source)),
    visibleChannels: visibleChannels.length,
    totalChannels: channels.length,
  });
  return {
    spreadsheetId: TELEGRAM_FETCH_CHANNELS_SPREADSHEET_ID,
    sheetName: TELEGRAM_FETCH_CHANNELS_SHEET_NAME,
    groups,
    channels: visibleChannels,
    cache,
    summary: {
      totalChannels: channels.length,
      visibleChannels: visibleChannels.length,
      hiddenChannels: channels.length - visibleChannels.length,
      cacheUpdatedAt: cache.updatedAt,
      source: cache.source,
      inserted: Number(meta.inserted || 0),
      updated: Number(meta.updated || 0),
      discovered: Number(meta.discovered || 0),
    },
  };
}

async function listSpreadsheetTabs(token, spreadsheetId) {
  const metadata = await getSpreadsheetMetadata(token, spreadsheetId);
  return (metadata.sheets || []).map((sheet) => ({
    title: sheet.properties?.title || '',
    sheetId: sheet.properties?.sheetId,
    index: sheet.properties?.index,
  })).filter((sheet) => sheet.title);
}

async function listSpreadsheetTabsCached(token, spreadsheet, options = {}) {
  const cache = readFetchSheetsCache();
  const key = compactString(spreadsheet?.key);
  const cachedSheets = key ? cache?.sheetsBySpreadsheetKey?.[key] : null;
  const forceFresh = Boolean(options?.forceFresh);
  const isFresh = !forceFresh && cache?.updatedAt && (Date.now() - new Date(cache.updatedAt).getTime()) < FETCH_SHEETS_CACHE_TTL_MS;
  if (isFresh && Array.isArray(cachedSheets) && cachedSheets.length) {
    return {
      sheets: cachedSheets,
      cache: buildCacheDescriptor(cache.updatedAt, FETCH_SHEETS_CACHE_TTL_MS, 'cache', { hit: true }),
    };
  }
  try {
    const sheets = await listSpreadsheetTabs(token, spreadsheet.spreadsheetId);
    const sheetsBySpreadsheetKey = {
      ...(cache?.sheetsBySpreadsheetKey || {}),
      [key]: sheets,
    };
    const written = writeFetchSheetsCache(sheetsBySpreadsheetKey);
    return {
      sheets,
      cache: buildCacheDescriptor(written.updatedAt, FETCH_SHEETS_CACHE_TTL_MS, 'google_sheets', { hit: false }),
    };
  } catch (error) {
    if (Array.isArray(cachedSheets) && cachedSheets.length) {
      return {
        sheets: cachedSheets,
        cache: buildCacheDescriptor(cache?.updatedAt || '', FETCH_SHEETS_CACHE_TTL_MS, 'stale_cache', { hit: true, fallback: true }),
      };
    }
    throw error;
  }
}

async function loadFetchChannels(token) {
  if (!TELEGRAM_FETCH_CHANNELS_SPREADSHEET_ID) return [];
  const values = await getSheetValues(token, TELEGRAM_FETCH_CHANNELS_SPREADSHEET_ID, `${TELEGRAM_FETCH_CHANNELS_SHEET_NAME}!A1:ZZ`).catch(() => ({ values: [] }));
  const rows = values.values || [];
  const headers = rows[0] || [];
  return rows.slice(1).map((row) => normalizeChannelRecord(headers, row)).filter((channel) => channel.id || channel.username || channel.name);
}

async function loadFetchChannelSheetState(token) {
  const values = await getSheetValues(token, TELEGRAM_FETCH_CHANNELS_SPREADSHEET_ID, `${TELEGRAM_FETCH_CHANNELS_SHEET_NAME}!A1:ZZ`).catch(() => ({ values: [] }));
  const rows = values.values || [];
  const headers = (rows[0] || []).map((header) => compactString(header));
  const dataRows = rows.slice(1);
  const channels = dataRows
    .map((row) => normalizeChannelRecord(headers, row))
    .filter((channel) => channel.id || channel.username || channel.name);
  return { headers, rows: dataRows, channels };
}

async function rebuildFetchChannelsCacheFromSheet(token) {
  const sheetState = await loadFetchChannelSheetState(token);
  const cache = writeFetchChannelsCache(sheetState.channels, { source: 'sheet' });
  return buildFetchChannelsResponse(cache.channels, cache);
}

function buildFetchChannelLookupKeys(channel) {
  const keys = new Set();
  const id = compactString(channel?.id);
  const username = normalizeTelegramUsername(channel?.username);
  const name = compactString(channel?.name).toLowerCase();
  if (id) keys.add(`id:${id}`);
  if (username) keys.add(`username:${username}`);
  if (name) keys.add(`name:${name}`);
  return [...keys];
}

function normalizeManualChannelLink(value) {
  const raw = compactString(value);
  if (!raw) throw new Error('Channel link is required.');
  if (/^@[A-Za-z0-9_]{5,}$/i.test(raw)) {
    return { kind: 'public', normalized: raw };
  }
  const publicMatch = raw.match(/^https?:\/\/t\.me\/([A-Za-z0-9_]{5,})\/?$/i);
  if (publicMatch) {
    return { kind: 'public', normalized: `@${publicMatch[1]}` };
  }
  const inviteMatch = raw.match(/^https?:\/\/t\.me\/\+([A-Za-z0-9_-]+)\/?$/i);
  if (inviteMatch) {
    return { kind: 'invite', normalized: `https://t.me/+${inviteMatch[1]}` };
  }
  throw new Error('Supported formats: @username, https://t.me/USERNAME, https://t.me/+HASH');
}

function resolveMergedChannel(channels, candidate) {
  const lookupKeys = buildFetchChannelLookupKeys(candidate);
  return channels.find((channel) => buildFetchChannelLookupKeys(channel).some((key) => lookupKeys.includes(key))) || null;
}

function mergeDiscoveredChannelsIntoSheet(headers, rows, discoveredChannels) {
  const shaped = ensureFetchChannelSheetShape(headers, rows);
  const columns = inferFetchChannelColumns(shaped.headers);
  const mutableRows = shaped.rows.map((row) => {
    const clone = [...row];
    while (clone.length < shaped.headers.length) clone.push('');
    return clone;
  });

  const keyToRowIndex = new Map();
  mutableRows.forEach((row, rowIndex) => {
    const normalized = normalizeChannelRecord(shaped.headers, row);
    buildFetchChannelLookupKeys(normalized).forEach((key) => {
      if (!keyToRowIndex.has(key)) keyToRowIndex.set(key, rowIndex);
    });
  });

  let inserted = 0;
  let updated = 0;
  for (const discovered of discoveredChannels) {
    const keys = buildFetchChannelLookupKeys(discovered);
    const existingRowIndex = keys.find((key) => keyToRowIndex.has(key));
    if (existingRowIndex) {
      const row = mutableRows[keyToRowIndex.get(existingRowIndex)];
      let rowChanged = false;
      const applyCell = (columnIndex, value) => {
        if (columnIndex < 0) return;
        const normalizedValue = compactString(value);
        if (row[columnIndex] !== normalizedValue) {
          row[columnIndex] = normalizedValue;
          rowChanged = true;
        }
      };
      applyCell(columns.id, discovered.id);
      applyCell(columns.name, discovered.name);
      applyCell(columns.username, discovered.username);
      applyCell(columns.type, discovered.type);
      applyCell(columns.membersCount, discovered.membersCount);
      if (rowChanged) updated += 1;
      continue;
    }

    const newRow = shaped.headers.map(() => '');
    if (columns.id >= 0) newRow[columns.id] = compactString(discovered.id);
    if (columns.name >= 0) newRow[columns.name] = compactString(discovered.name);
    if (columns.username >= 0) newRow[columns.username] = compactString(discovered.username);
    if (columns.type >= 0) newRow[columns.type] = compactString(discovered.type);
    if (columns.membersCount >= 0) newRow[columns.membersCount] = compactString(discovered.membersCount);
    mutableRows.push(newRow);
    const newIndex = mutableRows.length - 1;
    buildFetchChannelLookupKeys(discovered).forEach((key) => keyToRowIndex.set(key, newIndex));
    inserted += 1;
  }

  return {
    headers: shaped.headers,
    rows: mutableRows,
    inserted,
    updated,
    channels: mutableRows
      .map((row) => normalizeChannelRecord(shaped.headers, row))
      .filter((channel) => channel.id || channel.username || channel.name),
  };
}

function sanitizeFetchJobPayload(body, spreadsheet) {
  const sheetName = compactString(body?.sheetName);
  if (!sheetName) throw new Error('sheetName is required.');
  const channels = Array.isArray(body?.channels) ? body.channels : [];
  if (!channels.length) throw new Error('Select at least one channel.');
  const normalizedChannels = channels.map((channel) => ({
    id: compactString(channel?.id),
    name: compactString(channel?.name),
    username: normalizeTelegramUsername(channel?.username),
  })).filter((channel) => channel.id || channel.username || channel.name);
  if (!normalizedChannels.length) throw new Error('Selected channels are invalid.');

  let rangeMode = compactString(body?.rangeMode) === 'message_id' ? 'message_id' : 'date';
  let dateFrom = compactString(body?.dateFrom);
  const startMessageId = compactString(body?.startMessageId);
  const endMessageId = compactString(body?.endMessageId);
  if (rangeMode === 'message_id' && !startMessageId && !endMessageId) {
    rangeMode = 'date';
    dateFrom = '';
  }
  return {
    spreadsheetKey: spreadsheet.key,
    spreadsheetId: spreadsheet.spreadsheetId,
    sheetName,
    channels: normalizedChannels,
    rangeMode,
    dateFrom,
    startMessageId,
    endMessageId,
    fetchComments: Boolean(body?.fetchComments),
    maxCommentsPerPost: Math.max(1, parseInt(body?.maxCommentsPerPost || '50', 10) || 50),
  };
}

function getAppBaseUrl(req) {
  if (APP_URL) return APP_URL;
  const host = compactString(req.get('x-forwarded-host') || req.get('host'));
  if (!host) return '';
  const protocol = compactString(req.get('x-forwarded-proto')) || (req.secure ? 'https' : 'http');
  return `${protocol}://${host}`;
}

async function telegramApi(method, payload = null) {
  if (!TELEGRAM_BOT_TOKEN) return { configured: false };
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: payload ? 'POST' : 'GET',
    headers: payload ? { 'Content-Type': 'application/json' } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(text || `Telegram ${method} returned an invalid response.`);
  }
  if (!response.ok || data.ok === false) {
    throw new Error(data.description || text || `Telegram ${method} failed.`);
  }
  return { configured: true, ...data };
}

function jsonResponseSafe(value) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return JSON.stringify({ error: 'Could not serialize payload.' });
  }
}

function buildSheetsUrl(spreadsheetId, range) {
  return `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`;
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

async function getOwnerDriveAccessToken() {
  if (cachedOwnerDriveToken && Date.now() < ownerDriveTokenExpiry - 60000) return cachedOwnerDriveToken;

  if (!OWNER_GOOGLE_CLIENT_ID || !OWNER_GOOGLE_CLIENT_SECRET || !OWNER_GOOGLE_REFRESH_TOKEN) {
    throw new Error('Owner Google Drive OAuth is not configured. Set OWNER_GOOGLE_CLIENT_ID, OWNER_GOOGLE_CLIENT_SECRET, and OWNER_GOOGLE_REFRESH_TOKEN.');
  }

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: OWNER_GOOGLE_CLIENT_ID,
      client_secret: OWNER_GOOGLE_CLIENT_SECRET,
      refresh_token: OWNER_GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }).toString(),
  });

  const data = await resp.json();
  if (!resp.ok || !data.access_token) {
    cachedOwnerDriveToken = null;
    ownerDriveTokenExpiry = 0;
    throw new Error(`Owner Drive token error: ${JSON.stringify(data)}`);
  }

  cachedOwnerDriveToken = data.access_token;
  ownerDriveTokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  return cachedOwnerDriveToken;
}

function canUseOwnerDriveOAuth() {
  return Boolean(OWNER_GOOGLE_CLIENT_ID && OWNER_GOOGLE_CLIENT_SECRET && OWNER_GOOGLE_REFRESH_TOKEN);
}

function isRecoverableOwnerDriveError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    message.includes('invalid_grant') ||
    message.includes('expired or revoked') ||
    message.includes('owner google drive oauth is not configured') ||
    message.includes('owner drive token error')
  );
}

async function getDriveAccessToken() {
  if (canUseOwnerDriveOAuth()) {
    try {
      return await getOwnerDriveAccessToken();
    } catch (error) {
      if (!isRecoverableOwnerDriveError(error)) throw error;
      console.warn(`Owner Drive OAuth unavailable, falling back to service account: ${safeErrorMessage(error)}`);
    }
  }
  return getAccessToken();
}

async function googleJson(url, options = {}) {
  const retries = Number.isFinite(options.retries) ? options.retries : 3;
  const retryDelayMs = Number.isFinite(options.retryDelayMs) ? options.retryDelayMs : 700;
  const requestOptions = { ...options };
  delete requestOptions.retries;
  delete requestOptions.retryDelayMs;

  let lastError;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const response = await fetch(url, requestOptions);
    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch (error) {
      parsed = text;
    }

    if (response.ok) return parsed;

    const message = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
    const transientStatus = [429, 500, 502, 503, 504];
    if (transientStatus.includes(response.status) && attempt < retries - 1) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
      continue;
    }

    lastError = new Error(message);
    lastError.status = response.status;
    throw lastError;
  }

  throw lastError || new Error('Google request failed.');
}

async function getSpreadsheetMetadata(token, spreadsheetId) {
  return googleJson(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function updateSheetValues(token, spreadsheetId, range, values) {
  return googleJson(`${buildSheetsUrl(spreadsheetId, range)}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values }),
  });
}

async function getSheetValues(token, spreadsheetId, range) {
  return googleJson(buildSheetsUrl(spreadsheetId, range), {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function batchUpdateSpreadsheet(token, spreadsheetId, requests) {
  return googleJson(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ requests }),
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

async function ensureSheetTab(token, spreadsheetId, tabName, headers) {
  const metadata = await getSpreadsheetMetadata(token, spreadsheetId);
  const hasTab = (metadata.sheets || []).some((sheet) => sheet.properties?.title === tabName);
  if (!hasTab) {
    await batchUpdateSpreadsheet(token, spreadsheetId, [{ addSheet: { properties: { title: tabName } } }]);
  }

  const values = await getSheetValues(token, spreadsheetId, `${tabName}!A1:ZZ2`).catch(() => ({ values: [] }));
  const firstRow = values.values?.[0] || [];
  const needsHeader = !firstRow.length || headers.some((header, index) => String(firstRow[index] || '') !== header);
  if (needsHeader) {
    await updateSheetValues(token, spreadsheetId, `${tabName}!A1:${colToLetter(headers.length - 1)}1`, [headers]);
  }
}

async function ensureContactsInfra(token) {
  if (!CONTACTS_SHEET_ID) throw new Error('CONTACTS_SHEET_ID is not configured.');
  for (const [tabName, headers] of Object.entries(CONTACTS_HEADERS)) {
    await ensureSheetTab(token, CONTACTS_SHEET_ID, tabName, headers);
  }
}

function rowsToObjects(headers, values, rowOffset = 2) {
  return (values || []).map((row, index) => {
    const obj = { _rowIndex: rowOffset + index };
    headers.forEach((header, headerIndex) => {
      obj[header] = String(row[headerIndex] || '');
    });
    return obj;
  });
}

function objectToRow(headers, obj) {
  return headers.map((header) => String(obj[header] || ''));
}

async function loadSheetObjects(token, spreadsheetId, tabName, headers) {
  const values = await getSheetValues(token, spreadsheetId, `${tabName}!A2:ZZ`).catch(() => ({ values: [] }));
  return rowsToObjects(headers, values.values || []);
}

async function writeWholeSheet(token, spreadsheetId, tabName, headers, objects) {
  const rows = [headers, ...objects.map((obj) => objectToRow(headers, obj))];
  await updateSheetValues(token, spreadsheetId, `${tabName}!A1:${colToLetter(headers.length - 1)}${rows.length}`, rows);
}

async function appendSheetObject(token, spreadsheetId, tabName, headers, obj) {
  return googleJson(`${buildSheetsUrl(spreadsheetId, `${tabName}!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: [objectToRow(headers, obj)] }),
  });
}

function findHeaderIndex(headers, candidates) {
  const normalizedHeaders = headers.map((header) => compactString(header).toLowerCase());
  for (const candidate of candidates) {
    const index = normalizedHeaders.indexOf(candidate.toLowerCase());
    if (index >= 0) return index;
  }
  return -1;
}

function getCell(row, index) {
  return index >= 0 ? compactString(row[index]) : '';
}

function inferActionSheetColumns(headers) {
  return {
    action: findHeaderIndex(headers, ['Action']),
    destination: findHeaderIndex(headers, ['Destination']),
    extraMsg: findHeaderIndex(headers, ['Extra_Msg', 'Extra Msg', 'Extra']),
    collection: findHeaderIndex(headers, ['Collection']),
    messageLink: findHeaderIndex(headers, ['Message Link', 'Message_Link', 'Post Link', 'Post_Link', 'Telegram Link', 'Telegram_Link', 'Link', 'URL', 'Url']),
    title: findHeaderIndex(headers, ['Title', 'Post_Title', 'Message_Title', 'Name']),
    text: findHeaderIndex(headers, ['Text', 'Message', 'Description', 'Caption']),
    hashtags: findHeaderIndex(headers, ['Hashtags']),
    id: findHeaderIndex(headers, ['ID', 'Message_ID', 'Msg_ID']),
  };
}

function buildActionRowPayload(headers, row, rowIndex) {
  const columns = inferActionSheetColumns(headers);
  const action = getCell(row, columns.action);
  const destination = getCell(row, columns.destination);
  const extraMsg = getCell(row, columns.extraMsg);
  const collection = getCell(row, columns.collection);
  const messageLink = getCell(row, columns.messageLink);
  const title = getCell(row, columns.title);
  const text = getCell(row, columns.text);
  const hashtags = getCell(row, columns.hashtags);
  const identifier = getCell(row, columns.id);
  const preview = title || extraMsg || text || hashtags || identifier;
  const model = parseActionString(action);
  return {
    rowIndex,
    title: title || extraMsg || identifier || `Row ${rowIndex}`,
    preview: preview.slice(0, 240),
    identifier,
    collection,
    messageLink,
    action,
    destination,
    extraMsg,
    actionModel: model,
    actionSummary: summarizeActionModel(model),
    isEmpty: !row.some((cell) => compactString(cell)),
  };
}

function buildCollectionActionGroups(rows) {
  const groups = [];
  const byCollection = new Map();
  for (const row of rows) {
    const collection = compactString(row.collection);
    if (!collection) continue;
    const relatedRow = {
      rowIndex: row.rowIndex,
      title: row.title,
      preview: row.preview,
      identifier: row.identifier,
      messageLink: row.messageLink,
      actionSummary: row.actionSummary,
      destination: row.destination,
    };
    if (!byCollection.has(collection)) {
      const group = {
        collection,
        leaderRowIndex: row.rowIndex,
        rowIndexes: [row.rowIndex],
        count: 1,
        title: row.title,
        preview: row.preview,
        identifier: row.identifier,
        messageLink: row.messageLink,
        action: row.action,
        destination: row.destination,
        extraMsg: row.extraMsg,
        pubLinkTitle: collection,
        actionModel: row.actionModel,
        actionSummary: row.actionSummary,
        relatedRows: [relatedRow],
      };
      byCollection.set(collection, group);
      groups.push(group);
      continue;
    }
    const group = byCollection.get(collection);
    group.rowIndexes.push(row.rowIndex);
    group.count += 1;
    group.relatedRows.push(relatedRow);
  }
  return groups;
}

async function loadActionSheetRows(token, spreadsheetId, sheetName) {
  const data = await getSheetValues(token, spreadsheetId, `${sheetName}!A1:ZZ`).catch(() => ({ values: [] }));
  const rows = data.values || [];
  const headers = (rows[0] || []).map((header) => compactString(header));
  const values = rows.slice(1);
  const normalizedRows = values
    .map((row, index) => buildActionRowPayload(headers, row, index + 2))
    .filter((row) => !row.isEmpty);
  return {
    headers,
    columns: inferActionSheetColumns(headers),
    rawRows: normalizedRows,
    rows: buildCollectionActionGroups(normalizedRows),
  };
}

function buildActionCellUpdates(headers, sheetName, updates) {
  const columns = inferActionSheetColumns(headers);
  const ranges = [];
  for (const update of updates) {
    const rowIndex = Number(update?.rowIndex);
    if (!Number.isInteger(rowIndex) || rowIndex < 2) {
      throw new Error('rowIndex must be a sheet row number starting from 2.');
    }
    if (Object.prototype.hasOwnProperty.call(update, 'actionModel') && columns.action >= 0) {
      ranges.push({
        range: `${sheetName}!${colToLetter(columns.action)}${rowIndex}`,
        values: [[serializeActionModel(update.actionModel || {})]],
      });
    } else if (Object.prototype.hasOwnProperty.call(update, 'action') && columns.action >= 0) {
      ranges.push({
        range: `${sheetName}!${colToLetter(columns.action)}${rowIndex}`,
        values: [[compactString(update.action)]],
      });
    }
    if (Object.prototype.hasOwnProperty.call(update, 'destination') && columns.destination >= 0) {
      ranges.push({
        range: `${sheetName}!${colToLetter(columns.destination)}${rowIndex}`,
        values: [[compactString(update.destination)]],
      });
    }
    if (Object.prototype.hasOwnProperty.call(update, 'extraMsg') && columns.extraMsg >= 0) {
      ranges.push({
        range: `${sheetName}!${colToLetter(columns.extraMsg)}${rowIndex}`,
        values: [[compactString(update.extraMsg)]],
      });
    }
  }
  return ranges;
}

function buildFollowerActionModel() {
  return {
    grouped: true,
    transferMode: 'none',
    pubLnk: {
      enabled: false,
      numSequence: false,
      punctBlank: false,
      punctValue: '',
      joinUs: false,
      commentJoinUsMode: 'none',
    },
  };
}

function expandCollectionActionUpdates(updates) {
  const expanded = [];
  for (const update of updates) {
    const rowIndexes = Array.isArray(update?.rowIndexes)
      ? [...new Set(update.rowIndexes.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 2))].sort((a, b) => a - b)
      : [];
    const leaderRowIndex = Number(update?.leaderRowIndex);

    if (rowIndexes.length) {
      const resolvedLeader = rowIndexes.includes(leaderRowIndex) ? leaderRowIndex : rowIndexes[0];
      const leaderUpdate = {
        rowIndex: resolvedLeader,
        destination: compactString(update?.destination),
        extraMsg: compactString(update?.extraMsg),
      };
      if (Object.prototype.hasOwnProperty.call(update, 'action')) {
        leaderUpdate.action = compactString(update?.action);
      } else {
        leaderUpdate.actionModel = update?.actionModel || {};
      }
      expanded.push(leaderUpdate);
      rowIndexes.filter((rowIndex) => rowIndex !== resolvedLeader).forEach((rowIndex) => {
        expanded.push({
          rowIndex,
          actionModel: buildFollowerActionModel(),
          destination: '',
          extraMsg: '',
        });
      });
      continue;
    }

    expanded.push(update);
  }
  return expanded;
}

async function updateSheetObject(token, spreadsheetId, tabName, headers, rowIndex, obj) {
  await updateSheetValues(
    token,
    spreadsheetId,
    `${tabName}!A${rowIndex}:${colToLetter(headers.length - 1)}${rowIndex}`,
    [objectToRow(headers, obj)],
  );
}

async function clearSheetRow(token, spreadsheetId, tabName, headers, rowIndex) {
  await updateSheetValues(
    token,
    spreadsheetId,
    `${tabName}!A${rowIndex}:${colToLetter(headers.length - 1)}${rowIndex}`,
    [headers.map(() => '')],
  );
}

function makeContactVersion(contact) {
  return compactString(contact.Updated_At);
}

function extractAppendedRowIndex(result) {
  const range = result?.updates?.updatedRange || '';
  const match = range.match(/![A-Z]+(\d+):/);
  return match ? parseInt(match[1], 10) : null;
}

async function rollbackSheetChanges(token, changes) {
  for (const change of changes.slice().reverse()) {
    try {
      if (change.kind === 'restore') {
        await updateSheetObject(token, CONTACTS_SHEET_ID, change.tabName, change.headers, change.rowIndex, change.row);
      } else if (change.kind === 'clear') {
        await clearSheetRow(token, CONTACTS_SHEET_ID, change.tabName, change.headers, change.rowIndex);
      }
    } catch (rollbackError) {
      console.error(`Rollback failed for ${change.tabName} row ${change.rowIndex}: ${safeErrorMessage(rollbackError)}`);
    }
  }
}

async function loadContactsState(token) {
  await ensureContactsInfra(token);
  const contacts = await loadSheetObjects(token, CONTACTS_SHEET_ID, 'ZED_Contacts', CONTACTS_HEADERS.ZED_Contacts);
  const accounts = await loadSheetObjects(token, CONTACTS_SHEET_ID, 'ZED_Accounts', CONTACTS_HEADERS.ZED_Accounts);
  const joins = await loadSheetObjects(token, CONTACTS_SHEET_ID, 'Telegram_Joins', CONTACTS_HEADERS.Telegram_Joins);
  const channels = await loadSheetObjects(token, CONTACTS_SHEET_ID, 'ZED_Channels', CONTACTS_HEADERS.ZED_Channels);
  const jobs = await loadSheetObjects(token, CONTACTS_SHEET_ID, 'ZED_Jobs', CONTACTS_HEADERS.ZED_Jobs);
  return { contacts, accounts, joins, channels, jobs };
}

function aggregateContacts(state) {
  const accountsByContact = new Map();
  for (const account of state.accounts) {
    const bucket = accountsByContact.get(account.ID_Contact) || [];
    bucket.push(account);
    accountsByContact.set(account.ID_Contact, bucket);
  }

  const matchedJoinIds = new Set();
  const contacts = state.contacts.map((contact) => {
    const accounts = (accountsByContact.get(contact.ID_Contact) || []).sort((a, b) => a._rowIndex - b._rowIndex);
    const joins = state.joins.filter((join) => join.Matched_ID_Contact === contact.ID_Contact);
    joins.forEach((join) => matchedJoinIds.add(join.ID_Join));
    return {
      id: contact.ID_Contact,
      rowIndex: contact._rowIndex,
      version: makeContactVersion(contact),
      fullName: contact.Full_Name,
      notes: contact.Notes,
      tags: contact.Tags,
      createdAt: contact.Created_At,
      updatedAt: contact.Updated_At,
      createdBy: contact.Created_By,
      updatedBy: contact.Updated_By,
      accounts: accounts.map((account) => ({
        id: account.ID_Account,
        rowIndex: account._rowIndex,
        type: account.Account_Type,
        value: account.Value,
        normalizedValue: account.Normalized_Value,
        tgUserId: account.TG_User_ID,
        tgUsername: account.TG_Username,
        tgDisplayName: account.TG_Display_Name,
        source: account.Source,
      })),
      joins: joins.map((join) => ({
        id: join.ID_Join,
        channelName: join.Channel_Name,
        channelUsername: join.Channel_Username,
        tgUserId: join.TG_User_ID,
        tgUsername: join.TG_Username,
        tgDisplayName: join.TG_Display_Name,
        joinedAt: join.Joined_At,
      })),
    };
  });

  const unmatchedJoins = state.joins.filter((join) => !matchedJoinIds.has(join.ID_Join)).map((join) => ({
    id: join.ID_Join,
    channelName: join.Channel_Name,
    channelUsername: join.Channel_Username,
    tgUserId: join.TG_User_ID,
    tgUsername: join.TG_Username,
    tgDisplayName: join.TG_Display_Name,
    joinedAt: join.Joined_At,
  }));

  return { contacts, unmatchedJoins, channels: state.channels, jobs: state.jobs };
}

function validateContactPayload(payload) {
  const fullName = compactString(payload.fullName);
  if (!fullName) throw new Error('Full name is required.');
  const rawAccounts = Array.isArray(payload.accounts) ? payload.accounts : [];
  const accounts = rawAccounts
    .map((account) => ({
      id: compactString(account.id),
      type: compactString(account.type).toLowerCase() || 'telegram',
      value: compactString(account.value),
      tgUserId: compactString(account.tgUserId),
      tgUsername: compactString(account.tgUsername),
      tgDisplayName: compactString(account.tgDisplayName),
      source: compactString(account.source) || 'manual',
    }))
    .filter((account) => account.value || account.tgUserId || account.tgUsername || account.tgDisplayName);
  return {
    fullName,
    notes: compactString(payload.notes),
    tags: compactString(payload.tags),
    updatedBy: compactString(payload.updatedBy) || 'web',
    accounts: accounts.map((account) => ({
      ...account,
      normalizedValue: normalizeAccountValue(account.type, account.value || account.tgUsername || account.tgUserId),
      tgUsername: normalizeTelegramUsername(account.tgUsername || account.value),
    })),
  };
}

function assertContactVersion(contact, expectedVersion) {
  if (makeContactVersion(contact) !== compactString(expectedVersion)) {
    const error = new Error('This contact row was modified by someone else. Please reload and try again.');
    error.statusCode = 409;
    throw error;
  }
}

function sendSafeError(res, statusCode, error, fallbackMessage = 'Unexpected error.') {
  return res.status(statusCode).json({ error: safeErrorMessage(error) || fallbackMessage });
}

function matchJoinToContactId(join, accounts) {
  const tgUserId = compactString(join.TG_User_ID);
  const tgUsername = normalizeTelegramUsername(join.TG_Username);
  const direct = accounts.find((account) => tgUserId && compactString(account.TG_User_ID) === tgUserId);
  if (direct) return direct.ID_Contact;
  const byUsername = accounts.find((account) => tgUsername && normalizeTelegramUsername(account.TG_Username || account.Value) === tgUsername);
  if (byUsername) return byUsername.ID_Contact;
  return '';
}

function isMemberStatus(status) {
  return ['member', 'administrator', 'creator', 'restricted'].includes(status);
}

function didJoinFromChatMember(update) {
  const oldStatus = compactString(update.old_chat_member?.status).toLowerCase();
  const newStatus = compactString(update.new_chat_member?.status).toLowerCase();
  return !isMemberStatus(oldStatus) && isMemberStatus(newStatus);
}

function extractJoinRow(update, accounts) {
  const chat = update.chat || {};
  const user = update.new_chat_member?.user || update.from || {};
  const tgUsername = normalizeTelegramUsername(user.username);
  const tgUserId = compactString(user.id);

  return {
    ID_Join: makeId('join'),
    Chat_ID: compactString(chat.id),
    Channel_Name: compactString(chat.title || chat.username || chat.id),
    Channel_Username: normalizeTelegramUsername(chat.username),
    TG_User_ID: tgUserId,
    TG_Username: tgUsername,
    TG_Display_Name: compactString([user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || user.id),
    Joined_At: nowIso(),
    Matched_ID_Contact: matchJoinToContactId({ TG_User_ID: tgUserId, TG_Username: tgUsername }, accounts),
    Update_ID: compactString(update._updateId),
    Raw_JSON: jsonResponseSafe(update._raw),
  };
}

async function uploadBufferToDrive(fileBuffer, name, token) {
  if (!token) throw new Error('Missing Google Drive access token.');
  if (!DRIVE_FOLDER_ID) throw new Error('DRIVE_FOLDER_ID is not set in environment variables.');

  const ext = (name.split('.').pop() || '').toLowerCase();
  const mimeMap = {
    pdf: 'application/pdf',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    csv: 'text/csv;charset=utf-8;',
    tsv: 'text/tab-separated-values;charset=utf-8;',
  };
  const mimeType = mimeMap[ext] || 'application/octet-stream';
  const meta = { name, mimeType, parents: [DRIVE_FOLDER_ID] };
  const form = new FormData();
  form.append('metadata', Buffer.from(JSON.stringify(meta)), { contentType: 'application/json', filename: 'metadata.json' });
  form.append('file', fileBuffer, { contentType: mimeType, filename: name });

  const uploadRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&supportsAllDrives=true',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, ...form.getHeaders() },
      body: form,
    },
  );
  if (!uploadRes.ok) throw new Error(await uploadRes.text());
  const { id } = await uploadRes.json();

  await fetch(`https://www.googleapis.com/drive/v3/files/${id}/permissions?supportsAllDrives=true`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });

  return { id, url: `https://drive.google.com/file/d/${id}/view`, mimeType };
}

async function getDriveFileMeta(fileId, token) {
  if (!fileId) throw new Error('Missing file id');
  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,mimeType&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!metaRes.ok) throw new Error(await metaRes.text());
  return metaRes.json();
}

function buildPublicDriveDownloadUrl(fileId) {
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

function buildNextVersionedFilename(baseStem, extension, existingName = '') {
  const safeExtension = String(extension || '').replace(/^\./, '');
  const fileSuffix = safeExtension ? `.${safeExtension}` : '';
  const currentName = compactString(existingName);
  if (!currentName) return `${baseStem}${fileSuffix}`;
  const escapedExt = safeExtension.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const versionRegex = new RegExp(`_V(\\d+)\\.${escapedExt}$`, 'i');
  const versionMatch = currentName.match(versionRegex);
  if (versionMatch) return `${baseStem}_V${parseInt(versionMatch[1], 10) + 1}${fileSuffix}`;
  return `${baseStem}_V1${fileSuffix}`;
}

async function proxyWorker(path, method = 'GET', body = null) {
  if (!TELEGRAM_WORKER_URL) throw new Error('TELEGRAM_WORKER_URL is not configured.');
  if (!WORKER_URL_VALID) throw new Error(WORKER_PROXY_ERROR);
  const response = await fetch(`${TELEGRAM_WORKER_URL}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(WORKER_AUTH_TOKEN ? { 'X-Worker-Token': WORKER_AUTH_TOKEN } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    data = { error: text || 'Unexpected worker response.' };
  }
  if (!response.ok) throw new Error(data.error || text || 'Worker request failed.');
  return data;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForWorkerJob(jobId, timeoutMs = 90000, pollMs = 1500) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await proxyWorker(`/jobs/${encodeURIComponent(jobId)}`, 'GET');
    if (['done', 'error'].includes(compactString(snapshot.status))) {
      return snapshot;
    }
    await sleep(pollMs);
  }
  throw new Error('Timed out while waiting for the Telegram worker job to finish.');
}

async function loadDiscoveredChannelsFromWorkerStore(token) {
  if (!CONTACTS_SHEET_ID) {
    throw new Error('CONTACTS_SHEET_ID is not configured.');
  }
  await ensureContactsInfra(token);
  const rows = await loadSheetObjects(token, CONTACTS_SHEET_ID, 'ZED_Channels', CONTACTS_HEADERS.ZED_Channels);
  return rows
    .map((channel) => ({
      id: compactString(channel.ID_Channel),
      name: compactString(channel.Channel_Name),
      username: normalizeTelegramUsername(channel.Username),
      type: compactString(channel.Type),
      membersCount: compactString(channel.Members_Count),
      tags: [],
      raw: channel,
    }))
    .filter((channel) => channel.id || channel.username || channel.name);
}

async function getWorkerHealth() {
  if (!TELEGRAM_WORKER_URL || !WORKER_URL_VALID) {
    return {
      ok: false,
      telethonConfigured: false,
      telethonConnected: false,
      contactsSheetConfigured: false,
      workerAuthConfigured: Boolean(WORKER_AUTH_TOKEN),
      error: WORKER_PROXY_ERROR || 'Telegram worker not configured.',
    };
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const response = await fetch(`${TELEGRAM_WORKER_URL}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    return { ok: response.ok, ...data };
  } catch (error) {
    return {
      ok: false,
      telethonConfigured: false,
      telethonConnected: false,
      contactsSheetConfigured: false,
      workerAuthConfigured: Boolean(WORKER_AUTH_TOKEN),
      error: safeErrorMessage(error),
    };
  }
}

const routeDeps = {
  ACTION_PRESETS_PATH,
  ACTION_PRESETS_CACHE_PATH,
  ACTION_PRESETS_CACHE_TTL_MS,
  ACTION_PRESETS_SHEET_NAME,
  ACTION_PRESETS_SPREADSHEET_ID,
  aggregateContacts,
  APP_URL,
  appendSheetObject,
  assertContactVersion,
  base64url,
  batchUpdateSheetRanges,
  batchUpdateSpreadsheet,
  buildActionCellUpdates,
  buildActionPresetSummary,
  buildActionRowPayload,
  buildChannelTags,
  buildCollectionActionGroups,
  buildFetchChannelLookupKeys,
  buildFetchChannelsResponse,
  buildFollowerActionModel,
  buildAdminReportBuffer,
  buildBaseReportFilename,
  buildNextVersionedFilename,
  buildPublicReportBuffer,
  buildPublicDriveDownloadUrl,
  buildSheetsUrl,
  cachedOwnerDriveToken,
  cachedToken,
  canUseOwnerDriveOAuth,
  clearSheetRow,
  colToLetter,
  compactString,
  CONTACTS_HEADERS,
  CONTACTS_SESSION_SECRET,
  CONTACTS_SHEET_ID,
  cors,
  createContactsSessionToken,
  crypto,
  didJoinFromChatMember,
  DRAFT_SPREADSHEET_ID,
  DRIVE_FOLDER_ID,
  ensureContactsInfra,
  ensureContactsSessionCookie,
  ensureFetchChannelsCacheDir,
  ensureFetchChannelSheetShape,
  ensureRuntimeDataDir,
  ensureSheetTab,
  EXAM_STATUS_HEADER_ALIASES,
  ExamStatusUtils,
  expandCollectionActionUpdates,
  express,
  extractAppendedRowIndex,
  extractDriveFileId,
  extractJoinRow,
  fetch,
  FETCH_CHANNELS_CACHE_PATH,
  FETCH_SHEETS_CACHE_PATH,
  FETCH_SHEETS_CACHE_TTL_MS,
  FETCH_SPREADSHEET_OPTIONS,
  findHeaderIndex,
  FormData,
  fs,
  getAccessToken,
  getAppBaseUrl,
  getCell,
  getDriveAccessToken,
  getDriveFileMeta,
  getExamStatusCell,
  getFetchSpreadsheetByKey,
  getFetchSpreadsheetOptions,
  getOwnerDriveAccessToken,
  getSheetValues,
  getSpreadsheetMetadata,
  getWorkerHealth,
  GOOGLE_CLIENT_ID,
  googleJson,
  HEADER_ROW,
  HIDDEN_FETCH_CHANNEL_TAG,
  inferActionSheetColumns,
  inferFetchChannelColumns,
  isHiddenFetchChannel,
  isMemberStatus,
  isRecoverableOwnerDriveError,
  jsonResponseSafe,
  listSpreadsheetTabs,
  listSpreadsheetTabsCached,
  loadActionSheetRows,
  loadContactsState,
  loadDiscoveredChannelsFromWorkerStore,
  loadFetchChannels,
  loadFetchChannelSheetState,
  loadSheetObjects,
  loadSharedActionPresets,
  makeContactVersion,
  makeId,
  matchJoinToContactId,
  mergeDiscoveredChannelsIntoSheet,
  multer,
  normalizeAccountValue,
  normalizeActionPreset,
  normalizeChannelRecord,
  normalizeFetchTagValue,
  normalizeHeaderName,
  normalizeManualChannelLink,
  normalizeTelegramUsername,
  nowIso,
  objectToRow,
  OWNER_GOOGLE_CLIENT_ID,
  OWNER_GOOGLE_CLIENT_SECRET,
  OWNER_GOOGLE_REFRESH_TOKEN,
  ownerDriveTokenExpiry,
  parseCookies,
  path,
  proxyWorker,
  quoteSheetName,
  RAW_TELEGRAM_WORKER_URL,
  readActionPresets,
  readFetchChannelsCache,
  readFetchSheetsCache,
  readJsonFileSafe,
  rebuildFetchChannelsCacheFromSheet,
  redactSensitiveText,
  refreshExamStatuses,
  requireContactsSession,
  resolveExamStatusColumns,
  resolveMergedChannel,
  rollbackSheetChanges,
  ROOT_DIR,
  rowsToObjects,
  safeErrorMessage,
  sanitizeFetchJobPayload,
  sendSafeError,
  serializePresetForResponse,
  SERVICE_ACCOUNT,
  SHEET_ID,
  SHEET_TAB,
  signSessionPayload,
  sleep,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_FETCH_CHANNELS_SHEET_NAME,
  TELEGRAM_FETCH_CHANNELS_SPREADSHEET_ID,
  TELEGRAM_FETCH_DEFAULT_SHEET,
  TELEGRAM_SPREADSHEET_ID,
  TELEGRAM_WEBHOOK_SECRET,
  TELEGRAM_WORKER_URL,
  telegramApi,
  tokenExpiry,
  updateSheetObject,
  updateSheetValues,
  upload,
  uploadBufferToDrive,
  validateContactPayload,
  verifyContactsSessionToken,
  waitForWorkerJob,
  WORKER_AUTH_TOKEN,
  WORKER_PROXY_ERROR,
  WORKER_URL_VALID,
  writeActionPresets,
  writeActionPresetsCache,
  writeFetchChannelsCache,
  writeFetchSheetsCache,
  writeJsonFileSafe,
  writeWholeSheet,
  saveSharedActionPresets,
};

registerStaticRoutes(app, routeDeps);


app.use('/api/contacts', requireContactsSession);
app.use('/api/telegram/joins', requireContactsSession);
app.use('/api/telegram/bot-info', requireContactsSession);
app.use('/api/telegram/webhook-info', requireContactsSession);
app.use('/api/telegram/register-webhook', requireContactsSession);
app.use('/api/telegram/channels', requireContactsSession);
app.use('/api/telegram/jobs', requireContactsSession);
app.use('/api/telegram/fetch', requireContactsSession);

registerExamCoreRoutes(app, routeDeps);

registerTelegramFetchRoutes(app, routeDeps);

registerContactRoutes(app, routeDeps);

registerTelegramBotRoutes(app, routeDeps);

module.exports = app;


