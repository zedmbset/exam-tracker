# Exam Tracker

## Project Overview
A Node.js/Express web application for tracking the digitization progress of exams (QCM/Multiple Choice Questions). It serves as a dashboard and processing hub for exam data.

## Tech Stack
- **Backend**: Node.js with Express
- **Frontend**: Vanilla JavaScript, HTML, CSS (served as static files from `public/`)
- **External Services**: Google Sheets API (data storage), Google Drive API (file storage)
- **Authentication**: Google Service Account (JWT) + OAuth2 for owner Drive access

## Architecture
- `server.js` - Main Express server and all API routes
- `public/` - Static frontend files (index.html, exam.html, availability.html, prompts/ JS modules)
- `reports/` - PDF report generation logic (admin and public reports)
- `docs/` - Project documentation and data schemas
- `docs/plans/` - Task plans created by AI models (Replit, Codex, ChatGPT, Claude, etc.)

## Rules for AI models — Plan storage
**Whenever any AI model (Replit Agent, Codex, ChatGPT, Claude, or any other) creates a task plan or feature plan, it MUST be saved as a markdown file inside `docs/plans/`.**

Naming convention: `NN-short-description.md` where `NN` is a zero-padded task number that matches the task sequence (e.g. `01`, `02`, `17`). This keeps plans sorted in order in the file tree.

Example filenames:
- `docs/plans/01-availability-dashboard.md`
- `docs/plans/11-fix-submodule-reordering.md`
- `docs/plans/17-contacts-and-telegram.md`

Every plan file should include at minimum: task number + title, current status (PROPOSED / IN PROGRESS / MERGED / CANCELLED), a "What & Why" section, a "Done looks like" section, and a list of implementation tasks.

## Key API Routes
- `GET /api/sheet` - Read all rows from Google Sheet
- `PUT /api/sheet/:rowIndex` - Write one row to Google Sheet
- `POST /api/upload` - Upload file to Google Drive
- `POST /api/report-pdf` - Generate and upload PDF report
- `GET /api/drive-download` - Download a file from Google Drive
- `GET /api/drive-meta` - Get file metadata from Google Drive
- `GET /api/config` - Return sheet config and Google Client ID

## Environment Variables Required
- `SHEET_ID` - Google Sheets spreadsheet ID
- `SHEET_TAB` - Sheet tab name (default: Sheet1)
- `HEADER_ROW` - Header row number (default: 1)
- `SERVICE_ACCOUNT_JSON` - Full Google Service Account JSON credentials
- `DRIVE_FOLDER_ID` - Google Drive folder ID for uploads
- `GOOGLE_CLIENT_ID` - Google OAuth2 client ID (for frontend auth)
- `OWNER_GOOGLE_CLIENT_ID` - Owner Google OAuth2 client ID
- `OWNER_GOOGLE_CLIENT_SECRET` - Owner Google OAuth2 client secret
- `OWNER_GOOGLE_REFRESH_TOKEN` - Owner Google OAuth2 refresh token

## Running the App
- Port: 5000 (binds to 0.0.0.0)
- Start: `node server.js`
- Workflow: "Start application"