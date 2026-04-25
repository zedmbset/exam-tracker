import asyncio


async def list_channels(client, timeout_seconds=45):
    channels = []
    iterator = client.iter_dialogs().__aiter__()

    while True:
      try:
          dialog = await asyncio.wait_for(iterator.__anext__(), timeout=timeout_seconds)
      except StopAsyncIteration:
          break

      entity = dialog.entity
      if not getattr(entity, "megagroup", False) and not getattr(entity, "broadcast", False):
          continue
      channels.append(
          {
              "id": getattr(entity, "id", ""),
              "name": getattr(entity, "title", "") or dialog.name,
              "username": getattr(entity, "username", "") or "",
              "type": "group" if getattr(entity, "megagroup", False) else "channel",
              "members_count": getattr(entity, "participants_count", "") or "",
          }
      )

    channels.sort(key=lambda item: (item["type"], str(item["name"]).lower()))
    return channels
