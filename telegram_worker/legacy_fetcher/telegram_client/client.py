"""
Telegram Client Wrapper
Handles Telegram connection and message fetching operations
"""
import sys
import os

# Add Config_Tlg folder to Python path
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'Config_Tlg'))

import config
from telethon import TelegramClient


class TelegramMessageFetcher:
    """Handles Telegram connection and message fetching."""
    
    def __init__(self):
        """Initialize Telegram client."""
        self.client = TelegramClient(
            config.SESSION_FILE,
            config.API_ID,
            config.API_HASH
        )
        self.entity = None
        self.entity_name = None
    
    async def connect(self):
        """
        Connect to Telegram.
        
        Raises:
            Exception: If connection fails
        """
        try:
            await self.client.start(
                phone=config.PHONE_NUMBER,
                password=config.TWO_FA_PASSWORD
            )
            print("✓ Connected to Telegram\n")
        except Exception as e:
            raise Exception(f"Failed to connect to Telegram: {str(e)}")
    
    async def disconnect(self):
        """Disconnect from Telegram."""
        await self.client.disconnect()
        print("✓ Disconnected from Telegram\n")
    
    async def get_channel_entity(self, channel_id):
        """
        Get and store channel entity.
        
        Args:
            channel_id (int): The Telegram channel ID
        
        Returns:
            tuple: (entity, entity_name)
        
        Raises:
            Exception: If channel not found
        """
        try:
            self.entity = await self.client.get_entity(channel_id)
            self.entity_name = self.entity.title if hasattr(self.entity, 'title') else str(channel_id)
            print(f"✓ Connected to channel: {self.entity_name} (ID: {channel_id})\n")
            return self.entity, self.entity_name
        except Exception as e:
            raise Exception(f"Failed to get channel entity for ID {channel_id}: {str(e)}")
    
    async def verify_message_exists(self, message_id):
        """
        Verify that a message exists in the current channel.
        
        Args:
            message_id (int): Message ID to verify
        
        Returns:
            Message: The message object if found
        
        Raises:
            Exception: If message not found
        """
        if not self.entity:
            raise Exception("Channel entity not initialized. Call get_channel_entity() first.")
        
        try:
            msg = await self.client.get_messages(self.entity, ids=message_id)
            if msg is None:
                raise Exception(f"Message ID {message_id} not found in this channel")
            
            print(f"✓ Found message ID {message_id}")
            print(f"  Date: {msg.date.strftime('%Y-%m-%d %H:%M:%S')}")
            print()
            return msg
        except Exception as e:
            raise Exception(f"Error verifying message ID {message_id}: {str(e)}")
    
    async def fetch_messages_by_range(self, start_message_id=None, end_message_id=None):
        """
        Fetch messages from channel within specified ID range.
        
        Args:
            start_message_id (int, optional): Starting message ID (inclusive). 
                                             If None, fetches from the first message.
            end_message_id (int, optional): Ending message ID (inclusive). 
                                           If None, fetches until latest message.
        
        Returns:
            list: List of Telegram Message objects in ascending order (oldest first)
        
        Raises:
            Exception: If channel entity not initialized or fetch fails
        """
        if not self.entity:
            raise Exception("Channel entity not initialized. Call get_channel_entity() first.")
        
        try:
            # Print fetch info
            if start_message_id and end_message_id:
                print(f"Fetching messages from ID {start_message_id} to {end_message_id}...")
            elif start_message_id:
                print(f"Fetching all messages from ID {start_message_id} onwards...")
            elif end_message_id:
                print(f"Fetching messages from the beginning up to ID {end_message_id}...")
            else:
                print(f"Fetching all messages from the channel...")
            print("This may take a while for large channels...\n")
            
            messages = []
            batch_count = 0
            
            # Build parameters for iter_messages
            iter_params = {}
            
            if start_message_id:
                iter_params['min_id'] = start_message_id - 1
            
            if end_message_id:
                iter_params['max_id'] = end_message_id + 1
            
            # Fetch messages
            async for message in self.client.iter_messages(self.entity, **iter_params):
                messages.append(message)
                batch_count += 1
                
                # Print progress every 100 messages
                if batch_count % 100 == 0:
                    print(f"  Fetched {batch_count} messages... (latest ID: {message.id}, date: {message.date.strftime('%Y-%m-%d %H:%M:%S')})")
            
            # Reverse to get ascending order (oldest first)
            messages = list(reversed(messages))
            
            print(f"\n✓ Fetched {len(messages)} messages total\n")
            
            if len(messages) == 0:
                if start_message_id and end_message_id:
                    print(f"⚠ No messages found between ID {start_message_id} and {end_message_id}.")
                elif start_message_id:
                    print(f"⚠ No messages found from ID {start_message_id} onwards.")
                elif end_message_id:
                    print(f"⚠ No messages found up to ID {end_message_id}.")
                else:
                    print(f"⚠ No messages found in this channel.")
            
            return messages
            
        except Exception as e:
            raise Exception(f"Failed to fetch messages: {str(e)}")
    
    async def get_forward_entity_info(self, forward_obj):
        """
        Get detailed information about forwarded message source.
        
        Args:
            forward_obj: The message.forward object
        
        Returns:
            tuple: (user_name, user_id)
        """
        user_name = ''
        user_id = ''
        
        if hasattr(forward_obj, 'from_id') and forward_obj.from_id:
            from_id_obj = forward_obj.from_id
            
            # Extract ID
            if hasattr(from_id_obj, 'user_id'):
                user_id = str(from_id_obj.user_id)
            elif hasattr(from_id_obj, 'channel_id'):
                user_id = str(from_id_obj.channel_id)
            elif hasattr(from_id_obj, 'chat_id'):
                user_id = str(from_id_obj.chat_id)
            else:
                user_id = str(from_id_obj)
            
            # Try to get entity name
            try:
                fwd_entity = await self.client.get_entity(forward_obj.from_id)
                if hasattr(fwd_entity, 'title'):
                    user_name = fwd_entity.title
                elif hasattr(fwd_entity, 'first_name'):
                    user_name = fwd_entity.first_name
                    if hasattr(fwd_entity, 'last_name') and fwd_entity.last_name:
                        user_name += f" {fwd_entity.last_name}"
                elif hasattr(fwd_entity, 'username') and fwd_entity.username:
                    user_name = fwd_entity.username
            except:
                pass
        
        # Fallback to from_name if available
        if not user_name and hasattr(forward_obj, 'from_name') and forward_obj.from_name:
            user_name = forward_obj.from_name
        
        return user_name, user_id
    
    async def get_topic_title(self, reply_to_top_id):
        """
        Get topic title from reply_to_top_id.
        
        CRITICAL FIX:
        - reply_to_top_id can be either a topic header OR a regular message in a topic
        - If it's a regular message, we need to get the topic that message belongs to
        - Only topic creation messages have action.title - that's the actual topic name
        
        IMPROVEMENTS:
        - Caches topic titles to reduce API calls
        - Returns "Discussion" for General/main topic (ID 1)
        - Properly distinguishes between topic headers and regular messages
        
        Args:
            reply_to_top_id (int): The topic message ID (could be topic header or any message in topic)
        
        Returns:
            str: Topic title, "Discussion" for main topic, or empty string if unavailable
        """
        if not reply_to_top_id:
            return 'Discussion'
        
        # Handle General/main topic (typically message_id 1 in forums)
        # This is the main "General" discussion area
        if reply_to_top_id == 1:
            return 'Discussion'
        
        # Initialize topic cache if not exists
        if not hasattr(self, '_topic_cache'):
            self._topic_cache = {}
        
        # Check cache first
        if reply_to_top_id in self._topic_cache:
            return self._topic_cache[reply_to_top_id]
        
        if not self.entity:
            print(f"  ⚠️  Entity not initialized, cannot fetch topic {reply_to_top_id}")
            return 'Discussion'
        
        try:
            # Fetch the message with this ID
            topic_msg = await self.client.get_messages(self.entity, ids=reply_to_top_id)
            
            if topic_msg:
                title = ''
                
                # CRITICAL: Check if this is a topic creation message (has action.title)
                # Only topic header messages have this - regular messages don't
                if hasattr(topic_msg, 'action') and hasattr(topic_msg.action, 'title'):
                    # This is the actual topic header
                    title = topic_msg.action.title.strip()
                    
                    # Cache and return
                    if title:
                        self._topic_cache[reply_to_top_id] = title
                        return title
                
                # If we reach here, this is a REGULAR MESSAGE in a topic, not the topic header
                # We need to find what topic this message belongs to
                if hasattr(topic_msg, 'reply_to') and topic_msg.reply_to:
                    # Check if this message has reply_to_top_id (the actual topic header ID)
                    actual_topic_id = getattr(topic_msg.reply_to, 'reply_to_top_id', None)
                    
                    if not actual_topic_id:
                        # Fallback to reply_to_msg_id
                        actual_topic_id = getattr(topic_msg.reply_to, 'reply_to_msg_id', None)
                    
                    if actual_topic_id and actual_topic_id != reply_to_top_id:
                        # Recursively get the actual topic title
                        title = await self.get_topic_title(actual_topic_id)
                        
                        # Cache this reply_to_top_id with the actual topic name
                        if title:
                            self._topic_cache[reply_to_top_id] = title
                            return title
                
                # If we still don't have a title, this is a message in the main Discussion
                # (messages without specific topic assignment go to general discussion)
                self._topic_cache[reply_to_top_id] = 'Discussion'
                return 'Discussion'
            else:
                # Could not fetch the message
                print(f"  ⚠️  Could not fetch message for ID {reply_to_top_id}")
                return 'Discussion'
        
        except Exception as e:
            # On error, log and return empty string
            print(f"  ⚠️  Error fetching topic {reply_to_top_id}: {e}")
            return 'Discussion'
