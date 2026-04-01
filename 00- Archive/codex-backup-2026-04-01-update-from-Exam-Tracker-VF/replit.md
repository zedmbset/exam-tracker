# Exam Tracker

A web-based dashboard for tracking medical exam data. Uses Google Sheets as the database and Google Drive for PDF storage.

## Project Structure

```
exam-tracker/ (repo root)
├── server.js              # Express backend — all Google API calls go through here
├── package.json           # Node.js dependencies
├── package-lock.json      # Locked dependency versions
├── railway.toml           # Deployment config for Railway.app
├── DEPLOYMENT_GUIDE.md    # Setup and deployment instructions
├── .gitignore             # Excludes .env, node_modules, attached_assets
├── replit.md              # This file
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

The workflow runs: `PORT=5000 node server.js`

The app starts on port 5000 and serves static files from `public/`.

## Environment Variables

All credentials are stored in Replit Secrets (not in any file). For local development, create a `.env` file at the project root:

| Variable              | Description                                      |
|-----------------------|--------------------------------------------------|
| `SHEET_ID`            | Google Sheets spreadsheet ID                     |
| `SHEET_TAB`           | Sheet tab name (default: `Exams_Tracking`)       |
| `HEADER_ROW`          | Row number of the header row (default: `1`)      |
| `DRIVE_FOLDER_ID`     | Google Drive folder ID for PDF uploads           |
| `SERVICE_ACCOUNT_JSON`| Full JSON of the Google service account key      |
| `GOOGLE_CLIENT_ID`    | Google OAuth client ID for frontend sign-in      |

## API Endpoints

| Method | Path                  | Description                          |
|--------|-----------------------|--------------------------------------|
| GET    | `/api/sheet`          | Read all rows from the sheet         |
| PUT    | `/api/sheet/:rowIndex`| Write a single row back to the sheet |
| POST   | `/api/upload`         | Upload a PDF to Google Drive         |
| GET    | `/api/config`         | Send non-secret config to the frontend |

## Column Mapping (Google Sheet)

| Column | Name           | Index |
|--------|----------------|-------|
| A      | ID_Exams       | 0     |
| B      | Wilaya         | 1     |
| C      | Year           | 2     |
| D      | Level          | 3     |
| E      | Rotation       | 4     |
| F      | Module         | 5     |
| G      | Start          | 6     |
| H      | End            | 7     |
| I      | ExamDate       | 8     |
| J      | Status         | 9     |
| K      | OrgnlExam      | 10    |
| L      | DBTbl          | 11    |
| M      | Membre         | 12    |
| N      | Tags           | 13    |
| O      | Drive          | 14    |
| P      | QuizLink       | 15    |
| Q      | ExamStatus     | 16    |
| R      | MBsetStatus    | 17    |
| S      | Mbset          | 18    |
| T      | NQst           | 19    |
| U      | MissingQsts    | 20    |

## Key Design Decisions

- The backend acts as a secure proxy — Google API credentials are never sent to the browser.
- The frontend reads the `GOOGLE_CLIENT_ID` from `/api/config` at runtime so it never needs to be hardcoded.
- A row is considered "complete" when Status, Drive, Quiz Link, MBset Status, and N° of Questions are all filled.
- The exam detail page (`exam.html`) requires Google sign-in so that the contributor's email is recorded automatically.
