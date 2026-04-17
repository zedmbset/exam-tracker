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
app.use(express.static('public', {
  setHeaders(res, path) {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
  },
}));

app.get('/exam', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(`${__dirname}/public/exam.html`);
});

app.get(['/contacts', '/contacts/'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(`${__dirname}/public/contacts/index.html`);
});

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
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_WORKER_URL = (process.env.TELEGRAM_WORKER_URL || '').replace(/\/+$/, '');

const CONTACTS_HEADERS = {
  ZED_Contacts: ['ID_Contact', 'Full_Name', 'Notes', 'Tags', 'Created_At', 'Updated_At', 'Created_By', 'Updated_By'],
  ZED_Accounts: ['ID_Account', 'ID_Contact', 'Account_Type', 'Value', 'Normalized_Value', 'TG_User_ID', 'TG_Username', 'TG_Display_Name', 'Source', 'Created_At', 'Updated_At'],
  Telegram_Joins: ['ID_Join', 'Chat_ID', 'Channel_Name', 'Channel_Username', 'TG_User_ID', 'TG_Username', 'TG_Display_Name', 'Joined_At', 'Matched_ID_Contact', 'Update_ID', 'Raw_JSON'],
  ZED_Channels: ['ID_Channel', 'Channel_Name', 'Username', 'Type', 'Members_Count', 'Last_Sync'],
  ZED_Jobs: ['ID_Job', 'Type', 'Channel', 'Status', 'Progress', 'Total', 'Started', 'Finished', 'Error', 'Summary_JSON', 'Worker_Job_ID'],
};

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
  const response = await fetch(`${TELEGRAM_WORKER_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
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

app.get('/api/sheet', async (req, res) => {
  try {
    const token = await getAccessToken();
    res.json(await googleJson(buildSheetsUrl(SHEET_ID, SHEET_TAB), { headers: { Authorization: `Bearer ${token}` } }));
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const token = await getOwnerDriveAccessToken();
    if (!req.file) return res.status(400).json({ error: 'Missing uploaded file.' });
    const uploaded = await uploadBufferToDrive(req.file.buffer, req.body.filename || req.file.originalname, token);
    res.json({ url: uploaded.url });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/config', (req, res) => {
  res.json({
    sheetTab: SHEET_TAB,
    headerRow: HEADER_ROW,
    googleClientId: GOOGLE_CLIENT_ID,
    contactsConfigured: Boolean(CONTACTS_SHEET_ID),
    telegramBotConfigured: Boolean(TELEGRAM_BOT_TOKEN),
    telegramWorkerConfigured: Boolean(TELEGRAM_WORKER_URL),
  });
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
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/contacts', async (req, res) => {
  try {
    const token = await getAccessToken();
    const payload = validateContactPayload(req.body || {});
    const state = await loadContactsState(token);
    const timestamp = nowIso();
    const contactId = makeId('contact');

    state.contacts.push({
      ID_Contact: contactId,
      Full_Name: payload.fullName,
      Notes: payload.notes,
      Tags: payload.tags,
      Created_At: timestamp,
      Updated_At: timestamp,
      Created_By: payload.updatedBy,
      Updated_By: payload.updatedBy,
    });

    for (const account of payload.accounts) {
      state.accounts.push({
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

    await writeWholeSheet(token, CONTACTS_SHEET_ID, 'ZED_Contacts', CONTACTS_HEADERS.ZED_Contacts, state.contacts);
    await writeWholeSheet(token, CONTACTS_SHEET_ID, 'ZED_Accounts', CONTACTS_HEADERS.ZED_Accounts, state.accounts);
    res.json({ ok: true, id: contactId });
  } catch (error) {
    res.status(400).json({ error: error.message });
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

    contact.Full_Name = payload.fullName;
    contact.Notes = payload.notes;
    contact.Tags = payload.tags;
    contact.Updated_At = nowIso();
    contact.Updated_By = payload.updatedBy;

    const remainingAccounts = state.accounts.filter((account) => account.ID_Contact !== contact.ID_Contact);
    const existingById = new Map(state.accounts.filter((account) => account.ID_Contact === contact.ID_Contact).map((account) => [account.ID_Account, account]));
    const refreshedAccounts = payload.accounts.map((account) => {
      const existing = existingById.get(account.id) || {};
      return {
        ID_Account: existing.ID_Account || makeId('acct'),
        ID_Contact: contact.ID_Contact,
        Account_Type: account.type,
        Value: account.value,
        Normalized_Value: account.normalizedValue,
        TG_User_ID: account.tgUserId,
        TG_Username: account.tgUsername,
        TG_Display_Name: account.tgDisplayName,
        Source: account.source,
        Created_At: existing.Created_At || nowIso(),
        Updated_At: nowIso(),
      };
    });
    state.accounts = [...remainingAccounts, ...refreshedAccounts];

    for (const join of state.joins) {
      if (join.Matched_ID_Contact === contact.ID_Contact || !join.Matched_ID_Contact) {
        join.Matched_ID_Contact = matchJoinToContactId(join, state.accounts);
      }
    }

    await writeWholeSheet(token, CONTACTS_SHEET_ID, 'ZED_Contacts', CONTACTS_HEADERS.ZED_Contacts, state.contacts);
    await writeWholeSheet(token, CONTACTS_SHEET_ID, 'ZED_Accounts', CONTACTS_HEADERS.ZED_Accounts, state.accounts);
    await writeWholeSheet(token, CONTACTS_SHEET_ID, 'Telegram_Joins', CONTACTS_HEADERS.Telegram_Joins, state.joins);
    res.json({ ok: true, id: contact.ID_Contact });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/contacts/:rowIndex', async (req, res) => {
  try {
    const token = await getAccessToken();
    const rowIndex = parseInt(req.params.rowIndex, 10);
    const state = await loadContactsState(token);
    const contact = state.contacts.find((entry) => entry._rowIndex === rowIndex);
    if (!contact) return res.status(404).json({ error: 'Contact not found.' });

    state.contacts = state.contacts.filter((entry) => entry.ID_Contact !== contact.ID_Contact);
    state.accounts = state.accounts.filter((entry) => entry.ID_Contact !== contact.ID_Contact);
    state.joins = state.joins.map((join) => (join.Matched_ID_Contact === contact.ID_Contact ? { ...join, Matched_ID_Contact: '' } : join));

    await writeWholeSheet(token, CONTACTS_SHEET_ID, 'ZED_Contacts', CONTACTS_HEADERS.ZED_Contacts, state.contacts);
    await writeWholeSheet(token, CONTACTS_SHEET_ID, 'ZED_Accounts', CONTACTS_HEADERS.ZED_Accounts, state.accounts);
    await writeWholeSheet(token, CONTACTS_SHEET_ID, 'Telegram_Joins', CONTACTS_HEADERS.Telegram_Joins, state.joins);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
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
    await writeWholeSheet(token, CONTACTS_SHEET_ID, 'Telegram_Joins', CONTACTS_HEADERS.Telegram_Joins, state.joins);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/telegram/webhook', async (req, res) => {
  try {
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
      state.joins.push(extractJoinRow(candidate, state.accounts));
      created += 1;
    }

    if (created) {
      await writeWholeSheet(token, CONTACTS_SHEET_ID, 'Telegram_Joins', CONTACTS_HEADERS.Telegram_Joins, state.joins);
    }
    res.json({ ok: true, created });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/telegram/channels', async (req, res) => {
  try {
    const token = await getAccessToken();
    await ensureContactsInfra(token);
    const channels = await loadSheetObjects(token, CONTACTS_SHEET_ID, 'ZED_Channels', CONTACTS_HEADERS.ZED_Channels);
    res.json({
      workerConfigured: Boolean(TELEGRAM_WORKER_URL),
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
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/telegram/jobs', async (req, res) => {
  try {
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
    res.status(503).json({ error: error.message });
  }
});

app.get('/api/telegram/jobs/:jobId', async (req, res) => {
  try {
    res.json(await proxyWorker(`/jobs/${encodeURIComponent(req.params.jobId)}`, 'GET'));
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

// ─── CONTACTS MINI-APP ───────────────────────────────────────────────────────

const CONTACTS_SHEET_ID = process.env.CONTACTS_SHEET_ID || '1tsP9abcf5NsIqNV-K_qts_RncpDdSPn3ElAPeY6YkdU';
const TELEGRAM_BOT_TOKEN    = process.env.TELEGRAM_BOT_TOKEN    || '';
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';

const CTAB  = 'ZED_Contacts';
const ETAB  = 'ZED_Emails';
const ATAB  = 'ZED_Accounts';
const XATAB = 'ZED_Activities';

const CTAB_HEADERS  = ['ID_Contact','Timestamp','Email Address','Nom (en francais)','Prénom (en francais)','TLG_Name','Username','Official phone number','Archive_Tlg_Contacts','Wilaya','Commune','Archive_adresse','Promo','VIP','Tag'];
const ETAB_HEADERS  = ['ID_Email','ID_Contact','Email','Is_Primary'];
const ATAB_HEADERS  = ['ID_Telegram','ID_Contact','TG_User_ID','TG_Username'];
const XATAB_HEADERS = ['ID_Activity','ID_Contact','ID_Telegram','TG_User_ID','TG_Username','Action','Channel','Timestamp'];

async function csRead(tab) {
  try {
    const token = await getAccessToken();
    const r = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${CONTACTS_SHEET_ID}/values/${encodeURIComponent(tab)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!r.ok) return [];
    const d = await r.json();
    return d.values || [];
  } catch { return []; }
}

async function csAppend(tab, row) {
  const token = await getAccessToken();
  const r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${CONTACTS_SHEET_ID}/values/${encodeURIComponent(tab)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [row] }),
    }
  );
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function csUpdate(tab, rowIndex, row) {
  const token = await getAccessToken();
  const r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${CONTACTS_SHEET_ID}/values/${encodeURIComponent(`${tab}!A${rowIndex}`)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [row] }),
    }
  );
  if (!r.ok) throw new Error(await r.text());
}

async function csEnsureTab(tabName, headers) {
  const token = await getAccessToken();
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${CONTACTS_SHEET_ID}?fields=sheets(properties(title))`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const meta = await metaRes.json();
  const exists = (meta.sheets || []).some(s => s.properties.title === tabName);
  if (!exists) {
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${CONTACTS_SHEET_ID}:batchUpdate`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tabName } } }] }),
      }
    );
  }
  // Always ensure headers exist (handles both new and previously-empty tabs)
  if (headers) {
    const rows = await csRead(tabName);
    if (!rows.length) await csAppend(tabName, headers);
  }
}

function rowsToObjects(rows) {
  if (!rows.length) return [];
  const [headers, ...data] = rows;
  return data
    .map((row, i) => {
      const obj = { _rowIndex: i + 2 };
      headers.forEach((h, j) => { obj[h.trim()] = (row[j] || '').trim(); });
      return obj;
    })
    .filter(obj => Object.keys(obj).some(k => k !== '_rowIndex' && obj[k]));
}

function nextId(prefix, existingIds, padLen = 5) {
  const nums = existingIds
    .map(id => { const m = String(id || '').match(/(\d+)$/); return m ? parseInt(m[1]) : 0; })
    .filter(n => !isNaN(n) && n > 0);
  return `${prefix}${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(padLen, '0')}`;
}

// GET /api/contacts
app.get('/api/contacts', async (req, res) => {
  try {
    const [contactRows, emailRows, accountRows] = await Promise.all([
      csRead(CTAB), csRead(ETAB), csRead(ATAB),
    ]);
    const contacts = rowsToObjects(contactRows);
    const emails   = rowsToObjects(emailRows);
    const accounts = rowsToObjects(accountRows);
    const enriched = contacts.map(c => ({
      ...c,
      emails:   emails.filter(e => e.ID_Contact === c.ID_Contact),
      accounts: accounts.filter(a => a.ID_Contact === c.ID_Contact),
    }));
    res.json({ contacts: enriched });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/contacts/activities
app.get('/api/contacts/activities', async (req, res) => {
  try {
    const rows = await csRead(XATAB);
    res.json({ activities: rowsToObjects(rows) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/contacts
app.post('/api/contacts', async (req, res) => {
  try {
    // Ensure all tabs exist with headers before first write
    await Promise.all([
      csEnsureTab(CTAB, CTAB_HEADERS),
      csEnsureTab(ETAB, ETAB_HEADERS),
      csEnsureTab(ATAB, ATAB_HEADERS),
    ]);
    const [contactRows, emailRows, accountRows] = await Promise.all([
      csRead(CTAB), csRead(ETAB), csRead(ATAB),
    ]);
    const { nom, prenom, tlgName, promo, wilaya, commune, vip, tag, emails = [], accounts = [] } = req.body;
    const contactId = nextId('CTK-', contactRows.slice(1).map(r => r[0]));
    const ts = new Date().toLocaleString('fr-FR');
    // Columns: ID_Contact, Timestamp, Email Address, Nom, Prénom, TLG_Name, Username, Official phone, Archive_Tlg, Wilaya, Commune, Archive_adresse, Promo, VIP, Tag
    await csAppend(CTAB, [contactId, ts, '', nom||'', prenom||'', tlgName||'', '', '', '', wilaya||'', commune||'', '', promo||'', vip ? 'TRUE' : 'FALSE', tag||'']);
    const emailIdPool = emailRows.slice(1).map(r => r[0]);
    for (const e of emails) {
      const eid = nextId('E-', emailIdPool); emailIdPool.push(eid);
      await csAppend(ETAB, [eid, contactId, e.email||'', e.isPrimary ? 'TRUE' : 'FALSE']);
    }
    const accountIdPool = accountRows.slice(1).map(r => r[0]);
    for (const a of accounts) {
      const aid = nextId('T-', accountIdPool); accountIdPool.push(aid);
      await csAppend(ATAB, [aid, contactId, a.tgUserId||'', a.tgUsername||'']);
    }
    res.json({ ok: true, id: contactId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/contacts/:id/emails
app.post('/api/contacts/:id/emails', async (req, res) => {
  try {
    const eRows = await csRead(ETAB);
    const eid = nextId('E-', eRows.slice(1).map(r => r[0]));
    const { email, isPrimary } = req.body;
    await csAppend(ETAB, [eid, req.params.id, email||'', isPrimary ? 'TRUE' : 'FALSE']);
    res.json({ ok: true, id: eid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/contacts/:id/accounts
app.post('/api/contacts/:id/accounts', async (req, res) => {
  try {
    const aRows = await csRead(ATAB);
    const aid = nextId('T-', aRows.slice(1).map(r => r[0]));
    const { tgUserId, tgUsername } = req.body;
    await csAppend(ATAB, [aid, req.params.id, tgUserId||'', tgUsername||'']);
    res.json({ ok: true, id: aid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/contacts/link-activity
app.post('/api/contacts/link-activity', async (req, res) => {
  try {
    const { activityRowIndex, contactId, accountId } = req.body;
    const actRows = await csRead(XATAB);
    const ex = [...(actRows[activityRowIndex - 1] || [])];
    ex[1] = contactId || ''; ex[2] = accountId || '';
    await csUpdate(XATAB, activityRowIndex, ex);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/contacts/:id
app.put('/api/contacts/:id', async (req, res) => {
  try {
    const contactRows = await csRead(CTAB);
    const idx = contactRows.findIndex((r, i) => i > 0 && r[0] === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Contact not found' });
    const ex = contactRows[idx];
    const { nom, prenom, tlgName, promo, wilaya, commune, vip, tag } = req.body;
    await csUpdate(CTAB, idx + 1, [
      ex[0], ex[1], ex[2],
      nom     !== undefined ? nom     : (ex[3]  || ''),
      prenom  !== undefined ? prenom  : (ex[4]  || ''),
      tlgName !== undefined ? tlgName : (ex[5]  || ''),
      ex[6]||'', ex[7]||'', ex[8]||'',
      wilaya  !== undefined ? wilaya  : (ex[9]  || ''),
      commune !== undefined ? commune : (ex[10] || ''),
      ex[11]||'',
      promo   !== undefined ? promo   : (ex[12] || ''),
      vip     !== undefined ? (vip ? 'TRUE' : 'FALSE') : (ex[13] || 'FALSE'),
      tag     !== undefined ? tag     : (ex[14] || ''),
    ]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/contacts/emails/:emailId
app.delete('/api/contacts/emails/:emailId', async (req, res) => {
  try {
    const eRows = await csRead(ETAB);
    const idx = eRows.findIndex((r, i) => i > 0 && r[0] === req.params.emailId);
    if (idx > 0) await csUpdate(ETAB, idx + 1, ['', '', '', '']);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/contacts/accounts/:accountId
app.delete('/api/contacts/accounts/:accountId', async (req, res) => {
  try {
    const aRows = await csRead(ATAB);
    const idx = aRows.findIndex((r, i) => i > 0 && r[0] === req.params.accountId);
    if (idx > 0) await csUpdate(ATAB, idx + 1, ['', '', '', '']);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/contacts/:id/all-emails  (used by edit-mode save to replace all emails)
app.delete('/api/contacts/:id/all-emails', async (req, res) => {
  try {
    const eRows = await csRead(ETAB);
    const id = req.params.id;
    for (let i = 1; i < eRows.length; i++) {
      if ((eRows[i][1]||'') === id) await csUpdate(ETAB, i + 1, ['', '', '', '']);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/contacts/:id/all-accounts  (used by edit-mode save to replace all accounts)
app.delete('/api/contacts/:id/all-accounts', async (req, res) => {
  try {
    const aRows = await csRead(ATAB);
    const id = req.params.id;
    for (let i = 1; i < aRows.length; i++) {
      if ((aRows[i][1]||'') === id) await csUpdate(ATAB, i + 1, ['', '', '', '']);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/contacts/:id
app.delete('/api/contacts/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const [cRows, eRows, aRows] = await Promise.all([csRead(CTAB), csRead(ETAB), csRead(ATAB)]);
    const blank = len => Array(len).fill('');
    const cIdx = cRows.findIndex((r, i) => i > 0 && r[0] === id);
    if (cIdx > 0) await csUpdate(CTAB, cIdx + 1, blank(15));
    for (let i = 1; i < eRows.length; i++) {
      if ((eRows[i][1]||'') === id) await csUpdate(ETAB, i + 1, blank(4));
    }
    for (let i = 1; i < aRows.length; i++) {
      if ((aRows[i][1]||'') === id) await csUpdate(ATAB, i + 1, blank(4));
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/telegram/webhook
app.post('/api/telegram/webhook', async (req, res) => {
  // Validate secret token header (if TELEGRAM_WEBHOOK_SECRET is configured)
  if (TELEGRAM_WEBHOOK_SECRET) {
    const provided = req.headers['x-telegram-bot-api-secret-token'] || '';
    if (provided !== TELEGRAM_WEBHOOK_SECRET) {
      return res.status(403).json({ ok: false, error: 'Invalid webhook secret' });
    }
  }
  res.json({ ok: true }); // always respond 200 immediately
  try {
    const update = req.body;
    const member = update.chat_member || update.my_chat_member;
    if (!member) return;
    const newStatus = (member.new_chat_member || {}).status;
    if (!['member', 'administrator'].includes(newStatus)) return;
    const tgUser = member.new_chat_member.user;
    if (tgUser.is_bot) return;
    const channel  = member.chat;
    const tgUserId = String(tgUser.id);
    const tgUsername = tgUser.username ? `@${tgUser.username}` : (tgUser.first_name || '');
    const aRows = await csRead(ATAB);
    // Match by TG_User_ID first, then fall back to username match
    const matchRow = aRows.slice(1).find(r =>
      (r[2] && String(r[2]) === tgUserId) ||
      (tgUser.username && r[3] && r[3].replace('@','').toLowerCase() === tgUser.username.toLowerCase())
    );
    await csEnsureTab(XATAB, XATAB_HEADERS);
    const actRows = await csRead(XATAB);
    const actId = nextId('A-', actRows.slice(1).map(r => r[0]));
    await csAppend(XATAB, [
      actId,
      matchRow ? (matchRow[1]||'') : '',
      matchRow ? (matchRow[0]||'') : '',
      tgUserId, tgUsername, 'joined_channel',
      channel.title || channel.username || String(channel.id),
      new Date().toISOString(),
    ]);
  } catch (e) { console.error('TG webhook error:', e.message); }
});

// GET /api/contacts/config — expose bot configuration state
app.get('/api/contacts/config', (req, res) => {
  res.json({ telegramConfigured: !!TELEGRAM_BOT_TOKEN });
});

// ─── END CONTACTS MINI-APP ────────────────────────────────────────────────────

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Exam Tracker backend running on port ${PORT}`);
});
