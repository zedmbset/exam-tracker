# Exam Tracker — Technical Overview

A web-based dashboard for tracking medical exam data. Uses Google Sheets as the database and Google Drive for PDF storage.

## Project Structure

```
exam-tracker/ (repo root)
├── server.js              # Express backend — all Google API calls go through here
├── package.json           # Node.js dependencies
├── package-lock.json      # Locked dependency versions
├── railway.toml           # Deployment config for Railway.app
├── README.md              # GitHub/root entry page
├── PROJECT_OVERVIEW.md    # High-level technical summary
├── replit.md              # Replit-specific memory file (kept for Replit tooling)
├── .gitignore             # Excludes .env, node_modules, attached_assets
├── docs/                  # All documentation
│   ├── INDEX.md           # Documentation table of contents
│   ├── TECHNICAL_OVERVIEW.md  # This file
│   ├── SCHEMA.md          # Full database schema
│   ├── AI_CHAT_INSTRUCTIONS.md # Persistent AI working preferences
│   └── ...other docs
└── public/
    ├── index.html         # Main dashboard (stats, filters, table)
    └── exam.html          # Exam detail page (fill fields, upload PDF, Google sign-in)
```

## Tech Stack

- **Backend**: Node.js + Express
- **Frontend**: Vanilla HTML/CSS/JavaScript (no framework)
- **Database**: Google Sheets (via Sheets API v4)
- **File storage**: Google Drive (via Drive API v3)
- **Auth**: Google service account (backend) + Google Identity Services (frontend sign-in)

## Running the App

The workflow runs: `node server.js`

The app starts on port 5000 and serves static files from `public/`.

## Environment Variables

All credentials are stored in Replit Secrets (not in any file). For local development, create a `.env` file at the project root:

| Variable | Description |
|---|---|
| `SHEET_ID` | Google Sheets spreadsheet ID |
| `SHEET_TAB` | Sheet tab name (default: `Exams_Tracking`) |
| `HEADER_ROW` | Row number of the header row (default: `1`) |
| `DRIVE_FOLDER_ID` | Google Drive folder ID for PDF uploads |
| `SERVICE_ACCOUNT_JSON` | Full JSON of the Google service account key |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID for frontend sign-in |

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/sheet` | Read all rows from the sheet |
| PUT | `/api/sheet/:rowIndex` | Write a single row back to the sheet |
| POST | `/api/upload` | Upload a PDF to Google Drive |
| GET | `/api/config` | Send non-secret config to the frontend |

## Column Mapping (Google Sheet)

These are the authoritative 0-based column indices. See `docs/SCHEMA.md` for full details.

| Column | Name | Index |
|---|---|---|
| A | ID_Exams | 0 |
| B | Wilaya | 1 |
| C | Year | 2 |
| D | Level | 3 |
| E | ExamSession | 4 |
| F | categoryId | 5 |
| G | Module | 6 |
| H | Start | 7 |
| I | End | 8 |
| J | ExamDate | 9 |
| K | Status | 10 |
| L | OrigPDF | 11 |
| M | AffichagePDF | 12 |
| N | Quiz_Tbl | 13 |
| O | Membre | 14 |
| P | Tags | 15 |
| Q | Quiz_Link | 16 |
| R | Admin_Report | 17 |
| S | Public_Report | 18 |

## Key Design Decisions

- The backend acts as a secure proxy — Google API credentials are never sent to the browser.
- The frontend reads the `GOOGLE_CLIENT_ID` from `/api/config` at runtime so it never needs to be hardcoded.
- A row is considered "complete" when `Quiz_Tbl` and `Tags.nQst` are both filled.
- `ExamSession` is stored as a compact code string such as `R1-P1`, `S1`, `RTRPG`, or `SYNTH`; parsing and validation live in `src/shared/examSession.js`.
- Status is normally derived from row data, with one supported manual override: an existing `Completed` status is preserved even if `Quiz_Tbl` is empty. Rules:
  - `Completed`: `Quiz_Tbl` exists
  - manual `Completed`: stored Status is already `Completed` and `Quiz_Tbl` is empty
  - `Pending`: `OrigPDF` exists, no `Quiz_Tbl`
  - `New Exam`: exam date is past, no PDF, exam ≤ 15 days old
  - `Missing`: exam date is past, no PDF, exam > 15 days old
  - *(blank)*: no exam date, or date is in the future
- The exam detail page (`exam.html`) requires Google sign-in so that the contributor's email is recorded automatically.

## Schema & Column Groups

| Tag | Columns |
|---|---|
| `[identity]` | Wilaya, Year, Level, ExamSession, Module, ExamDate |
| `[system]` | ID_Exams, Start, End, Status |
| `[member-task]` | Membre, Tags |
| `[links]` | OrigPDF, AffichagePDF, Quiz_Tbl, Quiz_Link |
| `[reports]` | Admin_Report, Public_Report |

## Exam Detail Page Structure (`exam.html`)

| Card | Element ID | Description |
|---|---|---|
| Exam Summary | `#summaryCard` | Read-only grid of identity fields |
| Task Checklist | `#checklistCard` | 8 numbered steps, state in localStorage |
| Data Entry | `#editCard` | Form with member-fillable fields |
| Upload Files | `#uploadCard` | PDF → OrigPDF, Excel/CSV → Quiz_Tbl |
| AI Prompt | `.prompt-card` | Auto-filled digitization prompt with copy button |
