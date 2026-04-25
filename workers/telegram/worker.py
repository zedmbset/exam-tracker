import asyncio
import json
import os
import re
import signal
import threading
from pathlib import Path
from datetime import datetime, timezone

from flask import Flask, jsonify, request
from dotenv import load_dotenv
from telethon import TelegramClient
from telethon.errors import RPCError
from telethon.sessions import StringSession

from channel_lister import list_channels
from fetch_runtime import execute_sheet_actions, fetch_messages_to_sheet
from member_fetcher import fetch_members
from sheets_store import SheetsStore, make_id

load_dotenv(dotenv_path=Path(__file__).with_name(".env"))

app = Flask(__name__)
JOBS = {}
LOCK = threading.Lock()
SHEETS_JOB_LOCK = threading.Lock()
ACTIVE_SHEETS_JOB = None
STORE = None
STORE_LOCK = threading.Lock()

API_ID = int(os.environ.get("TELEGRAM_API_ID", "0"))
API_HASH = os.environ.get("TELEGRAM_API_HASH", "")
TELEGRAM_SESSION = os.environ.get("TELEGRAM_SESSION", "")
WORKER_AUTH_TOKEN = os.environ.get("WORKER_AUTH_TOKEN", "")
PORT = int(os.environ.get("PORT", "8000"))
ASYNC_TIMEOUT_SECONDS = int(os.environ.get("TELEGRAM_REQUEST_TIMEOUT_SECONDS", "45"))

WORKER_LOOP = asyncio.new_event_loop()
LOOP_THREAD = None
CLIENT = None
CLIENT_LOCK = threading.Lock()


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def redact_sensitive_text(value):
    text = str(value or "")
    text = re.sub(r"Bearer\s+[A-Za-z0-9._\-~+/=]+", "Bearer [REDACTED]", text)
    text = re.sub(r"([?&](?:token|access_token|refresh_token|key|secret|password)=)[^&\s]+", r"\1[REDACTED]", text)
    text = re.sub(r"\b[a-f0-9]{32,}\b", "[REDACTED]", text)
    text = re.sub(r"\b[A-Za-z0-9+/_-]{40,}={0,2}\b", "[REDACTED]", text)
    return text[:500]


def get_store():
    global STORE
    with STORE_LOCK:
        if STORE is None:
            STORE = SheetsStore()
            STORE.ensure_all()
        return STORE


def base_job(job_id, job_type, channel=""):
    return {
        "jobId": job_id,
        "type": job_type,
        "channel": channel,
        "status": "queued",
        "progress": 0,
        "total": 0,
        "started": now_iso(),
        "finished": "",
        "error": "",
        "summary": "",
    }


def persist_job(job):
    store = get_store()
    store.upsert_job(
        {
            "ID_Job": job["jobId"],
            "Type": job["type"],
            "Channel": job["channel"],
            "Status": job["status"],
            "Progress": str(job["progress"]),
            "Total": str(job["total"]),
            "Started": job["started"],
            "Finished": job["finished"],
            "Error": redact_sensitive_text(job["error"]),
            "Summary_JSON": redact_sensitive_text(job["summary"]),
            "Worker_Job_ID": job["jobId"],
        }
    )


def set_job(job_id, **updates):
    with LOCK:
        job = JOBS[job_id]
        job.update(updates)
        snapshot = dict(job)
        persist_job(snapshot)
    return snapshot


def set_active_sheets_job(job_id):
    global ACTIVE_SHEETS_JOB
    with LOCK:
        ACTIVE_SHEETS_JOB = job_id


def clear_active_sheets_job(job_id):
    global ACTIVE_SHEETS_JOB
    with LOCK:
        if ACTIVE_SHEETS_JOB == job_id:
            ACTIVE_SHEETS_JOB = None


def get_active_sheets_job():
    with LOCK:
        return ACTIVE_SHEETS_JOB


def create_job(job_type, channel=""):
    job_id = make_id("job")
    job = base_job(job_id, job_type, channel)
    with LOCK:
        JOBS[job_id] = job
        persist_job(job)
    return job_id


def loop_runner():
    asyncio.set_event_loop(WORKER_LOOP)
    WORKER_LOOP.run_forever()


def start_worker_loop():
    global LOOP_THREAD
    if LOOP_THREAD and LOOP_THREAD.is_alive():
        return
    LOOP_THREAD = threading.Thread(target=loop_runner, daemon=True, name="telegram-worker-loop")
    LOOP_THREAD.start()


async def init_client():
    global CLIENT
    if CLIENT is None:
        CLIENT = TelegramClient(StringSession(TELEGRAM_SESSION), API_ID, API_HASH)
        await CLIENT.connect()
    elif not CLIENT.is_connected():
        await CLIENT.connect()
    if not await CLIENT.is_user_authorized():
        raise RuntimeError("TELEGRAM_SESSION is invalid or expired.")
    return CLIENT


def ensure_client_ready():
    if not (API_ID and API_HASH and TELEGRAM_SESSION):
        raise RuntimeError("Telegram worker is not fully configured.")
    start_worker_loop()
    with CLIENT_LOCK:
        future = asyncio.run_coroutine_threadsafe(init_client(), WORKER_LOOP)
        return future.result(timeout=ASYNC_TIMEOUT_SECONDS + 15)


def run_async(coroutine):
    ensure_client_ready()
    future = asyncio.run_coroutine_threadsafe(coroutine, WORKER_LOOP)
    return future.result(timeout=None)


def _normalize_channel_link(value):
    raw = str(value or "").strip()
    if not raw:
        raise ValueError("Channel link is required.")
    if raw.startswith("@"):
        username = raw.lstrip("@").strip()
        if not username:
            raise ValueError("Telegram username is invalid.")
        return {"kind": "public", "ref": username}
    public_match = re.match(r"^https?://t\.me/([A-Za-z0-9_]{5,})/?$", raw, re.IGNORECASE)
    if public_match:
        return {"kind": "public", "ref": public_match.group(1)}
    invite_match = re.match(r"^https?://t\.me/\+([A-Za-z0-9_-]+)/?$", raw, re.IGNORECASE)
    if invite_match:
        return {"kind": "invite", "ref": f"+{invite_match.group(1)}"}
    raise ValueError("Supported formats: @username, https://t.me/USERNAME, https://t.me/+HASH")


async def resolve_channel_reference(client, link, fallback_name=""):
    normalized = _normalize_channel_link(link)
    fallback_name = str(fallback_name or "").strip()

    if normalized["kind"] == "public":
        entity = await client.get_entity(normalized["ref"])
        return {
            "id": int(f"-100{entity.id}") if getattr(entity, "id", 0) > 0 else getattr(entity, "id", ""),
            "name": getattr(entity, "title", "") or getattr(entity, "username", "") or fallback_name,
            "username": getattr(entity, "username", "") or "",
            "type": "group" if getattr(entity, "megagroup", False) else "channel" if getattr(entity, "broadcast", False) else "",
            "membersCount": getattr(entity, "participants_count", "") or "",
            "resolved": True,
            "fallbackAllowed": False,
            "normalizedRef": normalized["ref"],
            "originalLink": str(link or "").strip(),
        }

    from telethon.tl.functions.messages import CheckChatInviteRequest

    invite_hash = normalized["ref"].lstrip("+")
    try:
        invite_info = await client(CheckChatInviteRequest(hash=invite_hash))
        chat = getattr(invite_info, "chat", None)
        if chat is None:
            return {
                "id": normalized["ref"],
                "name": getattr(invite_info, "title", "") or fallback_name or normalized["ref"],
                "username": "",
                "type": "",
                "membersCount": getattr(invite_info, "participants_count", "") or "",
                "resolved": False,
                "fallbackAllowed": True,
                "normalizedRef": normalized["ref"],
                "originalLink": str(link or "").strip(),
            }
        return {
            "id": int(f"-100{chat.id}") if getattr(chat, "id", 0) > 0 else getattr(chat, "id", ""),
            "name": getattr(chat, "title", "") or fallback_name or normalized["ref"],
            "username": getattr(chat, "username", "") or "",
            "type": "group" if getattr(chat, "megagroup", False) else "channel" if getattr(chat, "broadcast", False) else "",
            "membersCount": getattr(chat, "participants_count", "") or "",
            "resolved": True,
            "fallbackAllowed": True,
            "normalizedRef": normalized["ref"],
            "originalLink": str(link or "").strip(),
        }
    except RPCError:
        return {
            "id": normalized["ref"],
            "name": fallback_name or normalized["ref"],
            "username": "",
            "type": "",
            "membersCount": "",
            "resolved": False,
            "fallbackAllowed": True,
            "normalizedRef": normalized["ref"],
            "originalLink": str(link or "").strip(),
        }


async def resolve_channel_request(link, fallback_name=""):
    client = await init_client()
    return await resolve_channel_reference(client, link, fallback_name)


async def shutdown_client():
    global CLIENT
    if CLIENT is not None and CLIENT.is_connected():
        await CLIENT.disconnect()
    CLIENT = None


def shutdown_worker(*_args):
    if LOOP_THREAD and LOOP_THREAD.is_alive():
        try:
            asyncio.run_coroutine_threadsafe(shutdown_client(), WORKER_LOOP).result(timeout=15)
        except Exception:
            pass
        WORKER_LOOP.call_soon_threadsafe(WORKER_LOOP.stop)


def run_async_job(job_id, coroutine_factory):
    def runner():
        try:
            run_async(coroutine_factory())
        except Exception as error:
            message = redact_sensitive_text(error)
            set_job(job_id, status="error", error=message, finished=now_iso(), summary=message)

    thread = threading.Thread(target=runner, daemon=True)
    thread.start()


async def run_serialized_sheets_job(job_id, wait_summary, coroutine_factory):
    """
    Ensure only one sheet-heavy job runs at a time to avoid Google Sheets quota spikes.
    """
    announced_wait = False
    while not SHEETS_JOB_LOCK.acquire(blocking=False):
        active_job = get_active_sheets_job()
        suffix = f" Waiting for job {active_job} to finish..." if active_job else " Waiting for another sheet job to finish..."
        if not announced_wait:
            set_job(job_id, status="queued", summary=f"{wait_summary}.{suffix}")
            announced_wait = True
        await asyncio.sleep(2)

    set_active_sheets_job(job_id)
    try:
        return await coroutine_factory()
    finally:
        clear_active_sheets_job(job_id)
        SHEETS_JOB_LOCK.release()


@app.before_request
def require_worker_token():
    if request.path == "/health":
        return None
    if request.path.startswith("/jobs/") or request.path.startswith("/resolve/"):
        if not WORKER_AUTH_TOKEN:
            return jsonify({"error": "WORKER_AUTH_TOKEN is not configured on the worker."}), 503
        if request.headers.get("X-Worker-Token", "") != WORKER_AUTH_TOKEN:
            return jsonify({"error": "Unauthorized worker request."}), 401
    return None


@app.get("/health")
def health():
    ready = bool(API_ID and API_HASH and TELEGRAM_SESSION)
    client_ready = False
    if ready:
      try:
          ensure_client_ready()
          client_ready = True
      except Exception:
          client_ready = False
    return jsonify(
        {
            "ok": True,
            "telethonConfigured": ready,
            "telethonConnected": client_ready,
            "contactsSheetConfigured": bool(os.environ.get("CONTACTS_SHEET_ID")),
            "workerAuthConfigured": bool(WORKER_AUTH_TOKEN),
        }
    )


@app.post("/resolve/channel")
def resolve_channel():
    payload = request.get_json(silent=True) or {}
    link = str(payload.get("link", "")).strip()
    fallback_name = str(payload.get("name", "")).strip()
    if not link:
        return jsonify({"error": "link is required."}), 400

    try:
        channel = run_async(resolve_channel_request(link, fallback_name))
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except Exception as error:
        return jsonify({"error": redact_sensitive_text(error)}), 500

    return jsonify({"ok": True, "channel": channel})


@app.post("/jobs/list-channels")
def start_list_channels():
    job_id = create_job("list-channels")

    async def work():
        client = await init_client()
        set_job(job_id, status="running", summary="Listing channels...")
        channels = await list_channels(client, timeout_seconds=ASYNC_TIMEOUT_SECONDS)
        store = get_store()
        store.write_channels(channels)
        summary = json.dumps({"channels": len(channels)})
        set_job(job_id, status="done", progress=len(channels), total=len(channels), finished=now_iso(), summary=summary)

    run_async_job(job_id, work)
    return jsonify({"ok": True, "jobId": job_id})


@app.post("/jobs/fetch-members")
def start_fetch_members():
    payload = request.get_json(silent=True) or {}
    channel_id = str(payload.get("channelId", "")).strip()
    channel_username = str(payload.get("channelUsername", "")).strip()
    channel_name = str(payload.get("channelName", "")).strip()
    channel_ref = channel_username or channel_id
    if not channel_ref:
        return jsonify({"error": "channelId or channelUsername is required."}), 400

    label = channel_name or channel_username or channel_id
    job_id = create_job("fetch-members", label)

    async def work():
        client = await init_client()
        set_job(job_id, status="running", summary=f"Fetching members for {label}...")
        result = await fetch_members(
            client,
            channel_ref,
            progress_cb=lambda progress: set_job(job_id, status="running", progress=progress),
            timeout_seconds=ASYNC_TIMEOUT_SECONDS,
        )
        set_job(job_id, total=result["total"], channel=result["channel_name"])
        store = get_store()
        summary_payload = store.import_members(result["members"])
        summary = json.dumps(summary_payload)
        set_job(
            job_id,
            status="done",
            progress=result["total"],
            total=result["total"],
            finished=now_iso(),
            summary=summary,
        )

    run_async_job(job_id, work)
    return jsonify({"ok": True, "jobId": job_id})


@app.post("/jobs/fetch-messages")
def start_fetch_messages():
    payload = request.get_json(silent=True) or {}
    spreadsheet_id = str(payload.get("spreadsheetId", "")).strip()
    sheet_name = str(payload.get("sheetName", "")).strip()
    channels = payload.get("channels") or []
    range_mode = str(payload.get("rangeMode", "date")).strip() or "date"
    date_from = str(payload.get("dateFrom", "")).strip()
    start_message_id = str(payload.get("startMessageId", "")).strip()
    end_message_id = str(payload.get("endMessageId", "")).strip()
    fetch_comments = bool(payload.get("fetchComments"))
    max_comments_per_post = int(payload.get("maxCommentsPerPost", 50) or 50)

    if not spreadsheet_id or not sheet_name:
        return jsonify({"error": "spreadsheetId and sheetName are required."}), 400
    if not channels:
        return jsonify({"error": "At least one channel is required."}), 400

    label = ", ".join(filter(None, [str(channel.get("name", "")).strip() for channel in channels[:3]]))
    if len(channels) > 3:
        label = f"{label} (+{len(channels) - 3} more)"
    job_id = create_job("fetch-messages", label or sheet_name)

    async def work():
        async def run_job():
            client = await init_client()
            set_job(job_id, status="running", total=len(channels), summary=f"Fetching Telegram messages into {sheet_name}...")

            def progress_cb(done_channels, total_channels, channel_name, message_count, row_count):
                summary = json.dumps({
                    "current_channel": channel_name,
                    "channels_done": done_channels,
                    "channels_total": total_channels,
                    "messages_fetched": message_count,
                    "rows_buffered": row_count,
                })
                set_job(job_id, status="running", progress=done_channels, total=total_channels, summary=summary)

            result = await fetch_messages_to_sheet(
                client,
                spreadsheet_id=spreadsheet_id,
                sheet_name=sheet_name,
                channels=channels,
                range_mode=range_mode,
                date_from=date_from,
                start_message_id=start_message_id,
                end_message_id=end_message_id,
                fetch_comments=fetch_comments,
                max_comments_per_post=max_comments_per_post,
                progress_cb=progress_cb,
            )
            summary = json.dumps(result)
            set_job(job_id, status="done", progress=len(channels), total=len(channels), finished=now_iso(), summary=summary)

        await run_serialized_sheets_job(
            job_id,
            wait_summary=f"Queued for fetch into {sheet_name}",
            coroutine_factory=run_job,
        )

    run_async_job(job_id, work)
    return jsonify({"ok": True, "jobId": job_id})


@app.post("/jobs/execute-actions")
def start_execute_actions():
    payload = request.get_json(silent=True) or {}
    spreadsheet_id = str(payload.get("spreadsheetId", "")).strip()
    sheet_name = str(payload.get("sheetName", "")).strip()
    if not spreadsheet_id or not sheet_name:
        return jsonify({"error": "spreadsheetId and sheetName are required."}), 400

    job_id = create_job("execute-actions", sheet_name)

    async def work():
        async def run_job():
            client = await init_client()
            set_job(job_id, status="running", summary=f"Executing sheet actions from {sheet_name}...")
            stats = await execute_sheet_actions(client, spreadsheet_id=spreadsheet_id, sheet_name=sheet_name)
            summary = json.dumps(stats)
            set_job(job_id, status="done", progress=int(stats.get("total", 0) or 0), total=int(stats.get("total", 0) or 0), finished=now_iso(), summary=summary)

        await run_serialized_sheets_job(
            job_id,
            wait_summary=f"Queued for action execution on {sheet_name}",
            coroutine_factory=run_job,
        )

    run_async_job(job_id, work)
    return jsonify({"ok": True, "jobId": job_id})


@app.get("/jobs/<job_id>")
def get_job(job_id):
    with LOCK:
        job = JOBS.get(job_id)
    if job:
        snapshot = dict(job)
        snapshot["error"] = redact_sensitive_text(snapshot.get("error"))
        snapshot["summary"] = redact_sensitive_text(snapshot.get("summary"))
        return jsonify(snapshot)

    store = get_store()
    rows, _ = store.get_rows("ZED_Jobs")
    for row in rows:
        if row.get("ID_Job") == job_id:
            return jsonify(
                {
                    "jobId": row.get("ID_Job"),
                    "type": row.get("Type"),
                    "channel": row.get("Channel"),
                    "status": row.get("Status"),
                    "progress": int(str(row.get("Progress", "0") or "0")),
                    "total": int(str(row.get("Total", "0") or "0")),
                    "started": row.get("Started", ""),
                    "finished": row.get("Finished", ""),
                    "error": redact_sensitive_text(row.get("Error", "")),
                    "summary": redact_sensitive_text(row.get("Summary_JSON", "")),
                }
            )
    return jsonify({"error": "Job not found."}), 404


start_worker_loop()
for sig in (signal.SIGINT, signal.SIGTERM):
    signal.signal(sig, shutdown_worker)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT)
