import json
import os
import time
import uuid
from datetime import datetime, timezone

import gspread


HEADERS = {
    "ZED_Contacts": ["ID_Contact", "Full_Name", "Notes", "Tags", "Created_At", "Updated_At", "Created_By", "Updated_By"],
    "ZED_Accounts": ["ID_Account", "ID_Contact", "Account_Type", "Value", "Normalized_Value", "TG_User_ID", "TG_Username", "TG_Display_Name", "Source", "Created_At", "Updated_At"],
    "Telegram_Joins": ["ID_Join", "Chat_ID", "Channel_Name", "Channel_Username", "TG_User_ID", "TG_Username", "TG_Display_Name", "Joined_At", "Matched_ID_Contact", "Update_ID", "Raw_JSON"],
    "ZED_Channels": ["ID_Channel", "Channel_Name", "Username", "Type", "Members_Count", "Last_Sync"],
    "ZED_Jobs": ["ID_Job", "Type", "Channel", "Status", "Progress", "Total", "Started", "Finished", "Error", "Summary_JSON", "Worker_Job_ID"],
}


def run_gspread_request(fn, label="Google Sheets request", retries=5, base_delay=2.0):
    """
    Retry gspread operations on quota/transient failures with exponential backoff.
    """
    last_error = None
    for attempt in range(retries):
        try:
            return fn()
        except gspread.exceptions.APIError as error:
            message = str(error)
            is_retryable = (
                "429" in message or
                "Quota exceeded" in message or
                "Read requests per minute per user" in message or
                "500" in message or
                "502" in message or
                "503" in message or
                "504" in message
            )
            if not is_retryable or attempt >= retries - 1:
                raise
            delay = base_delay * (2 ** attempt)
            print(f"Retry {attempt + 1}/{retries} for {label} after {delay:.1f}s due to Sheets API limit...")
            time.sleep(delay)
            last_error = error
    if last_error:
        raise last_error


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def make_id(prefix):
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def normalize_username(value):
    return str(value or "").strip().lstrip("@").lower()


def column_index_to_letter(index):
    """
    Convert a zero-based column index to Excel/Sheets column letters.
    """
    if index < 0:
        raise ValueError("Column index must be non-negative")
    out = ""
    current = index + 1
    while current > 0:
        current, rem = divmod(current - 1, 26)
        out = chr(65 + rem) + out
    return out


class SheetsStore:
    def __init__(self):
        self.sheet_id = os.environ["CONTACTS_SHEET_ID"]
        service_account = json.loads(os.environ["SERVICE_ACCOUNT_JSON"])
        self.gc = gspread.service_account_from_dict(service_account)
        self.book = run_gspread_request(
            lambda: self.gc.open_by_key(self.sheet_id),
            label="open contacts spreadsheet"
        )
        self._worksheet_cache = {}
        self._header_cache = {}

    def ensure_sheet(self, title):
        worksheet = self._worksheet_cache.get(title)
        if worksheet is None:
            try:
                worksheet = run_gspread_request(
                    lambda: self.book.worksheet(title),
                    label=f"open worksheet {title}"
                )
            except gspread.WorksheetNotFound:
                worksheet = run_gspread_request(
                    lambda: self.book.add_worksheet(title=title, rows=1000, cols=len(HEADERS[title]) + 6),
                    label=f"create worksheet {title}"
                )
            self._worksheet_cache[title] = worksheet

        values = run_gspread_request(
            lambda: worksheet.get("A1:Z2"),
            label=f"read headers for {title}"
        )
        first_row = values[0] if values else []
        if first_row != HEADERS[title]:
            run_gspread_request(
                lambda: worksheet.update("A1", [HEADERS[title]]),
                label=f"write headers for {title}"
            )
            self._header_cache[title] = list(HEADERS[title])
        return worksheet

    def ensure_all(self):
        for title in HEADERS:
            self.ensure_sheet(title)

    def get_rows(self, title):
        worksheet = self.ensure_sheet(title)
        raw_rows = run_gspread_request(
            lambda: worksheet.get_all_values(),
            label=f"read rows for {title}"
        )
        rows = []
        for row_index, row in enumerate(raw_rows[1:], start=2):
            payload = {header: (row[idx] if idx < len(row) else "") for idx, header in enumerate(HEADERS[title])}
            payload["_row_index"] = row_index
            rows.append(payload)
        return rows, worksheet

    def append_row(self, title, row):
        worksheet = self.ensure_sheet(title)
        run_gspread_request(
            lambda: worksheet.append_row([row.get(header, "") for header in HEADERS[title]], value_input_option="USER_ENTERED"),
            label=f"append row to {title}"
        )

    def update_row(self, title, row_index, payload):
        worksheet = self.ensure_sheet(title)
        end_col = column_index_to_letter(len(HEADERS[title]) - 1)
        run_gspread_request(
            lambda: worksheet.update(
                f"A{row_index}:{end_col}{row_index}",
                [[payload.get(header, "") for header in HEADERS[title]]],
                value_input_option="USER_ENTERED",
            ),
            label=f"update row in {title}"
        )

    def upsert_job(self, payload):
        rows, worksheet = self.get_rows("ZED_Jobs")
        for row in rows:
            if row.get("ID_Job") == payload["ID_Job"]:
                end_col = column_index_to_letter(len(HEADERS["ZED_Jobs"]) - 1)
                run_gspread_request(
                    lambda: worksheet.update(
                        f"A{row['_row_index']}:{end_col}{row['_row_index']}",
                        [[payload.get(header, "") for header in HEADERS["ZED_Jobs"]]],
                        value_input_option="USER_ENTERED",
                    ),
                    label="update job row"
                )
                return
        run_gspread_request(
            lambda: worksheet.append_row([payload.get(header, "") for header in HEADERS["ZED_Jobs"]], value_input_option="USER_ENTERED"),
            label="append job row"
        )

    def write_channels(self, channels):
        worksheet = self.ensure_sheet("ZED_Channels")
        rows = [
            {
                "ID_Channel": str(channel.get("id", "")),
                "Channel_Name": channel.get("name", ""),
                "Username": channel.get("username", ""),
                "Type": channel.get("type", ""),
                "Members_Count": str(channel.get("members_count", "")),
                "Last_Sync": now_iso(),
            }
            for channel in channels
        ]
        matrix = [HEADERS["ZED_Channels"]]
        for row in rows:
            matrix.append([row.get(header, "") for header in HEADERS["ZED_Channels"]])
        run_gspread_request(lambda: worksheet.clear(), label="clear ZED_Channels")
        run_gspread_request(lambda: worksheet.update("A1", matrix), label="rewrite ZED_Channels")

    def import_members(self, members):
        contacts, contacts_ws = self.get_rows("ZED_Contacts")
        accounts, accounts_ws = self.get_rows("ZED_Accounts")
        created = 0
        updated = 0
        skipped_duplicates = 0

        contacts_by_id = {row.get("ID_Contact"): row for row in contacts if row.get("ID_Contact")}
        by_user_id = {}
        by_username = {}
        for row in accounts:
            user_id = str(row.get("TG_User_ID", "")).strip()
            username = normalize_username(row.get("TG_Username") or row.get("Value"))
            if user_id:
                by_user_id[user_id] = row
            if username:
                by_username[username] = row

        seen_members = set()
        for member in members:
            tg_user_id = str(member.get("tg_user_id", "")).strip()
            tg_username = normalize_username(member.get("tg_username"))
            dedupe_key = tg_user_id or tg_username
            if dedupe_key and dedupe_key in seen_members:
                skipped_duplicates += 1
                continue
            if dedupe_key:
                seen_members.add(dedupe_key)

            matched = by_user_id.get(tg_user_id) if tg_user_id else None
            if not matched and tg_username:
                matched = by_username.get(tg_username)

            timestamp = now_iso()
            display_name = (
                member.get("display_name")
                or member.get("first_name")
                or member.get("tg_username")
                or tg_user_id
            )

            if matched:
                matched["Account_Type"] = matched.get("Account_Type") or "telegram"
                matched["Value"] = member.get("tg_username") or matched.get("Value") or tg_user_id
                matched["Normalized_Value"] = tg_username or matched.get("Normalized_Value") or tg_user_id
                matched["TG_User_ID"] = tg_user_id or matched.get("TG_User_ID", "")
                matched["TG_Username"] = tg_username or matched.get("TG_Username", "")
                matched["TG_Display_Name"] = display_name or matched.get("TG_Display_Name", "")
                matched["Source"] = matched.get("Source") or "telethon_import"
                matched["Updated_At"] = timestamp
                self.update_row("ZED_Accounts", matched["_row_index"], matched)

                contact = contacts_by_id.get(matched.get("ID_Contact"))
                if contact:
                    if not str(contact.get("Full_Name", "")).strip():
                        contact["Full_Name"] = display_name
                    if "telethon_import" in str(contact.get("Tags", "")).split(",") or not str(contact.get("Tags", "")).strip():
                        tags = {tag.strip() for tag in str(contact.get("Tags", "")).split(",") if tag.strip()}
                        tags.add("telethon_import")
                        contact["Tags"] = ",".join(sorted(tags))
                    contact["Updated_At"] = timestamp
                    contact["Updated_By"] = "telethon-worker"
                    self.update_row("ZED_Contacts", contact["_row_index"], contact)
                updated += 1
                continue

            contact_id = make_id("contact")
            contact_row = {
                "ID_Contact": contact_id,
                "Full_Name": display_name,
                "Notes": "",
                "Tags": "telethon_import",
                "Created_At": timestamp,
                "Updated_At": timestamp,
                "Created_By": "telethon-worker",
                "Updated_By": "telethon-worker",
            }
            account_row = {
                "ID_Account": make_id("acct"),
                "ID_Contact": contact_id,
                "Account_Type": "telegram",
                "Value": member.get("tg_username") or tg_user_id,
                "Normalized_Value": tg_username or tg_user_id,
                "TG_User_ID": tg_user_id,
                "TG_Username": tg_username,
                "TG_Display_Name": display_name,
                "Source": "telethon_import",
                "Created_At": timestamp,
                "Updated_At": timestamp,
            }

            run_gspread_request(
                lambda: contacts_ws.append_row([contact_row.get(header, "") for header in HEADERS["ZED_Contacts"]], value_input_option="USER_ENTERED"),
                label="append imported contact"
            )
            run_gspread_request(
                lambda: accounts_ws.append_row([account_row.get(header, "") for header in HEADERS["ZED_Accounts"]], value_input_option="USER_ENTERED"),
                label="append imported account"
            )
            contacts_by_id[contact_id] = contact_row
            if tg_user_id:
                by_user_id[tg_user_id] = account_row
            if tg_username:
                by_username[tg_username] = account_row
            created += 1

        return {
            "created_contacts": created,
            "updated_accounts": updated,
            "skipped_duplicates": skipped_duplicates,
        }
