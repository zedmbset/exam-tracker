import json
import os
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


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def make_id(prefix):
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def normalize_username(value):
    return str(value or "").strip().lstrip("@").lower()


class SheetsStore:
    def __init__(self):
        self.sheet_id = os.environ["CONTACTS_SHEET_ID"]
        service_account = json.loads(os.environ["SERVICE_ACCOUNT_JSON"])
        self.gc = gspread.service_account_from_dict(service_account)
        self.book = self.gc.open_by_key(self.sheet_id)

    def ensure_sheet(self, title):
        try:
            worksheet = self.book.worksheet(title)
        except gspread.WorksheetNotFound:
            worksheet = self.book.add_worksheet(title=title, rows=1000, cols=len(HEADERS[title]) + 6)
        values = worksheet.get("A1:Z2")
        first_row = values[0] if values else []
        if first_row != HEADERS[title]:
            worksheet.update("A1", [HEADERS[title]])
        return worksheet

    def ensure_all(self):
        for title in HEADERS:
            self.ensure_sheet(title)

    def get_rows(self, title):
        worksheet = self.ensure_sheet(title)
        rows = worksheet.get_all_records()
        return rows, worksheet

    def overwrite_rows(self, title, rows):
        worksheet = self.ensure_sheet(title)
        matrix = [HEADERS[title]]
        for row in rows:
          matrix.append([row.get(header, "") for header in HEADERS[title]])
        worksheet.clear()
        worksheet.update("A1", matrix)

    def append_row(self, title, row):
        worksheet = self.ensure_sheet(title)
        worksheet.append_row([row.get(header, "") for header in HEADERS[title]], value_input_option="USER_ENTERED")

    def upsert_job(self, payload):
        rows, worksheet = self.get_rows("ZED_Jobs")
        for index, row in enumerate(rows, start=2):
            if row.get("ID_Job") == payload["ID_Job"]:
                worksheet.update(f"A{index}:K{index}", [[payload.get(header, "") for header in HEADERS["ZED_Jobs"]]])
                return
        worksheet.append_row([payload.get(header, "") for header in HEADERS["ZED_Jobs"]], value_input_option="USER_ENTERED")

    def write_channels(self, channels):
        rows = [{
            "ID_Channel": str(channel.get("id", "")),
            "Channel_Name": channel.get("name", ""),
            "Username": channel.get("username", ""),
            "Type": channel.get("type", ""),
            "Members_Count": str(channel.get("members_count", "")),
            "Last_Sync": now_iso(),
        } for channel in channels]
        self.overwrite_rows("ZED_Channels", rows)

    def import_members(self, members):
        contacts, _ = self.get_rows("ZED_Contacts")
        accounts, _ = self.get_rows("ZED_Accounts")
        created = 0
        existing = 0
        by_user_id = {str(row.get("TG_User_ID", "")).strip(): row for row in accounts if str(row.get("TG_User_ID", "")).strip()}
        by_username = {normalize_username(row.get("TG_Username") or row.get("Value")): row for row in accounts if normalize_username(row.get("TG_Username") or row.get("Value"))}

        contact_rows = list(contacts)
        account_rows = list(accounts)

        for member in members:
            tg_user_id = str(member.get("tg_user_id", "")).strip()
            tg_username = normalize_username(member.get("tg_username"))
            matched = by_user_id.get(tg_user_id) if tg_user_id else None
            if not matched and tg_username:
                matched = by_username.get(tg_username)

            if matched:
                existing += 1
                if tg_user_id and not str(matched.get("TG_User_ID", "")).strip():
                    matched["TG_User_ID"] = tg_user_id
                if tg_username and not normalize_username(matched.get("TG_Username")):
                    matched["TG_Username"] = tg_username
                if member.get("display_name"):
                    matched["TG_Display_Name"] = member["display_name"]
                matched["Updated_At"] = now_iso()
                continue

            contact_id = make_id("contact")
            timestamp = now_iso()
            contact_rows.append({
                "ID_Contact": contact_id,
                "Full_Name": member.get("display_name") or member.get("first_name") or member.get("tg_username") or tg_user_id,
                "Notes": "",
                "Tags": "telethon_import",
                "Created_At": timestamp,
                "Updated_At": timestamp,
                "Created_By": "telethon-worker",
                "Updated_By": "telethon-worker",
            })
            account_row = {
                "ID_Account": make_id("acct"),
                "ID_Contact": contact_id,
                "Account_Type": "telegram",
                "Value": member.get("tg_username") or tg_user_id,
                "Normalized_Value": tg_username or tg_user_id,
                "TG_User_ID": tg_user_id,
                "TG_Username": tg_username,
                "TG_Display_Name": member.get("display_name", ""),
                "Source": "telethon_import",
                "Created_At": timestamp,
                "Updated_At": timestamp,
            }
            account_rows.append(account_row)
            if tg_user_id:
                by_user_id[tg_user_id] = account_row
            if tg_username:
                by_username[tg_username] = account_row
            created += 1

        self.overwrite_rows("ZED_Contacts", contact_rows)
        self.overwrite_rows("ZED_Accounts", account_rows)
        return {"created_contacts": created, "existing_accounts": existing}
