const express  = require('express');
const cors     = require('cors');
const multer   = require('multer');
const fetch    = (...args) => import('node-fetch').then(({default: f}) => f(...args));
const FormData = require('form-data');
const crypto   = require('crypto');

const app    = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ── ENV VARS (set in Railway Variables tab) ────────────────────────────────
const SHEET_ID        = process.env.SHEET_ID   || '';
const SHEET_TAB       = process.env.SHEET_TAB  || 'Sheet1';
const HEADER_ROW      = parseInt(process.env.HEADER_ROW || '1');
const SERVICE_ACCOUNT = JSON.parse(process.env.SERVICE_ACCOUNT_JSON || '{}');
const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID || '';
// ──────────────────────────────────────────────────────────────────────────

// ── Service Account → OAuth2 access token (JWT) ───────────────────────────
let cachedToken = null;
let tokenExpiry = 0;

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

  // Fix escaped newlines — common when pasting JSON into env var fields
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

// ── Routes ─────────────────────────────────────────────────────────────────

// GET /api/sheet  →  read all rows
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

// PUT /api/sheet/:rowIndex  →  write one row
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

// POST /api/upload  →  upload PDF to Google Drive, return shareable URL
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const token        = await getAccessToken();
    const { filename } = req.body;
    const fileBuffer   = req.file.buffer;
    const name         = filename || req.file.originalname;

    if (!DRIVE_FOLDER_ID) {
      throw new Error('DRIVE_FOLDER_ID is not set in Railway environment variables.');
    }

    // ✅ Just the folder as parent — no driveId in metadata
    const meta = {
      name,
      mimeType: 'application/pdf',
      parents: [DRIVE_FOLDER_ID],
    };

    const metadata = JSON.stringify(meta);
    const form     = new FormData();
    form.append('metadata', Buffer.from(metadata), { contentType: 'application/json', filename: 'metadata.json' });
    form.append('file', fileBuffer, { contentType: 'application/pdf', filename: name });

    const uploadRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&supportsAllDrives=true',
      {
        method : 'POST',
        headers: { Authorization: `Bearer ${token}`, ...form.getHeaders() },
        body   : form,
      }
    );
    if (!uploadRes.ok) throw new Error(await uploadRes.text());
    const { id } = await uploadRes.json();

    await fetch(`https://www.googleapis.com/drive/v3/files/${id}/permissions?supportsAllDrives=true`, {
      method : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body   : JSON.stringify({ role: 'reader', type: 'anyone' }),
    });

    res.json({ url: `https://drive.google.com/file/d/${id}/view` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/config  →  send non-secret config to frontend
app.get('/api/config', (req, res) => {
  res.json({ sheetTab: SHEET_TAB, headerRow: HEADER_ROW });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Exam Tracker backend running on port ${PORT}`));
