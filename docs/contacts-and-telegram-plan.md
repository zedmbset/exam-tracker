# Contacts & Telegram channel-join tracking

## What & Why
Add a second mini-app inside this same repo so the user can store their contacts in Google Sheets via a flexible web form, and link Telegram channel joins back to those contacts. Today the same Express server is already wired to Google Sheets via a service account; this work reuses that plumbing under separate URL paths and a separate sheet ID. No new project, no second Railway deploy, no duplicated auth setup.

The contacts data layout is intentionally simple per the user's choice: one row per contact, with multiple emails and Telegram handles stored as comma-separated values inside their cells.

## Done looks like
- A new page at `/contacts/` lists every contact in a clean table: full name, comma-separated emails, comma-separated Telegram handles, notes, last-updated info. Search/filter by name, email, or Telegram handle.
- A "+ Add contact" button opens a flexible form with:
  - Name (required), notes (optional)
  - **Emails** section: starts with one row, "+ add email" adds more, each row deletable. Saved as comma-separated.
  - **Telegram accounts** section: same dynamic add/remove pattern, defaults to one row since most contacts have a single account.
  - Light validation (basic email shape, Telegram handle starts with `@` or is a phone number).
- Editing an existing contact opens the same form pre-filled.
- A separate Google Sheet (different from the exam tracker sheet) stores the contacts, configured via a `CONTACTS_SHEET_ID` env var. The header row is created automatically on first write if the sheet is empty.
- A Telegram bot (added to the user's channels) listens for new members and writes each join event to a `Telegram_Joins` tab in the same contacts sheet (telegram_user_id, username, channel, joined_at, matched_contact_row). The contacts page surfaces a per-contact "Joined channels" badge when a match is found.
- The shared top bar gets a "Contacts" link next to "Disponibilité" so users can switch between the two apps.

## Out of scope
- Real OAuth-gated login. We reuse the existing lightweight identity (the "Set identity" button) so anyone with the link who has set their identity can use the page. Locking it down to admin emails is a separate future task.
- Bulk CSV import of Telegram channel members from Telegram Desktop exports. Tracked as a follow-up — start with the bot.
- Sending messages from the app to Telegram users. Read-only on Telegram's side for now.
- Migration to a relational layout (separate Emails / TelegramAccounts tabs). The flat one-row-per-contact layout is what the user picked.
- Changing the existing exam tracker behaviour.

## Tasks
1. **Backend: contacts API** — Add Express routes (`GET /api/contacts`, `POST /api/contacts`, `PUT /api/contacts/:rowIndex`, `DELETE /api/contacts/:rowIndex`) that read and write a separate Google Sheet identified by a new `CONTACTS_SHEET_ID` environment variable. Reuse the existing service-account JWT helper. Auto-create the header row on first write if the sheet is empty.

2. **Frontend: contacts page** — Build `/public/contacts/index.html` with a contacts list (search, sort, edit, delete) and a flexible add/edit form supporting dynamic add/remove rows for emails and Telegram handles. Match the existing app's visual style. Add a "Contacts" link to the top bar of the main exam-tracker dashboard.

3. **Telegram bot integration** — Register a bot via BotFather (the user provides the token as a `TELEGRAM_BOT_TOKEN` secret), add a webhook endpoint at `/api/telegram/webhook`, handle `chat_member` updates to capture new joiners, and append rows to a `Telegram_Joins` tab in the contacts sheet. Show clear setup instructions in the contacts page when no joins have arrived yet.

4. **Match joins to contacts** — When loading the contacts page, cross-reference each join row's telegram username against the comma-separated Telegram handles in each contact, and surface a small badge ("Joined: Channel X, Channel Y") on matched contacts. Surface unmatched joins in a separate "Unlinked Telegram joiners" panel so the user can attach them to a contact in one click.

## Relevant files
- `server.js`
- `public/index.html:269-287`
- `public/exam.html`
