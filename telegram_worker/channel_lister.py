async def list_channels(client):
    channels = []
    async for dialog in client.iter_dialogs():
        entity = dialog.entity
        if not getattr(entity, "megagroup", False) and not getattr(entity, "broadcast", False):
            continue
        channels.append({
            "id": getattr(entity, "id", ""),
            "name": getattr(entity, "title", "") or dialog.name,
            "username": getattr(entity, "username", "") or "",
            "type": "group" if getattr(entity, "megagroup", False) else "channel",
            "members_count": getattr(entity, "participants_count", "") or "",
        })
    channels.sort(key=lambda item: (item["type"], str(item["name"]).lower()))
    return channels
