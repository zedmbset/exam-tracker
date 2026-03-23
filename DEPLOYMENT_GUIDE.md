# 🚀 Exam Tracker — Deployment Guide

## What you have
- `server.js` — the backend (holds your API keys securely)
- `public/index.html` — the app your users will see
- `package.json` — dependencies list
- `railway.toml` — Railway hosting config

---

## Step 1 — Upload to GitHub (free, 5 min)

1. Go to https://github.com and create a free account (if you don't have one)
2. Click **"New repository"** → name it `exam-tracker` → click **Create**
3. On your computer, put all these files in one folder:
   ```
   exam-tracker/
   ├── server.js
   ├── package.json
   ├── railway.toml
   └── public/
       └── index.html
   ```
4. Upload them to GitHub:
   - Click **"uploading an existing file"** on the repo page
   - Drag all the files and the `public` folder
   - Click **Commit changes**

---

## Step 2 — Deploy on Railway (free, 5 min)

1. Go to https://railway.app and sign up with your GitHub account
2. Click **"New Project"** → **"Deploy from GitHub repo"**
3. Select your `exam-tracker` repository
4. Railway will start deploying automatically ✅

---

## Step 3 — Add your secret API keys (IMPORTANT)

1. In Railway, click on your project → click the **Variables** tab
2. Add these variables one by one (click **+ New Variable** for each):

| Variable name   | Value                          |
|-----------------|--------------------------------|
| `GOOGLE_API_KEY`| Your Google Sheets/Drive API key |
| `SHEET_ID`      | Your Google Spreadsheet ID     |
| `SHEET_TAB`     | Your sheet tab name (e.g. `Sheet1`) |
| `HEADER_ROW`    | Row number of headers (usually `1`) |

3. Click **Deploy** to restart with the new variables

---

## Step 4 — Get your public link

1. In Railway, go to **Settings** → **Networking** → click **Generate Domain**
2. You'll get a URL like: `https://exam-tracker-production.up.railway.app`
3. **Share this link** with your team — that's all they need!

---

## 🔑 Where to get your Google API key

1. Go to https://console.cloud.google.com
2. Create a new project (or use existing)
3. Go to **APIs & Services** → **Enable APIs**:
   - Enable **Google Sheets API**
   - Enable **Google Drive API**
4. Go to **Credentials** → **Create Credentials** → **API Key**
5. Copy the key → paste it as `GOOGLE_API_KEY` in Railway

---

## 🔑 Where to find your Spreadsheet ID

Your Google Sheet URL looks like:
```
https://docs.google.com/spreadsheets/d/THIS_IS_YOUR_ID/edit
```
Copy the long ID between `/d/` and `/edit`.

---

## ✅ Done!

Your users just open the Railway URL — no setup, no API keys needed on their side.
The app will automatically load the shared Google Sheet data for everyone.
