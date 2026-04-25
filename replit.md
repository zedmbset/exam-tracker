# Exam Tracker

## Project Overview
A Node.js/Express web application for tracking the digitization progress of exams (QCM/Multiple Choice Questions). It serves as a dashboard and processing hub for exam data.

## Tech Stack
- **Backend**: Node.js with Express
- **Frontend**: Vanilla JavaScript, HTML, CSS (served as static files from `public/`)
- **External Services**: Google Sheets API (data storage), Google Drive API (file storage)
- **Authentication**: Google Service Account (JWT) + OAuth2 for owner Drive access

## Architecture
- `server.js` - Tiny boot entrypoint that loads the Express app
- `src/server/` - Backend app, routes, services, utilities, and PDF reports
- `src/shared/` - Shared browser/server helpers served through stable `/lib/*` URLs
- `public/` - Static frontend HTML, CSS, and JavaScript assets
- `workers/telegram/` - Standalone Telethon worker service
- `docs/` - Project documentation and data schemas
- `docs/plans/` - Task plans created by AI models (Replit, Codex, ChatGPT, Claude, etc.)

## Rules for AI models — GitHub pushes
Push to GitHub **at the end of each completed task** (not after every individual file edit). A task is complete when all related changes are done and working. Use a clear commit message that summarises what changed.

Push command to use (the token header form is the one that works reliably):
```bash
git push https://x-access-token:${GITHUB_TOKEN}@github.com/zedmbset/exam-tracker.git main
```

Do NOT push after every file save — that floods Railway with unnecessary redeploys and clutters the Git history.

## Rules for AI models — Plan storage
**Whenever any AI model (Replit Agent, Codex, ChatGPT, Claude, or any other) creates a task plan or feature plan, it MUST be saved as a markdown file inside `docs/plans/`.**

Naming convention: `NN-short-description.md` where `NN` is a zero-padded task number that matches the task sequence (e.g. `01`, `02`, `17`). This keeps plans sorted in order in the file tree.

Example filenames:
- `docs/plans/01-availability-dashboard.md`
- `docs/plans/11-fix-submodule-reordering.md`
- `docs/plans/17-contacts-and-telegram.md`

Every plan file should include at minimum: task number + title, current status (PROPOSED / IN PROGRESS / MERGED / CANCELLED), a "What & Why" section, a "Done looks like" section, and a list of implementation tasks.

## Architecture — Pages
- `/` (index.html) — Main exam digitization dashboard
- `/exam` (exam.html) — Exam detail / processing page
- `/availability.html` — Public availability dashboard
- `/contacts/` (contacts/index.html) — Contacts mini-app with Telegram join tracking

## Key API Routes — Exam tracker
- `GET /api/sheet` - Read all rows from Google Sheet
- `PUT /api/sheet/:rowIndex` - Write one row to Google Sheet
- `POST /api/upload` - Upload file to Google Drive
- `POST /api/report-pdf` - Generate and upload PDF report
- `GET /api/drive-download` - Download a file from Google Drive
- `GET /api/drive-meta` - Get file metadata from Google Drive
- `GET /api/config` - Return sheet config and Google Client ID

## Key API Routes — Contacts mini-app
- `GET /api/contacts` - List all contacts enriched with emails + Telegram accounts
- `POST /api/contacts` - Create contact with emails and Telegram accounts
- `PUT /api/contacts/:id` - Update core contact fields
- `DELETE /api/contacts/:id` - Blank the contact row and all linked rows
- `POST /api/contacts/:id/emails` - Add an email to a contact
- `DELETE /api/contacts/emails/:emailId` - Remove an email
- `POST /api/contacts/:id/accounts` - Add a Telegram account to a contact
- `DELETE /api/contacts/accounts/:accountId` - Remove a Telegram account
- `GET /api/contacts/activities` - Return all join events
- `POST /api/contacts/link-activity` - Manually link an unmatched joiner to a contact
- `POST /api/telegram/webhook` - Telegram bot webhook (handles chat_member joins)

## Environment Variables Required — Exam tracker
- `SHEET_ID` - Google Sheets spreadsheet ID
- `SHEET_TAB` - Sheet tab name (default: Sheet1)
- `HEADER_ROW` - Header row number (default: 1)
- `SERVICE_ACCOUNT_JSON` - Full Google Service Account JSON credentials
- `DRIVE_FOLDER_ID` - Google Drive folder ID for uploads
- `GOOGLE_CLIENT_ID` - Google OAuth2 client ID (for frontend auth)
- `OWNER_GOOGLE_CLIENT_ID` - Owner Google OAuth2 client ID
- `OWNER_GOOGLE_CLIENT_SECRET` - Owner Google OAuth2 client secret
- `OWNER_GOOGLE_REFRESH_TOKEN` - Owner Google OAuth2 refresh token

## Environment Variables Required — Contacts mini-app
- `CONTACTS_SHEET_ID` - Contacts Google Sheets ID (default: `1tsP9abcf5NsIqNV-K_qts_RncpDdSPn3ElAPeY6YkdU`)
- `TELEGRAM_BOT_TOKEN` - Telegram bot token from BotFather (optional; enables join tracking)

## Contacts data model (sheets inside CONTACTS_SHEET_ID)
- `ZED_Contacts` — One row per person. ID format: `CTK-00001`
- `ZED_Emails` — One row per email address. ID format: `E-00001`
- `ZED_Accounts` — One row per Telegram account. ID format: `T-00001`
- `ZED_Activities` — One row per event (auto-created by bot). ID format: `A-00001`

## Running the App
- Port: 5000 (binds to 0.0.0.0)
- Start: `node server.js`
- Workflow: "Start application"
