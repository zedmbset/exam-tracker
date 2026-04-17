# Task #22 — Telethon Headless Worker

**Status:** PROPOSED

## What & Why
The Telegram Bot API only sees new joiners in real-time. To backfill existing members (people already in your channels before the bot was added), we need a Telethon-based Python worker that can fetch the full member list of any channel. This task builds the backend worker service and the one-time session setup script.

## Done looks like
- A `telegram_worker/` folder exists in the repo with a standalone Python Flask service
- The worker exposes three HTTP endpoints: health check, fetch-members job, list-channels job
- A `telegram_worker/generate_session.py` script can be run once on the user's PC to produce a StringSession string (stored as `TELEGRAM_SESSION` on Railway)
- The worker reads `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION` from environment — no hardcoded values
- A second Railway service can be deployed from the same repo pointing to `telegram_worker/`
- The Node.js server in `server.js` has a new `TELEGRAM_WORKER_URL` env var and exposes proxy endpoints (`POST /api/telegram/jobs`, `GET /api/telegram/jobs/:jobId`) that forward to the worker
- When a fetch-members job completes, results are written to `ZED_Contacts` + `ZED_Accounts` (same `CONTACTS_SHEET_ID`) — new members are created, existing members matched by TG_User_ID or username (no duplicates)
- Job progress and status are stored in a new `ZED_Jobs` tab (auto-created with headers: ID_Job, Type, Channel, Status, Progress, Total, Started, Finished, Error)

## Out of scope
- Message fetching / content operations (future Phase 3)
- Action execution (post, transfer) — those stay in the desktop app for now
- Real-time join tracking (already handled by the bot webhook in Task #21)
- Authentication / login UI in the web app — session is managed via Railway env vars only

## Tasks
1. **Session generator script** — Add `telegram_worker/generate_session.py`: a simple Telethon script the user runs once on their PC. It prompts for phone number + 2FA code, prints the StringSession string, and exits. Includes clear printed instructions. No UI required.

2. **Flask worker service** — Create `telegram_worker/worker.py` (Flask), `telegram_worker/member_fetcher.py` (Telethon member extraction logic), `telegram_worker/channel_lister.py` (lists all channels/groups the account is in), and `telegram_worker/requirements.txt` (telethon, flask, gspread, google-auth). The worker must initialize the Telethon client from `TELEGRAM_SESSION` + `API_ID` + `API_HASH` at startup.

3. **Job endpoints** — Implement `POST /jobs/fetch-members` (accepts `{ channelId, channelUsername }`), `POST /jobs/list-channels`, and `GET /jobs/:jobId`. Jobs run as background threads; status is updated in the `ZED_Jobs` sheet so the web UI can poll it.

4. **Member import logic** — When a fetch-members job finishes, for each Telegram user: check ZED_Accounts for existing TG_User_ID or TG_Username match. If found, update the TG_User_ID if missing. If not found, create a new row in ZED_Contacts (Nom = Telegram first name, TLG_Name = display name) and a linked row in ZED_Accounts. Mark the source as `"telethon_import"` in the Tag field.

5. **Node.js proxy + Railway config** — Add `TELEGRAM_WORKER_URL` env support to `server.js` and add the two proxy endpoints. Add `telegram_worker/Procfile` and `telegram_worker/railway.toml` so the worker can be deployed as a second Railway service from the same repo.

## Relevant files
- `server.js` (lines 325–649)
- `docs/plans/17-contacts-and-telegram.md`
- `replit.md`
