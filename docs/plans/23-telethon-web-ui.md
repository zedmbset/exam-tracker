# Task #23 — Channels Browser + Member Sync UI

**Status:** PROPOSED

## What & Why
Once the Telethon worker is running (Task #22), moderators need a way to use it from the web app without touching the command line. This task adds a "My Channels" panel to the contacts page where moderators can browse all Telegram channels the account is in, trigger a member fetch for any channel, and watch the import progress — all from the browser.

## Done looks like
- A "My Channels" collapsible section appears in `/contacts/` below the Telegram Bot panel
- Clicking "Sync Channel List" fetches all channels/groups the Telethon account is in and stores them in a new `ZED_Channels` sheet (columns: ID_Channel, Channel_Name, Username, Type, Members_Count, Last_Sync)
- The channel list renders in the web UI as a table: name, type (channel/group), member count, last sync date
- Each channel row has a "Fetch Members" button that starts a worker job and shows real-time progress (polling every 3s): "Fetching… 142/800 members"
- When the job finishes, a summary shows: "312 new contacts created, 488 already existed"
- New contacts created by Telethon import are visible immediately in the main contacts table, tagged as `telethon_import`
- If the worker is not configured (`TELEGRAM_WORKER_URL` missing), the panel shows a clear "worker not connected" message instead of the controls
- If the Telethon session is expired or invalid, the error from the worker is surfaced clearly in the panel

## Out of scope
- Selecting which fields to import (always imports: first name, last name, username, TG_User_ID)
- Filtering or deduplicating contacts before import (deduplication is automatic by TG_User_ID / username)
- Message fetching or content operations
- Scheduling automatic syncs

## Tasks
1. **ZED_Channels sheet + channel list endpoint** — Add `GET /api/telegram/channels` to Node.js (proxies to worker's list-channels job result and caches in `ZED_Channels` sheet). Auto-create `ZED_Channels` tab with headers on first use.

2. **Channels panel UI** — Add the "My Channels" collapsible panel to `public/contacts/index.html` below the bot status panel. Panel fetches and renders the channel list from `GET /api/telegram/channels`. Includes "Sync Channel List" button and per-row "Fetch Members" buttons.

3. **Job status polling** — After "Fetch Members" is clicked, the row shows a live progress bar. The frontend polls `GET /api/telegram/jobs/:jobId` every 3 seconds and updates the display until status is `done` or `error`. On completion, reload the contacts table to show new imports.

4. **Import summary + error display** — On job completion, show an inline summary card on the channel row: "N new contacts created, M already existed". On error, show the error message from the worker with a retry button.

## Relevant files
- `public/contacts/index.html`
- `server.js` (lines 325–649)
- `docs/plans/22-telethon-worker.md`
