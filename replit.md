# Exam Tracker

A web-based dashboard for tracking medical exam data. Uses Google Sheets as the database and Google Drive for PDF storage.

## Project Structure

```
exam-tracker/ (repo root)
├── server.js              # Express backend — all Google API calls go through here
├── package.json           # Node.js dependencies
├── package-lock.json      # Locked dependency versions
├── railway.toml           # Deployment config for Railway.app
├── SCHEMA.md              # Full database schema with column groups and tags
├── DEPLOYMENT_GUIDE.md    # Setup and deployment instructions
├── .gitignore             # Excludes .env, node_modules, attached_assets
├── replit.md              # This file
└── public/
    ├── index.html         # Main dashboard (stats, filters, table)
    └── exam.html          # Exam detail page (fill fields, upload PDF, Google sign-in, inline help)
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
| F      | Period         | 5     |
| G      | Module         | 6     |
| H      | Start          | 7     |
| I      | End            | 8     |
| J      | ExamDate       | 9     |
| K      | Status         | 10    |
| L      | OrigPDF        | 11    |
| M      | Quiz_Tbl       | 12    |
| N      | Membre         | 13    |
| O      | Tags           | 14    |

## Key Design Decisions

- The backend acts as a secure proxy — Google API credentials are never sent to the browser.
- The frontend reads the `GOOGLE_CLIENT_ID` from `/api/config` at runtime so it never needs to be hardcoded.
- A row is considered "complete" when Status, OrigPDF, Quiz_Tbl, and N° of Questions (Tags.nQst) are all filled.
- The exam detail page (`exam.html`) requires Google sign-in so that the contributor's email is recorded automatically.

## Schema & Column Groups

See `SCHEMA.md` for the full technical reference. Columns are organized into 5 tagged groups for use in task and design descriptions:

| Tag | Columns |
|-----|---------|
| `[identity]` | Wilaya, Year, Level, Rotation, Period, Module, ExamDate |
| `[system]` | ID_Exams, Start, End, Status |
| `[member-task]` | Membre, Tags |
| `[links]` | OrigPDF, Quiz_Tbl |

## Exam Detail Page Structure (`exam.html`)

The exam detail page is composed of five stacked cards rendered by JavaScript after the row data is loaded:

| Card | ID / Element | Populated by | Description |
|------|-------------|--------------|-------------|
| Exam Summary | `#summaryCard` | `renderSummaryCard(row)` | Read-only grid of 10 identity fields (Wilaya, Year, Level, Rotation, Period, Module, Exam Date, Member, Status, ID) |
| Task Checklist | `#checklistCard` | `renderChecklist(examId)` | 8 numbered checkbox steps; state persisted in `localStorage` |
| Data Entry | `#editCard` | `buildDataEntry(row, missing)` | Explicit form with 6 member-fillable fields + read-only Member; filled fields highlighted green |
| Upload Files | `#uploadCard` | `buildUploads(row)` | Two upload zones: PDF → OrigPDF (col L), Excel/CSV → Quiz_Tbl (col M) |
| AI Prompt | `.prompt-card` | `renderPrompt(row)` | Auto-filled prompt for QCM generation; copy button |

### Task Checklist localStorage key

Checklist state is stored per exam: `examChecklist_<ID_Exams>` (e.g., `examChecklist_STF-2024-P1-Cardio`). Value is a JSON object `{ "0": true, "3": true, … }` mapping step index to checked state.

### File Upload → Column mapping

| Upload zone | Drive filename suffix | Sheet column | Index |
|-------------|----------------------|--------------|-------|
| Original exam PDF | `_<Module>.pdf` | OrigPDF (L) | 11 |
| QCM Excel / CSV | `_<Module>_QCM.<ext>` | Quiz_Tbl (M) | 12 |

Both files are uploaded to the Google Drive folder defined by `DRIVE_FOLDER_ID`, made public (anyone with link), and the resulting URL is saved back to the Sheet row.

### Data Entry form fields

Fields in the revamped form (fields with existing values are highlighted green):

| Field ID | Sheet column | Index | Notes |
|----------|-------------|-------|-------|
| `field_ExamDate` | ExamDate (J) | 9 | date picker, member-editable |
| `field_OrigPDF` | OrigPDF (L) | 11 | url, also auto-set by PDF upload |
| `field_Quiz_Tbl` | Quiz_Tbl (M) | 12 | url, also auto-set by Excel upload |
| `field_Membre` | Membre (N) | 13 | read-only, auto-filled from Google sign-in |
| `tags_hasCT` | Tags JSON `hasCT` | 14 | checkbox |
| `tags_nQst` | Tags JSON `nQst` | 14 | number |
| `tags_missingQsts` | Tags JSON `missingQsts` | 14 | number |
| `tags_missingPos` | Tags JSON `missingPos` | 14 | text (comma-separated ints) |
| `tags_schemaQsts` | Tags JSON `schemaQsts` | 14 | text (comma-separated ints/ranges) |

Note: Status (K) is shown read-only in the Exam Summary card but is not editable in the Data Entry form. Members update status indirectly by filling in the required fields.

### Tags JSON schema (col O, index 14)

All per-exam metadata beyond core identity and links is stored as a JSON string in the Tags column:

| Key | Type | Description |
|-----|------|-------------|
| `nQst` | integer | Total number of questions. Used in completeness check and AI prompt. |
| `missingQsts` | integer | Count of questions with missing content. |
| `missingPos` | integer[] | Positions of missing questions, e.g. `[5, 12, 23]`. |
| `schemaQsts` | integer[] | Positions of questions that include a schema or table, e.g. `[3, 7, 10, 11, 12]`. |
| `hasCT` | boolean | Whether the original PDF includes a Corrigé Type. Embedded in upload filenames. |

### Upload filename convention

| File type | Filename pattern | Example |
|-----------|-----------------|---------|
| Original exam PDF | `Wilaya_Year_Rotation_Module_CT_30Q_2miss.pdf` | `STF_2024_R1_Cardio_CT_30Q_2miss.pdf` |
| Original exam PDF (no CT) | `Wilaya_Year_Rotation_Module_noCT_30Q_0miss.pdf` | `Const_2025_S2_Pneumo_noCT_20Q_0miss.pdf` |
| QCM Excel / CSV | `Wilaya_Year_Rotation_Module_QCM_CT_30Q_2miss.xlsx` | `STF_2024_R1_Cardio_QCM_CT_30Q_2miss.xlsx` |

CT/noCT, Qst count, and miss count are read from the form at Save time.

## Inline Help System

`exam.html` has a lightweight "?" tooltip system. Clicking any "?" button next to a card title or field label shows a popover explaining what that section or field is for. Help text is defined in the `FIELD_HELP` object in `exam.html`. No external libraries — pure HTML/CSS/JS using the existing design token variables.
