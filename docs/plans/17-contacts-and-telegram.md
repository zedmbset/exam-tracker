# Plan #17 — Contacts & Telegram channel-join tracking

> Task #17 · Status: IN PROGRESS

## What & Why
Add a contacts management mini-app inside this same repo, backed by a relational Google Sheets model, and link Telegram channel join events to individual contacts. The same Express server and service-account JWT already in use for the exam tracker are fully reused — no new project, no second Railway deploy.

The data model is **relational across 3 sheets** (upgraded from the original flat design after deciding to support activity tracking and cross-database linking).

---

## Sheet structure (already created by user)

Sheet ID: `1tsP9abcf5NsIqNV-K_qts_RncpDdSPn3ElAPeY6YkdU`
Env var: `CONTACTS_SHEET_ID`

### ZED_Contacts — one row per person
| Col | Name | Format | Notes |
|---|---|---|---|
| 0 | ID_Contact | `CTK-00001` | Primary key, no spaces, zero-padded 5 digits |
| 1 | Timestamp | datetime | Date contact added |
| 2 | Email Address | text | Legacy field — keep during migration |
| 3 | Nom (en francais) | text | Last name |
| 4 | Prénom (en francais) | text | First name |
| 5 | TLG_Name | text | Display name as seen in Telegram |
| 6 | Username | text | Optional platform username |
| 7 | Official phone number | text | Optional |
| 8 | Archive_Tlg_Contacts | text | Legacy field |
| 9 | Wilaya | text | Region/province |
| 10 | Commune | text | City/town |
| 11 | Archive_adresse | text | Legacy field |
| 12 | Promo | `Promo 2018` | Promotion year |
| 13 | VIP | `TRUE`/`FALSE` | Boolean |
| 14 | Tag | text | e.g. `All Promo` |

### ZED_Accounts — one row per Telegram account
| Col | Name | Format | Notes |
|---|---|---|---|
| 0 | ID_Telegram | `T-00001` | Surrogate key — stable even if username changes |
| 1 | ID_Contact | `CTK-00001` | Foreign key → ZED_Contacts |
| 2 | TG_User_ID | numeric | Telegram's permanent internal ID — use for bot matching |
| 3 | TG_Username | `@handle` | Display only — can change anytime |

### ZED_Emails — one row per email address
| Col | Name | Format | Notes |
|---|---|---|---|
| 0 | ID_Email | `E-00001` | Primary key |
| 1 | ID_Contact | `CTK-00001` | Foreign key → ZED_Contacts |
| 2 | Email | email | |
| 3 | Is_Primary | `TRUE`/`FALSE` | Mark one per contact |

### ZED_Activities — one row per event (auto-created by bot)
| Col | Name | Format | Notes |
|---|---|---|---|
| 0 | ID_Activity | `A-00001` | Primary key |
| 1 | ID_Contact | `CTK-00001` | FK → ZED_Contacts (empty if unmatched) |
| 2 | ID_Telegram | `T-00001` | FK → ZED_Accounts (empty if unmatched) |
| 3 | TG_User_ID | numeric | Raw Telegram user ID |
| 4 | TG_Username | `@handle` | At time of event |
| 5 | Action | text | `joined_channel`, `left_channel` |
| 6 | Channel | text | Telegram channel name |
| 7 | Timestamp | ISO datetime | |

---

## ID conventions (for all AI models working on this project)
- Contacts: `CTK-00001` — no spaces, zero-padded to 5 digits
- Telegram accounts: `T-00001` — zero-padded to 5 digits
- Emails: `E-00001` — zero-padded to 5 digits
- Activities: `A-00001` — zero-padded to 5 digits

---

## Done looks like
- `/contacts/` page: searchable/filterable contacts table, add/edit drawer, delete with confirm
- Add/edit drawer: core fields + dynamic email rows + dynamic Telegram account rows
- Backend: CRUD across all 3 sheets with auto-generated IDs
- Telegram bot webhook: `/api/telegram/webhook` handles `chat_member` joins, writes to ZED_Activities
- Per-contact "Joined: Channel X" badges pulled from ZED_Activities
- "Unlinked joiners" panel for events not matched to a contact
- "Contacts" link in the top bar of main dashboard and availability page

---

## Out of scope
- Real OAuth login — reuse existing lightweight identity ("Set identity" button)
- Bulk CSV import from Telegram Desktop exports — follow-up task
- Sending messages from the app to contacts
- Removing legacy columns from sheet (user does this manually after migration)

---

## Data cleanup needed (user action)
1. Fix `CTK- 00001` → `CTK-00001` (remove space after dash) in ZED_Contacts
2. Standardise VIP column to `TRUE`/`FALSE` only
3. Fix broken Telegram handle `@d k` (has a space — invalid)
4. Run `=TRIM()` on Nom, Prénom, Wilaya, Commune to strip trailing spaces
5. Delete blank row 2 in old "ZED All Contacts" tab

---

## Implementation tasks

1. **Backend: contacts API** — Express routes for full CRUD:
   - `GET /api/contacts` — join all 3 sheets, return enriched list
   - `POST /api/contacts` — create rows in all 3 sheets, auto-generate IDs
   - `PUT /api/contacts/:id` — update contact core fields
   - `DELETE /api/contacts/:id` — blank rows in all 3 sheets
   - `POST /api/contacts/:id/emails` — add email
   - `DELETE /api/contacts/emails/:emailId` — remove email
   - `POST /api/contacts/:id/accounts` — add Telegram account
   - `DELETE /api/contacts/accounts/:accountId` — remove account
   - `GET /api/contacts/activities` — return join events
   - `POST /api/contacts/link-activity` — manually link unmatched joiner
   - `POST /api/telegram/webhook` — handle Telegram bot updates

2. **Frontend: contacts page** — `/public/contacts/index.html`

3. **Topbar links** — add "Contacts" link to `public/index.html` and `public/availability.html`

---

## Environment variables needed
- `CONTACTS_SHEET_ID` = `1tsP9abcf5NsIqNV-K_qts_RncpDdSPn3ElAPeY6YkdU` (set in Railway)
- `TELEGRAM_BOT_TOKEN` = from BotFather (set in Railway when ready)

## Relevant files
- `server.js`
- `public/index.html:269-287`
- `public/availability.html`
