require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const multer   = require('multer');
const fetch    = (...args) => import('node-fetch').then(({default: f}) => f(...args));
const FormData = require('form-data');
const crypto   = require('crypto');
const { buildBaseReportFilename, extractDriveFileId } = require('./reports/reportPdfShared');
const { buildAdminReportBuffer } = require('./reports/adminReportPdf');
const { buildPublicReportBuffer } = require('./reports/publicReportPdf');

const app    = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());
app.use(express.static('public', {
  setHeaders(res, path) {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
  }
}));

// Route: serve exam.html for /exam
app.get('/exam', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(__dirname + '/public/exam.html');
});

// Environment variables (set in Railway Variables tab)
const SHEET_ID        = process.env.SHEET_ID   || '';
const SHEET_TAB       = process.env.SHEET_TAB  || 'Sheet1';
const HEADER_ROW      = parseInt(process.env.HEADER_ROW || '1');
const SERVICE_ACCOUNT = JSON.parse(process.env.SERVICE_ACCOUNT_JSON || '{}');
const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const OWNER_GOOGLE_CLIENT_ID = process.env.OWNER_GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID || '';
const OWNER_GOOGLE_CLIENT_SECRET = process.env.OWNER_GOOGLE_CLIENT_SECRET || '';
const OWNER_GOOGLE_REFRESH_TOKEN = process.env.OWNER_GOOGLE_REFRESH_TOKEN || '';

async function uploadBufferToDrive(fileBuffer, name, token) {
  if (!token) {
    throw new Error('Missing owner Google Drive access token.');
  }
  if (!DRIVE_FOLDER_ID) {
    throw new Error('DRIVE_FOLDER_ID is not set in environment variables.');
  }

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
    }
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
    { headers: { Authorization: `Bearer ${token}` } }
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
  const currentName = String(existingName || '').trim();
  if (!currentName) return `${baseStem}${fileSuffix}`;

  const escapedExt = safeExtension.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const versionRegex = new RegExp(`_V(\\d+)\\.${escapedExt}$`, 'i');
  const versionMatch = currentName.match(versionRegex);
  if (versionMatch) {
    return `${baseStem}_V${parseInt(versionMatch[1], 10) + 1}${fileSuffix}`;
  }
  return `${baseStem}_V1${fileSuffix}`;
}

// Service Account -> OAuth2 access token (JWT)
let cachedToken = null;
let tokenExpiry = 0;
let cachedOwnerDriveToken = null;
let ownerDriveTokenExpiry = 0;

function base64url(buf) {
  return buf.toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry - 60000) return cachedToken;

  const now   = Math.floor(Date.now() / 1000);
  const claim = {
    iss  : SERVICE_ACCOUNT.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive',
    aud  : 'https://oauth2.googleapis.com/token',
    iat  : now,
    exp  : now + 3600,
  };

  const header  = base64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = base64url(Buffer.from(JSON.stringify(claim)));
  const toSign  = `${header}.${payload}`;

  const privateKey = SERVICE_ACCOUNT.private_key.replace(/\\n/g, '\n');

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(toSign);
  const signature = base64url(sign.sign(privateKey));

  const jwt = `${toSign}.${signature}`;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method : 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body   : `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  const data = await resp.json();
  if (!data.access_token) throw new Error('Token error: ' + JSON.stringify(data));

  cachedToken = data.access_token;
  tokenExpiry = Date.now() + data.expires_in * 1000;
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
    throw new Error('Owner Drive token error: ' + JSON.stringify(data));
  }

  cachedOwnerDriveToken = data.access_token;
  ownerDriveTokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  return cachedOwnerDriveToken;
}

// Routes

// GET /api/sheet -> read all rows
app.get('/api/sheet', async (req, res) => {
  try {
    const token = await getAccessToken();
    const url   = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(SHEET_TAB)}`;
    const r     = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(await r.text());
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/sheet/:rowIndex -> write one row
app.put('/api/sheet/:rowIndex', async (req, res) => {
  try {
    const token      = await getAccessToken();
    const rowIndex   = parseInt(req.params.rowIndex);
    const { cells }  = req.body;
    const range      = `${SHEET_TAB}!A${rowIndex}`;
    const url        = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
    const r          = await fetch(url, {
      method : 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body   : JSON.stringify({ values: [cells] }),
    });
    if (!r.ok) throw new Error(await r.text());
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/upload -> upload file to Google Drive and return shareable URL
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const token = await getOwnerDriveAccessToken();
    if (!req.file) {
      return res.status(400).json({ error: 'Missing uploaded file.' });
    }
    const { filename } = req.body;
    const fileBuffer   = req.file.buffer;
    const name         = filename || req.file.originalname;
    const uploaded = await uploadBufferToDrive(fileBuffer, name, token);
    res.json({ url: uploaded.url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/report-pdf -> generate admin/public PDF, upload to Drive, return public URL
app.post('/api/report-pdf', async (req, res) => {
  try {
    const token = await getOwnerDriveAccessToken();
    const { type, data } = req.body || {};
    if (!['admin', 'public'].includes(type)) {
      return res.status(400).json({ error: 'Invalid report type. Use "admin" or "public".' });
    }
    if (!data || !data.module || !data.wilaya || !data.year) {
      return res.status(400).json({ error: 'Missing report data.' });
    }

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
        } catch (e) {}
      }
    }
    const filename = buildNextVersionedFilename(`${baseName}_${suffix}`, 'pdf', existingName);
    const pdfBuffer = type === 'admin'
      ? buildAdminReportBuffer(data)
      : buildPublicReportBuffer(data);
    const uploaded = await uploadBufferToDrive(pdfBuffer, filename, token);

    res.json({
      type,
      filename,
      url: uploaded.url,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


app.get('/api/drive-download', async (req, res) => {
  const fileId = (req.query.id || '').replace(/[^a-zA-Z0-9_\-]/g, '');
  if (!fileId) return res.status(400).json({ error: 'Missing file id' });
  try {
    const token = await getOwnerDriveAccessToken();
    const { name, mimeType } = await getDriveFileMeta(fileId, token);

    const fileRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!fileRes.ok) throw new Error(await fileRes.text());

    res.setHeader('Content-Type', mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name || fileId)}"`);
    fileRes.body.pipe(res);
  } catch (e) {
    res.redirect(buildPublicDriveDownloadUrl(fileId));
  }
});

app.get('/api/drive-meta', async (req, res) => {
  const fileId = (req.query.id || '').replace(/[^a-zA-Z0-9_\-]/g, '');
  if (!fileId) return res.status(400).json({ error: 'Missing file id' });
  try {
    const token = await getOwnerDriveAccessToken();
    res.json(await getDriveFileMeta(fileId, token));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


app.get('/api/config', (req, res) => {
  res.json({ sheetTab: SHEET_TAB, headerRow: HEADER_ROW, googleClientId: GOOGLE_CLIENT_ID });
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
app.listen(PORT, '0.0.0.0', () => console.log(`Exam Tracker backend running on port ${PORT}`));
