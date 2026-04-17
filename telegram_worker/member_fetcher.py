async def fetch_members(client, channel_ref, progress_cb=None):
    entity = await client.get_entity(channel_ref)
    members = []
    count = 0
    async for user in client.iter_participants(entity):
        count += 1
        members.append({
            "tg_user_id": getattr(user, "id", ""),
            "tg_username": getattr(user, "username", "") or "",
            "first_name": getattr(user, "first_name", "") or "",
            "last_name": getattr(user, "last_name", "") or "",
            "display_name": " ".join(part for part in [getattr(user, "first_name", ""), getattr(user, "last_name", "")] if part).strip() or getattr(user, "username", "") or str(getattr(user, "id", "")),
        })
        if progress_cb and count % 25 == 0:
            progress_cb(count)
    if progress_cb:
        progress_cb(count)
    return {
        "channel_id": getattr(entity, "id", ""),
        "channel_name": getattr(entity, "title", "") or getattr(entity, "username", "") or str(channel_ref),
        "members": members,
        "total": count,
    }
