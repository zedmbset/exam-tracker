"""
Generate a Telethon StringSession for the shared worker.
Run locally once, then copy the printed session into TELEGRAM_SESSION.
"""

import asyncio
import os

from telethon import TelegramClient
from telethon.sessions import StringSession


async def main():
    api_id = int(os.environ.get("TELEGRAM_API_ID") or input("TELEGRAM_API_ID: ").strip())
    api_hash = os.environ.get("TELEGRAM_API_HASH") or input("TELEGRAM_API_HASH: ").strip()
    phone = input("Telegram phone number (include country code): ").strip()

    client = TelegramClient(StringSession(), api_id, api_hash)
    await client.connect()
    try:
        print("\nIf 2-step verification is enabled, you can paste the password here.")
        password = input("2FA password (press Enter if not enabled): ").strip()
        await client.start(phone=phone, password=password or None)
        print("\nTELEGRAM_SESSION:\n")
        print(client.session.save())
        print("\nCopy this exact value into the TELEGRAM_SESSION environment variable.")
    finally:
        await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
