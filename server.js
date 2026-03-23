const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
const FormData = require('form-data');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ── ENV VARS (set these in Railway dashboard) ──────────────────────────────
const GOOGLE_API_KEY  = process.env.GOOGLE_API_KEY  || '';
const SHEET_ID        = process.env.SHEET_ID        || '';
const SHEET_TAB       = process.env.SHEET_TAB       || 'Sheet1';
const HEADER_ROW      = parseInt(process.env.HEADER_ROW || '1');
// ──────────────────────────────────────────────────────────────────────────

// GET /api/sheet  →  returns all rows from the Google Sheet
app.get('/api/sheet', async (req, res) => {
  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(SHEET_TAB)}?key=${GOOGLE_API_KEY}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/sheet/:rowIndex  →  writes a row back to the sheet
app.put('/api/sheet/:rowIndex', async (req, res) => {
  try {
    const rowIndex = parseInt(req.params.rowIndex);
    const { cells } = req.body;
    const range = `${SHEET_TAB}!A${rowIndex}`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED&key=${GOOGLE_API_KEY}`;
    const r = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [cells] })
    });
    if (!r.ok) throw new Error(await r.text());
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/upload  →  uploads a PDF to Google Drive, returns the file URL
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const { filename } = req.body;
    const fileBuffer = req.file.buffer;
    const name = filename || req.file.originalname;

    const metadata = JSON.stringify({ name, mimeType: 'application/pdf' });
    const form = new FormData();
    form.append('metadata', Buffer.from(metadata), { contentType: 'application/json', filename: 'metadata.json' });
    form.append('file', fileBuffer, { contentType: 'application/pdf', filename: name });

    const url = `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&key=${GOOGLE_API_KEY}`;
    const r = await fetch(url, { method: 'POST', body: form, headers: form.getHeaders() });
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    res.json({ url: `https://drive.google.com/file/d/${data.id}/view` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/config  →  sends non-secret config to the frontend
app.get('/api/config', (req, res) => {
  res.json({ sheetTab: SHEET_TAB, headerRow: HEADER_ROW });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Exam Tracker backend running on port ${PORT}`));
