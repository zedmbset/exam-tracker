"""
Comment Fetcher Module
======================
Fetches comments from channel posts via their linked discussion groups.
"""

from telethon import TelegramClient
from telethon.tl.functions.channels import GetFullChannelRequest


class CommentFetcher:
    """Fetch comments from channel posts via discussion groups."""
    
    def __init__(self, client: TelegramClient):
        self.client = client
        self._discussion_group_cache = {}
    
    async def get_discussion_group(self, channel_id):
        """Get the linked discussion group for a channel."""
        if channel_id in self._discussion_group_cache:
            return self._discussion_group_cache[channel_id]
        
        try:
            if not str(channel_id).startswith('-100'):
                channel_id = int(f'-100{channel_id}')
            
            channel = await self.client.get_entity(channel_id)
            full_channel = await self.client(GetFullChannelRequest(channel))
            
            if full_channel.full_chat.linked_chat_id:
                linked_chat_id = full_channel.full_chat.linked_chat_id
                if not str(linked_chat_id).startswith('-100'):
                    linked_chat_id = int(f'-100{linked_chat_id}')
                
                self._discussion_group_cache[channel_id] = linked_chat_id
                return linked_chat_id
            else:
                self._discussion_group_cache[channel_id] = None
                return None
                
        except Exception as e:
            print(f"  ⚠️  Error getting discussion group: {e}")
            return None
    
    async def get_post_comments(self, channel_id, post_id, limit=50):
        """Get all comments for a specific channel post."""
        try:
            discussion_group_id = await self.get_discussion_group(channel_id)
            if not discussion_group_id:
                return []
            
            forwarded_msg = await self._find_forwarded_post(
                discussion_group_id, channel_id, post_id
            )
            
            if not forwarded_msg:
                return []
            
            comments = []
            async for reply in self.client.iter_messages(
                discussion_group_id,
                reply_to=forwarded_msg.id,
                limit=limit
            ):
                comments.append(reply)
            
            return comments
            
        except Exception as e:
            print(f"  ⚠️  Error fetching comments for post {post_id}: {e}")
            return []
    
    async def _find_forwarded_post(self, discussion_group_id, channel_id, post_id, search_limit=200):
        """Find the forwarded post in the discussion group."""
        try:
            async for message in self.client.iter_messages(discussion_group_id, limit=search_limit):
                if message.fwd_from and message.fwd_from.from_id:
                    if hasattr(message.fwd_from.from_id, 'channel_id'):
                        fwd_channel_id = message.fwd_from.from_id.channel_id
                        fwd_channel_id_clean = int(str(fwd_channel_id).replace('-100', ''))
                        channel_id_clean = int(str(channel_id).replace('-100', ''))
                        
                        if (fwd_channel_id_clean == channel_id_clean and 
                            message.fwd_from.channel_post == post_id):
                            return message
            return None
        except Exception as e:
            print(f"  ⚠️  Error finding forwarded post: {e}")
            return None
