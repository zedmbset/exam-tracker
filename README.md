# Exam Tracker

A web-based dashboard for tracking the digitization progress of medical exams (QCM). Built with Node.js + Express, using Google Sheets as the database and Google Drive for file storage.

## Quick Start

1. Clone the repo
2. Set up environment variables (see below)
3. Run `npm install && node server.js`
4. Open `http://localhost:5000`

## Environment Variables

| Variable | Description |
|---|---|
| `SHEET_ID` | Google Sheets spreadsheet ID |
| `SHEET_TAB` | Sheet tab name (e.g. `Exams_Tracking`) |
| `HEADER_ROW` | Header row number (default: `1`) |
| `SERVICE_ACCOUNT_JSON` | Full JSON of the Google service account key |
| `DRIVE_FOLDER_ID` | Google Drive folder ID for PDF uploads |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID for frontend sign-in |
| `CONTACTS_SHEET_ID` | Google Sheets spreadsheet ID for contacts, joins, channels, and jobs |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token used for webhook-based join tracking |
| `TELEGRAM_WORKER_URL` | Base URL of the deployed Telethon worker service |
| `TELEGRAM_API_ID` | Telegram API ID for the worker service |
| `TELEGRAM_API_HASH` | Telegram API hash for the worker service |
| `TELEGRAM_SESSION` | Telethon StringSession used by the worker service |

## Documentation

| File | Purpose |
|---|---|
| `docs/INDEX.md` | Documentation table of contents and reading order |
| `PROJECT_OVERVIEW.md` | High-level technical summary |
| `docs/TECHNICAL_OVERVIEW.md` | Deep technical reference (structure, columns, logic) |
| `docs/SCHEMA.md` | Full Google Sheet column schema |
| `docs/PROJECT_DOCUMENTATION.md` | Full auto-generated project documentation |

## Tech Stack

- **Backend**: Node.js + Express
- **Frontend**: Vanilla HTML/CSS/JavaScript
- **Database**: Google Sheets (Sheets API v4)
- **File storage**: Google Drive (Drive API v3)
- **Auth**: Google Service Account (backend) + Google Identity Services (frontend)
