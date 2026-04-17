import asyncio
import json
import os
import threading
from datetime import datetime, timezone

from flask import Flask, jsonify, request
from telethon import TelegramClient
from telethon.sessions import StringSession

from channel_lister import list_channels
from member_fetcher import fetch_members
from sheets_store import SheetsStore, make_id


app = Flask(__name__)
JOBS = {}
LOCK = threading.Lock()

API_ID = int(os.environ.get("TELEGRAM_API_ID", "0"))
API_HASH = os.environ.get("TELEGRAM_API_HASH", "")
TELEGRAM_SESSION = os.environ.get("TELEGRAM_SESSION", "")
PORT = int(os.environ.get("PORT", "8000"))


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def get_store():
    store = SheetsStore()
    store.ensure_all()
    return store


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
    store.upsert_job({
        "ID_Job": job["jobId"],
        "Type": job["type"],
        "Channel": job["channel"],
        "Status": job["status"],
        "Progress": str(job["progress"]),
        "Total": str(job["total"]),
        "Started": job["started"],
        "Finished": job["finished"],
        "Error": job["error"],
        "Summary_JSON": job["summary"],
        "Worker_Job_ID": job["jobId"],
    })


def set_job(job_id, **updates):
    with LOCK:
        job = JOBS[job_id]
        job.update(updates)
        snapshot = dict(job)
    persist_job(snapshot)
    return snapshot


async def create_client():
    client = TelegramClient(StringSession(TELEGRAM_SESSION), API_ID, API_HASH)
    await client.connect()
    if not await client.is_user_authorized():
        raise RuntimeError("TELEGRAM_SESSION is invalid or expired.")
    return client


def run_async_job(job_id, coroutine_factory):
    def runner():
        try:
            asyncio.run(coroutine_factory())
        except Exception as error:
            set_job(job_id, status="error", error=str(error), finished=now_iso(), summary=str(error))
    thread = threading.Thread(target=runner, daemon=True)
    thread.start()


def create_job(job_type, channel=""):
    job_id = make_id("job")
    job = base_job(job_id, job_type, channel)
    with LOCK:
      JOBS[job_id] = job
    persist_job(job)
    return job_id


@app.get("/health")
def health():
    ready = bool(API_ID and API_HASH and TELEGRAM_SESSION)
    return jsonify({
        "ok": True,
        "telethonConfigured": ready,
        "contactsSheetConfigured": bool(os.environ.get("CONTACTS_SHEET_ID")),
    })


@app.post("/jobs/list-channels")
def start_list_channels():
    job_id = create_job("list-channels")

    async def work():
        set_job(job_id, status="running", summary="Listing channels...")
        client = await create_client()
        try:
            channels = await list_channels(client)
        finally:
            await client.disconnect()
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
        set_job(job_id, status="running", summary=f"Fetching members for {label}...")
        client = await create_client()
        try:
            result = await fetch_members(
                client,
                channel_ref,
                progress_cb=lambda progress: set_job(job_id, status="running", progress=progress),
            )
        finally:
            await client.disconnect()

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


@app.get("/jobs/<job_id>")
def get_job(job_id):
    with LOCK:
        job = JOBS.get(job_id)
    if job:
        return jsonify(job)

    store = get_store()
    rows, _ = store.get_rows("ZED_Jobs")
    for row in rows:
        if row.get("ID_Job") == job_id:
            return jsonify({
                "jobId": row.get("ID_Job"),
                "type": row.get("Type"),
                "channel": row.get("Channel"),
                "status": row.get("Status"),
                "progress": int(str(row.get("Progress", "0") or "0")),
                "total": int(str(row.get("Total", "0") or "0")),
                "started": row.get("Started", ""),
                "finished": row.get("Finished", ""),
                "error": row.get("Error", ""),
                "summary": row.get("Summary_JSON", ""),
            })
    return jsonify({"error": "Job not found."}), 404


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT)
