"""
Google Sheets Helper Module - Simplified Version

Provides reusable functions for Google Sheets operations

NOTE: Text parsing moved to telegram_client/utils/text_extractors.py
"""

import gspread
from google.oauth2.service_account import Credentials
import config
import json
import os
import time
from datetime import datetime, timedelta
import pytz


# Google Sheets API Scopes
SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive'
]

# ============= AUTHENTICATION =============

# Module-level cached client – created once per process, reused everywhere
_gspread_client_cache = None
_spreadsheet_cache = {}
_worksheet_cache = {}
_header_row_cache = {}


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
                '429' in message or
                'Quota exceeded' in message or
                'Read requests per minute per user' in message or
                '500' in message or
                '502' in message or
                '503' in message or
                '504' in message
            )
            if not is_retryable or attempt >= retries - 1:
                raise
            delay = base_delay * (2 ** attempt)
            print(f"  Retry {attempt + 1}/{retries} for {label} after {delay:.1f}s due to Sheets API limit...")
            time.sleep(delay)
            last_error = error
    if last_error:
        raise last_error

def get_google_sheets_client():
    """
    Initialize and return authenticated Google Sheets client.
    Result is cached for the lifetime of the process so that
    OAuth + HTTP connection setup only happens once per run.

    Returns:
        gspread.Client: Authenticated Google Sheets client

    Raises:
        FileNotFoundError: If credentials file not found
        Exception: If authentication fails
    """
    global _gspread_client_cache
    if _gspread_client_cache is not None:
        return _gspread_client_cache
    try:
        service_account_json = os.environ.get('SERVICE_ACCOUNT_JSON', '')
        if service_account_json:
            creds = Credentials.from_service_account_info(
                json.loads(service_account_json),
                scopes=SCOPES
            )
        else:
            creds = Credentials.from_service_account_file(
                config.GOOGLE_CREDENTIALS_FILE,
                scopes=SCOPES
            )
        _gspread_client_cache = gspread.authorize(creds)
        return _gspread_client_cache
    except FileNotFoundError:
        raise FileNotFoundError(
            f"Google credentials file not found at: {config.GOOGLE_CREDENTIALS_FILE}"
        )
    except Exception as e:
        raise Exception(f"Failed to authenticate with Google Sheets: {str(e)}")


def get_spreadsheet(spreadsheet_id):
    """Return a cached spreadsheet object for the given spreadsheet ID."""
    spreadsheet = _spreadsheet_cache.get(spreadsheet_id)
    if spreadsheet is not None:
        return spreadsheet

    gc = get_google_sheets_client()
    spreadsheet = gc.open_by_key(spreadsheet_id)
    _spreadsheet_cache[spreadsheet_id] = spreadsheet
    return spreadsheet


def _worksheet_cache_key(spreadsheet_id, sheet_name):
    return (str(spreadsheet_id), str(sheet_name))


def column_index_to_letter(index):
    """
    Convert a zero-based column index to Excel/Sheets column letters.
    0 -> A, 25 -> Z, 26 -> AA, 27 -> AB ...
    """
    if index < 0:
        raise ValueError("Column index must be non-negative")
    out = ""
    current = index + 1
    while current > 0:
        current, rem = divmod(current - 1, 26)
        out = chr(65 + rem) + out
    return out


def invalidate_header_cache(spreadsheet_id, sheet_name):
    _header_row_cache.pop(_worksheet_cache_key(spreadsheet_id, sheet_name), None)


def get_header_row_cached(worksheet, spreadsheet_id, sheet_name):
    """Read and cache the header row for a worksheet."""
    cache_key = _worksheet_cache_key(spreadsheet_id, sheet_name)
    cached = _header_row_cache.get(cache_key)
    if cached is not None:
        return list(cached)

    header_row = run_gspread_request(
        lambda: worksheet.row_values(1),
        label=f"read header row for {sheet_name}"
    )
    _header_row_cache[cache_key] = list(header_row)
    return list(header_row)


def read_action_rows_only(spreadsheet_id, sheet_name=None):
    """
    FAST alternative to read_sheet_data() for action execution.

    Strategy:
      1. Fetch ONLY the Action column  (1 col  × N rows  – tiny payload)
      2. Find row numbers that have a non-empty Action value
      3. Fetch ONLY those rows via batch_get  (M rows × all cols – still tiny)
      4. Return (headers, action_rows) – same format as read_sheet_data()

    With 4855 rows and ~20 action rows this downloads ~4875 cells instead
    of ~72,825 cells – roughly 15× less data, noticeably faster.

    Args:
        spreadsheet_id (str): The spreadsheet ID
        sheet_name (str, optional): Sheet name

    Returns:
        tuple: (headers, data_rows)
            headers   – list of column header strings
            data_rows – list of (row_index_1based, row_data_list) tuples
                        *** NOTE: each element is (row_idx, row_list) ***
                        so callers enumerate with the stored row_idx directly.
    """
    if not sheet_name:
        sheet_name = config.ALL_MSGS_SHEET_NAME

    worksheet = get_worksheet_by_name(spreadsheet_id, sheet_name)

    # ── Step 1: fetch header row to find the Action column letter ────────────
    header_row  = get_header_row_cached(worksheet, spreadsheet_id, sheet_name)
    if not header_row:
        raise Exception("Sheet header row is empty")

    # Find Action column (0-based index → convert to A1 letter notation)
    try:
        action_col_idx = next(
            i for i, h in enumerate(header_row)
            if h.strip().lower() == 'action'
        )
    except StopIteration:
        raise Exception("Action column not found in header row")

    action_col_letter = column_index_to_letter(action_col_idx)

    # ── Step 2: fetch ONLY the Action column (all rows) ─────────────────────
    action_col_range  = f"{action_col_letter}2:{action_col_letter}"   # row 2 onward
    action_col_values = run_gspread_request(
        lambda: worksheet.col_values(action_col_idx + 1),
        label=f"read action column for {sheet_name}"
    )      # 1-based, 1 API call

    # Collect 1-based row numbers that have a non-empty Action value
    # action_col_values[0] is row 1 (header), so data starts at index 1
    action_row_numbers = [
        row_1based
        for row_1based, val in enumerate(action_col_values, start=1)
        if row_1based > 1 and val.strip() and val.strip().lower() != 'done'   # skip header and Done rows
    ]

    if not action_row_numbers:
        return header_row, []   # nothing to do

    # Step 3: batch_get only those specific rows
    # Build ranges like "2:2", "5:5", "12:12"
    # Chunk into batches of 100 to avoid HTTP 413 (URL too long)
    BATCH_SIZE = 100
    row_ranges = [f"{r}:{r}" for r in action_row_numbers]

    all_value_ranges = []
    import time
    from gspread.exceptions import APIError as _GspreadAPIError
    _MAX_CHUNK_RETRIES = 4
    for chunk_start in range(0, len(row_ranges), BATCH_SIZE):
        chunk = row_ranges[chunk_start:chunk_start + BATCH_SIZE]
        # Small inter-chunk delay to stay within 60 reads/min quota
        if chunk_start > 0:
            time.sleep(1.1)
        for _attempt in range(_MAX_CHUNK_RETRIES):
            try:
                batch_result = run_gspread_request(
                    lambda: worksheet.spreadsheet.values_batch_get(
                        ranges=[f"'{sheet_name}'!{rng}" for rng in chunk]
                    ),
                    label=f"batch read action rows for {sheet_name}"
                )
                all_value_ranges.extend(batch_result.get('valueRanges', []))
                break
            except _GspreadAPIError as _e:
                if '429' in str(_e) and _attempt < _MAX_CHUNK_RETRIES - 1:
                    _wait = 60 * (_attempt + 1)
                    print(f"  ⚠️  Sheets quota hit (chunk {chunk_start//BATCH_SIZE+1}) — "
                          f"waiting {_wait}s then retrying...")
                    time.sleep(_wait)
                else:
                    raise
    # Step 4: assemble result in same (row_idx, row_data) format
    data_rows = []
    for i, vr in enumerate(all_value_ranges):
        row_values_raw = vr.get('values', [[]])[0] if vr.get('values') else []
        data_rows.append((action_row_numbers[i], row_values_raw))


    return header_row, data_rows



def extract_spreadsheet_id_from_url(url):
    """
    Extract spreadsheet ID from Google Sheets URL
    
    Supports:
    - https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit...
    - SPREADSHEET_ID (plain ID)
    
    Returns:
        str: spreadsheet_id or None if invalid
    """
    import re
    
    # Pattern to match Google Sheets URL
    pattern = r'/spreadsheets/d/([a-zA-Z0-9-_]+)'
    match = re.search(pattern, url)
    
    if match:
        return match.group(1)
    
    # If no match, check if it looks like a plain ID
    # Google Sheets IDs are alphanumeric + hyphens/underscores, typically 44 chars
    if re.match(r'^[a-zA-Z0-9-_]{20,100}$', url.strip()):
        return url.strip()
    
    return None  # Invalid format

# ============= WORKSHEET ACCESS =============

def get_worksheet_by_gid(spreadsheet_id, gid):
    """
    Get a worksheet by its GID from a spreadsheet
    
    Args:
        spreadsheet_id (str): The spreadsheet ID
        gid (str or int): The worksheet GID
    
    Returns:
        gspread.Worksheet: The worksheet object
    
    Raises:
        Exception: If worksheet not found or connection fails
    """
    try:
        spreadsheet = get_spreadsheet(spreadsheet_id)
        
        # Find worksheet by GID
        for sheet in spreadsheet.worksheets():
            if str(sheet.id) == str(gid):
                return sheet
        
        raise Exception(f"Worksheet with GID {gid} not found in spreadsheet")
    except Exception as e:
        raise Exception(f"Failed to get worksheet: {str(e)}")

def get_worksheet_by_name(spreadsheet_id, sheet_name):
    """
    Get a worksheet by its name from a spreadsheet
    
    Args:
        spreadsheet_id (str): The spreadsheet ID
        sheet_name (str): The worksheet name
    
    Returns:
        gspread.Worksheet: The worksheet object
    
    Raises:
        Exception: If worksheet not found or connection fails
    """
    try:
        cache_key = _worksheet_cache_key(spreadsheet_id, sheet_name)
        cached = _worksheet_cache.get(cache_key)
        if cached is not None:
            return cached

        spreadsheet = get_spreadsheet(spreadsheet_id)
        worksheet = spreadsheet.worksheet(sheet_name)
        _worksheet_cache[cache_key] = worksheet
        return worksheet
    except Exception as e:
        raise Exception(f"Failed to get worksheet '{sheet_name}': {str(e)}")

def read_sheet_data(spreadsheet_id, gid=None, sheet_name=None):
    """
    Read all data from a worksheet
    
    Args:
        spreadsheet_id (str): The spreadsheet ID
        gid (str or int, optional): The worksheet GID
        sheet_name (str, optional): The worksheet name (used if gid not provided)
    
    Returns:
        tuple: (headers, data_rows)
            - headers (list): Column headers from first row
            - data_rows (list): List of rows (excluding header)
    
    Raises:
        Exception: If unable to read data
    """
    try:
        if gid:
            worksheet = get_worksheet_by_gid(spreadsheet_id, gid)
        elif sheet_name:
            worksheet = get_worksheet_by_name(spreadsheet_id, sheet_name)
        else:
            raise ValueError("Either gid or sheet_name must be provided")
        
        all_data = run_gspread_request(
            lambda: worksheet.get_all_values(),
            label=f"read full sheet data for {sheet_name or gid}"
        )
        
        if len(all_data) < 1:
            raise Exception("Sheet is empty")
        
        headers = all_data[0]
        data_rows = all_data[1:] if len(all_data) > 1 else []
        
        return headers, data_rows
    except Exception as e:
        raise Exception(f"Failed to read sheet data: {str(e)}")

# ============= COLUMN UTILITIES =============

def get_column_index(headers, column_name):
    """
    Get the index of a column by its header name
    
    Args:
        headers (list): List of column headers
        column_name (str): Name of the column to find
    
    Returns:
        int: Index of the column (0-based)
    
    Raises:
        ValueError: If column not found
    """
    try:
        return headers.index(column_name)
    except ValueError:
        raise ValueError(f"Column '{column_name}' not found in headers: {headers}")

def get_cell_value(row, column_index, default=''):
    """
    Safely get a cell value from a row
    
    Args:
        row (list): The row data
        column_index (int): Index of the column
        default: Default value if index out of range
    
    Returns:
        str: The cell value or default
    """
    if column_index < len(row):
        return row[column_index]
    return default

def is_yes(value):
    """
    Check if a value represents 'yes'
    
    Args:
        value: The value to check
    
    Returns:
        bool: True if value means 'yes', False otherwise
    """
    if value is None:
        return False
    value_str = str(value).strip().lower()
    return value_str in ['yes', 'y', 'true', '1', 'ok']

# ============= ACTION PARSING =============


def parse_action_column(action_value):
    """
    Parse Action column with new unified tag syntax.

    Supported tokens (comma-separated; quoted groups allowed):
      Grp, Msgs, Edit, Edit_Clear, Delete, Update,
      Add_Comment, Add_Msg_Before,
      Transfer[Posts]              – transfer as standalone post(s)
      Transfer[Cmts]               – transfer as comments under hub post
      Pub_lnk[opts]                – publication-link post

    Pub_lnk options (comma/pipe-separated inside brackets):
      Punct__          remove leading dash from labels
      Punct_🔥_        replace leading dash with emoji
      Num__      strip numeric prefix  (03- Title → Title)
      Num_Sequence_    auto-number items     (1. Title, 2. Title …)
      Joinus_CHN_LNK   append Join-Us line from destination channel
      Joinus_Name_URL  append Join-Us line with explicit name/link

    Quotes: Google Sheets wraps multi-token values in "…" when the cell
    content contains commas.  Those quotes are stripped transparently, e.g.
      Grp, "Transfer[Posts], Pub_lnk[Joinus_CHN_LNK]"
    is treated identically to:
      Grp, Transfer[Posts], Pub_lnk[Joinus_CHN_LNK]
    """
    import re
    if not action_value:
        return []

    def _split_top(s):
        """Split by comma at top level, treating [], () and "" as grouping."""
        parts, depth, in_quote, cur = [], 0, False, []
        for ch in s:
            if ch == '"' and depth == 0:
                in_quote = not in_quote
                continue          # drop the quote character itself
            if not in_quote:
                if ch in ('[', '('): depth += 1
                elif ch in (']', ')'): depth -= 1
            if ch == ',' and depth == 0 and not in_quote:
                parts.append(''.join(cur).strip())
                cur = []
            else:
                if ch != '"':
                    cur.append(ch)
        if cur:
            parts.append(''.join(cur).strip())
        return [p for p in parts if p]

    SIMPLE_CANONICAL = {
        'grp': 'Grp', 'msgs': 'Msgs',
        'edit': 'Edit', 'edit_clear': 'Edit_Clear',
        'delete': 'Delete', 'update': 'Update',
        'add_comment': 'Add_Comment', 'add_msg_before': 'Add_Msg_Before',
        # Plain "Transfer" is a shorthand for Transfer[Posts]
        'transfer': 'Transfer[Posts]',
        'transfer_orig': 'Transfer_Orig',
        'transfer_orig_hide': 'Transfer_Orig_Hide',
    }

    def _normalise_pub_lnk_opts(raw_opts):
        """Normalise option list inside Pub_lnk[...]"""
        opts = []
        for o in re.split(r'[,|]', raw_opts):
            o = o.strip()
            if not o:
                continue
            ol = o.lower()
            if ol.startswith('punct_'):
                opts.append('Punct' + o[5:])
            elif ol.startswith('num_remove') or ol == 'num__':
                opts.append('Num__')  # num__ or num_remove_
            elif ol.startswith('num_sequence'):
                opts.append('Num_Sequence_')
            elif ol.startswith('joinus_'):
                opts.append('Joinus' + o[6:])
        return ','.join(opts)

    actions = []
    seen    = set()

    # After _split_top, quoted compound tokens like
    # 'Transfer[Posts], Pub_lnk[Joinus_CHN_LNK]' are one string.
    # Flatten them by re-splitting each token that still has
    # commas outside brackets.
    raw_tokens = []
    for t in _split_top(action_value):
        sub = _split_top(t)   # idempotent when no nested commas
        raw_tokens.extend(sub)

    for raw_token in raw_tokens:
        token = raw_token.strip()
        if not token:
            continue
        tl = token.lower()

        # ── Compound token: re-split and process each sub-token ─────
        # After quote-stripping, 'Transfer[Posts], Pub_lnk[...]' is one
        # token with a comma. We re-split it at top level (no brackets)
        # and process each sub-token individually via a nested for-loop.
        # This avoids recursion and handles any depth correctly.
        is_transfer_token = bool(re.match(r'^transfer\s*\[', tl))
        is_pub_lnk_token  = bool(re.match(r'^pub_lnk\s*\[', tl, re.IGNORECASE))
        if ',' in token and not is_transfer_token and not is_pub_lnk_token:
            # Re-split this compound token and process sub-tokens
            for sub_raw in _split_top(token):
                sub = sub_raw.strip()
                if not sub or sub in seen:
                    continue
                sl = sub.lower()
                # Transfer sub-token
                ms = re.match(r'^transfer\s*\[\s*(posts?|cmts?)\s*\]$', sl)
                if ms:
                    mode = 'Posts' if ms.group(1).startswith('post') else 'Cmts'
                    c = f'Transfer[{mode}]'
                    actions.append(c); seen.add(c)
                    continue
                # Pub_lnk sub-token
                # Use rindex(']') so nested brackets like joinus_CHN_LNK[Cmts] are included
                mp = re.match(r'^pub_lnk\s*\[', sub, re.IGNORECASE) and sub.rindex(']') == len(sub)-1
                if mp:
                    opts_raw  = sub[sub.index('[')+1 : sub.rindex(']')]
                    opts_norm = _normalise_pub_lnk_opts(opts_raw)
                    c = f'Pub_lnk[{opts_norm}]'
                    actions.append(c); seen.add(c)
                    continue
                # Simple action
                if sl in SIMPLE_CANONICAL:
                    c = SIMPLE_CANONICAL[sl]
                    actions.append(c); seen.add(c)
            continue

        # ── Transfer[Posts] / Transfer[Cmts] ────────────────────────
        m = re.match(r'^transfer\s*\[\s*(posts?|cmts?)\s*\]$', tl)
        if m:
            mode = 'Posts' if m.group(1).startswith('post') else 'Cmts'
            c = f'Transfer[{mode}]'
            if c not in seen:
                actions.append(c); seen.add(c)
            continue

        # ── Pub_lnk[opts] ───────────────────────────────────────────
        # Use rindex(']') so nested brackets like joinus_CHN_LNK[Cmts] are included
        m = re.match(r'^pub_lnk\s*\[', token, re.IGNORECASE) and token.rstrip().endswith(']')
        if m:
            opts_raw  = token[token.index('[')+1 : token.rindex(']')]
            opts_norm = _normalise_pub_lnk_opts(opts_raw)
            c = f'Pub_lnk[{opts_norm}]'
            if c not in seen:
                actions.append(c); seen.add(c)
            continue

        # ── Simple actions ───────────────────────────────────────────
        if tl in SIMPLE_CANONICAL:
            c = SIMPLE_CANONICAL[tl]
            if c not in seen:
                actions.append(c); seen.add(c)
            continue

    return actions



# ============= SPREADSHEET INSPECTION =============

def get_all_sheets_from_spreadsheet(spreadsheet_id):
    """
    Fetch list of all sheets from a spreadsheet
    
    Args:
        spreadsheet_id (str): The spreadsheet ID
    
    Returns:
        list: List of sheet dictionaries [{"name": "...", "gid": "..."}, ...]
    
    Raises:
        Exception: If unable to access spreadsheet
    """
    try:
        gc = get_google_sheets_client()
        spreadsheet = gc.open_by_key(spreadsheet_id)
        
        sheets = []
        for ws in spreadsheet.worksheets():
            sheets.append({
                'name': ws.title,
                'gid': str(ws.id)
            })
        
        return sheets
    except Exception as e:
        raise Exception(f"Failed to get sheets from spreadsheet: {str(e)}")


def validate_spreadsheet_access(spreadsheet_id):
    """
    Check if service account has access to spreadsheet
    
    Args:
        spreadsheet_id (str): The spreadsheet ID
    
    Returns:
        tuple: (success: bool, message: str)
    """
    try:
        gc = get_google_sheets_client()
        spreadsheet = gc.open_by_key(spreadsheet_id)
        sheet_count = len(spreadsheet.worksheets())
        return (True, f"Access confirmed. Found {sheet_count} sheets.")
    except Exception as e:
        return (False, f"Access denied: {str(e)}")


def validate_sheet_exists(spreadsheet_id, sheet_name):
    """
    Check if specific sheet exists in spreadsheet
    
    Args:
        spreadsheet_id (str): The spreadsheet ID
        sheet_name (str): Sheet name to check
    
    Returns:
        tuple: (exists: bool, gid: str or None)
    """
    try:
        sheets = get_all_sheets_from_spreadsheet(spreadsheet_id)
        for sheet in sheets:
            if sheet['name'] == sheet_name:
                return (True, sheet['gid'])
        return (False, None)
    except Exception as e:
        return (False, None)

# ============= CHANNELS SHEET FUNCTIONS =============

def read_channels_list(spreadsheet_id, sheet_name=None, gid=None):
    """
    Read list of channels from the channels sheet
    
    Args:
        spreadsheet_id (str): The spreadsheet ID
        sheet_name (str, optional): Sheet name (default: from config)
        gid (str, optional): Sheet GID (alternative to sheet_name)
    
    Returns:
        list: List of channel dictionaries [{"name": "...", "id": "..."}, ...]
    
    Raises:
        Exception: If unable to read channels
    """
    try:
        # Use config defaults if not provided
        if not sheet_name and not gid:
            sheet_name = config.CHANNELS_SHEET_NAME
        
        headers, data_rows = read_sheet_data(spreadsheet_id, gid=gid, sheet_name=sheet_name)
        
        # Find required columns
        try:
            name_col = get_column_index(headers, config.CHANNEL_NAME_COLUMN)
            id_col = get_column_index(headers, config.CHANNEL_ID_COLUMN)
        except ValueError as e:
            raise Exception(f"Required columns not found. Expected '{config.CHANNEL_NAME_COLUMN}' and '{config.CHANNEL_ID_COLUMN}': {str(e)}")
        
        # Find optional Tags column (flexible matching)
        tags_col = None
        for h_idx, h in enumerate(headers):
            if h.strip().lower() in ('tags', 'tag', 'group', 'groups'):
                tags_col = h_idx
                break

        # Build channels list
        channels = []
        for row in data_rows:
            channel_name = get_cell_value(row, name_col).strip()
            channel_id = get_cell_value(row, id_col).strip()
            
            # Skip empty rows
            if channel_name and channel_id:
                tags_raw = get_cell_value(row, tags_col).strip() if tags_col is not None else ''
                tags = [t.strip() for t in tags_raw.split(',') if t.strip()] if tags_raw else []
                channels.append({
                    'name': channel_name,
                    'id': channel_id,
                    'tags': tags
                })
        
        if not channels:
            raise Exception("No channels found in sheet. Please add channels with 'Channel Name' and 'Channel ID' columns.")
        
        return channels
    except Exception as e:
        raise Exception(f"Failed to read channels list: {str(e)}")

def get_channel_by_name(spreadsheet_id, channel_name, sheet_name=None, gid=None):
    """
    Get channel information by channel name
    
    Args:
        spreadsheet_id (str): The spreadsheet ID
        channel_name (str): Name of the channel to find
        sheet_name (str, optional): Sheet name (default: from config)
        gid (str, optional): Sheet GID (alternative to sheet_name)
    
    Returns:
        dict: Channel dictionary {"name": "...", "id": "..."}
        None: If channel not found
    
    Raises:
        Exception: If unable to read channels
    """
    try:
        # ALWAYS use the main spreadsheet from config for channel lookups
        channels_spreadsheet_id = config.SPREADSHEET_ID
        channels = read_channels_list(channels_spreadsheet_id, sheet_name, gid)
        
        for channel in channels:
            if channel['name'] == channel_name:
                return channel
        
        return None
    except Exception as e:
        raise Exception(f"Failed to get channel by name: {str(e)}")

def get_channel_by_id(spreadsheet_id, channel_id, sheet_name=None, gid=None):
    """
    Get channel information by channel ID
    
    Args:
        spreadsheet_id (str): The spreadsheet ID
        channel_id (str): ID of the channel to find
        sheet_name (str, optional): Sheet name (default: from config)
        gid (str, optional): Sheet GID (alternative to sheet_name)
    
    Returns:
        dict: Channel dictionary {"name": "...", "id": "..."}
        None: If channel not found
    
    Raises:
        Exception: If unable to read channels
    """
    try:
        # ALWAYS use the main spreadsheet from config for channel lookups
        channels_spreadsheet_id = config.SPREADSHEET_ID
        channels = read_channels_list(channels_spreadsheet_id, sheet_name, gid)
        
        for channel in channels:
            if channel['id'] == str(channel_id):
                return channel
        
        return None
    except Exception as e:
        raise Exception(f"Failed to get channel by ID: {str(e)}")

# ============= ALL_MSGS SHEET FUNCTIONS (UPSERT) =============

def upsert_messages_to_all_msgs(spreadsheet_id, messages_data, sheet_name=None):
    """
    Insert or update messages in the All_Msgs sheet
    
    Schema (14 columns - Clean Markdown Format):
    ID | Channel Name | Date & Time | Author | Topic | Text | 
    Hashtags | Title | Description_MD | Tags | Message Link | Extra_Msg | Action | Destination
    
    Args:
        spreadsheet_id (str): The spreadsheet ID
        messages_data (list): List of message rows (14 columns each)
    
    Returns:
        dict: Statistics about the operation
    """
    try:
        if not sheet_name:
            sheet_name = config.ALL_MSGS_SHEET_NAME
        worksheet = get_worksheet_by_name(spreadsheet_id, sheet_name)

        # Expected headers
        expected_headers = [
            'ID', 'Channel Name', 'Date & Time', 'Author', 'Topic', 'Text',
            'Hashtags', 'Title', 'Description_MD', 'Tags',
            'Message Link', 'Extra_Msg', 'Action', 'Destination', 'Scheduled_Time'
        ]

        # Read only the header row first instead of downloading the whole sheet.
        headers = get_header_row_cached(worksheet, spreadsheet_id, sheet_name)

        # Check if sheet is empty or needs headers
        if len(headers) == 0:
            run_gspread_request(
                lambda: worksheet.update('A1', [expected_headers]),
                label=f"create headers in {sheet_name}"
            )
            headers = expected_headers
            _header_row_cache[_worksheet_cache_key(spreadsheet_id, sheet_name)] = list(headers)
            print("✓ Created headers in All_Msgs sheet")

        # Create header index map
        header_map = {header: idx for idx, header in enumerate(headers)}

        if 'ID' not in header_map:
            raise Exception("'ID' column not found in sheet headers")

        id_col_index = header_map['ID']

        # Read only the ID column to decide update vs insert.
        id_column_values = run_gspread_request(
            lambda: worksheet.col_values(id_col_index + 1),
            label=f"read ID column for {sheet_name}"
        )

        # Build map of existing IDs to row numbers and track the last populated ID row.
        id_to_row = {}
        last_data_row = 1

        for row_num, row_id in enumerate(id_column_values[1:], start=2):
            row_id = str(row_id or '').strip()
            if row_id:
                last_data_row = row_num
                id_to_row[row_id] = row_num

        # Statistics
        stats = {
            'total': len(messages_data),
            'updated': 0,
            'inserted': 0,
            'errors': 0
        }
        
        updates_batch = []
        new_rows = []
        
        # Map incoming data to sheet column order
        for msg_row in messages_data:
            msg_id = msg_row[0]
            
            mapped_row = [''] * len(headers)
            
            # Field mapping (based on expected_headers order)
            field_mapping = {
                'ID': 0, 'Channel Name': 1, 'Date & Time': 2, 'Author': 3,
                'Topic': 4, 'Text': 5, 'Hashtags': 6, 'Title': 7,
                'Description_MD': 8, 'Tags': 9,
                'Message Link': 10, 'Extra_Msg': 11, 'Action': 12, 'Destination': 13, 'Scheduled_Time': 14
            }
            
            for header_name, sheet_idx in header_map.items():
                if header_name in field_mapping:
                    data_idx = field_mapping[header_name]
                    if data_idx < len(msg_row):
                        mapped_row[sheet_idx] = msg_row[data_idx]
            
            if msg_id in id_to_row:
                # Update existing row
                row_num = id_to_row[msg_id]
                end_col = column_index_to_letter(len(headers) - 1)
                range_notation = f"A{row_num}:{end_col}{row_num}"
                updates_batch.append({
                    'range': range_notation,
                    'values': [mapped_row]
                })
                stats['updated'] += 1
            else:
                # New row
                new_rows.append(mapped_row)
                stats['inserted'] += 1
        
        # Execute batch updates
        if updates_batch:
            run_gspread_request(
                lambda: worksheet.batch_update(updates_batch),
                label=f"batch update existing rows in {sheet_name}"
            )
            print(f"✓ Updated {len(updates_batch)} existing messages")
        
        # Append new rows
        if new_rows:
            start_row = max(last_data_row + 1, 2)
            end_row = start_row + len(new_rows) - 1
            
            current_row_count = worksheet.row_count
            required_rows = end_row
            
            if required_rows > current_row_count:
                new_row_count = required_rows + 100
                run_gspread_request(
                    lambda: worksheet.resize(rows=new_row_count),
                    label=f"resize sheet {sheet_name}"
                )
                print(f"✓ Expanded sheet from {current_row_count} to {new_row_count} rows")
            
            new_data_batch = []
            end_col = column_index_to_letter(len(headers) - 1)
            for i, row in enumerate(new_rows):
                row_num = start_row + i
                range_notation = f"A{row_num}:{end_col}{row_num}"
                new_data_batch.append({
                    'range': range_notation,
                    'values': [row]
                })
            
            run_gspread_request(
                lambda: worksheet.batch_update(new_data_batch),
                label=f"batch insert new rows in {sheet_name}"
            )
            print(f"✓ Inserted {len(new_rows)} new messages at row {start_row}")
        
        return stats
    except Exception as e:
        raise Exception(f"Failed to upsert messages: {str(e)}")

def get_existing_message_ids(spreadsheet_id):
    """
    Get all existing message IDs from All_Msgs sheet
    
    Args:
        spreadsheet_id (str): The spreadsheet ID
    
    Returns:
        set: Set of existing composite IDs
    """
    try:
        worksheet = get_worksheet_by_name(spreadsheet_id, config.ALL_MSGS_SHEET_NAME)
        id_column_values = run_gspread_request(
            lambda: worksheet.col_values(1),
            label=f"read existing IDs for {config.ALL_MSGS_SHEET_NAME}"
        )

        if len(id_column_values) <= 1:
            return set()

        return {
            row_id.strip()
            for row_id in id_column_values[1:]
            if str(row_id or '').strip()
        }
    except Exception as e:
        print(f"Warning: Could not read existing IDs: {str(e)}")
        return set()

# ============= TAG PARSING (BACKWARD COMPATIBLE) =============

def parse_legacy_tags(tags_str):
    """
    Parse old tag format for backward compatibility.
    
    Old format: "Media: Video (mp4) | Duration: 03:45 | Grouped Media | Has Hashtags"
    
    Args:
        tags_str (str): Old format tags string
    
    Returns:
        dict: Parsed components (same format as parse_structured_tags)
    """
    import re
    
    result = {
        'media': {'type': '', 'ext': '', 'duration': ''},
        'flags': [],
        'forward': {'name': '', 'id': ''},
        'reply': ''
    }
    
    if not tags_str:
        return result
    
    # Split by pipe
    parts = [p.strip() for p in tags_str.split('|')]
    
    for part in parts:
        # Media type
        if part.startswith('Media:'):
            media_info = part.replace('Media:', '').strip()
            
            # Extract type and extension: "Video (mp4)"
            match = re.match(r'(.+?)\s*\(([^)]+)\)', media_info)
            if match:
                result['media']['type'] = match.group(1).strip()
                result['media']['ext'] = match.group(2).strip()
            else:
                result['media']['type'] = media_info
        
        # Duration
        elif part.startswith('Duration:'):
            result['media']['duration'] = part.replace('Duration:', '').strip()
        
        # Flags
        elif 'Grouped Media' in part:
            result['flags'].append('Group')
        elif 'Has Hashtags' in part:
            result['flags'].append('hash')
        elif 'Emoji Title' in part:
            result['flags'].append('Title')
        
        # Forward
        elif part.startswith('Forwarded From:'):
            fwd_info = part.replace('Forwarded From:', '').strip()
            
            # Parse format: "Name_id:123" or "Name" or "_id:123"
            if '_id:' in fwd_info:
                name_part, id_part = fwd_info.split('_id:')
                result['forward']['name'] = name_part.strip()
                result['forward']['id'] = id_part.strip()
            else:
                result['forward']['name'] = fwd_info
        
        # Reply
        elif part.startswith('Reply To:'):
            result['reply'] = part.replace('Reply To:', '').strip()
    
    return result

def parse_structured_tags(tags_str):
    """
    Parse new structured tag format.
    
    New format: "Video(mp4, 03:45); Group; hash; Forward(Name, ID); Reply(42)"
    
    Args:
        tags_str (str): New format tags string
    
    Returns:
        dict: Parsed components
    """
    import re
    
    result = {
        'media': {'type': '', 'ext': '', 'duration': ''},
        'flags': [],
        'forward': {'name': '', 'id': ''},
        'reply': ''
    }
    
    if not tags_str:
        return result
    
    # Split by semicolon
    parts = [p.strip() for p in tags_str.split(';')]
    
    for part in parts:
        if not part:
            continue
        
        # Check for media/forward/reply with params
        match = re.match(r'^(.+?)\(([^)]+)\)$', part)
        if match:
            type_name = match.group(1).strip()
            params = [p.strip() for p in match.group(2).split(',')]
            
            if type_name == 'Forward':
                if len(params) >= 2:
                    result['forward']['name'] = params[0]
                    result['forward']['id'] = params[1]
                elif len(params) == 1:
                    if params[0].isdigit():
                        result['forward']['id'] = params[0]
                    else:
                        result['forward']['name'] = params[0]
            
            elif type_name == 'Reply':
                if params:
                    result['reply'] = params[0]
            
            else:
                # Media type
                result['media']['type'] = type_name
                if len(params) >= 1:
                    result['media']['ext'] = params[0]
                if len(params) >= 2:
                    result['media']['duration'] = params[1]
            
            continue
        
        # Simple flags or media without params
        if part in ['Group', 'hash', 'Title']:
            result['flags'].append(part)
        elif part in ['Photo', 'Sticker', 'Poll', 'Link', 'Document']:
            result['media']['type'] = part
    
    return result

def parse_tags_flexible(tags_str):
    """
    Flexibly parse tags in either old or new format.
    Automatically detects format and uses appropriate parser.
    
    Args:
        tags_str (str): Tags string in any format
    
    Returns:
        dict: Parsed components (standardized format)
    
    Example:
        # Old format
        >>> parse_tags_flexible("Media: Video (mp4) | Duration: 03:45")
        {'media': {'type': 'Video', 'ext': 'mp4', 'duration': '03:45'}, ...}
        
        # New format
        >>> parse_tags_flexible("Video(mp4, 03:45)")
        {'media': {'type': 'Video', 'ext': 'mp4', 'duration': '03:45'}, ...}
    """
    if not tags_str:
        return {
            'media': {'type': '', 'ext': '', 'duration': ''},
            'flags': [],
            'forward': {'name': '', 'id': ''},
            'reply': ''
        }
    
    # Detect format
    if '; ' in tags_str or tags_str.count('(') >= 1:
        # New format (has semicolons or parentheses)
        return parse_structured_tags(tags_str)
    elif '|' in tags_str or 'Media:' in tags_str:
        # Old format (has pipes or "Media:" prefix)
        return parse_legacy_tags(tags_str)
    else:
        # Ambiguous or simple - try new format first
        return parse_structured_tags(tags_str)

# ============= ACTION EXECUTION FUNCTIONS =============



# ============= SCHEDULED TIME PARSING =============

def parse_scheduled_time(time_str, timezone_name=None):
    """
    Parse scheduled time string to Unix timestamp for Telegram API.
    
    Process:
    1. Try each format in config.SCHEDULED_TIME_FORMATS
    2. Attach configured timezone
    3. Convert to UTC
    4. Validate (future time, within Telegram limits)
    5. Return Unix timestamp
    
    Args:
        time_str (str): Time string from spreadsheet (e.g., "2026-01-25 14:30")
        timezone_name (str, optional): Timezone name (default: from config)
    
    Returns:
        int: Unix timestamp for Telegram API
        None: If empty or should send immediately
    
    Raises:
        ValueError: If time is invalid or beyond limits
    
    Example:
        >>> parse_scheduled_time("2026-01-25 14:30")
        1737813000  # Unix timestamp
    """
    # Empty or None - send immediately
    if not time_str or not time_str.strip():
        return None
    
    time_str = time_str.strip()
    
    # Get timezone
    if not timezone_name:
        timezone_name = config.SCHEDULED_TIME_TIMEZONE
    
    try:
        tz = pytz.timezone(timezone_name)
    except Exception as e:
        raise ValueError(f"Invalid timezone '{timezone_name}': {e}")
    
    # Try each format
    parsed_dt = None
    used_format = None
    
    for fmt in config.SCHEDULED_TIME_FORMATS:
        try:
            # Parse as naive datetime
            naive_dt = datetime.strptime(time_str, fmt)
            # Attach timezone
            parsed_dt = tz.localize(naive_dt)
            used_format = fmt
            break
        except ValueError:
            continue
    
    if not parsed_dt:
        raise ValueError(
            f"Could not parse '{time_str}' with any known format. "
            f"Expected formats: {', '.join(config.SCHEDULED_TIME_FORMATS)}"
        )
    
    # Get current time in same timezone
    now = datetime.now(tz)
    
    # Check if time is in the past
    if parsed_dt <= now:
        # Allow small buffer (1 minute) for processing time
        if parsed_dt >= now - timedelta(minutes=1):
            # Within buffer - adjust to now + 1 minute
            parsed_dt = now + timedelta(minutes=1)
        else:
            # Definitely in the past - return None to send immediately
            print(f"  ⚠️  Scheduled time '{time_str}' is in the past - will send immediately")
            return None
    
    # Check Telegram's max future limit
    max_future = now + timedelta(days=config.SCHEDULED_TIME_MAX_FUTURE_DAYS)
    if parsed_dt > max_future:
        raise ValueError(
            f"Scheduled time '{time_str}' is too far in the future. "
            f"Telegram allows scheduling up to {config.SCHEDULED_TIME_MAX_FUTURE_DAYS} days ahead."
        )
    
    # Convert to UTC for Telegram API
    utc_dt = parsed_dt.astimezone(pytz.UTC)
    
    # Convert to Unix timestamp (integer)
    timestamp = int(utc_dt.timestamp())
    
    return timestamp


def format_scheduled_time_for_display(timestamp, timezone_name=None):
    """
    Convert Unix timestamp back to readable format for display.
    
    Args:
        timestamp (int): Unix timestamp
        timezone_name (str, optional): Timezone for display (default: from config)
    
    Returns:
        str: Formatted time string (e.g., "2026-01-25 14:30")
    """
    if not timestamp:
        return ""
    
    if not timezone_name:
        timezone_name = config.SCHEDULED_TIME_TIMEZONE
    
    try:
        tz = pytz.timezone(timezone_name)
        dt = datetime.fromtimestamp(timestamp, tz)
        return dt.strftime(config.SCHEDULED_TIME_FORMAT)
    except Exception as e:
        print(f"  ⚠️  Error formatting timestamp: {e}")
        return str(timestamp)

def get_messages_for_action(spreadsheet_id, sheet_name=None, preloaded_data=None):
    """
    Get messages marked with actions from the specified sheet.

    Reads rows where Action column has values (Transfer, Delete, Edit, Update).

    Args:
        spreadsheet_id (str): The spreadsheet ID
        sheet_name (str, optional): Sheet name (default: config.ALL_MSGS_SHEET_NAME)
        preloaded_data (tuple, optional): (headers, data_rows) already loaded –
            pass this to avoid a redundant full sheet download.

    Returns:
        list: List of message dictionaries with action info

    Raises:
        Exception: If unable to read messages
    """
    try:
        if not sheet_name:
            sheet_name = config.ALL_MSGS_SHEET_NAME

        if preloaded_data is not None:
            headers, data_rows = preloaded_data
        else:
            headers, data_rows = read_sheet_data(spreadsheet_id, sheet_name=sheet_name)
        
        # Find required columns
        try:
            id_col = get_column_index(headers, 'ID')
            channel_name_col = get_column_index(headers, 'Channel Name')
            text_col = get_column_index(headers, 'Text')
            hashtags_col = get_column_index(headers, 'Hashtags')
            title_col = get_column_index(headers, 'Title')
            description_md_col = get_column_index(headers, 'Description_MD')
            extra_msg_col = get_column_index(headers, 'Extra_Msg')
            action_col = get_column_index(headers, 'Action')
            destination_col = get_column_index(headers, 'Destination')
            message_link_col = get_column_index(headers, 'Message Link')
        except ValueError as e:
            raise Exception(f"Required column not found: {str(e)}")
        
        # Optional: Author column (for Msgs formatting)
        author_col = None
        try:
            author_col = get_column_index(headers, 'Author')
        except ValueError:
            pass  # Column doesn't exist - that's okay
        
        # Optional: Scheduled_Time column (for scheduling feature)
        scheduled_time_col = None
        try:
            scheduled_time_col = get_column_index(headers, 'Scheduled_Time')
        except ValueError:
            pass  # Column doesn't exist yet - that's okay
        
        # Filter messages with actions
        # Support both plain lists (get_all_values) and
        # (row_idx, row_list) tuples (read_action_rows_only).
        messages_for_action = []

        for i, raw in enumerate(data_rows, start=2):
            if isinstance(raw, tuple):
                row_idx, row = raw          # preloaded: (row_idx, row_list)
                row = list(row)             # make mutable copy
            else:
                row_idx, row = i, list(raw) # normal: plain list from get_all_values

            # Ensure row has enough columns
            while len(row) <= max(action_col, destination_col):
                row.append('')

            action_value = get_cell_value(row, action_col).strip()

            # Skip rows without actions or already marked as Done
            if not action_value or action_value.strip().lower() == 'done':
                continue

            # Parse actions
            actions = parse_action_column(action_value)
            
            # Skip standalone Pub_lnk rows — handled in STEP 1
            has_transfer = any(a.startswith('Transfer[') for a in actions)
            has_pub_lnk  = any(a.startswith('Pub_lnk[')  for a in actions)
            if has_pub_lnk and not has_transfer:
                continue
            
            # Skip if no valid actions
            if not actions:
                continue
            
            message_info = {
                'row_num': row_idx,
                'id': get_cell_value(row, id_col),
                'channel_name': get_cell_value(row, channel_name_col),
                'text': get_cell_value(row, text_col),
                'hashtags': get_cell_value(row, hashtags_col),
                'title': get_cell_value(row, title_col),
                'description_md': get_cell_value(row, description_md_col),
                'extra_msg': get_cell_value(row, extra_msg_col),
                'actions': actions,
                'destination': get_cell_value(row, destination_col),
                'message_link': get_cell_value(row, message_link_col),
                'scheduled_time': get_cell_value(row, scheduled_time_col) if scheduled_time_col else '',
                'author': get_cell_value(row, author_col) if author_col is not None else '',
            }
            
            messages_for_action.append(message_info)
        
        return messages_for_action
    except Exception as e:
        raise Exception(f"Failed to get messages for action: {str(e)}")


def get_pub_lnk_messages(spreadsheet_id, sheet_name=None, preloaded_data=None):
    """
    Get all messages marked with Pub_lnk action (without Transfer).

    Supports MULTIPLE GROUPS: a leader row starts a new group when it has
    both Extra_Msg AND Destination filled. Follower rows belong to the
    current group until the next leader is found.

    Args:
        spreadsheet_id (str): The spreadsheet ID
        sheet_name (str, optional): Sheet name (default: config.ALL_MSGS_SHEET_NAME)
        preloaded_data (tuple, optional): (headers, data_rows) already loaded –
            pass this to avoid a redundant full sheet download.

    Returns:
        list of dicts, one per group:
            {
                'valid': bool,
                'error': str or None,
                'title': str,          # from leader Extra_Msg
                'destination': str,    # from leader Destination
                'publications': [
                    {'row_num': int, 'title': str, 'link': str},
                    ...
                ]
            }
        Returns [{'valid': False, 'error': '...', 'publications': []}]
        when nothing is found or a fatal error occurs.
    """
    try:
        if not sheet_name:
            sheet_name = config.ALL_MSGS_SHEET_NAME

        if preloaded_data is not None:
            headers, data_rows = preloaded_data
        else:
            headers, data_rows = read_sheet_data(spreadsheet_id, sheet_name=sheet_name)

        # Find required columns
        try:
            action_col      = get_column_index(headers, 'Action')
            title_col       = get_column_index(headers, 'Title')
            extra_msg_col   = get_column_index(headers, 'Extra_Msg')
            destination_col = get_column_index(headers, 'Destination')
            message_link_col= get_column_index(headers, 'Message Link')
        except ValueError as e:
            return [{'valid': False, 'error': f"Required column not found: {str(e)}", 'publications': []}]

        # ── Scan ALL rows and build groups in a single pass ──────────────
        #
        # LEADER   = has Pub_lnk in actions (no Transfer) + Extra_Msg + Destination filled
        # FOLLOWER = has ONLY Grp in actions, while a group is currently open
        # Any other row closes the current group.
        #
        groups        = []   # list of raw-row lists
        current_group = []   # rows belonging to the group being built

        for i, raw in enumerate(data_rows, start=2):
            if isinstance(raw, tuple):
                row_idx, row = raw          # preloaded: (row_idx, row_list)
                row = list(row)             # make mutable copy
            else:
                row_idx, row = i, list(raw) # normal: plain list from get_all_values

            while len(row) <= max(action_col, destination_col):
                row.append('')

            action_value = get_cell_value(row, action_col).strip()
            if not action_value:
                # Empty action row (gap in sheet) → skip silently, keep group open
                continue

            actions = parse_action_column(action_value)

            has_pub_lnk    = any(a.startswith('Pub_lnk[') for a in actions) and not any(a.startswith('Transfer[') for a in actions)
            is_grp_only    = actions == ['Grp']
            extra_msg_val  = get_cell_value(row, extra_msg_col).strip()
            destination_val= get_cell_value(row, destination_col).strip()
            is_leader      = has_pub_lnk and bool(extra_msg_val) and bool(destination_val)

            if is_leader:
                # Close previous group (if any) and start a new one
                if current_group:
                    groups.append(current_group)
                current_group = [{
                    'row_num'     : row_idx,
                    'title'       : get_cell_value(row, title_col),
                    'extra_msg'   : extra_msg_val,
                    'destination' : destination_val,
                    'message_link': get_cell_value(row, message_link_col),
                    'actions'     : actions,
                }]
                print(f"[DEBUG] Pub_lnk Leader Row {row_idx}: actions = {actions}")

            elif is_grp_only and current_group:
                # Follower row: belongs to the currently open group
                current_group.append({
                    'row_num'     : row_idx,
                    'title'       : get_cell_value(row, title_col),
                    'extra_msg'   : '',
                    'destination' : '',
                    'message_link': get_cell_value(row, message_link_col),
                })

            else:
                # Neither a leader nor a Grp-only follower → close open group
                if current_group:
                    groups.append(current_group)
                    current_group = []

        # Flush last open group
        if current_group:
            groups.append(current_group)

        if not groups:
            return [{'valid': False, 'error': 'No valid Pub_lnk groups found', 'publications': []}]

        # ── Build result for each group ───────────────────────────────────
        # Rows with missing Title or Message Link are SKIPPED with a warning.
        # They do NOT break the group (handles ID gaps in the channel).
        results = []
        for group_rows in groups:
            leader       = group_rows[0]
            publications = []

            for row in group_rows:
                title = row['title'].strip()
                link  = row['message_link'].strip()

                if not title:
                    print(f"  ⚠️  Pub_lnk row {row['row_num']} has no Title – skipping")
                    continue
                if not link:
                    print(f"  ⚠️  Pub_lnk row {row['row_num']} has no Message Link – skipping")
                    continue

                publications.append({
                    'row_num': row['row_num'],
                    'title'  : title,
                    'link'   : link,
                })

            if not publications:
                results.append({
                    'valid': False,
                    'error': f"Group '{leader['extra_msg']}' has no valid publications",
                    'publications': [],
                })
            else:
                leader_actions = leader.get('actions', [])
                print(f"[DEBUG] Pub_lnk Result: actions = {leader_actions}, publications = {len(publications)}")
                results.append({
                    'valid'       : True,
                    'error'       : None,
                    'title'       : leader['extra_msg'].strip(),
                    'destination' : leader['destination'].strip(),
                    'publications': publications,
                    'actions'     : leader_actions,
                })

        return results

    except Exception as e:
        return [{
            'valid': False,
            'error': f"Failed to get Pub_lnk messages: {str(e)}",
            'publications': [],
        }]

def update_action_results(spreadsheet_id, sheet_updates, sheet_name=None):
    """
    Update Action column, IDs, and other columns after actions are executed
    
    ENHANCED: Now supports full row updates when UPDATE_ACTION_FULL_REFRESH is enabled
    
    Args:
        spreadsheet_id (str): The spreadsheet ID
        sheet_updates (list): List of update dictionaries with:
            - row_num (required): Row number to update
            - action (optional): New action value (usually empty string to clear)
            - new_id (optional): New message ID after transfer
            - channel_name (optional): New channel name after transfer
            - datetime (optional): New date & time (for full refresh)
            - author (optional): Updated author name
            - topic (optional): Topic name (for full refresh)
            - text (optional): Raw text (for full refresh)
            - hashtags (optional): Hashtags (for full refresh)
            - title (optional): Title (for full refresh)
            - description_md (optional): Description in Markdown (for full refresh)
            - tags (optional): Tags (for full refresh)
            - message_link (optional): New message link after transfer
            - destination (optional): Clear destination column (usually empty string)
            - extra_msg (optional): Clear Extra_Msg column (usually empty string)
            - scheduled_time (optional): Clear Scheduled_Time column (usually empty string)
        sheet_name (str, optional): Sheet name (default: config.ALL_MSGS_SHEET_NAME)
    
    Raises:
        Exception: If unable to update sheet
    """
    try:
        if not sheet_name:
            sheet_name = config.ALL_MSGS_SHEET_NAME
        
        worksheet = get_worksheet_by_name(spreadsheet_id, sheet_name)
        headers = get_header_row_cached(worksheet, spreadsheet_id, sheet_name)
        
        # Find required column indices
        id_col_idx = get_column_index(headers, 'ID')
        action_col_idx = get_column_index(headers, 'Action')
        
        # Map of column names to their indices (all optional)
        column_map = {
            'channel_name': 'Channel Name',
            'datetime': 'Date & Time',
            'author': 'Author',
            'topic': 'Topic',
            'text': 'Text',
            'hashtags': 'Hashtags',
            'title': 'Title',
            'description_md': 'Description_MD',
            'tags': 'Tags',
            'message_link': 'Message Link',
            'destination': 'Destination',
            'extra_msg': 'Extra_Msg',
            'scheduled_time': 'Scheduled_Time'
        }
        
        # Get indices for all optional columns
        col_indices = {}
        for key, header_name in column_map.items():
            try:
                col_indices[key] = get_column_index(headers, header_name)
            except ValueError:
                col_indices[key] = None
        
        # Batch updates
        updates = []
        
        for update in sheet_updates:
            row_num = update['row_num']
            
            # Update Action column
            if 'action' in update:
                action_col_letter = chr(65 + action_col_idx)
                updates.append({
                    'range': f"{action_col_letter}{row_num}",
                    'values': [[update['action']]]
                })
            
            # Update ID column if new ID provided
            if 'new_id' in update and update['new_id']:
                id_col_letter = chr(65 + id_col_idx)
                updates.append({
                    'range': f"{id_col_letter}{row_num}",
                    'values': [[update['new_id']]]
                })
            
            # Update all other columns dynamically
            for key, col_idx in col_indices.items():
                if key in update and col_idx is not None:
                    col_letter = chr(65 + col_idx)
                    updates.append({
                        'range': f"{col_letter}{row_num}",
                        'values': [[update[key]]]
                    })
        
        if updates:
            run_gspread_request(
                lambda: worksheet.batch_update(updates),
                label=f"update action results in {sheet_name}"
            )
            print(f"✓ Applied {len(updates)} cell updates across {len(sheet_updates)} rows")
    except Exception as e:
        raise Exception(f"Failed to update action results: {str(e)}")


def delete_rows(spreadsheet_id, row_numbers, sheet_name=None):
    """
    Delete multiple rows from the spreadsheet in a single bulk API call.

    Args:
        spreadsheet_id (str): The spreadsheet ID
        row_numbers (list): List of row numbers to delete (1-based)
        sheet_name (str, optional): Sheet name (default: config.ALL_MSGS_SHEET_NAME)

    Returns:
        int: Number of rows deleted

    Raises:
        Exception: If unable to delete rows
    """
    try:
        if not sheet_name:
            sheet_name = config.ALL_MSGS_SHEET_NAME

        if not row_numbers:
            return 0

        worksheet = get_worksheet_by_name(spreadsheet_id, sheet_name)
        sheet_id  = worksheet.id

        # Sort descending so index shifts don't affect earlier rows
        sorted_rows = sorted(row_numbers, reverse=True)
        print(f"  Bulk-deleting {len(sorted_rows)} rows in one API call: {sorted_rows}")

        # Build one batchUpdate request with all deletions
        # Each request deletes a single row by its 0-based index.
        # Descending order ensures each index is still valid when processed.
        requests = [
            {
                "deleteDimension": {
                    "range": {
                        "sheetId":    sheet_id,
                        "dimension":  "ROWS",
                        "startIndex": row_num - 1,   # convert 1-based → 0-based
                        "endIndex":   row_num        # exclusive
                    }
                }
            }
            for row_num in sorted_rows
        ]

        # Execute all deletions in one HTTP request
        worksheet.spreadsheet.batch_update({"requests": requests})

        print(f"  ✅ Successfully bulk-deleted {len(sorted_rows)} rows")
        return len(sorted_rows)

    except Exception as e:
        raise Exception(f"Failed to delete rows: {str(e)}")
