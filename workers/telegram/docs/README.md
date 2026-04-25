# Telegram Worker Docs

This folder documents the Telegram worker used by the `exam-tracker` app.

## What this worker does

The worker is the Python service that:

- connects to Telegram through Telethon
- fetches channel messages into Google Sheets
- executes row actions from a sheet
- writes results back to Google Sheets

Main files:

- [worker.py](../worker.py)
- [fetch_runtime.py](../fetch_runtime.py)
- [legacy_fetcher/telegram_client/action_executor.py](../legacy_fetcher/telegram_client/action_executor.py)
- [legacy_fetcher/Config_Tlg/google_sheets_helper.py](../legacy_fetcher/Config_Tlg/google_sheets_helper.py)

## Local run

From `workers/telegram/`:

```powershell
python -m pip install -r requirements.txt
python worker.py
```

Health check:

```text
http://localhost:8000/health
```

Healthy worker means:

- `telethonConfigured: true`
- `telethonConnected: true`
- `workerAuthConfigured: true`
- `contactsSheetConfigured: true`

## Important env notes

The worker uses `workers/telegram/.env`.

Important variables:

- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `TELEGRAM_SESSION`
- `WORKER_AUTH_TOKEN`
- `SERVICE_ACCOUNT_JSON`
- `CONTACTS_SHEET_ID`

Important rule:

- do not use the same `TELEGRAM_SESSION` locally and on Railway at the same time

Use one session for production and a different one for local testing.

## Related docs

- [ACTION_TAGS.md](./ACTION_TAGS.md)

This file explains the meaning of action tags such as:

- `Grp`
- `Transfer[Posts]`
- `Transfer[Cmts]`
- `Pub_lnk[...]`

## Recent maintenance notes

The worker was recently improved to reduce Google Sheets quota pressure:

- fewer full-sheet reads
- caching for spreadsheet, worksheet, and header lookups
- retry/backoff for quota and transient Google Sheets errors
- serialized sheet-heavy jobs
- explicit `.env` loading in `worker.py`

Those changes live mainly in:

- [legacy_fetcher/Config_Tlg/google_sheets_helper.py](../legacy_fetcher/Config_Tlg/google_sheets_helper.py)
- [sheets_store.py](../sheets_store.py)
- [worker.py](../worker.py)
