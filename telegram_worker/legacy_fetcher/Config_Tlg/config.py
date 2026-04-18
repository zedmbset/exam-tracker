import json
import os
import tempfile
from pathlib import Path


API_ID = int(os.environ.get("TELEGRAM_API_ID", "0"))
API_HASH = os.environ.get("TELEGRAM_API_HASH", "")
PHONE_NUMBER = os.environ.get("TELEGRAM_PHONE", "")
TWO_FA_PASSWORD = os.environ.get("TELEGRAM_2FA_PASSWORD", "")

_TEMP_DIR = Path(tempfile.gettempdir()) / "exam_tracker_worker"
_TEMP_DIR.mkdir(parents=True, exist_ok=True)
GOOGLE_CREDENTIALS_FILE = str(_TEMP_DIR / "service_account.json")

if os.environ.get("SERVICE_ACCOUNT_JSON"):
    Path(GOOGLE_CREDENTIALS_FILE).write_text(os.environ["SERVICE_ACCOUNT_JSON"], encoding="utf-8")

SPREADSHEET_ID = os.environ.get("TELEGRAM_FETCH_CHANNELS_SPREADSHEET_ID") or os.environ.get("TELEGRAM_SPREADSHEET_ID") or ""
ALL_MSGS_SHEET_NAME = os.environ.get("TELEGRAM_FETCH_DEFAULT_SHEET", "All_Msgs")
ALL_MSGS_SHEET_GID = ""

DEFAULT_DRAFT_SPREADSHEET_ID = os.environ.get("DRAFT_SPREADSHEET_ID", "")
DEFAULT_DRAFT_SHEET_NAME = os.environ.get("DEFAULT_DRAFT_SHEET_NAME", "Draft_CHN")

DEFAULT_AUTOMATION_SPREADSHEET_ID = os.environ.get("TELEGRAM_SPREADSHEET_ID", "")
DEFAULT_AUTOMATION_SHEET_NAME = os.environ.get("DEFAULT_TELEGRAM_SHEET_NAME", ALL_MSGS_SHEET_NAME)

RUNTIME_DATA_DIR = str(_TEMP_DIR)
DRAFT_SHEETS_CACHE_FILE = str(_TEMP_DIR / ".draft_sheets_cache.json")
AUTOMATION_SHEETS_CACHE_FILE = str(_TEMP_DIR / ".automation_sheets_cache.json")

DEFAULT_CHANNELS_SHEET_NAME = os.environ.get("TELEGRAM_FETCH_CHANNELS_SHEET_NAME", "My_CHNs_Grps")
DEFAULT_CHANNELS_SHEET_GID = os.environ.get("TELEGRAM_FETCH_CHANNELS_SHEET_GID", "1600911713")
DEFAULT_CHANNELS_SHEET_RANGE = "A2:A1000"

CHANNELS_SHEET_NAME = DEFAULT_CHANNELS_SHEET_NAME
CHANNELS_SHEET_RANGE = DEFAULT_CHANNELS_SHEET_RANGE
CHANNELS_SHEET_GID = DEFAULT_CHANNELS_SHEET_GID
CHANNEL_NAME_COLUMN = "Channel Name"
CHANNEL_ID_COLUMN = "Channel ID"

SETTINGS_FILE = str(_TEMP_DIR / ".app_settings.json")
LAST_SELECTION_FILE = str(_TEMP_DIR / ".last_channels.json")
SPREADSHEET_REGISTRY_FILE = str(_TEMP_DIR / ".spreadsheet_registry.json")

SCHEDULED_TIME_FORMAT = "%Y-%m-%d %H:%M"
SCHEDULED_TIME_FORMATS = [
    "%Y-%m-%d %H:%M",
    "%d/%m/%Y %H:%M",
    "%Y-%m-%d %H:%M:%S",
    "%d/%m/%Y %H:%M:%S",
]
SCHEDULED_TIME_TIMEZONE = os.environ.get("TELEGRAM_FETCH_TIMEZONE", "Africa/Algiers")
SCHEDULED_TIME_MAX_FUTURE_DAYS = 365

UPDATE_ACTION_FULL_REFRESH = True
RECONSTRUCT_GROUPED_MEDIA_AS_ALBUM = True
TELEGRAM_ACTION_DELAY = float(os.environ.get("TELEGRAM_ACTION_DELAY", "1.0"))


class SpreadsheetRegistry:
    def __init__(self):
        self.data = {"spreadsheets": {}, "last_used": None, "cache_validity_hours": 24}

    def get_last_used(self):
        return None


spreadsheet_registry = SpreadsheetRegistry()
