require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const FormData = require('form-data');
const crypto = require('crypto');
const { buildBaseReportFilename, extractDriveFileId } = require('./reports/reportPdfShared');
const { buildAdminReportBuffer } = require('./reports/adminReportPdf');
const { buildPublicReportBuffer } = require('./reports/publicReportPdf');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/exam', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(`${__dirname}/public/exam.html`);
});

app.get(['/contacts', '/contacts/', '/contacts/index.html'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  ensureContactsSessionCookie(req, res);
  res.sendFile(`${__dirname}/public/contacts/index.html`);
});

app.get(['/telegram', '/telegram/', '/telegram/index.html'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  ensureContactsSessionCookie(req, res);
  res.sendFile(`${__dirname}/public/telegram/index.html`);
});

app.use(express.static('public', {
  setHeaders(res, path) {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
  },
}));
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
const WORKER_AUTH_TOKEN = process.env.WORKER_AUTH_TOKEN || '';
const CONTACTS_SESSION_SECRET = process.env.CONTACTS_SESSION_SECRET || SERVICE_ACCOUNT.private_key_id || '';
const RAW_TELEGRAM_WORKER_URL = (process.env.TELEGRAM_WORKER_URL || '').trim();
const TELEGRAM_WORKER_URL = RAW_TELEGRAM_WORKER_URL.replace(/\/+$/, '');
const WORKER_URL_VALID = !TELEGRAM_WORKER_URL || /^https?:\/\//i.test(TELEGRAM_WORKER_URL);
const WORKER_PROXY_ERROR = WORKER_URL_VALID
  ? ''
  : 'TELEGRAM_WORKER_URL must start with http:// or https://. Worker proxy endpoints are disabled.';

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

async function listSpreadsheetTabs(token, spreadsheetId) {
  const metadata = await getSpreadsheetMetadata(token, spreadsheetId);
  return (metadata.sheets || []).map((sheet) => ({
    title: sheet.properties?.title || '',
    sheetId: sheet.properties?.sheetId,
    index: sheet.properties?.index,
  })).filter((sheet) => sheet.title);
}

async function loadFetchChannels(token) {
  if (!TELEGRAM_FETCH_CHANNELS_SPREADSHEET_ID) return [];
  const values = await getSheetValues(token, TELEGRAM_FETCH_CHANNELS_SPREADSHEET_ID, `${TELEGRAM_FETCH_CHANNELS_SHEET_NAME}!A1:ZZ`).catch(() => ({ values: [] }));
  const rows = values.values || [];
  const headers = rows[0] || [];
  return rows.slice(1).map((row) => normalizeChannelRecord(headers, row)).filter((channel) => channel.id || channel.username || channel.name);
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

  const rangeMode = compactString(body?.rangeMode) === 'message_id' ? 'message_id' : 'date';
  const dateFrom = compactString(body?.dateFrom);
  const startMessageId = compactString(body?.startMessageId);
  const endMessageId = compactString(body?.endMessageId);
  if (rangeMode === 'message_id' && !startMessageId && !endMessageId) {
    throw new Error('Provide at least one message ID boundary.');
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
    throw new Error(`Owner Drive token error: ${JSON.stringify(data)}`);
  }

  cachedOwnerDriveToken = data.access_token;
  ownerDriveTokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  return cachedOwnerDriveToken;
}

async function googleJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let parsed;
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
  if (!token) throw new Error('Missing owner Google Drive access token.');
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
    const response = await fetch(`${TELEGRAM_WORKER_URL}/health`);
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

app.use('/api/contacts', requireContactsSession);
app.use('/api/telegram/joins', requireContactsSession);
app.use('/api/telegram/bot-info', requireContactsSession);
app.use('/api/telegram/webhook-info', requireContactsSession);
app.use('/api/telegram/register-webhook', requireContactsSession);
app.use('/api/telegram/channels', requireContactsSession);
app.use('/api/telegram/jobs', requireContactsSession);
app.use('/api/telegram/fetch', requireContactsSession);

app.get('/api/sheet', async (req, res) => {
  try {
    const token = await getAccessToken();
    res.json(await googleJson(buildSheetsUrl(SHEET_ID, SHEET_TAB), { headers: { Authorization: `Bearer ${token}` } }));
  } catch (error) {
    sendSafeError(res, 500, error);
  }
});

app.put('/api/sheet/:rowIndex', async (req, res) => {
  try {
    const token = await getAccessToken();
    const rowIndex = parseInt(req.params.rowIndex, 10);
    const cells = Array.isArray(req.body?.cells) ? req.body.cells : [];
    await updateSheetValues(token, SHEET_ID, `${SHEET_TAB}!A${rowIndex}`, [cells]);
    res.json({ ok: true });
  } catch (error) {
    sendSafeError(res, 500, error);
  }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const token = await getOwnerDriveAccessToken();
    if (!req.file) return res.status(400).json({ error: 'Missing uploaded file.' });
    const uploaded = await uploadBufferToDrive(req.file.buffer, req.body.filename || req.file.originalname, token);
    res.json({ url: uploaded.url });
  } catch (error) {
    sendSafeError(res, 500, error);
  }
});

app.post('/api/report-pdf', async (req, res) => {
  try {
    const token = await getOwnerDriveAccessToken();
    const { type, data } = req.body || {};
    if (!['admin', 'public'].includes(type)) return res.status(400).json({ error: 'Invalid report type. Use "admin" or "public".' });
    if (!data || !data.module || !data.wilaya || !data.year) return res.status(400).json({ error: 'Missing report data.' });

    const baseName = buildBaseReportFilename(data);
    const suffix = type === 'admin' ? 'Admin_Report' : 'Public_Report';
    const existingUrl = type === 'admin' ? data.adminReportUrl : data.publicReportUrl;
    let existingName = '';
    if (existingUrl) {
      const existingId = extractDriveFileId(existingUrl);
      if (existingId) {
        try {
          const meta = await getDriveFileMeta(existingId, token);
          existingName = meta.name || '';
        } catch (error) {}
      }
    }
    const filename = buildNextVersionedFilename(`${baseName}_${suffix}`, 'pdf', existingName);
    const pdfBuffer = type === 'admin' ? buildAdminReportBuffer(data) : buildPublicReportBuffer(data);
    const uploaded = await uploadBufferToDrive(pdfBuffer, filename, token);
    res.json({ type, filename, url: uploaded.url });
  } catch (error) {
    sendSafeError(res, 500, error);
  }
});

app.get('/api/drive-download', async (req, res) => {
  const fileId = compactString(req.query.id).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!fileId) return res.status(400).json({ error: 'Missing file id' });
  try {
    const token = await getOwnerDriveAccessToken();
    const { name, mimeType } = await getDriveFileMeta(fileId, token);
    const fileRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!fileRes.ok) throw new Error(await fileRes.text());
    res.setHeader('Content-Type', mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name || fileId)}"`);
    fileRes.body.pipe(res);
  } catch (error) {
    res.redirect(buildPublicDriveDownloadUrl(fileId));
  }
});

app.get('/api/drive-meta', async (req, res) => {
  const fileId = compactString(req.query.id).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!fileId) return res.status(400).json({ error: 'Missing file id' });
  try {
    const token = await getOwnerDriveAccessToken();
    res.json(await getDriveFileMeta(fileId, token));
  } catch (error) {
    sendSafeError(res, 500, error);
  }
});

app.get('/api/config', (req, res) => {
  res.json({
    sheetTab: SHEET_TAB,
    headerRow: HEADER_ROW,
    googleClientId: GOOGLE_CLIENT_ID,
    contactsConfigured: Boolean(CONTACTS_SHEET_ID),
    telegramBotConfigured: Boolean(TELEGRAM_BOT_TOKEN),
    telegramWorkerConfigured: Boolean(TELEGRAM_WORKER_URL) && WORKER_URL_VALID,
    telegramWorkerError: WORKER_PROXY_ERROR,
  });
});

app.get('/api/telegram/fetch/config', async (req, res) => {
  try {
    const workerHealth = await getWorkerHealth();
    res.json({
      workerHealth,
      channelsSheetName: TELEGRAM_FETCH_CHANNELS_SHEET_NAME,
      defaultSheetName: TELEGRAM_FETCH_DEFAULT_SHEET,
      spreadsheets: getFetchSpreadsheetOptions(),
    });
  } catch (error) {
    sendSafeError(res, 500, error);
  }
});

app.get('/api/telegram/fetch/spreadsheets', async (req, res) => {
  try {
    res.json({ spreadsheets: getFetchSpreadsheetOptions() });
  } catch (error) {
    sendSafeError(res, 500, error);
  }
});

app.get('/api/telegram/fetch/sheets', async (req, res) => {
  try {
    const spreadsheet = getFetchSpreadsheetByKey(compactString(req.query.spreadsheet));
    if (!spreadsheet) return res.status(400).json({ error: 'Unknown spreadsheet.' });
    const token = await getAccessToken();
    const sheets = await listSpreadsheetTabs(token, spreadsheet.spreadsheetId);
    res.json({ spreadsheet, sheets });
  } catch (error) {
    sendSafeError(res, 500, error);
  }
});

app.get('/api/telegram/fetch/channels', async (req, res) => {
  try {
    const token = await getAccessToken();
    const channels = await loadFetchChannels(token);
    const groups = [...new Set(channels.flatMap((channel) => channel.tags))].sort((a, b) => a.localeCompare(b));
    res.json({
      spreadsheetId: TELEGRAM_FETCH_CHANNELS_SPREADSHEET_ID,
      sheetName: TELEGRAM_FETCH_CHANNELS_SHEET_NAME,
      groups,
      channels,
    });
  } catch (error) {
    sendSafeError(res, 500, error);
  }
});

app.get('/api/contacts', async (req, res) => {
  try {
    const token = await getAccessToken();
    const state = await loadContactsState(token);
    const aggregated = aggregateContacts(state);
    res.json({
      contacts: aggregated.contacts,
      unmatchedJoins: aggregated.unmatchedJoins,
      channels: aggregated.channels.map((channel) => ({
        rowIndex: channel._rowIndex,
        id: channel.ID_Channel,
        name: channel.Channel_Name,
        username: channel.Username,
        type: channel.Type,
        membersCount: channel.Members_Count,
        lastSync: channel.Last_Sync,
      })),
      jobs: aggregated.jobs.map((job) => ({
        rowIndex: job._rowIndex,
        id: job.ID_Job,
        type: job.Type,
        channel: job.Channel,
        status: job.Status,
        progress: job.Progress,
        total: job.Total,
        started: job.Started,
        finished: job.Finished,
        error: job.Error,
        summary: job.Summary_JSON,
        workerJobId: job.Worker_Job_ID,
      })),
    });
  } catch (error) {
    sendSafeError(res, 500, error);
  }
});

app.post('/api/contacts', async (req, res) => {
  try {
    const token = await getAccessToken();
    const payload = validateContactPayload(req.body || {});
    const timestamp = nowIso();
    const contactId = makeId('contact');
    const contactRow = {
      ID_Contact: contactId,
      Full_Name: payload.fullName,
      Notes: payload.notes,
      Tags: payload.tags,
      Created_At: timestamp,
      Updated_At: timestamp,
      Created_By: payload.updatedBy,
      Updated_By: payload.updatedBy,
    };

    await appendSheetObject(token, CONTACTS_SHEET_ID, 'ZED_Contacts', CONTACTS_HEADERS.ZED_Contacts, contactRow);
    for (const account of payload.accounts) {
      await appendSheetObject(token, CONTACTS_SHEET_ID, 'ZED_Accounts', CONTACTS_HEADERS.ZED_Accounts, {
        ID_Account: makeId('acct'),
        ID_Contact: contactId,
        Account_Type: account.type,
        Value: account.value,
        Normalized_Value: account.normalizedValue,
        TG_User_ID: account.tgUserId,
        TG_Username: account.tgUsername,
        TG_Display_Name: account.tgDisplayName,
        Source: account.source,
        Created_At: timestamp,
        Updated_At: timestamp,
      });
    }
    res.json({ ok: true, id: contactId });
  } catch (error) {
    sendSafeError(res, 400, error);
  }
});

app.put('/api/contacts/:rowIndex', async (req, res) => {
  try {
    const token = await getAccessToken();
    const rowIndex = parseInt(req.params.rowIndex, 10);
    const payload = validateContactPayload(req.body || {});
    const state = await loadContactsState(token);
    const contact = state.contacts.find((entry) => entry._rowIndex === rowIndex);
    if (!contact) return res.status(404).json({ error: 'Contact not found.' });
    assertContactVersion(contact, req.body?.version);

    const timestamp = nowIso();
    const originalContact = { ...contact };
    const rollbackChanges = [];
    contact.Full_Name = payload.fullName;
    contact.Notes = payload.notes;
    contact.Tags = payload.tags;
    contact.Updated_At = timestamp;
    contact.Updated_By = payload.updatedBy;

    const existingAccounts = state.accounts.filter((account) => account.ID_Contact === contact.ID_Contact);
    const existingById = new Map(existingAccounts.map((account) => [account.ID_Account, account]));
    const seenAccountIds = new Set();
    const refreshedAccounts = payload.accounts.map((account) => {
      const existing = existingById.get(account.id) || null;
      if (existing?.ID_Account) seenAccountIds.add(existing.ID_Account);
      return {
        ID_Account: existing?.ID_Account || makeId('acct'),
        ID_Contact: contact.ID_Contact,
        Account_Type: account.type,
        Value: account.value,
        Normalized_Value: account.normalizedValue,
        TG_User_ID: account.tgUserId,
        TG_Username: account.tgUsername,
        TG_Display_Name: account.tgDisplayName,
        Source: account.source,
        Created_At: existing?.Created_At || timestamp,
        Updated_At: timestamp,
        _rowIndex: existing?._rowIndex,
      };
    });

    const allAccounts = refreshedAccounts.concat(state.accounts.filter((account) => account.ID_Contact !== contact.ID_Contact));
    const joinsToUpdate = [];
    for (const join of state.joins) {
      const nextMatch = (join.Matched_ID_Contact === contact.ID_Contact || !join.Matched_ID_Contact)
        ? matchJoinToContactId(join, allAccounts)
        : join.Matched_ID_Contact;
      if (join.Matched_ID_Contact !== nextMatch) {
        joinsToUpdate.push({ original: { ...join }, updated: { ...join, Matched_ID_Contact: nextMatch } });
        join.Matched_ID_Contact = nextMatch;
      }
    }

    try {
      rollbackChanges.push({ kind: 'restore', tabName: 'ZED_Contacts', headers: CONTACTS_HEADERS.ZED_Contacts, rowIndex: contact._rowIndex, row: originalContact });
      await updateSheetObject(token, CONTACTS_SHEET_ID, 'ZED_Contacts', CONTACTS_HEADERS.ZED_Contacts, contact._rowIndex, contact);

      for (const account of refreshedAccounts) {
        if (account._rowIndex) {
          const original = existingById.get(account.ID_Account);
          rollbackChanges.push({ kind: 'restore', tabName: 'ZED_Accounts', headers: CONTACTS_HEADERS.ZED_Accounts, rowIndex: account._rowIndex, row: { ...original } });
          await updateSheetObject(token, CONTACTS_SHEET_ID, 'ZED_Accounts', CONTACTS_HEADERS.ZED_Accounts, account._rowIndex, account);
        } else {
          const appendResult = await appendSheetObject(token, CONTACTS_SHEET_ID, 'ZED_Accounts', CONTACTS_HEADERS.ZED_Accounts, account);
          const appendedRowIndex = extractAppendedRowIndex(appendResult);
          if (appendedRowIndex) {
            rollbackChanges.push({ kind: 'clear', tabName: 'ZED_Accounts', headers: CONTACTS_HEADERS.ZED_Accounts, rowIndex: appendedRowIndex });
          }
        }
      }

      for (const existing of existingAccounts) {
        if (!seenAccountIds.has(existing.ID_Account)) {
          rollbackChanges.push({ kind: 'restore', tabName: 'ZED_Accounts', headers: CONTACTS_HEADERS.ZED_Accounts, rowIndex: existing._rowIndex, row: { ...existing } });
          await clearSheetRow(token, CONTACTS_SHEET_ID, 'ZED_Accounts', CONTACTS_HEADERS.ZED_Accounts, existing._rowIndex);
        }
      }

      for (const joinChange of joinsToUpdate) {
        rollbackChanges.push({ kind: 'restore', tabName: 'Telegram_Joins', headers: CONTACTS_HEADERS.Telegram_Joins, rowIndex: joinChange.original._rowIndex, row: joinChange.original });
        await updateSheetObject(token, CONTACTS_SHEET_ID, 'Telegram_Joins', CONTACTS_HEADERS.Telegram_Joins, joinChange.updated._rowIndex, joinChange.updated);
      }
    } catch (writeError) {
      await rollbackSheetChanges(token, rollbackChanges);
      const error = new Error(`Contact update could not be fully applied and was rolled back. Please reload and try again. ${safeErrorMessage(writeError)}`);
      error.statusCode = 409;
      throw error;
    }
    res.json({ ok: true, id: contact.ID_Contact });
  } catch (error) {
    sendSafeError(res, error.statusCode || 400, error);
  }
});

app.delete('/api/contacts/:rowIndex', async (req, res) => {
  try {
    const token = await getAccessToken();
    const rowIndex = parseInt(req.params.rowIndex, 10);
    const state = await loadContactsState(token);
    const contact = state.contacts.find((entry) => entry._rowIndex === rowIndex);
    if (!contact) return res.status(404).json({ error: 'Contact not found.' });
    assertContactVersion(contact, req.body?.version || req.query?.version);
    const rollbackChanges = [];
    const originalContact = { ...contact };
    const contactAccounts = state.accounts.filter((entry) => entry.ID_Contact === contact.ID_Contact);
    const joinsToUnlink = state.joins.filter((entry) => entry.Matched_ID_Contact === contact.ID_Contact).map((join) => ({ original: { ...join }, updated: { ...join, Matched_ID_Contact: '' } }));

    try {
      rollbackChanges.push({ kind: 'restore', tabName: 'ZED_Contacts', headers: CONTACTS_HEADERS.ZED_Contacts, rowIndex: contact._rowIndex, row: originalContact });
      await clearSheetRow(token, CONTACTS_SHEET_ID, 'ZED_Contacts', CONTACTS_HEADERS.ZED_Contacts, contact._rowIndex);

      for (const account of contactAccounts) {
        rollbackChanges.push({ kind: 'restore', tabName: 'ZED_Accounts', headers: CONTACTS_HEADERS.ZED_Accounts, rowIndex: account._rowIndex, row: { ...account } });
        await clearSheetRow(token, CONTACTS_SHEET_ID, 'ZED_Accounts', CONTACTS_HEADERS.ZED_Accounts, account._rowIndex);
      }

      for (const joinChange of joinsToUnlink) {
        rollbackChanges.push({ kind: 'restore', tabName: 'Telegram_Joins', headers: CONTACTS_HEADERS.Telegram_Joins, rowIndex: joinChange.original._rowIndex, row: joinChange.original });
        await updateSheetObject(token, CONTACTS_SHEET_ID, 'Telegram_Joins', CONTACTS_HEADERS.Telegram_Joins, joinChange.updated._rowIndex, joinChange.updated);
      }
    } catch (writeError) {
      await rollbackSheetChanges(token, rollbackChanges);
      const error = new Error(`Contact delete could not be fully applied and was rolled back. Please reload and try again. ${safeErrorMessage(writeError)}`);
      error.statusCode = 409;
      throw error;
    }
    res.json({ ok: true });
  } catch (error) {
    sendSafeError(res, error.statusCode || 400, error);
  }
});

app.post('/api/telegram/joins/:joinId/link', async (req, res) => {
  try {
    const token = await getAccessToken();
    const state = await loadContactsState(token);
    const join = state.joins.find((entry) => entry.ID_Join === req.params.joinId);
    if (!join) return res.status(404).json({ error: 'Join record not found.' });
    const contactId = compactString(req.body?.contactId);
    if (!state.contacts.some((contact) => contact.ID_Contact === contactId)) {
      return res.status(400).json({ error: 'Invalid contact selection.' });
    }
    join.Matched_ID_Contact = contactId;
    await updateSheetObject(token, CONTACTS_SHEET_ID, 'Telegram_Joins', CONTACTS_HEADERS.Telegram_Joins, join._rowIndex, join);
    res.json({ ok: true });
  } catch (error) {
    sendSafeError(res, 400, error);
  }
});

app.post('/api/telegram/webhook', async (req, res) => {
  try {
    if (!TELEGRAM_WEBHOOK_SECRET) {
      return res.status(503).json({ error: 'TELEGRAM_WEBHOOK_SECRET is not configured. Webhook ingestion is disabled.' });
    }
    const providedSecret = compactString(req.get('x-telegram-bot-api-secret-token'));
    if (providedSecret !== TELEGRAM_WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'Invalid Telegram webhook secret.' });
    }
    if (!CONTACTS_SHEET_ID) return res.json({ ok: true, skipped: 'CONTACTS_SHEET_ID not configured' });
    const token = await getAccessToken();
    const state = await loadContactsState(token);
    const payload = req.body || {};
    const updateId = compactString(payload.update_id);
    const candidateUpdates = [];

    if (payload.chat_member && didJoinFromChatMember(payload.chat_member)) {
      candidateUpdates.push({ ...payload.chat_member, _updateId: updateId, _raw: payload });
    }

    if (Array.isArray(payload.message?.new_chat_members)) {
      for (const member of payload.message.new_chat_members) {
        candidateUpdates.push({
          chat: payload.message.chat,
          new_chat_member: { status: 'member', user: member },
          old_chat_member: { status: 'left' },
          _updateId: updateId ? `${updateId}_${member.id}` : `${payload.message.message_id}_${member.id}`,
          _raw: payload,
        });
      }
    }

    let created = 0;
    for (const candidate of candidateUpdates) {
      const exists = state.joins.some((join) => compactString(join.Update_ID) === compactString(candidate._updateId));
      if (exists) continue;
      const joinRow = extractJoinRow(candidate, state.accounts);
      state.joins.push(joinRow);
      await appendSheetObject(token, CONTACTS_SHEET_ID, 'Telegram_Joins', CONTACTS_HEADERS.Telegram_Joins, joinRow);
      created += 1;
    }
    res.json({ ok: true, created });
  } catch (error) {
    sendSafeError(res, 500, error);
  }
});

app.get('/api/telegram/bot-info', async (req, res) => {
  try {
    const info = await telegramApi('getMe');
    if (!info.configured) return res.json({ configured: false });
    const bot = info.result || {};
    res.json({
      configured: true,
      id: bot.id,
      name: bot.first_name || '',
      username: bot.username || '',
      canJoinGroups: Boolean(bot.can_join_groups),
      canReadAllGroupMessages: Boolean(bot.can_read_all_group_messages),
      supportsInlineQueries: Boolean(bot.supports_inline_queries),
    });
  } catch (error) {
    sendSafeError(res, 502, error);
  }
});

app.get('/api/telegram/webhook-info', async (req, res) => {
  try {
    const info = await telegramApi('getWebhookInfo');
    if (!info.configured) return res.json({ configured: false });
    const webhook = info.result || {};
    res.json({
      configured: true,
      url: webhook.url || '',
      pendingUpdateCount: webhook.pending_update_count || 0,
      lastErrorDate: webhook.last_error_date || 0,
      lastErrorMessage: webhook.last_error_message || '',
      hasCustomCertificate: Boolean(webhook.has_custom_certificate),
      allowedUpdates: webhook.allowed_updates || [],
    });
  } catch (error) {
    sendSafeError(res, 502, error);
  }
});

app.post('/api/telegram/register-webhook', async (req, res) => {
  try {
    if (!TELEGRAM_BOT_TOKEN) return res.json({ configured: false });
    if (!TELEGRAM_WEBHOOK_SECRET) {
      return res.status(503).json({ error: 'TELEGRAM_WEBHOOK_SECRET is required before registering the webhook.' });
    }
    const baseUrl = getAppBaseUrl(req);
    if (!/^https?:\/\//i.test(baseUrl)) {
      return res.status(400).json({ error: 'APP_URL or request host did not produce a valid absolute URL.' });
    }
    const webhookUrl = `${baseUrl.replace(/\/+$/, '')}/api/telegram/webhook`;
    const result = await telegramApi('setWebhook', {
      url: webhookUrl,
      secret_token: TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ['chat_member'],
    });
    res.json({
      configured: true,
      ok: Boolean(result.ok),
      description: result.description || '',
      url: webhookUrl,
    });
  } catch (error) {
    sendSafeError(res, 502, error);
  }
});

app.get('/api/telegram/channels', async (req, res) => {
  try {
    const token = await getAccessToken();
    await ensureContactsInfra(token);
    const channels = await loadSheetObjects(token, CONTACTS_SHEET_ID, 'ZED_Channels', CONTACTS_HEADERS.ZED_Channels);
    res.json({
      workerConfigured: Boolean(TELEGRAM_WORKER_URL) && WORKER_URL_VALID,
      channels: channels.map((channel) => ({
        rowIndex: channel._rowIndex,
        id: channel.ID_Channel,
        name: channel.Channel_Name,
        username: channel.Username,
        type: channel.Type,
        membersCount: channel.Members_Count,
        lastSync: channel.Last_Sync,
      })),
    });
  } catch (error) {
    sendSafeError(res, 500, error);
  }
});

app.post('/api/telegram/fetch/jobs', async (req, res) => {
  try {
    if (!WORKER_URL_VALID) {
      return res.status(503).json({ error: WORKER_PROXY_ERROR || 'Telegram worker not configured.' });
    }
    const type = compactString(req.body?.type);
    if (!['fetch-messages', 'execute-actions'].includes(type)) {
      return res.status(400).json({ error: 'Unsupported fetch job type.' });
    }

    const spreadsheet = getFetchSpreadsheetByKey(compactString(req.body?.spreadsheetKey));
    if (!spreadsheet) return res.status(400).json({ error: 'Choose a valid spreadsheet.' });

    if (type === 'fetch-messages') {
      const payload = sanitizeFetchJobPayload(req.body || {}, spreadsheet);
      return res.json(await proxyWorker('/jobs/fetch-messages', 'POST', payload));
    }

    const sheetName = compactString(req.body?.sheetName);
    if (!sheetName) return res.status(400).json({ error: 'sheetName is required.' });
    return res.json(await proxyWorker('/jobs/execute-actions', 'POST', {
      spreadsheetKey: spreadsheet.key,
      spreadsheetId: spreadsheet.spreadsheetId,
      sheetName,
    }));
  } catch (error) {
    sendSafeError(res, 503, error);
  }
});

app.get('/api/telegram/fetch/jobs/:jobId', async (req, res) => {
  try {
    if (!WORKER_URL_VALID) {
      return res.status(503).json({ error: WORKER_PROXY_ERROR || 'Telegram worker not configured.' });
    }
    res.json(await proxyWorker(`/jobs/${encodeURIComponent(req.params.jobId)}`, 'GET'));
  } catch (error) {
    sendSafeError(res, 503, error);
  }
});

app.post('/api/telegram/jobs', async (req, res) => {
  try {
    if (!WORKER_URL_VALID) {
      return res.status(503).json({ error: WORKER_PROXY_ERROR || 'Telegram worker not configured.' });
    }
    const type = compactString(req.body?.type);
    if (!['list-channels', 'fetch-members'].includes(type)) {
      return res.status(400).json({ error: 'Unsupported job type.' });
    }
    const path = type === 'list-channels' ? '/jobs/list-channels' : '/jobs/fetch-members';
    const payload = type === 'fetch-members'
      ? {
          channelId: compactString(req.body?.channelId),
          channelUsername: compactString(req.body?.channelUsername),
          channelName: compactString(req.body?.channelName),
        }
      : {};
    res.json(await proxyWorker(path, 'POST', payload));
  } catch (error) {
    sendSafeError(res, 503, error);
  }
});

app.get('/api/telegram/jobs/:jobId', async (req, res) => {
  try {
    if (!WORKER_URL_VALID) {
      return res.status(503).json({ error: WORKER_PROXY_ERROR || 'Telegram worker not configured.' });
    }
    res.json(await proxyWorker(`/jobs/${encodeURIComponent(req.params.jobId)}`, 'GET'));
  } catch (error) {
    sendSafeError(res, 503, error);
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Exam Tracker backend running on port ${PORT}`);
});
