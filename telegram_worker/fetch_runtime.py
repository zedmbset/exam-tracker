import asyncio
import os
import sys
from pathlib import Path


LEGACY_ROOT = Path(__file__).resolve().parent / "legacy_fetcher"
if str(LEGACY_ROOT) not in sys.path:
    sys.path.insert(0, str(LEGACY_ROOT))
if str(LEGACY_ROOT / "Config_Tlg") not in sys.path:
    sys.path.insert(0, str(LEGACY_ROOT / "Config_Tlg"))

import google_sheets_helper as gsh
from telegram_client.action_executor import ActionExecutor
from telegram_client.comment_fetcher import CommentFetcher
from telegram_client.message_parser import MessageParser


class WorkerTelegramFetcherAdapter:
    def __init__(self, client):
        self.client = client
        self.entity = None
        self.entity_name = None
        self.comment_fetcher = CommentFetcher(client)
        self._topic_cache = {}

    async def get_channel_entity(self, channel_id):
        self.entity = await self.client.get_entity(channel_id)
        self.entity_name = getattr(self.entity, "title", str(channel_id))
        return self.entity, self.entity_name

    async def fetch_messages(self, start_message_id=None, end_message_id=None, start_date=None):
        if not self.entity:
            raise RuntimeError("Channel entity not initialized.")

        messages = []
        if start_date:
            async for message in self.client.iter_messages(self.entity, offset_date=start_date, reverse=True, limit=None):
                messages.append(message)
        else:
            iter_params = {}
            if start_message_id:
                iter_params["min_id"] = int(start_message_id) - 1
            if end_message_id:
                iter_params["max_id"] = int(end_message_id) + 1
            async for message in self.client.iter_messages(self.entity, **iter_params):
                messages.append(message)
            messages = list(reversed(messages))
        return messages

    async def get_forward_entity_info(self, forward_obj):
        user_name = ""
        user_id = ""

        if hasattr(forward_obj, "from_id") and forward_obj.from_id:
            from_id_obj = forward_obj.from_id
            if hasattr(from_id_obj, "user_id"):
                user_id = str(from_id_obj.user_id)
            elif hasattr(from_id_obj, "channel_id"):
                user_id = str(from_id_obj.channel_id)
            elif hasattr(from_id_obj, "chat_id"):
                user_id = str(from_id_obj.chat_id)
            else:
                user_id = str(from_id_obj)

            try:
                fwd_entity = await self.client.get_entity(forward_obj.from_id)
                if hasattr(fwd_entity, "title"):
                    user_name = fwd_entity.title
                elif hasattr(fwd_entity, "first_name"):
                    user_name = fwd_entity.first_name
                    if getattr(fwd_entity, "last_name", None):
                        user_name += f" {fwd_entity.last_name}"
                elif getattr(fwd_entity, "username", None):
                    user_name = fwd_entity.username
            except Exception:
                pass

        if not user_name and getattr(forward_obj, "from_name", None):
            user_name = forward_obj.from_name

        return user_name, user_id

    async def get_topic_title(self, reply_to_top_id):
        if not reply_to_top_id:
            return "Discussion"
        if reply_to_top_id == 1:
            return "Discussion"
        if reply_to_top_id in self._topic_cache:
            return self._topic_cache[reply_to_top_id]
        if not self.entity:
            return "Discussion"

        try:
            topic_msg = await self.client.get_messages(self.entity, ids=reply_to_top_id)
            if topic_msg:
                if getattr(getattr(topic_msg, "action", None), "title", None):
                    title = topic_msg.action.title
                    self._topic_cache[reply_to_top_id] = title
                    return title
                if getattr(topic_msg, "reply_to", None):
                    nested_top = getattr(topic_msg.reply_to, "reply_to_top_id", None)
                    if nested_top and nested_top != reply_to_top_id:
                        title = await self.get_topic_title(nested_top)
                        self._topic_cache[reply_to_top_id] = title
                        return title
        except Exception:
            pass

        self._topic_cache[reply_to_top_id] = "Discussion"
        return "Discussion"


async def fetch_messages_to_sheet(
    client,
    spreadsheet_id,
    sheet_name,
    channels,
    range_mode,
    date_from,
    start_message_id,
    end_message_id,
    fetch_comments,
    max_comments_per_post,
    progress_cb=None,
):
    adapter = WorkerTelegramFetcherAdapter(client)
    parser = MessageParser(adapter)

    all_rows = []
    total_channels = len(channels)
    for index, channel in enumerate(channels, start=1):
        channel_ref = channel.get("id") or channel.get("username") or channel.get("name")
        await adapter.get_channel_entity(channel_ref)
        start_dt = None
        if range_mode == "date" and date_from:
            start_dt = gsh.parse_scheduled_time(date_from)
            if start_dt:
                from datetime import datetime, timezone
                start_dt = datetime.fromtimestamp(start_dt, tz=timezone.utc)
        messages = await adapter.fetch_messages(
            start_message_id=start_message_id if range_mode == "message_id" else None,
            end_message_id=end_message_id if range_mode == "message_id" else None,
            start_date=start_dt if range_mode == "date" else None,
        )
        if fetch_comments:
            rows = await parser.parse_messages_with_comments(
                messages,
                channel.get("id") or channel_ref,
                channel.get("name") or adapter.entity_name,
                fetch_comments=True,
                max_comments_per_post=max_comments_per_post,
            )
        else:
            rows = await parser.parse_messages(messages, channel.get("id") or channel_ref, channel.get("name") or adapter.entity_name)
        all_rows.extend(rows)
        if progress_cb:
            progress_cb(index, total_channels, channel.get("name") or adapter.entity_name, len(messages), len(rows))

    stats = gsh.upsert_messages_to_all_msgs(spreadsheet_id, all_rows, sheet_name=sheet_name)
    return {
        "channels": total_channels,
        "rows": len(all_rows),
        "sheetStats": stats,
        "sheetName": sheet_name,
        "spreadsheetId": spreadsheet_id,
    }


async def execute_sheet_actions(client, spreadsheet_id, sheet_name):
    executor = ActionExecutor(client)
    stats = await executor.execute_actions(spreadsheet_id, sheet_name=sheet_name)
    return stats
