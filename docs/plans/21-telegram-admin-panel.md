# Task #21 — Telegram Admin Panel

**Status:** PROPOSED

## What & Why
The webhook endpoint is fully built and secure, but moderators currently have no way to configure or verify the Telegram bot without touching the Railway dashboard or running curl commands. This task adds a team-facing "Telegram Bot" panel inside the contacts page so any moderator can register the webhook, check its status, and diagnose issues without developer involvement.

## Done looks like
- A "Telegram Bot" collapsible section appears in `/contacts/` below the stats row
- The panel shows the bot's name + @username when the token is set, or a "not configured" state when it is not
- The panel shows the current webhook status: registered URL, pending update count, last error (if any)
- A "Register Webhook" button calls the Telegram API from the server and shows inline success/error feedback
- If the bot token is missing, the panel shows a clear instruction (set TELEGRAM_BOT_TOKEN on Railway)
- All existing contacts functionality is unchanged

## Out of scope
- Telethon / MTProto integration (Task #22)
- Managing which channels the bot is in (done directly in Telegram by adding the bot as admin)
- Any UI for sending messages or posting content through the bot

## Tasks
1. **Three new API endpoints** — Add `POST /api/telegram/register-webhook` (calls Telegram's `setWebhook` with `allowed_updates=["chat_member"]`), `GET /api/telegram/webhook-info` (calls `getWebhookInfo`), and `GET /api/telegram/bot-info` (calls `getMe`). All three return a safe `{ configured: false }` shape when `TELEGRAM_BOT_TOKEN` is not set. Use the `HOST` request header (or a new `APP_URL` env var) to build the webhook URL dynamically.

2. **Bot status panel in the contacts page** — Add a collapsible "Telegram Bot" section below the stats row in `public/contacts/index.html`. On open, it fetches `/api/telegram/bot-info` and `/api/telegram/webhook-info` and displays the results. The "Register Webhook" button triggers `POST /api/telegram/register-webhook` and shows inline success/error. Panel is collapsed by default.

## Relevant files
- `server.js` (lines 325–649, CONTACTS MINI-APP section)
- `public/contacts/index.html`
