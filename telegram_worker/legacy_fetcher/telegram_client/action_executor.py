"""
Action Executor Module - Enhanced Version

Executes actions (Transfer, Delete, Edit, Update, Post_Comment) on Telegram messages
Uses centralized text formatting for consistency

ENHANCEMENTS:
- Post_Comment now supports media (photos, videos, documents)
- Post_Comment accepts Telegram links for destination: https://t.me/c/3138994143/2461
- Transfer/Add_Msg_Before/Pub_lnk accept Telegram links for destination: https://t.me/c/3138994143/2461
"""

import asyncio
import logging
from telethon import TelegramClient
from telethon.errors import FloodWaitError, MessageNotModifiedError
from telethon.tl.types import MessageMediaPhoto
import sys
import os

# Add parent directories to path
parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
config_path = os.path.join(parent_dir, 'Config_Tlg')
if config_path not in sys.path:
    sys.path.insert(0, config_path)

import google_sheets_helper
import config

# Import utilities
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from .utils.text_extractors import (
    format_hashtags_for_telegram,
    validate_text_parts,
)
from .utils.title_cleaner import clean_title
from .utils.markdown_converter import (
    markdown_to_telegram_entities,
    validate_entity_positions,
    adjust_entity_offsets
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def _is_photo_media(media):
    """
    Return True only if media is a pure photo (MessageMediaPhoto).
    Documents, videos, audio, GIFs, voice notes → False.
    Used to decide whether to reconstruct grouped media as album:
    only photos are sent as albums; everything else is sent one-by-one.
    """
    return isinstance(media, MessageMediaPhoto)


def _is_numeric_channel_id(value):
    """
    Check if a value represents a numeric channel ID (int or string).
    
    Handles:
    - Integers: -1003874798165
    - Numeric strings: "-1003874798165", "1234567890"
    - Username strings: "ZEDP20MED", "@username"
    
    Returns:
        bool: True if numeric ID, False if username
    """
    if isinstance(value, int):
        return True
    
    if isinstance(value, str):
        # Try to convert to int - if it works, it's numeric
        try:
            int(value)
            return True
        except ValueError:
            return False
    
    return False




def parse_forum_url(url):
    """
    Parse forum URL to extract channel ID and topic ID.
    
    Formats supported:
    - https://t.me/c/2338021745/123/6409 (forum with topic)
    - https://t.me/c/2338021745/6409 (regular channel)
    
    Args:
        url (str): Telegram URL
    
    Returns:
        dict: {
            'channel_id': int,
            'topic_id': int or None,
            'message_id': int,
            'is_forum': bool
        }
    """
    if not url or 'https://t.me/c/' not in url:
        return None
    
    url = url.rstrip('/')
    parts = url.split('/')
    
    if len(parts) < 6:
        return None
    
    try:
        channel_id_str = parts[4]
        channel_id = int(f"-100{channel_id_str}")
        
        # Check if this is a forum (has 3 numbers after channel ID)
        if len(parts) == 7:
            topic_id = int(parts[5])
            message_id = int(parts[6])
            is_forum = True
        elif len(parts) == 6:
            topic_id = None
            message_id = int(parts[5])
            is_forum = False
        else:
            return None
        
        return {
            'channel_id': channel_id,
            'topic_id': topic_id,
            'message_id': message_id,
            'is_forum': is_forum
        }
    
    except (ValueError, IndexError):
        return None


class ActionExecutor:
    """Executes actions on Telegram messages based on spreadsheet instructions."""
    
    def __init__(self, client: TelegramClient):
        """
        Initialize action executor.
        
        Args:
            client: Authenticated TelegramClient instance
        """
        self.client = client
        # Cache for resolved invite link hashes → numeric channel IDs.
        # Key  : invite hash string, e.g. '+SNGnvN5TVI4xMzM0'
        # Value: dict with 'id' (int), 'name' (str), 'username' (str)
        # This prevents repeated CheckChatInviteRequest calls for the same
        # destination when processing a group of messages, which would
        # trigger Telegram's rate-limit (FloodWait ~181 s after ~6 calls).
        self._invite_link_cache = {}
    
    # ==================== HELPER METHODS ====================

    async def _resolve_invite_link(self, invite_hash: str) -> dict:
        """
        Resolve a Telegram invite-link hash to a numeric channel ID.

        Results are cached in self._invite_link_cache so that
        CheckChatInviteRequest is called **only once** per hash per session,
        regardless of how many messages in the group share the same destination.
        This avoids the ~181-second FloodWait that Telegram imposes after
        roughly 6 consecutive CheckChatInviteRequest calls.

        Args:
            invite_hash (str): The hash with or without the leading '+',
                               e.g. '+SNGnvN5TVI4xMzM0' or 'SNGnvN5TVI4xMzM0'

        Returns:
            dict: {'id': int, 'name': str, 'username': str}

        Raises:
            Exception: If Telegram returns an error or the bot is not a member.
        """
        # Normalise: always store/look up without the leading '+'
        clean_hash = invite_hash.lstrip('+')
        cache_key  = f'+{clean_hash}'

        if cache_key in self._invite_link_cache:
            cached = self._invite_link_cache[cache_key]
            print(f"  ✓ Using cached invite resolution: {cache_key} → {cached['id']}")
            return cached

        # Not cached yet — call Telegram
        from telethon.tl.functions.messages import CheckChatInviteRequest
        invite_info = await self.client(CheckChatInviteRequest(hash=clean_hash))
        chat = getattr(invite_info, 'chat', None)
        if chat is None:
            title = getattr(invite_info, 'title', cache_key)
            raise Exception(
                f"Not a member of channel '{title}' — join first"
            )

        real_id  = int(f"-100{chat.id}") if chat.id > 0 else chat.id
        resolved = {
            'id':       real_id,
            'name':     getattr(chat, 'title',    '') or '',
            'username': getattr(chat, 'username', '') or '',
        }
        self._invite_link_cache[cache_key] = resolved
        print(f"  🔍 Resolved invite {cache_key} → numeric ID: {real_id}")
        return resolved

    def _parse_message_id(self, composite_id):
        """
        Parse composite ID into channel_id and message_id.
        
        Args:
            composite_id (str): Format "channel_id:message_id"
        
        Returns:
            tuple: (channel_id, message_id)
        
        Raises:
            ValueError: If ID format is invalid
        """
        try:
            channel_id, message_id = composite_id.split(':')
            return int(channel_id), int(message_id)
        except (ValueError, KeyError, AttributeError):
            raise ValueError(f"Invalid message ID format: {composite_id}")
    
    def _extract_punct_from_actions(self, actions):
        """
        Extract punctuation/emoji from Punct_*_ actions.
        
        Args:
            actions (list): List of actions (e.g., ['Grp', 'Pub_lnk', 'Punct_🔹_'])
        
        Returns:
            str: The punctuation/emoji to use, or None if no Punct action found
        
        Behaviors:
            - No Punct action → None (use default "- ")
            - Punct__ (empty) → "" (no dash, just title)
            - Punct_🔹_ → "🔹 " (custom emoji with space)
            - Punct_•_ → "• " (bullet with space)
            - Punct_>>_ → ">> " (characters with space)
        
        Examples:
            ['Grp', 'Pub_lnk'] → None (default dash)
            ['Punct__'] → ""
            ['Punct_🔹_'] → '🔹 '
            ['Punct_•_'] → '• '
            ['Punct_>>_'] → '>> '
        """
        if not actions:
            return None
        
        for action in actions:
            if action.startswith('Punct_') and action.endswith('_'):
                # Extract the content between Punct_ and trailing _
                punct = action[6:-1]  # Remove 'Punct_' (6 chars) and trailing '_'
                
                if punct == '':
                    # Punct__ - empty, no dash wanted
                    return ''
                else:
                    # Punct_emoji_ - add a space after the emoji for better formatting
                    return f"{punct} "
        
        # No Punct action found - return None to use default dash
        return None
    
    def _parse_target_post(self, destination):
        """
        Parse destination string into channel_id and post_id for commenting.
        
        Supports multiple formats:
        - Numeric: "-1003138994143:2461"
        - Telegram link (private): "https://t.me/c/3138994143/2461"
        - Telegram link (public): "https://t.me/ZEDP22MED/123"
        
        Args:
            destination (str): Destination in any supported format
        
        Returns:
            tuple: (channel_id, post_id)
                - channel_id: int (for private channels) or str (for public channels/usernames)
                - post_id: int
        
        Raises:
            ValueError: If destination format is invalid
        """
        if not destination or not destination.strip():
            raise ValueError("Destination is empty")
        
        destination = destination.strip()
        
        try:
            # Check if it's a private channel link (https://t.me/c/...)
            if 'https://t.me/c/' in destination:
                # Use parse_forum_url – handles both regular and forum (3-segment) URLs
                parsed = parse_forum_url(destination)
                if not parsed:
                    raise ValueError(f"Invalid Telegram link format: {destination}")
                # message_id is the last segment; that's the post we target
                return parsed['channel_id'], parsed['message_id']
            
            # Check if it's a public channel link (https://t.me/USERNAME/123)
            elif destination.startswith('https://t.me/') or destination.startswith('http://t.me/'):
                # Remove protocol and domain
                if destination.startswith('https://'):
                    path = destination[len('https://t.me/'):]
                else:
                    path = destination[len('http://t.me/'):]
                
                # Split by / to get username and post ID
                parts = path.split('/')
                
                if len(parts) >= 2:
                    username = parts[0]
                    post_id = int(parts[1])
                    # Return username (string) and post_id (int)
                    return username, post_id
                else:
                    raise ValueError(f"Public channel link must include post ID: {destination}")
            
            # Otherwise, treat as "channel_id:post_id" format
            parts = destination.split(':')
            if len(parts) != 2:
                raise ValueError(f"Invalid format. Expected 'channel_id:post_id' or Telegram link, got: {destination}")
            
            channel_id = int(parts[0])
            post_id = int(parts[1])
            
            return channel_id, post_id
            
        except (ValueError, AttributeError, IndexError) as e:
            raise ValueError(f"Invalid destination format '{destination}': {str(e)}")
    
    def _parse_destination(self, destination):
        """
        Parse destination to extract channel ID and optional topic ID.
        
        Supports multiple formats:
        - Channel name: "My Channel" (looks up in spreadsheet)
        - Telegram link (private): "https://t.me/c/3138994143/2461"
        - Telegram link (public): "https://t.me/ZEDP22MED" or "https://t.me/ZEDP22MED/123"
        - Telegram link (forum): "https://t.me/c/2338021745/123/6409"
        
        Args:
            destination (str): Destination in any supported format
        
        Returns:
            tuple: (channel_id: int or None, is_link: bool, channel_name: str or None, topic_id: int or None)
                - channel_id: Extracted channel ID if it's a link, None if it's a name
                - is_link: True if destination is a Telegram link
                - channel_name: Original destination if it's a name, None if it's a link
                - topic_id: Topic ID if forum, None otherwise
        """
        if not destination or not destination.strip():
            return None, False, None, None
        
        destination = destination.strip()
        
        # Check if it's a Telegram link (private channel with /c/)
        if 'https://t.me/c/' in destination:
            try:
                # Parse URL to detect forums
                parsed = parse_forum_url(destination)
                
                if parsed:
                    return parsed['channel_id'], True, None, parsed.get('topic_id')
                else:
                    # Fallback to old parsing
                    parts = destination.split('/')
                    if len(parts) < 5:
                        return None, False, destination, None
                    
                    channel_id_str = parts[-2] if len(parts) >= 6 else parts[-1]
                    channel_id = int(f"-100{channel_id_str}")
                    
                    return channel_id, True, None, None
            
            except (ValueError, IndexError):
                return None, False, destination, None
        
        # Check if it's an invite link (https://t.me/+HASH)
        elif (destination.startswith('https://t.me/+') or destination.startswith('http://t.me/+')):
            hash_part = destination.split('/+', 1)[1].split('/')[0]
            return f'+{hash_part}', True, None, None

        # Check if it's a public channel link (https://t.me/USERNAME)
        elif destination.startswith('https://t.me/') or destination.startswith('http://t.me/'):
            try:
                # Remove protocol and domain
                if destination.startswith('https://'):
                    path = destination[len('https://t.me/'):]
                else:
                    path = destination[len('http://t.me/'):]
                
                # Split by / to get username and optional message/topic ID
                parts = path.split('/')
                
                if len(parts) >= 1:
                    username = parts[0]
                    topic_id = None
                    
                    # Check if there's a message/topic ID (e.g., https://t.me/USERNAME/123)
                    if len(parts) >= 2:
                        try:
                            topic_id = int(parts[1])
                        except ValueError:
                            pass
                    
                    # Return username as channel_name (will be resolved by Telethon)
                    # Mark as link so it's handled differently
                    return username, True, None, topic_id
            
            except Exception:
                return None, False, destination, None
        
        # Not a link, treat as channel name
        return None, False, destination, None
    

    def _build_message_content(self, msg_info):
        """
        Build message text and entities from spreadsheet data.
        
        Args:
            msg_info (dict): Message information from spreadsheet
        
        Returns:
            tuple: (plain_text, entities) or (plain_text, None) if validation fails
        """
        lines = []
        
        # Add hashtags line
        if hashtags := msg_info.get('hashtags'):
            lines.append(format_hashtags_for_telegram(hashtags))
        
        # Add title line (with fire emoji)
        if title := msg_info.get('title'):
            lines.append(f"🔥 ***{title}***")  # Add bold+italic markdown
        
        # Add description_md with blank line separator
        if description_md := msg_info.get('description_md'):
            if lines:
                lines.append('')
            lines.append(description_md)
        
        # Build final text
        final_text = '\n'.join(lines)
        
        # Convert Markdown to entities
        plain_text, entities = markdown_to_telegram_entities(final_text)
        
        # CRITICAL FIX: Adjust entities to remove leading/trailing newlines
        # The markdown_to_telegram_entities() creates entities that may start with \n
        # just like Telegram does, so we need to clean them the same way we do during fetch
        if entities:
            entities = adjust_entity_offsets(plain_text, entities)
        
        # Validate entities
        is_valid, error_msg = self._validate_reconstructed_entities(plain_text, entities)
        if not is_valid:
            print(f"⚠️  Validation failed: {error_msg}")
            print("   Falling back to plain text without formatting")
            return plain_text, None
        
        return plain_text, entities
    
    def _build_message_content_as_messages(self, msg_info):
        """
        Build message text for "Msgs" action - simpler formatting like chat messages.
        
        Format:
        - Hashtags (if any)
        - Title and description combined (no emoji, no bold/italic, no blank line)
        - Username/author as blockquote at the end
        
        Args:
            msg_info (dict): Message information from spreadsheet
        
        Returns:
            tuple: (plain_text, entities) or (plain_text, None) if validation fails
        """
        lines = []
        
        # Add hashtags line (if any)
        if hashtags := msg_info.get('hashtags'):
            lines.append(format_hashtags_for_telegram(hashtags))
        
        # Combine title and description WITHOUT emoji and formatting
        content_parts = []
        
        if title := msg_info.get('title'):
            content_parts.append(title)  # Plain title, no fire emoji, no bold
        
        if description_md := msg_info.get('description_md'):
            content_parts.append(description_md)
        
        # Join title and description on same line or with newline if both exist
        if content_parts:
            # If we have both title and description, separate with newline
            # If only one, just add it
            if len(content_parts) == 2:
                lines.append(content_parts[0])  # Title
                lines.append(content_parts[1])  # Description
            else:
                lines.append(content_parts[0])
        
        # Add author/username as hashtag at the end (after blank line)
        author = msg_info.get('author', '').strip()
        
        if author:
            # Extract username from "Name (@username)" format or use author as-is
            username = None
            
            # Check if author contains (@username) pattern
            if '(@' in author and ')' in author:
                import re
                match = re.search(r'\(@(\w+)\)', author)
                if match:
                    username = match.group(1)  # Extract username without @
            
            # Use username if available, otherwise use full author name
            if username:
                lines.append('')  # Add blank line before author hashtag
                lines.append(f"#{username}")
            else:
                # Author might be just a name without username - convert to hashtag-safe format
                # Replace spaces and special characters with underscores
                import re
                hashtag_author = re.sub(r'[^A-Za-z0-9_]', '_', author)
                lines.append('')  # Add blank line before author hashtag
                lines.append(f"#{hashtag_author}")
        
        # Build final text (with blank line before author hashtag)
        final_text = '\n'.join(lines)
        
        # Convert Markdown to entities
        plain_text, entities = markdown_to_telegram_entities(final_text)
        
        # Adjust entities
        if entities:
            entities = adjust_entity_offsets(plain_text, entities)
        
        # Validate entities
        is_valid, error_msg = self._validate_reconstructed_entities(plain_text, entities)
        if not is_valid:
            print(f"⚠️  Validation failed: {error_msg}")
            print("   Falling back to plain text without formatting")
            return plain_text, None
        
        return plain_text, entities
    
    def _validate_reconstructed_entities(self, text, entities):
        """
        Validate reconstructed message entities before sending.
        
        Args:
            text (str): Reconstructed message text
            entities (list): Telegram entities
        
        Returns:
            tuple: (is_valid, error_message)
        """
        if not entities:
            return True, None
        
        validation = validate_entity_positions(text, entities)
        
        if not validation['valid']:
            error_msg = "Entity validation failed: " + "; ".join(validation['errors'])
            return False, error_msg
        
        # Show warnings but don't fail
        for warning in validation.get('warnings', []):
            print(f"  ⚠️  {warning}")
        
        return True, None
    
    def _validate_edit_data(self, msg_info):
        """
        Validate message data before editing.
        
        Args:
            msg_info (dict): Message information from spreadsheet
        
        Returns:
            tuple: (is_valid, error_message)
        """
        # Check if we have at least something to edit
        has_content = any([
            msg_info.get('hashtags'),
            msg_info.get('title'),
            msg_info.get('description_md')
        ])
        
        if not has_content:
            return False, "No content to edit (hashtags, title, and description_md are all empty)"
        
        # Validate using centralized validator
        validation = validate_text_parts(
            msg_info.get('hashtags', ''),
            msg_info.get('title', ''),
            msg_info.get('description_md', '')
        )
        
        if not validation['valid']:
            return False, f"Validation failed: {'; '.join(validation['errors'])}"
        
        # Show warnings if any
        for warning in validation.get('warnings', []):
            print(f"⚠️  Warning: {warning}")
        
        return True, None
    
    def _validate_post_comment_data(self, msg_info):
        """
        Validate message data before posting as comment.
        
        Args:
            msg_info (dict): Message information from spreadsheet
        
        Returns:
            tuple: (is_valid, error_message)
        """
        # Check destination exists and is valid format
        destination = msg_info.get('destination', '').strip()
        if not destination:
            return False, "Destination is empty (need channel_id:post_id format or Telegram link)"
        
        # Validate destination format
        try:
            self._parse_target_post(destination)
        except ValueError as e:
            return False, str(e)
        
        # Check if we have at least something to post as comment
        has_content = any([
            msg_info.get('hashtags'),
            msg_info.get('title'),
            msg_info.get('description_md')
        ])
        
        if not has_content:
            return False, "No content to post (hashtags, title, and description_md are all empty)"
        
        # Validate using centralized validator
        validation = validate_text_parts(
            msg_info.get('hashtags', ''),
            msg_info.get('title', ''),
            msg_info.get('description_md', '')
        )
        
        if not validation['valid']:
            return False, f"Content validation failed: {'; '.join(validation['errors'])}"
        
        # Show warnings if any
        for warning in validation.get('warnings', []):
            print(f"⚠️  Warning: {warning}")
        
        return True, None
    
    async def _retry_with_backoff(self, operation, max_retries=3, operation_name="Operation"):
        """
        Generic retry wrapper with exponential backoff.
        
        Args:
            operation: Async callable to execute
            max_retries (int): Maximum retry attempts
            operation_name (str): Name for logging
        
        Returns:
            Operation result or None on failure
        """
        for attempt in range(max_retries):
            try:
                return await operation()
            
            except FloodWaitError as e:
                if attempt < max_retries - 1:
                    print(f"⏳ Rate limited. Waiting {e.seconds}s...")
                    await asyncio.sleep(e.seconds)
                else:
                    print(f"✗ {operation_name} failed: Rate limit exceeded")
                    return None
            
            except MessageNotModifiedError:
                # Special case: message unchanged is not an error
                print(f"ℹ️  Message was not modified (content unchanged)")
                return {'success': True, 'author': ''}
            
            except Exception as e:
                if attempt < max_retries - 1:
                    wait_time = 2 ** attempt
                    print(f"⚠️  Attempt {attempt + 1} failed: {str(e)}")
                    print(f"   Retrying in {wait_time}s...")
                    await asyncio.sleep(wait_time)
                else:
                    print(f"✗ {operation_name} failed: {str(e)}")
                    return None
        
        return None
    
    def _get_author_from_message(self, message):
        """
        Extract author name from message.
        
        Args:
            message: Telegram message object
        
        Returns:
            str: Author name or empty string
        """
        if not message:
            return ''
        
        if message.post_author:
            return message.post_author
        
        if message.sender:
            author = getattr(message.sender, 'first_name', '')
            last_name = getattr(message.sender, 'last_name', '')
            if last_name:
                author += f" {last_name}"
            return author
        
        return ''
    
    # ==================== ACTION METHODS ====================
    
    async def _transfer_message(self, msg_info, destination_channel_id, reply_to_post_id=None, topic_id=None, max_retries=3):
        """
        Transfer message to destination channel with Markdown formatting.
        Supports optional scheduling via Telegram's native scheduling feature.
        Optionally post as reply to a specific post.
        
        Args:
            msg_info (dict): Message information from spreadsheet
            destination_channel_id (int): Destination channel ID
            reply_to_post_id (int, optional): Post ID to reply to (for Post_Comment mode)
            max_retries (int): Maximum number of retry attempts
        
        Returns:
            dict: {
                'id': int - New message ID,
                'scheduled': bool - Whether message was scheduled,
                'scheduled_time': str - Formatted time (if scheduled)
            }
            None: If transfer failed
        """
        channel_id, message_id = self._parse_message_id(msg_info['id'])
        
        # Parse scheduled time if provided
        schedule_timestamp = None
        scheduled_time_str = msg_info.get('scheduled_time', '').strip()
        
        if scheduled_time_str:
            try:
                schedule_timestamp = google_sheets_helper.parse_scheduled_time(scheduled_time_str)
                if schedule_timestamp:
                    formatted_time = google_sheets_helper.format_scheduled_time_for_display(schedule_timestamp)
                    print(f"  📅 Will schedule for: {formatted_time}")
            except ValueError as e:
                print(f"  ⚠️  Scheduled time error: {e}")
                print(f"     Will send immediately instead")
                schedule_timestamp = None
        
        async def transfer_op():
            # Get source message
            source_message = await self.client.get_messages(channel_id, ids=message_id)
            
            if not source_message:
                print(f"✗ Message {message_id} not found in source channel")
                return None
            
            # Check if this message is part of a grouped media (photo album)
            # If so, fetch all messages in the group
            media = None
            if hasattr(source_message, 'grouped_id') and source_message.grouped_id is not None:
                # Only reconstruct as album for PHOTOS.
                # Documents, videos, audio, etc. are always sent one-by-one.
                is_photo = _is_photo_media(source_message.media)

                if not config.RECONSTRUCT_GROUPED_MEDIA_AS_ALBUM or not is_photo:
                    # INDIVIDUAL MODE: Send only this single item
                    # (always used for non-photo media regardless of config)
                    print(f"  📷 Grouped media detected (grouped_id: {source_message.grouped_id})")
                    if not is_photo:
                        print(f"  ℹ️  Non-photo media (document/video/audio) → Sending individually")
                    else:
                        print(f"  ℹ️  Individual mode enabled → Sending only this item")
                    media = source_message.media if source_message.media and source_message.media.__class__.__name__ != 'MessageMediaWebPage' else None
                else:
                    # ALBUM MODE: Photos only — reconstruct full group and send as album
                    print(f"  📸 Detected photo group (grouped_id: {source_message.grouped_id})")
                    
                    # Fetch a range of messages around this one to find all group members
                    # We'll fetch 20 messages before and after to ensure we get the whole group
                    start_id = max(1, message_id - 20)
                    end_id = message_id + 20
                    
                    nearby_messages = await self.client.get_messages(
                        channel_id, 
                        min_id=start_id - 1,
                        max_id=end_id + 1,
                        limit=50
                    )
                    
                    # Filter messages with the same grouped_id
                    grouped_messages = [
                        msg for msg in nearby_messages 
                        if hasattr(msg, 'grouped_id') and msg.grouped_id == source_message.grouped_id
                    ]
                    
                    # Sort by message ID to maintain order
                    grouped_messages.sort(key=lambda x: x.id)
                    
                    if len(grouped_messages) > 1:
                        # Multiple messages in group - collect all media
                        media = [msg.media for msg in grouped_messages if msg.media and msg.media.__class__.__name__ != 'MessageMediaWebPage']
                        print(f"  📸 Found {len(media)} items in group - will send as album")
                    else:
                        # Only one message found (shouldn't happen, but handle it)
                        media = source_message.media if source_message.media and source_message.media.__class__.__name__ != 'MessageMediaWebPage' else None
            else:
                # Single message, not grouped
                media = source_message.media if source_message.media and source_message.media.__class__.__name__ != 'MessageMediaWebPage' else None
            
            # Build message content (check for Msgs action)
            if 'Msgs' in msg_info.get('actions', []):
                plain_text, entities = self._build_message_content_as_messages(msg_info)
            else:
                plain_text, entities = self._build_message_content(msg_info)
            
            # Determine reply_to parameter
            # For forums: use topic_id as reply_to to post in that topic
            # For Post_Comment: use reply_to_post_id to reply to a specific post
            # For nested Msgs: preserve reply within group
            final_reply_to = None
            
            # Check if this message has a nested reply (from Tags column)
            # Supports two formats:
            #   Reply(MESSAGE_ID) - Simple reply to message
            #   Reply(TOPIC_ID:MESSAGE_ID) - Reply to message in forum topic
            nested_reply_id = None
            reply_topic_id = None
            
            if tags := msg_info.get('tags', ''):
                import re
                
                # Try to match Reply(TOPIC_ID:MESSAGE_ID) format first
                reply_match_forum = re.search(r'Reply\((\d+):(\d+)\)', tags)
                if reply_match_forum:
                    reply_topic_id = int(reply_match_forum.group(1))
                    nested_reply_id = int(reply_match_forum.group(2))
                    
                    # Check if replying to topic post itself or to a message
                    if reply_topic_id == nested_reply_id:
                        # Reply(15909:15909) - Replying to the topic post
                        final_reply_to = topic_id if topic_id else nested_reply_id
                        print(f"  📁 Posting to forum topic {reply_topic_id}")
                    else:
                        # Reply(15909:15923) - Replying to specific message in topic
                        final_reply_to = nested_reply_id
                        print(f"  💬 Replying to message {nested_reply_id} in topic {reply_topic_id}")
                else:
                    # Try simple Reply(ID) format
                    reply_match = re.search(r'Reply\((\d+)\)', tags)
                    if reply_match:
                        nested_reply_id = int(reply_match.group(1))
                        final_reply_to = nested_reply_id
                        print(f"  💬 Replying to message {nested_reply_id}")
            
            # Fallback to topic_id or reply_to_post_id if no Reply tag
            if final_reply_to is None:
                if topic_id:
                    # Forum mode: post in topic
                    final_reply_to = topic_id
                    print(f"  📁 Posting to forum topic {topic_id}")
                elif reply_to_post_id:
                    # Post_Comment mode: reply to post
                    final_reply_to = reply_to_post_id
            
            # # Send to destination (with optional scheduling and reply_to)
            if media:
                sent_message = await self.client.send_message(
                    entity=destination_channel_id,
                    message=plain_text,
                    file=media,
                    formatting_entities=entities,
                    schedule=schedule_timestamp,
                    reply_to=final_reply_to
                )
            else:
                sent_message = await self.client.send_message(
                    entity=destination_channel_id,
                    message=plain_text,
                    formatting_entities=entities,
                    schedule=schedule_timestamp,
                    reply_to=final_reply_to
                )
            
            if sent_message:
                # Handle both single message and album (list of messages)
                # When sending multiple photos as album, Telethon returns a list
                if isinstance(sent_message, list):
                    # Album sent - use the first message ID as reference
                    first_msg = sent_message[0]
                    message_id_to_return = first_msg.id
                    # Extract peer_id from the sent message
                    peer_id = first_msg.peer_id.channel_id if hasattr(first_msg.peer_id, 'channel_id') else None
                    print(f"  📸 Album sent with {len(sent_message)} photos (IDs: {first_msg.id}-{sent_message[-1].id})")
                else:
                    # Single message sent
                    message_id_to_return = sent_message.id
                    # Extract peer_id from the sent message
                    peer_id = sent_message.peer_id.channel_id if hasattr(sent_message.peer_id, 'channel_id') else None
                
                info_parts = []
                
                if topic_id:
                    info_parts.append(f"topic {topic_id}")
                if reply_to_post_id:
                    info_parts.append(f"reply to {reply_to_post_id}")
                
                info_str = f" ({', '.join(info_parts)})" if info_parts else ""
                
                await asyncio.sleep(config.TELEGRAM_ACTION_DELAY)  # Rate limit protection
                if schedule_timestamp:
                    formatted_time = google_sheets_helper.format_scheduled_time_for_display(schedule_timestamp)
                    print(f"✓ Scheduled message {message_id} → {message_id_to_return}{info_str} for {formatted_time}")
                    return {
                        'id': message_id_to_return,
                        'scheduled': True,
                        'scheduled_time': formatted_time,
                        'topic_id': topic_id,
                        'peer_id': peer_id
                    }
                else:
                    print(f"✓ Transferred message {message_id} → {message_id_to_return}{info_str}")
                    return {
                        'id': message_id_to_return,
                        'scheduled': False,
                        'topic_id': topic_id,
                        'peer_id': peer_id
                    }
            
            return None
        
        return await self._retry_with_backoff(transfer_op, max_retries, "Transfer")
    
    async def _delete_message(self, msg_info, max_retries=3):
        """
        Delete message from source channel with retry logic.
        
        Args:
            msg_info (dict): Message information from spreadsheet
            max_retries (int): Maximum number of retry attempts
        
        Returns:
            bool: True if successful, False otherwise
        """
        channel_id, message_id = self._parse_message_id(msg_info['id'])
        
        async def delete_op():
            await self.client.delete_messages(channel_id, message_id)
            print(f"✓ Deleted message {message_id} from channel {channel_id}")
            return True
        
        result = await self._retry_with_backoff(delete_op, max_retries, "Delete")
        return result is not None
    
    async def _edit_message(self, msg_info, max_retries=3):
        """
        Edit message with Markdown formatting.
        
        Args:
            msg_info (dict): Message information from spreadsheet
            max_retries (int): Maximum number of retry attempts
        
        Returns:
            dict: {'success': bool, 'author': str}
        """
        # Validate data
        is_valid, error_msg = self._validate_edit_data(msg_info)
        if not is_valid:
            print(f"✗ Edit validation failed: {error_msg}")
            return {'success': False, 'author': ''}
        
        channel_id, message_id = self._parse_message_id(msg_info['id'])
        
        async def edit_op():
            # Build message content (check for Msgs action)
            if 'Msgs' in msg_info.get('actions', []):
                plain_text, entities = self._build_message_content_as_messages(msg_info)
            else:
                plain_text, entities = self._build_message_content(msg_info)
            
            # Edit message
            await self.client.edit_message(
                entity=channel_id,
                message=message_id,
                text=plain_text,
                formatting_entities=entities
            )
            
            # Fetch updated message to get author
            updated_msg = await self.client.get_messages(channel_id, ids=message_id)
            author = self._get_author_from_message(updated_msg)
            
            print(f"✓ Edited message {message_id}")
            return {'success': True, 'author': author}
        
        result = await self._retry_with_backoff(edit_op, max_retries, "Edit")
        return result if result else {'success': False, 'author': ''}
    
    async def _edit_clear_message(self, msg_info, max_retries=3):
        """
        Clear the caption/description of a Telegram message (set to empty text).

        Works on any message that has a caption (photo, video, document)
        or a text-only message. Sets the text to empty string.

        Args:
            msg_info (dict): Message information from spreadsheet

        Returns:
            dict: {'success': bool}
        """
        channel_id, message_id = self._parse_message_id(msg_info['id'])

        async def clear_op():
            await self.client.edit_message(
                entity=channel_id,
                message=message_id,
                text='',
                formatting_entities=[]
            )
            print(f"✓ Cleared caption/description of message {message_id}")
            return {'success': True}

        result = await self._retry_with_backoff(clear_op, max_retries, "Edit_Clear")
        if result:
            return result
        print(f"✗ Edit_Clear failed for message {message_id}")
        return {'success': False}

    async def _add_comment(self, msg_info, max_retries=3):
        """
        Add comment/reply to message.
        
        Args:
            msg_info (dict): Message information from spreadsheet
            max_retries (int): Maximum number of retry attempts
        
        Returns:
            bool: True if successful, False otherwise
        """
        # Validate extra_msg
        extra_msg = msg_info.get('extra_msg', '').strip()
        if not extra_msg:
            print(f"✗ Add_Comment failed: Extra_Msg is empty")
            return False
        
        channel_id, message_id = self._parse_message_id(msg_info['id'])
        
        async def comment_op():
            # Verify original message exists
            original_msg = await self.client.get_messages(channel_id, ids=message_id)
            
            if not original_msg:
                print(f"✗ Original message {message_id} not found")
                return None
            
            # Send reply
            sent_comment = await self.client.send_message(
                entity=channel_id,
                message=extra_msg,
                reply_to=message_id
            )
            
            if sent_comment:
                print(f"✓ Added comment to message {message_id} (comment ID: {sent_comment.id})")
                return True
            
            return None
        
        result = await self._retry_with_backoff(comment_op, max_retries, "Add_Comment")
        return result is not None
    
    async def _add_message_before(self, msg_info, destination_channel_id, topic_id=None, max_retries=3):
        """
        Send Extra_Msg as separate message before transfer.
        
        Args:
            msg_info (dict): Message information from spreadsheet
            destination_channel_id (int): Destination channel ID
            topic_id (int, optional): Forum topic ID to post in
            max_retries (int): Maximum number of retry attempts
        
        Returns:
            int or None: Sent message ID if successful, None otherwise
        """
        # Validate extra_msg
        extra_msg = msg_info.get('extra_msg', '').strip()
        if not extra_msg:
            print(f"✗ Add_Msg_before failed: Extra_Msg is empty")
            return None
        
        async def send_op():
            sent_msg = await self.client.send_message(
                entity=destination_channel_id,
                message=extra_msg,
                reply_to=topic_id  # Posts into forum topic when set
            )
            
            if sent_msg:
                print(f"✓ Sent Extra_Msg before transfer (ID: {sent_msg.id})")
                return sent_msg.id
            
            return None
        
        return await self._retry_with_backoff(send_op, max_retries, "Add_Msg_before")
    
    # ==================== EXECUTION ORCHESTRATION ====================
    

    # ==================== PUB_LNK HELPER METHODS ====================
    
    async def _handle_pub_lnk_after_transfer(self, transferred_messages, stats):
        """
        Handle Pub_lnk action after transferring messages.
        
        This method is called after all transfers are complete to create
        a combined publication link post for transferred messages.
        
        Args:
            transferred_messages (list): List of dicts with:
                - row_num: Original row number
                - title: Message title
                - new_message_link: New message link after transfer
                - destination: Destination channel
                - extra_msg: Title for pub_lnk post (from first message only)
            stats (dict): Statistics dictionary to update
        
        Returns:
            list: List of update dicts for spreadsheet
        """
        if not transferred_messages:
            return []
        
        print(f"\n{'='*60}")
        print(f"📋 Processing Pub_lnk for {len(transferred_messages)} transferred messages")
        
        # Get destination and title from first message
        first_msg = transferred_messages[0]
        destination = first_msg['destination']
        
        # Extract topic_id (forum) and optional post reply
        has_post_comment = 'Post_Comment' in first_msg.get('original_actions', [])
        reply_to_post_id = None
        topic_id = None
        
        # Always check for forum topic in destination URL
        try:
            parsed = parse_forum_url(destination)
            if parsed and parsed.get('topic_id'):
                topic_id = parsed['topic_id']
                print(f"  📁 Pub_lnk will be posted in forum topic {topic_id}")
        except Exception:
            pass
        
        if has_post_comment:
            # Extract post ID from destination for reply mode
            try:
                channel_id, post_id = self._parse_target_post(destination)
                reply_to_post_id = post_id
                print(f"  💬 Pub_lnk will be posted as REPLY to post {post_id} (Post_Comment mode)")
            except ValueError:
                print(f"  ⚠️  Post_Comment present but destination has no post ID")
                print(f"     Pub_lnk will be posted as standalone")
        
        # Get post title from the message that has extra_msg (should be first)
        post_title = ''
        for msg in transferred_messages:
            if msg.get('extra_msg', '').strip():
                post_title = msg['extra_msg'].strip()
                break
        
        if not post_title:
            post_title = first_msg.get('extra_msg', '').strip()
        
        # Validate title
        if not post_title:
            print("⚠️  Warning: First message has no Extra_Msg for Pub_lnk title")
            print("    Using default title: 'Publications'")
            post_title = "Publications"
        
        # Build publications list
        publications = []
        for msg in transferred_messages:
            if msg.get('title') and msg.get('new_message_link'):
                # Clean title based on actions (Remove_Num, Punct_)
                # Get actions from the message (first message has them, followers inherit)
                actions = msg.get('original_actions', [])
                cleaned_title = clean_title(msg['title'].strip(), actions)
                
                publications.append({
                    'title': cleaned_title,
                    'link': msg['new_message_link']
                })
        
        if not publications:
            print("✗ No valid publications found (missing titles or links)")
            return []
        
        # Build pub_lnk_data structure
        pub_lnk_data = {
            'valid': True,
            'title': post_title,
            'destination': destination,
            'publications': publications,
            'actions': first_msg.get('original_actions', []),
            'pub_lnk_token': first_msg.get('pub_lnk_token', ''),
        }
        
        # Send Pub_lnk post (with optional reply_to)
        # Note: reply_to_post_id is already set above if Post_Comment is present
        sent_id = await self._send_pub_lnk_post(pub_lnk_data, reply_to_post_id=reply_to_post_id, topic_id=topic_id)
        
        # Prepare spreadsheet updates
        updates = []
        
        if sent_id:
            stats['pub_lnk_posts'] = stats.get('pub_lnk_posts', 0) + 1
            stats['pub_lnk_pubs'] = stats.get('pub_lnk_pubs', 0) + len(publications)
            
            # Mark all rows as Done and propagate the group title to Extra_Msg
            group_title = post_title  # already resolved above
            for msg in transferred_messages:
                updates.append({
                    'row_num': msg['row_num'],
                    'action': 'Done',
                    'destination': '',
                    'extra_msg': group_title,  # propagate title to all rows
                    'scheduled_time': ''
                })
        else:
            stats['errors'] = stats.get('errors', 0) + 1
            # Mark first row with error
            updates.append({
                'row_num': transferred_messages[0]['row_num'],
                'action': 'ERROR: Pub_lnk post failed to send after transfer',
                'destination': '',
                'extra_msg': '',
                'scheduled_time': ''
            })
        
        return updates

    
    def _validate_pub_lnk_data(self, pub_lnk_data):
        """
        Validate Pub_lnk data from google_sheets_helper.
        
        Args:
            pub_lnk_data (dict): Data from get_pub_lnk_messages()
        
        Returns:
            tuple: (is_valid, error_message)
        """
        if not pub_lnk_data.get('valid'):
            return False, pub_lnk_data.get('error', 'Unknown validation error')
        
        if not pub_lnk_data.get('publications'):
            return False, "No publications found"
        
        return True, None
    

    @staticmethod
    def _parse_pub_lnk_token(token):
        """
        Parse 'Pub_lnk[opt1,opt2,...]' → dict of options.
        Returns:
          {
            'punct': None | '' | 'emoji ',   # None=default dash
            'num': None | 'remove' | 'sequence',
            'joinus_tag': None | 'Joinus_...',
          }
        """
        import re as _re
        # Use rindex(']') so nested brackets like Joinus_CHN_LNK[Cmts] are included
        _lbracket = token.find('[')
        _rbracket = token.rindex(']') if ']' in token else -1
        opts_str = token[_lbracket+1:_rbracket] if _lbracket != -1 and _rbracket > _lbracket else ''
        result = {'punct': None, 'num': None, 'joinus_tag': None, 'joinus_cmts': False}
        for opt in opts_str.split(','):
            opt = opt.strip()
            if not opt:
                continue
            ol = opt.lower()
            if ol.startswith('punct_'):
                # Punct__ → '' (no dash), Punct_🔥_ → '🔥 '
                inner = opt[6:-1] if opt.endswith('_') else ''
                result['punct'] = (inner + ' ') if inner else ''
            elif ol.startswith('num_sequence'):
                result['num'] = 'sequence'
            elif ol.startswith('num_remove') or ol == 'num__':
                result['num'] = 'remove'
            elif ol.startswith('joinus_'):
                # Check for joinus_CHN_LNK[Cmts] → append Join Us to each comment too
                if '[cmts]' in ol:
                    result['joinus_cmts'] = True
                    # Strip the [Cmts] suffix before storing the tag
                    import re as _re2
                    opt = _re2.sub(r'\[Cmts\]', '', opt, flags=_re2.IGNORECASE).strip()
                result['joinus_tag'] = opt
        return result

    @staticmethod
    def _apply_pub_lnk_label(title, opts, index=None):
        """
        Return (prefix, clean_label) for a pub_lnk entry.
        prefix goes OUTSIDE the markdown link, clean_label is the clickable text.
        e.g. Num_Sequence_ → ('1. ', 'Title') so result is: 1. [Title](url)
        """
        import re as _re
        clean = _re.sub(r'^[\d\s\-\.\u2013\u2014]+', '', title.strip()).strip()
        if not clean:
            clean = title.strip()
        punct = opts.get('punct')
        num   = opts.get('num')
        if num == 'sequence' and index is not None:
            prefix = f"{index:02d}. "
        elif punct is None:
            prefix = '- '
        elif punct == '':
            prefix = ''
        else:
            prefix = punct
        return prefix, clean


    # ------------------------------------------------------------------ #
    #  Part-grouping helpers (injected by autofix_pub_lnk_combine_parts)  #
    # ------------------------------------------------------------------ #

    @staticmethod
    def _extract_part_number(title: str):
        """
        Detect a part-indicator in *title* and return
        (base_title, part_number_int, short_label) or (None, None, None).

        Recognised patterns (case-insensitive):
          "Title P1"                  -> base="Title",          num=1
          "Title P1 (Suffix)"         -> base="Title (Suffix)", num=1
          "Title part 1"              -> base="Title",          num=1
          "Title Pt 01 (Author)"      -> base="Title (Author)", num=1
          "Title partie I"            -> base="Title",          num=1
          "Title (Pt 3)"              -> base="Title",          num=3
          Also: ep, episode, vol, volume, ch, chapter, s (season)
        """
        import re as _re

        ROMAN = {
            'I':1,'II':2,'III':3,'IV':4,'V':5,'VI':6,'VII':7,
            'VIII':8,'IX':9,'X':10,'XI':11,'XII':12,'XIII':13,
            'XIV':14,'XV':15,'XVI':16,'XVII':17,'XVIII':18,
            'XIX':19,'XX':20
        }

        _SEP = r'[\s\-\u2013\u2014:,|/\\]*'
        _NUM = r'(\d{1,3}|[IVX]{1,8})'
        _KW  = (r'(?:parties?|parts?|pt|p|\u00e9pisodes?|episodes?|ep|'
                r'volumes?|vol|chapitres?|chapters?|ch|saisons?|seasons?|s)')

        # Pattern A: indicator inside trailing parens -- "Title (Pt 3)"
        PAT_PAREN = _re.compile(
            rf'\(\s*(?:{_KW}){_SEP}{_NUM}\s*\)\s*$',
            _re.IGNORECASE
        )
        # Pattern B: indicator before optional trailing parenthetical
        #   "Title P1"              -> suffix=None
        #   "Title P1 (Pr Mehdadi)" -> suffix="(Pr Mehdadi)"
        PAT_MID = _re.compile(
            rf'{_SEP}(?:{_KW}){_SEP}{_NUM}\s*(\([^)]*\))?\s*$',
            _re.IGNORECASE
        )
        # Pattern C (highest priority): indicator wrapped in quotes at end
        #   'Title P21 "partie 1"'  or  "Title P21 'partie 2'"
        _Q = r'["\'\u00ab\u00bb\u201c\u201d\u2018\u2019]'
        PAT_QUOTED = _re.compile(
            rf'{_Q}\s*(?:{_KW}){_SEP}{_NUM}\s*{_Q}?\s*$',
            _re.IGNORECASE
        )

        for pat, keep_suffix in ((PAT_QUOTED, False), (PAT_PAREN, False), (PAT_MID, True)):
            m = pat.search(title)
            if not m:
                continue
            raw_num = m.group(1)
            if raw_num.upper() in ROMAN:
                part_num = ROMAN[raw_num.upper()]
            else:
                try:
                    part_num = int(raw_num)
                except ValueError:
                    continue

            base_raw = title[:m.start()].strip().rstrip(':-\u2013\u2014,|').strip()
            if not base_raw:
                continue

            if keep_suffix:
                suffix = (m.group(2) or '').strip() if m.lastindex and m.lastindex >= 2 else ''
                base = (base_raw + ' ' + suffix).strip() if suffix else base_raw
            else:
                base = base_raw

            return base, part_num, f"Pt {part_num}"

        return None, None, None

    @staticmethod
    def _group_parts(publications: list) -> list:
        """
        Scan *publications* (list of {'title':…, 'link':…}) for runs of
        entries that share the same base title with consecutive part numbers.
        A "run" must have ≥ 2 entries AND the part numbers must be consecutive
        starting from any value (e.g. 1,2,3  or  2,3  are valid; 1,3 is not).

        Entries NOT belonging to a multi-part group are returned as-is.
        Entries belonging to a group are collapsed into a single dict:
          {
            'title': 'MainTitle',
            'link' : None,          ← no single link; use 'parts' instead
            'parts': [
               {'label': 'Pt 1', 'link': '…'},
               {'label': 'Pt 2', 'link': '…'},
            ]
          }

        The output preserves the original ordering: the group entry appears
        at the position of the FIRST member of the group.
        """
        # Step 1 – annotate each entry
        annotated = []
        for pub in publications:
            base, num, label = ActionExecutor._extract_part_number(pub['title'])
            annotated.append({
                'pub':   pub,
                'base':  base,
                'num':   num,
                'label': label,
            })

        # Step 2 – find contiguous runs with same base and consecutive nums
        result = []
        i = 0
        while i < len(annotated):
            a = annotated[i]
            if a['base'] is None:
                # No part-number detected
                result.append(a['pub'])
                i += 1
                continue

            # Try to extend a run
            run = [a]
            j = i + 1
            while j < len(annotated):
                b = annotated[j]
                if (b['base'] is not None
                        and b['base'].lower() == run[-1]['base'].lower()
                        and b['num'] == run[-1]['num'] + 1):
                    run.append(b)
                    j += 1
                else:
                    break

            if len(run) >= 2:
                # Collapse into one group entry
                parts = [{'label': r['label'], 'link': r['pub']['link']}
                         for r in run]
                result.append({
                    'title': run[0]['base'],
                    'link':  None,
                    'parts': parts,
                })
                i = j
            else:
                # Only one entry with this base – treat as normal
                result.append(a['pub'])
                i += 1

        return result

    def _build_pub_lnk_post(self, publications, post_title, pub_lnk_token=None, joinus_name=None, joinus_link=None, actions=None):
        """
        Build the Pub_lnk post content.
        pub_lnk_token: e.g. 'Pub_lnk[Punct__,Num__,Joinus_CHN_LNK]'

        Format:
          #Pub_lnk
          🔥 ***title***

          {prefix}[clean label](link)
          ...
          (blank)
          > ***Join us ☛*** [***name***](url)
        """
        opts = self._parse_pub_lnk_token(pub_lnk_token or '')
        punct = opts.get('punct')   # None=default dash, ''=no prefix, 'x '=custom

        lines = []
        lines.append('#Pub_lnk    #ZED_MBset')
        lines.append(f'🔥 ***{post_title}***')
        lines.append('')

        grouped_pubs = self._group_parts(publications)
        seq_idx = 0  # separate counter for Num_Sequence (counts logical entries)
        for pub in grouped_pubs:
            seq_idx += 1
            if pub.get('parts'):
                # ── Multi-part entry ──
                main_title = pub['title']
                prefix, clean_main = self._apply_pub_lnk_label(main_title, opts, index=seq_idx)
                # Build inline part links:  [Pt 1](link1), [Pt 2](link2), ...
                part_links = ' - '.join(
                    f"[{p['label']}]({p['link']})" for p in pub['parts']
                )
                lines.append(f"{prefix}{clean_main}: {part_links}")
            else:
                prefix, clean = self._apply_pub_lnk_label(pub['title'], opts, index=seq_idx)
                lines.append(f"{prefix}[{clean}]({pub['link']})")

        # Append Join Us line
        if joinus_name and joinus_link:
            lines.append('')
            lines.append(f"> ***Join us ☛*** [***{joinus_name}***]({joinus_link})")

        markdown_text = '\n'.join(lines)
        plain_text, entities = markdown_to_telegram_entities(markdown_text)
        if entities:
            entities = adjust_entity_offsets(plain_text, entities)
        return plain_text, entities

    async def _send_pub_lnk_post(self, pub_lnk_data, reply_to_post_id=None, topic_id=None, max_retries=3):
        """
        Send the combined Pub_lnk post to destination channel.
        Optionally post as reply to a specific post.
        
        Args:
            pub_lnk_data (dict): Validated Pub_lnk data
            reply_to_post_id (int, optional): Post ID to reply to (for Post_Comment mode)
            max_retries (int): Maximum retry attempts
        
        Returns:
            int or None: Sent message ID if successful, None otherwise
        """
        # Get destination channel
        dest_channel = self._get_destination_channel(
            config.SPREADSHEET_ID,
            pub_lnk_data['destination']
        )
        
        if not dest_channel:
            print(f"✗ Destination channel '{pub_lnk_data['destination']}' not found")
            return None
        
        # Handle both numeric IDs and username strings
        channel_id_value = dest_channel['id']
        if _is_numeric_channel_id(channel_id_value):
            dest_channel_id = int(channel_id_value)
        else:
            dest_channel_id = channel_id_value

        # Resolve invite hash (+HASH) or username string to numeric ID
        if isinstance(dest_channel_id, str):
            try:
                if dest_channel_id.startswith('+'):
                    # Use cached helper — avoids repeated CheckChatInviteRequest
                    # calls that trigger FloodWait when processing large groups.
                    resolved = await self._resolve_invite_link(dest_channel_id)
                    dest_channel['id']       = str(resolved['id'])
                    dest_channel['name']     = resolved['name'] or dest_channel.get('name', '')
                    dest_channel['username'] = resolved['username']
                    dest_channel_id          = resolved['id']
                else:
                    ent = await self.client.get_entity(dest_channel_id)
                    real_id = int(f"-100{ent.id}") if ent.id > 0 else ent.id
                    print(f"  🔍 Resolved @{dest_channel_id} → numeric ID: {real_id}")
                    dest_channel['id']       = str(real_id)
                    dest_channel['name']     = getattr(ent, 'title', '') or dest_channel.get('name', '')
                    dest_channel['username'] = getattr(ent, 'username', '') or dest_channel_id
                    dest_channel_id = real_id
            except Exception as e:
                print(f"  ✗ Could not resolve Pub_lnk destination '{dest_channel_id}': {e}")
                return None

        # Build post content
        pub_lnk_token = pub_lnk_data.get('pub_lnk_token', '')
        opts = self._parse_pub_lnk_token(pub_lnk_token)

        # Resolve Joinus_ if present in token
        joinus_name = None
        joinus_link = None
        if opts.get('joinus_tag'):
            joinus_name, joinus_link = await self._resolve_joinus_tag(
                opts['joinus_tag'], dest_channel=dest_channel)
            if joinus_name and joinus_link:
                print(f"  ☛ Join Us: {joinus_name} → {joinus_link}")
            else:
                print("  ⚠️  Joinus_ tag present but could not resolve name/link")

        plain_text, entities = self._build_pub_lnk_post(
            pub_lnk_data['publications'],
            pub_lnk_data['title'],
            pub_lnk_token=pub_lnk_token,
            joinus_name=joinus_name,
            joinus_link=joinus_link,
        )
        
        # Define send operation
        async def send_op():
            sent_message = await self.client.send_message(
                entity=dest_channel_id,
                message=plain_text,
                formatting_entities=entities,
                link_preview=False,  # Disable link previews
                reply_to=topic_id if topic_id else reply_to_post_id  # forum topic > post reply
            )
            if sent_message:
                reply_info = f" as reply to {reply_to_post_id}" if reply_to_post_id else ""
                print(f"✓ Sent Pub_lnk post with {len(pub_lnk_data['publications'])} publications{reply_info} (ID: {sent_message.id})")
                return sent_message.id
            return None
        
        # Execute with retry
        return await self._retry_with_backoff(send_op, max_retries, "Pub_lnk")

    def _init_stats(self, total):
        """Initialize statistics dictionary."""
        return {
            'total': total,
            'transferred': 0,
            'scheduled': 0,
            'deleted': 0,
            'edited': 0,
            'cleared': 0,
            'updated': 0,
            'pub_lnk_posts': 0,
            'pub_lnk_pubs': 0,
            'post_comments': 0,
            'deleted_rows': 0,
            'errors': 0
        }
    
    def _get_destination_channel(self, spreadsheet_id, destination_name, fetch_metadata=True):
        """
        Get destination channel by name or Telegram link.
        
        Supports multiple formats:
        - Channel name: "My Channel" (looks up in spreadsheet)
        - Telegram link (private): "https://t.me/c/3138994143/2461" (extracts channel ID)
        - Telegram link (public): "https://t.me/ZEDP22MED" (extracts username)
        
        Args:
            spreadsheet_id (str): Spreadsheet ID
            destination_name (str): Channel name or Telegram link
        
        Returns:
            dict or None: Channel info or None if not found
                Format: {'id': str or int, 'name': str, ...}
        """
        # Parse destination to check if it's a link
        channel_id, is_link, channel_name, topic_id = self._parse_destination(destination_name)
        
        if is_link:
            # It's a Telegram link - channel_id could be numeric ID or username
            if isinstance(channel_id, int):
                # Private channel with numeric ID
                print(f"  📎 Detected private channel link → Channel ID: {channel_id}")
            else:
                # Public channel with username
                print(f"  📎 Detected public channel link → Username: @{channel_id}")
            
            # Try to get channel info using GID (only if metadata needed and it's a numeric ID)
            if fetch_metadata and isinstance(channel_id, int):
                try:
                    dest_channel = google_sheets_helper.get_channel_by_id(
                        config.SPREADSHEET_ID,  # Use main spreadsheet
                        channel_id,
                        gid=config.DEFAULT_CHANNELS_SHEET_GID  # Use GID: 1600911713
                    )
                    
                    if dest_channel:
                        print(f"  ✓ Found in channels sheet: {dest_channel['name']}")
                    else:
                        dest_channel = None
                except Exception as e:
                    # Lookup failed - this is OK
                    print(f"  ℹ Could not lookup channel (using ID directly)")
                    dest_channel = None
            else:
                # Skip metadata lookup (for usernames or when not needed)
                if not isinstance(channel_id, int):
                    print(f"  ⚡ Using username directly (no lookup needed)")
                else:
                    print(f"  ⚡ Skipping metadata lookup (not needed)")
                dest_channel = None
            
            if not dest_channel:
                # Use channel ID/username directly
                if isinstance(channel_id, int):
                    dest_channel = {
                        'id': str(channel_id),
                        'name': f"Channel_{channel_id}"
                    }
                elif isinstance(channel_id, str) and channel_id.startswith('+'):
                    # Invite link hash — stored as-is, resolved to numeric ID later
                    dest_channel = {
                        'id': channel_id,
                        'name': f"invite:{channel_id}"
                    }
                    print(f"  🔗 Invite link hash: {channel_id}")
                else:
                    # For usernames, use the username as ID (Telethon will resolve it)
                    dest_channel = {
                        'id': channel_id,  # This is the username string
                        'name': f"@{channel_id}"
                    }
        else:
            # It's a channel name - look it up in spreadsheet
            dest_channel = google_sheets_helper.get_channel_by_name(
                spreadsheet_id,
                channel_name
            )
            
            if not dest_channel:
                print(f"✗ Destination channel '{channel_name}' not found in spreadsheet")
                print(f"  💡 Tip: You can also use a Telegram link like https://t.me/USERNAME or https://t.me/c/CHANNEL_ID")
                return None
        
        dest_channel['topic_id'] = topic_id
        # Store the original destination string so _resolve_joinus_tag can
        # use the exact link the user typed (e.g. https://t.me/+HASH) instead
        # of generating a numeric fallback link
        if 'original_link' not in dest_channel:
            dest_channel['original_link'] = destination_name.strip() if destination_name else ''
        return dest_channel

    async def _handle_add_msg_before(self, msg_info, spreadsheet_id):
        """
        Handle Add_Msg_Before action.
        
        Returns:
            tuple: (success, error_message)
        """
        if not msg_info.get('destination'):
            return False, "Missing destination"
        
        # Check if Update action is present
        has_update = 'Update' in msg_info.get('actions', [])
        
        # Only fetch metadata if Update action present
        dest_channel = self._get_destination_channel(
            spreadsheet_id, 
            msg_info['destination'],
            fetch_metadata=has_update
        )
        if not dest_channel:
            return False, f"Channel '{msg_info['destination']}' not found"
        
        # Handle both numeric IDs and username strings
        channel_id_value = dest_channel['id']
        if _is_numeric_channel_id(channel_id_value):
            # It's a numeric ID (as string or int)
            dest_channel_id = int(channel_id_value)
        else:
            # It's a username (e.g., 'ZEDP20MED')
            dest_channel_id = channel_id_value
        
        topic_id = dest_channel.get('topic_id')  # None for regular channels
        extra_msg_id = await self._add_message_before(msg_info, dest_channel_id, topic_id=topic_id)
        
        if extra_msg_id:
            print(f"  📝 Extra message sent (ID: {extra_msg_id})")
            return True, None
        
        return False, "Add_Msg_before failed"
    
    async def _handle_transfer(self, msg_info, spreadsheet_id):
        """
        Handle Transfer action.
        
        If Post_Comment action is also present, Transfer will post as reply to the destination post.
        This prevents duplicate messages and creates a unified workflow.
        
        Returns:
            tuple: (transfer_result, error_message)
                transfer_result: dict with 'id', 'scheduled', 'scheduled_time'
        """
        if not msg_info.get('destination'):
            return None, "Missing destination"
        
        # Check if Post_Comment action is also present
        has_post_comment = 'Post_Comment' in msg_info.get('actions', [])
        reply_to_post_id = None
        
        if has_post_comment:
            # Extract post ID from destination for reply_to
            try:
                destination = msg_info['destination'].strip()
                channel_id, post_id = self._parse_target_post(destination)
                reply_to_post_id = post_id
                print(f"  💬 Transfer will post as REPLY to post {post_id} (Post_Comment mode)")
            except ValueError:
                # Destination doesn't have post ID, Transfer will be standalone
                print(f"  ⚠️  Post_Comment present but destination has no post ID")
                print(f"     Transfer will post as standalone (not as reply)")
        
        # Check if Update action is present
        has_update = 'Update' in msg_info.get('actions', [])
        
        # Only fetch metadata if Update action present
        dest_channel = self._get_destination_channel(
            spreadsheet_id, 
            msg_info['destination'],
            fetch_metadata=has_update
        )
        if not dest_channel:
            return None, f"Channel '{msg_info['destination']}' not found"
        
        # Handle both numeric IDs and username strings
        channel_id_value = dest_channel['id']
        if _is_numeric_channel_id(channel_id_value):
            dest_channel_id = int(channel_id_value)
        else:
            dest_channel_id = channel_id_value

        # Resolve invite hash (+HASH) or username string to numeric ID
        if isinstance(dest_channel_id, str):
            try:
                if dest_channel_id.startswith('+'):
                    # Use cached helper — avoids repeated CheckChatInviteRequest
                    # calls that trigger FloodWait when processing large groups.
                    resolved = await self._resolve_invite_link(dest_channel_id)
                    dest_channel['id']       = str(resolved['id'])
                    dest_channel['name']     = resolved['name'] or dest_channel.get('name', '')
                    dest_channel['username'] = resolved['username']
                    dest_channel_id          = resolved['id']
                else:
                    ent = await self.client.get_entity(dest_channel_id)
                    real_id = int(f"-100{ent.id}") if ent.id > 0 else ent.id
                    print(f"  🔍 Resolved @{dest_channel_id} → numeric ID: {real_id}")
                    dest_channel['id']       = str(real_id)
                    dest_channel['name']     = getattr(ent, 'title', '') or dest_channel.get('name', '')
                    dest_channel['username'] = getattr(ent, 'username', '') or dest_channel_id
                    dest_channel_id = real_id
            except Exception as e:
                return None, f"Could not resolve destination '{dest_channel_id}': {e}"

        topic_id = dest_channel.get('topic_id')  # None for regular channels

        # Pass reply_to_post_id and topic_id to _transfer_message
        transfer_result = await self._transfer_message(
            msg_info, 
            dest_channel_id,
            reply_to_post_id=reply_to_post_id,
            topic_id=topic_id
        )
        
        if transfer_result:
            # Build composite ID - use the actual transferred channel ID from result if available
            # For usernames, we need to get the numeric ID from the result
            transferred_channel_id = transfer_result.get('peer_id', dest_channel_id)
            new_id = f"{transferred_channel_id}:{transfer_result['id']}"
            return {
                'new_id': new_id,
                'scheduled': transfer_result.get('scheduled', False),
                'scheduled_time': transfer_result.get('scheduled_time', '')
            }, None
        
        return None, "Transfer failed"
    
    async def _handle_transfer_orig(self, msg_info, spreadsheet_id, max_retries=3, drop_author=False):
        """
        Handle Transfer_Orig action.
        Forwards the original Telegram message as-is using Telegram's native forward
        Forwards the original Telegram message as-is using Telegram's native forward.
        When drop_author=True (Transfer_Orig_Hide), the "Forwarded from" header
        is hidden so the post appears as if it came directly from the destination.
        Returns:
            tuple: (transfer_result_dict, error_str)
        """
        if not msg_info.get('destination'):
            return None, "Missing destination"

        dest_channel = self._get_destination_channel(
            spreadsheet_id,
            msg_info['destination'],
            fetch_metadata=False
        )
        if not dest_channel:
            return None, f"Channel '{msg_info['destination']}' not found"

        channel_id_value = dest_channel['id']
        if _is_numeric_channel_id(channel_id_value):
            dest_channel_id = int(channel_id_value)
        else:
            dest_channel_id = channel_id_value

        # Resolve invite hash (+HASH) or username to numeric ID
        if isinstance(dest_channel_id, str):
            try:
                if dest_channel_id.startswith('+'):
                    resolved = await self._resolve_invite_link(dest_channel_id)
                    dest_channel_id = resolved['id']
                else:
                    ent = await self.client.get_entity(dest_channel_id)
                    dest_channel_id = int(f"-100{ent.id}") if ent.id > 0 else ent.id
            except Exception as e:
                return None, f"Could not resolve destination '{dest_channel_id}': {e}"

        source_channel_id, source_msg_id = self._parse_message_id(msg_info['id'])

        async def forward_op():
            forwarded = await self.client.forward_messages(
                entity=dest_channel_id,
                messages=[source_msg_id],
                from_peer=source_channel_id,
                drop_author=drop_author
            )
            if not forwarded:
                print(f"✗ forward_messages returned nothing for {msg_info['id']}")
                return None
            # Telethon may return a list or a single message
            fwd_msg = forwarded[0] if isinstance(forwarded, list) else forwarded
            peer_id = fwd_msg.peer_id.channel_id if hasattr(fwd_msg.peer_id, 'channel_id') else dest_channel_id
            print(f"✓ Forwarded original {source_msg_id} → {fwd_msg.id} (dest channel {peer_id})")
            new_id = f"{peer_id}:{fwd_msg.id}"
            await asyncio.sleep(config.TELEGRAM_ACTION_DELAY)  # Rate limit protection
            return {'new_id': new_id, 'scheduled': False, 'scheduled_time': ''}

        result = await self._retry_with_backoff(forward_op, max_retries, "Transfer_Orig")
        if result:
            return result, None
        return None, "Transfer_Orig forward failed"

    async def _fetch_and_parse_transferred_message(self, new_channel_id, new_message_id):
        """
        Fetch the transferred message and parse it completely.
        
        This enables full row updates when Update action is used.
        
        Args:
            new_channel_id (int): Destination channel ID
            new_message_id (int): Transferred message ID
        
        Returns:
            dict: Parsed message data with all columns, or None if failed
        """
        try:
            # Import MessageParser here to avoid circular imports
            import sys
            import os
            parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            if parent_dir not in sys.path:
                sys.path.insert(0, parent_dir)
            
            from telegram_client.message_parser import MessageParser
            
            # Fetch the transferred message
            transferred_msg = await self.client.get_messages(
                new_channel_id,
                ids=new_message_id
            )
            
            if not transferred_msg:
                print(f"  ⚠️  Could not fetch transferred message {new_message_id} from channel {new_channel_id}")
                return None
            
            # Get channel name for parsing
            try:
                dest_channel = google_sheets_helper.get_channel_by_id(
                    config.SPREADSHEET_ID,
                    new_channel_id,
                    gid=config.DEFAULT_CHANNELS_SHEET_GID
                )
                channel_name = dest_channel['name'] if dest_channel else f"Channel_{new_channel_id}"
            except Exception as e:
                channel_name = f"Channel_{new_channel_id}"
                print(f"  ℹ️  Using default channel name: {channel_name}")
            
            # Parse the message completely
            parser = MessageParser(self.client)
            row_data = await parser.parse_message(
                transferred_msg,
                new_channel_id,
                channel_name
            )
            
            if row_data:
                # Convert row_data (list) to dict with column names
                # Schema: ID, Channel Name, Date & Time, Author, Topic, Text,
                #         Hashtags, Title, Description_MD, Tags, Message Link,
                #         Extra_Msg, Action, Destination, Scheduled_Time
                return {
                    'id': row_data[0],
                    'channel_name': row_data[1],
                    'datetime': row_data[2],
                    'author': row_data[3],
                    'topic': row_data[4],
                    'text': row_data[5],
                    'hashtags': row_data[6],
                    'title': row_data[7],
                    'description_md': row_data[8],
                    'tags': row_data[9],
                    'message_link': row_data[10]
                }
            else:
                print(f"  ⚠️  Failed to parse transferred message")
                return None
                
        except Exception as e:
            print(f"  ⚠️  Error fetching transferred message: {e}")
            return None
    
    async def _build_update_data(self, msg_info, transfer_result, spreadsheet_id, has_update_action):
        """
        Build spreadsheet update data.
        
        ENHANCED: When UPDATE_ACTION_FULL_REFRESH is True and Update action is present,
        fetches the transferred message and updates ALL columns with fresh data.
        
        Args:
            msg_info (dict): Message info
            transfer_result (dict): Transfer result with 'new_id', 'scheduled', 'scheduled_time'
            spreadsheet_id (str): Spreadsheet ID
            has_update_action (bool): Whether Update action was requested
        
        Returns:
            dict: Update data for spreadsheet
        """
        update_data = {
            'row_num': msg_info['row_num'],
            'action': 'Done',
            'destination': '',
            'extra_msg': '',  # Always clear after processing
            'scheduled_time': ''  # Always clear after processing
        }
        
        # SPECIAL CASE: If Delete action is present (alone or with Grp only),
        # mark row for deletion from the sheet.
        # Covers: 'Delete', 'Grp, Delete'
        row_actions = msg_info.get('actions', [])
        if 'Delete' in row_actions and all(a in ['Delete', 'Grp'] for a in row_actions):
            update_data['action'] = 'delete'  # This will trigger row deletion
            return update_data
        
        # Handle scheduled messages differently
        if transfer_result and transfer_result.get('scheduled'):
            update_data['action'] = f"Scheduled: {transfer_result['scheduled_time']}"
            # Keep destination for scheduled messages (user might want to see where it's scheduled)
            # Actually, clear it to match other behaviors
            update_data['destination'] = ''
        
        new_id = transfer_result['new_id'] if transfer_result else None
        
        # Update author if available (from Edit action)
        if 'updated_author' in msg_info and msg_info['updated_author']:
            update_data['author'] = msg_info['updated_author']
            print(f"  📝 Will update Author to: {msg_info['updated_author']}")
        
        # If Update action and transfer was successful, update columns
        if has_update_action and new_id:
            try:
                new_channel_id, new_message_id = new_id.split(':')
                new_channel_id_int = int(new_channel_id)
                new_message_id_int = int(new_message_id)
                
                # Check if full refresh is enabled
                if config.UPDATE_ACTION_FULL_REFRESH:
                    print(f"  🔄 Fetching transferred message for full row update...")
                    
                    # Fetch and parse the transferred message
                    parsed_data = await self._fetch_and_parse_transferred_message(
                        new_channel_id_int,
                        new_message_id_int
                    )
                    
                    if parsed_data:
                        # Update ALL columns with fresh data
                        update_data['new_id'] = parsed_data['id']
                        update_data['channel_name'] = parsed_data['channel_name']
                        update_data['datetime'] = parsed_data['datetime']
                        update_data['author'] = parsed_data['author']  # Override Edit author if full refresh
                        update_data['topic'] = parsed_data['topic']
                        update_data['text'] = parsed_data['text']
                        update_data['hashtags'] = parsed_data['hashtags']
                        update_data['title'] = parsed_data['title']
                        update_data['description_md'] = parsed_data['description_md']
                        update_data['tags'] = parsed_data['tags']
                        update_data['message_link'] = parsed_data['message_link']
                        
                        print(f"  ✅ Full update: ALL columns refreshed from transferred message")
                    else:
                        # Fallback to basic update if fetch failed
                        print(f"  ⚠️  Full refresh failed, falling back to basic update")
                        dest_channel = google_sheets_helper.get_channel_by_id(
                            config.SPREADSHEET_ID,
                            new_channel_id_int,
                            gid=config.DEFAULT_CHANNELS_SHEET_GID
                        )
                        
                        if dest_channel:
                            update_data['new_id'] = new_id
                            update_data['channel_name'] = dest_channel['name']
                            
                            # Build message link
                            channel_for_link = new_channel_id[4:] if new_channel_id.startswith('-100') else new_channel_id
                            update_data['message_link'] = f"https://t.me/c/{channel_for_link}/{new_message_id}"
                            
                            print(f"  📝 Basic update: ID, Channel Name, Message Link")
                        else:
                            print(f"  ⚠️  Could not find destination channel info, updating ID only")
                            update_data['new_id'] = new_id
                else:
                    # Basic update mode (faster, original behavior)
                    dest_channel = google_sheets_helper.get_channel_by_id(
                        config.SPREADSHEET_ID,
                        new_channel_id_int,
                        gid=config.DEFAULT_CHANNELS_SHEET_GID
                    )
                    
                    if dest_channel:
                        update_data['new_id'] = new_id
                        update_data['channel_name'] = dest_channel['name']
                        
                        # Build message link
                        channel_for_link = new_channel_id[4:] if new_channel_id.startswith('-100') else new_channel_id
                        update_data['message_link'] = f"https://t.me/c/{channel_for_link}/{new_message_id}"
                        
                        print(f"  📝 Basic update: ID, Channel Name, Message Link")
                    else:
                        print(f"  ⚠️  Could not find destination channel info, updating ID only")
                        update_data['new_id'] = new_id
            except Exception as e:
                print(f"  ⚠️  Error building update data: {e}")
                update_data['new_id'] = new_id
        
        return update_data
    
    async def _handle_post_comment(self, msg_info):
        """
        Post message content as comment (reply) to a specific post.
        Supports media (photos, videos, documents) and Telegram links.
        NOW SUPPORTS SCHEDULED POSTING!
        
        Args:
            msg_info (dict): Message information with:
                - destination: Target post (channel_id:post_id or https://t.me/c/3138994143/2461)
                - id: Source message ID (to fetch media)
                - hashtags, title, description_md: Content
                - scheduled_time: Optional time to schedule comment
        
        Returns:
            tuple: (success: bool, error: str or None, result_data: dict or None)
        """
        print("\n📝 Posting as comment...")
        
        # Validate data
        is_valid, error_msg = self._validate_post_comment_data(msg_info)
        if not is_valid:
            print(f"✗ Validation failed: {error_msg}")
            return False, error_msg, None
        
        # Parse scheduled time if provided (NEW!)
        schedule_timestamp = None
        scheduled_time_str = msg_info.get('scheduled_time', '').strip()
        
        if scheduled_time_str:
            try:
                schedule_timestamp = google_sheets_helper.parse_scheduled_time(scheduled_time_str)
                if schedule_timestamp:
                    formatted_time = google_sheets_helper.format_scheduled_time_for_display(schedule_timestamp)
                    print(f"  📅 Will schedule comment for: {formatted_time}")
            except ValueError as e:
                print(f"  ⚠️  Scheduled time error: {e}")
                print(f"     Will post immediately instead")
                schedule_timestamp = None
        
        try:
            # Parse target post (supports both formats)
            destination = msg_info['destination'].strip()
            channel_id, post_id = self._parse_target_post(destination)
            
            # Show which format was used
            if 'https://t.me/c/' in destination:
                print(f"  Target: Telegram link → Channel {channel_id}, Post {post_id}")
            else:
                print(f"  Target: Channel {channel_id}, Post {post_id}")
            
            # Get source message to extract media (just like Transfer does)
            media = None
            source_msg_id = msg_info.get('id', '').strip()
            
            if source_msg_id:
                try:
                    source_channel_id, source_message_id = self._parse_message_id(source_msg_id)
                    source_message = await self.client.get_messages(source_channel_id, ids=source_message_id)
                    
                    if source_message and source_message.media:
                        # Check if this message is part of a grouped media (photo album)
                        # If so, fetch all messages in the group
                        if hasattr(source_message, 'grouped_id') and source_message.grouped_id is not None:
                            # Only reconstruct as album for PHOTOS.
                            # Documents, videos, audio, etc. are always sent one-by-one.
                            is_photo = _is_photo_media(source_message.media)

                            if not config.RECONSTRUCT_GROUPED_MEDIA_AS_ALBUM or not is_photo:
                                # INDIVIDUAL MODE: Post only this single item
                                print(f"  📷 Grouped media detected (grouped_id: {source_message.grouped_id})")
                                if not is_photo:
                                    print(f"  ℹ️  Non-photo media (document/video/audio) → Posting individually")
                                else:
                                    print(f"  ℹ️  Individual mode enabled → Posting only this item")
                                media = source_message.media
                            else:
                                # ALBUM MODE: Photos only — reconstruct full group and post as album
                                print(f"  📸 Detected photo group (grouped_id: {source_message.grouped_id})")
                                
                                # Fetch a range of messages around this one to find all group members
                                start_id = max(1, source_message_id - 20)
                                end_id = source_message_id + 20
                                
                                nearby_messages = await self.client.get_messages(
                                    source_channel_id,
                                    min_id=start_id - 1,
                                    max_id=end_id + 1,
                                    limit=50
                                )
                                
                                # Filter messages with the same grouped_id
                                grouped_messages = [
                                    msg for msg in nearby_messages
                                    if hasattr(msg, 'grouped_id') and msg.grouped_id == source_message.grouped_id
                                ]
                                
                                # Sort by message ID to maintain order
                                grouped_messages.sort(key=lambda x: x.id)
                                
                                if len(grouped_messages) > 1:
                                    # Multiple messages in group - collect all media
                                    media = [msg.media for msg in grouped_messages if msg.media and msg.media.__class__.__name__ != 'MessageMediaWebPage']
                                    print(f"  📸 Found {len(media)} items in group - will post as album")
                                else:
                                    # Only one message found
                                    media = source_message.media
                        else:
                            # Single message, not grouped
                            media = source_message.media
                            print(f"  ✓ Media found in source message")
                    else:
                        print(f"  ℹ No media in source message")
                except Exception as e:
                    print(f"  ⚠️  Could not fetch source message for media: {e}")
            
            # Build comment content (check for Msgs action)
            if 'Msgs' in msg_info.get('actions', []):
                text, entities = self._build_message_content_as_messages(msg_info)
            else:
                text, entities = self._build_message_content(msg_info)
            
            # Define the send operation with media support (like Transfer)
            async def send_comment():
                if media:
                    # Send comment with media
                    return await self.client.send_message(
                        entity=channel_id,
                        message=text,
                        file=media,
                        formatting_entities=entities,
                        reply_to=post_id,  # This makes it a comment/reply!
                        schedule=schedule_timestamp  # NEW: Support scheduled comments
                    )
                else:
                    # Send text-only comment
                    return await self.client.send_message(
                        entity=channel_id,
                        message=text,
                        formatting_entities=entities,
                        reply_to=post_id,
                        schedule=schedule_timestamp  # NEW: Support scheduled comments
                    )
            
            # Send comment with retry logic
            result = await self._retry_with_backoff(
                send_comment,
                max_retries=3,
                operation_name="Post comment"
            )
            
            if result:
                # Handle both single message and album (list of messages)
                # When sending multiple photos as album, Telethon returns a list
                if isinstance(result, list):
                    # Album sent - use the first message ID as reference
                    first_msg = result[0]
                    comment_id = first_msg.id
                    # Extract peer_id for full refresh support
                    peer_id = first_msg.peer_id.channel_id if hasattr(first_msg.peer_id, 'channel_id') else None
                    print(f"  📸 Album comment sent with {len(result)} photos (IDs: {first_msg.id}-{result[-1].id})")
                else:
                    # Single message sent
                    comment_id = result.id
                    # Extract peer_id for full refresh support
                    peer_id = result.peer_id.channel_id if hasattr(result.peer_id, 'channel_id') else None
                
                # NEW: Show scheduled vs immediate posting
                if schedule_timestamp:
                    formatted_time = google_sheets_helper.format_scheduled_time_for_display(schedule_timestamp)
                    if media:
                        print(f"✓ Comment with media scheduled successfully for {formatted_time}!")
                    else:
                        print(f"✓ Comment scheduled successfully for {formatted_time}!")
                else:
                    if media:
                        print(f"✓ Comment with media posted successfully!")
                    else:
                        print(f"✓ Comment posted successfully!")
                print(f"  Comment ID: {comment_id}")
                
                # Build result data for Pub_lnk (same as Transfer)
                new_id = f"{channel_id}:{comment_id}"
                channel_for_link = str(channel_id)[4:] if str(channel_id).startswith('-100') else str(channel_id)
                new_message_link = f"https://t.me/c/{channel_for_link}/{comment_id}"
                
                result_data = {
                    'new_id': new_id,
                    'new_message_link': new_message_link,
                    'scheduled': bool(schedule_timestamp),
                    'scheduled_time': formatted_time if schedule_timestamp else '',
                    'peer_id': peer_id  # NEW: Add peer_id for full refresh support
                }
                
                return True, None, result_data
            else:
                error = "Failed to post comment (max retries exceeded)"
                print(f"✗ {error}")
                return False, error, None
        
        except ValueError as e:
            error = f"Invalid destination format: {str(e)}"
            print(f"✗ {error}")
            return False, error, None
        
        except Exception as e:
            error = f"Failed to post comment: {str(e)}"
            print(f"✗ {error}")
            import traceback
            traceback.print_exc()
            return False, error, None
    
    async def _process_single_message(self, msg_info, spreadsheet_id, stats):
        """
        Process a single message with all its actions.
        
        Args:
            msg_info (dict): Message information
            spreadsheet_id (str): Spreadsheet ID
            stats (dict): Statistics dictionary (updated in place)
        
        Returns:
            dict: Update data for spreadsheet
        """
        print(f"\n{'='*60}")
        print(f"Processing: {msg_info['id']}")
        print(f"Actions: {msg_info['actions']}")
        
        new_id = None
        transfer_result = None
        post_comment_result = None  # NEW: Track Post_Comment result for Update action
        actions_completed = []
        
        # Resolve action tokens
        _acts = msg_info['actions']
        transfer_token  = next((a for a in _acts if a.startswith('Transfer[')), None)
        pub_lnk_token   = next((a for a in _acts if a.startswith('Pub_lnk[')),  None)
        has_pub_lnk     = bool(pub_lnk_token) or msg_info.get('is_in_pub_lnk_group', False)
        msg_info['pub_lnk_token'] = pub_lnk_token or ''

        # Early dispatch: Transfer[Posts] or Transfer[Cmts] (self-contained)
        if transfer_token == 'Transfer[Posts]' and pub_lnk_token:
            return await self._transfer_with_pub_lnk(msg_info, spreadsheet_id, stats)
        if transfer_token == 'Transfer[Cmts]':
            return await self._transfer_with_comments(msg_info, spreadsheet_id, stats)
        if transfer_token == 'Transfer[Posts]':
            # Plain transfer — fall through to normal execute loop
            msg_info['actions'] = ['Transfer'] + [a for a in _acts
                if a not in ('Transfer[Posts]', pub_lnk_token or '')]
        # backward compat: plain 'Transfer' still works

        # Validate Add_Msg_Before requires Transfer
        if 'Add_Msg_Before' in msg_info['actions'] and 'Transfer' not in msg_info['actions'] and 'Transfer[Posts]' not in msg_info['actions']:
            error = "Add_Msg_before requires Transfer"
            print(f"✗ {error}")
            stats['errors'] += 1
            return {
                'row_num': msg_info['row_num'], 
                'action': f"ERROR: {error}",
                'destination': '',
                'extra_msg': '',
                'scheduled_time': ''
            }
        
        # Execute Add_Msg_Before first if present
        if 'Add_Msg_Before' in msg_info['actions']:
            success, error = await self._handle_add_msg_before(msg_info, spreadsheet_id)
            if success:
                actions_completed.append('Add_Msg_Before')
            else:
                stats['errors'] += 1
                return {
                    'row_num': msg_info['row_num'], 
                    'action': f"ERROR: {error}",
                    'destination': '',
                    'extra_msg': '',
                    'scheduled_time': ''
                }
        
        # NEW: Filter out non-executable actions from execution loop
        # These are not actions to execute, but flags/markers for special processing:
        # - Pub_lnk: handled after Transfer in a separate step
        # - Grp: grouping marker, not an executable action
        # - Remove_Num: title cleaning flag used by clean_title() in Pub_lnk posts
        # - Punct_*_: title formatting flag (e.g., Punct_🔹_ adds emoji, Punct__ removes dash)
        actions_to_execute = [
            a for a in msg_info['actions']
            if a not in ['Pub_lnk', 'Grp', 'Remove_Num', 'Transfer_Cmts', 'Transfer_Lnk']
            and not a.startswith('Pub_lnk[')
            and not a.startswith('Transfer[')
            and not (a.startswith('Punct_') and a.endswith('_'))
            and not a.startswith('Joinus_')
        ]
        
        # Store original actions for later use
        msg_info['original_actions'] = msg_info['actions'].copy()
        
        # Execute actions in order
        for action in actions_to_execute:
            if action == 'Add_Msg_Before':
                continue  # Already handled
            
            if action == 'Transfer':
                transfer_result, error = await self._handle_transfer(msg_info, spreadsheet_id)
                if transfer_result:
                    stats['transferred'] += 1
                    if transfer_result.get('scheduled'):
                        stats['scheduled'] = stats.get('scheduled', 0) + 1
                    new_id = transfer_result['new_id']
                    actions_completed.append('Transfer')
                    
                    # Build message link for Pub_lnk (same logic as _build_update_data)
                    try:
                        new_channel_id, new_message_id = new_id.split(':')
                        channel_for_link = new_channel_id[4:] if new_channel_id.startswith('-100') else new_channel_id
                        transfer_result['new_message_link'] = f"https://t.me/c/{channel_for_link}/{new_message_id}"
                    except Exception as e:
                        transfer_result['new_message_link'] = ''
                        print(f"  ⚠️  Could not build message link: {e}")
                    
                    # Store transfer info for Pub_lnk processing
                    if has_pub_lnk:
                            msg_info['transfer_result'] = transfer_result
                            msg_info['has_pub_lnk'] = True
                else:
                        stats['errors'] += 1
                        return {
                            'row_num': msg_info['row_num'], 
                            'action': f"ERROR: {error}",
                            'destination': '',
                            'extra_msg': '',
                            'scheduled_time': ''
                        }
            
            elif action == 'Transfer_Cmts':
                # Handled outside the normal loop – should not reach here.
                # Transfer_Cmts is dispatched directly in _process_single_message.
                pass

            elif action == 'Transfer_Orig':
                transfer_orig_result, error = await self._handle_transfer_orig(msg_info, spreadsheet_id)
                if transfer_orig_result:
                    stats['transferred'] += 1
                    transfer_result = transfer_orig_result
                    actions_completed.append('Transfer_Orig')
                else:
                    stats['errors'] += 1
                    return {
                        'row_num': msg_info['row_num'],
                        'action': f"ERROR: {error}",
                        'destination': '',
                        'extra_msg': '',
                        'scheduled_time': ''
                    }

            elif action == 'Transfer_Orig_Hide':
                transfer_orig_result, error = await self._handle_transfer_orig(msg_info, spreadsheet_id, drop_author=True)
                if transfer_orig_result:
                    stats['transferred'] += 1
                    transfer_result = transfer_orig_result
                    actions_completed.append('Transfer_Orig_Hide')
                else:
                    stats['errors'] += 1
                    return {
                        'row_num': msg_info['row_num'],
                        'action': f"ERROR: {error}",
                        'destination': '',
                        'extra_msg': '',
                        'scheduled_time': ''
                    }

            elif action == 'Edit':
                result = await self._edit_message(msg_info)
                if result['success']:
                        stats['edited'] += 1
                        actions_completed.append('Edit')
                        if result.get('author'):
                            msg_info['updated_author'] = result['author']
                else:
                        stats['errors'] += 1
                        return {
                            'row_num': msg_info['row_num'], 
                            'action': "ERROR: Edit failed",
                            'destination': '',
                            'extra_msg': '',
                            'scheduled_time': ''
                        }
            
            elif action == 'Edit_Clear':
                result = await self._edit_clear_message(msg_info)
                if result['success']:
                        stats['cleared'] = stats.get('cleared', 0) + 1
                        actions_completed.append('Edit_Clear')
                else:
                        stats['errors'] += 1
                        return {
                            'row_num': msg_info['row_num'],
                            'action': "ERROR: Edit_Clear failed",
                            'destination': '',
                            'extra_msg': '',
                            'scheduled_time': ''
                        }
            
            elif action == 'Add_Comment':
                if await self._add_comment(msg_info):
                        actions_completed.append('Add_Comment')
                else:
                        stats['errors'] += 1
                        return {
                            'row_num': msg_info['row_num'], 
                            'action': "ERROR: Add_Comment failed",
                            'destination': '',
                            'extra_msg': '',
                            'scheduled_time': ''
                        }
            
            elif action == 'Delete':
                if await self._delete_message(msg_info):
                        stats['deleted'] += 1
                        actions_completed.append('Delete')
                else:
                        stats['errors'] += 1
                        return {
                            'row_num': msg_info['row_num'], 
                            'action': "ERROR: Delete failed",
                            'destination': '',
                            'extra_msg': '',
                            'scheduled_time': ''
                        }
            
            elif action == 'Post_Comment':
                # Skip Post_Comment if Transfer already posted as reply
                # This happens when both Transfer and Post_Comment are present
                if 'Transfer' in actions_completed:
                        print(f"  ℹ️  Skipping Post_Comment (Transfer already posted as reply)")
                        actions_completed.append('Post_Comment')
                else:
                        # Execute Post_Comment normally (when Transfer not present)
                        success, error, result_data = await self._handle_post_comment(msg_info)
                        if success:
                            stats['post_comments'] += 1
                            actions_completed.append('Post_Comment')
                            
                            # Store result for Update action (NEW!)
                            if result_data:
                                post_comment_result = result_data
                                new_id = result_data.get('new_id')
                            
                            # Store result for Pub_lnk (same as Transfer)
                            if result_data and has_pub_lnk:
                                msg_info['post_comment_result'] = result_data
                                msg_info['has_pub_lnk'] = True
                        else:
                            stats['errors'] += 1
                            return {
                                'row_num': msg_info['row_num'], 
                                'action': f"ERROR: {error}",
                                'destination': '',
                                'extra_msg': '',
                                'scheduled_time': ''
                            }
            
            elif action == 'Update':
                stats['updated'] += 1
                actions_completed.append('Update')
        
        # Build update data
        has_update = 'Update' in actions_completed
        has_transfer = 'Transfer' in actions_completed
        has_post_comment = 'Post_Comment' in actions_completed
        
        # Use transfer_result if available, otherwise use post_comment_result
        action_result = transfer_result if transfer_result else post_comment_result
        
        return await self._build_update_data(msg_info, action_result, spreadsheet_id, has_update)
    


    @staticmethod
    def _extract_media_filename(media):
        """
        Extract filename (without extension) from a Telegram media object.
        Mirrors the logic in message_parser.py get_file_without_extension().
        Returns empty string if no filename found.
        """
        if not media:
            return ''
        
        # Get the underlying document/audio/video object
        doc = None
        if hasattr(media, 'document') and media.document:
            doc = media.document
        elif hasattr(media, 'audio') and media.audio:
            doc = media.audio
        elif hasattr(media, 'video') and media.video:
            doc = media.video
        
        if not doc:
            return ''
        
        filename = ''
        if hasattr(doc, 'attributes'):
            for attr in doc.attributes:
                if hasattr(attr, 'file_name') and attr.file_name:
                    filename = attr.file_name
                    break
        
        if not filename and hasattr(doc, 'file_name') and doc.file_name:
            filename = doc.file_name
        
        # Strip extension
        if filename and '.' in filename:
            filename = filename.rsplit('.', 1)[0]
        
        return filename.strip()


    async def _resolve_joinus_tag(self, tag, dest_channel=None):
        """
        Async version: resolve Joinus_ tag → (real_name, link).
        Fetches real channel title from Telegram when name is a fallback ID.
        """
        import re as _re
        rest = tag[len('Joinus_'):]
        url_match = _re.search(r'_(https?://\S+)$', rest)
        if url_match:
            return rest[:url_match.start()].strip(), url_match.group(1)
        if dest_channel:
            ch_id     = dest_channel.get('id', '')
            username  = dest_channel.get('username', '')
            name      = dest_channel.get('name', '') or ''
            ch_id_str = str(ch_id).replace('-100', '')

            # If id is a username string (public link case e.g. 'ZEDDraft'), treat as username
            ch_id_is_username = ch_id_str and not ch_id_str.lstrip('-').isdigit()
            if ch_id_is_username and not username:
                username = ch_id_str

            # Prefer original_link (what the user typed, e.g. https://t.me/+HASH)
            # over a generated numeric fallback link
            original_link = dest_channel.get('original_link', '')
            link = (f"https://t.me/{username}" if username
                    else f"https://t.me/c/{ch_id_str}" if ch_id_str else '')

            # Fetch real title from Telegram when name is missing, a fallback ID,
            # or just @username / invite: (not the real channel title)
            needs_fetch = not name or name.startswith('Channel_') or name.startswith('@') or name.startswith('invite:')
            if needs_fetch:
                try:
                    eid = int(ch_id) if str(ch_id).lstrip('-').isdigit() else ch_id
                    ent = await self.client.get_entity(eid)
                    name = getattr(ent, 'title', '') or getattr(ent, 'username', '') or name
                    if hasattr(ent, 'username') and ent.username:
                        username = ent.username
                        link = f"https://t.me/{ent.username}"
                except Exception as _je:
                    print(f"  ⚠️  Could not fetch channel for Joinus_: {_je}")

            # No public username → use the original link the user typed
            if not username and original_link and original_link.startswith('http'):
                link = original_link

            return name, link
        return None, None

    @staticmethod
    def _parse_joinus_tag(tag, dest_channel=None):
        """
        Parse Joinus_ action tag → (channel_name, channel_link).

        Joinus_CHN_LNK                         → from dest_channel
        Joinus_ZED DZ_https://t.me/ZEDMEDDZ    → ('ZED DZ', 'https://t.me/ZEDMEDDZ')
        """
        import re as _re
        rest = tag[len('Joinus_'):]
        url_match = _re.search(r'_(https?://\S+)$', rest)
        if url_match:
            link = url_match.group(1)
            name = rest[:url_match.start()].strip()
            return name, link
        if dest_channel:
            name     = dest_channel.get('name', '') or dest_channel.get('username', '')
            username = dest_channel.get('username', '')
            ch_id    = str(dest_channel.get('id', '')).replace('-100', '')
            link = f"https://t.me/{username}" if username else (f"https://t.me/c/{ch_id}" if ch_id else '')
            return name, link
        return None, None

    async def _transfer_with_pub_lnk(self, msg_info, spreadsheet_id, stats):
        """
        Transfer_Lnk (single message):
        Transfer the post then send a Pub_lnk post using Extra_Msg as title.
        Remove_Num, Punct_ and Joinus_ flags are honoured.
        """
        print("\n🔗 Transfer[Posts]+Pub_lnk: transferring post + building pub-link...")

        transfer_result, error = await self._handle_transfer(msg_info, spreadsheet_id)
        if not transfer_result:
            stats['errors'] += 1
            return {'row_num': msg_info['row_num'],
                    'action': f"ERROR: Transfer[Posts]+Pub_lnk – {error}",
                    'destination': '', 'extra_msg': '', 'scheduled_time': ''}

        stats['transferred'] += 1
        msg_info['transfer_result'] = transfer_result

        post_title    = msg_info.get('extra_msg', '').strip() or 'Publications'
        msg_title     = msg_info.get('title', '').strip()
        if not msg_title:
            msg_title = msg_info.get('channel_name', '').strip()
        # Build link from new_id if new_message_link not set
        new_link = transfer_result.get('new_message_link', '')
        if not new_link and transfer_result.get('new_id'):
            try:
                _ch, _mid = transfer_result['new_id'].split(':')
                _ch_clean = str(_ch).replace('-100', '')
                new_link = f"https://t.me/c/{_ch_clean}/{_mid}"
            except Exception:
                pass
        actions       = msg_info.get('actions', [])
        pub_lnk_token = msg_info.get('pub_lnk_token', '') or next(
            (a for a in actions if a.startswith('Pub_lnk[')), '')
        cleaned    = msg_title  # label cleaned via _apply_pub_lnk_label in _build

        transferred_messages = [{
            'row_num':          msg_info['row_num'],
            'title':            cleaned or msg_title,
            'new_message_link': new_link,
            'destination':      msg_info.get('destination', ''),
            'extra_msg':        post_title,
            'original_actions': actions,
            'pub_lnk_token':    pub_lnk_token or '',
        }]

        pub_updates = await self._handle_pub_lnk_after_transfer(transferred_messages, stats)
        if pub_updates:
            return pub_updates[0]
        return await self._build_update_data(msg_info, transfer_result, spreadsheet_id, False)

    async def _transfer_lnk_group(self, group, spreadsheet_id, stats):
        """
        Transfer_Lnk + Grp: transfer all posts, then send ONE Pub_lnk post.
        Leader Extra_Msg = title. Each Title column = link label.
        Remove_Num, Punct_ and Joinus_ flags on leader apply to all.
        """
        leader        = group[0]
        post_title    = leader.get('extra_msg', '').strip() or 'Publications'
        actions       = leader.get('actions', [])
        pub_lnk_token = next((a for a in actions if a.startswith('Pub_lnk[')), '')
        print(f"\n🔗 Transfer[Posts]+Pub_lnk+Grp: '{post_title}' ({len(group)} post(s))...")

        sheet_updates    = []
        transferred_msgs = []

        has_edit = 'Edit' in actions

        for idx, msg_info in enumerate(group):
            is_leader = (idx == 0)
            print(f"\n  [{idx+1}/{len(group)}] {'Editing then transferring' if has_edit else 'Transferring'}: {msg_info['id']}")

            # ── Edit first (if requested) ────────────────────────────────
            if has_edit:
                edit_result = await self._edit_message(msg_info)
                if edit_result['success']:
                    stats['edited'] = stats.get('edited', 0) + 1
                    print(f"    ✓ Edited message {msg_info['id']}")
                else:
                    stats['errors'] += 1
                    sheet_updates.append({'row_num': msg_info['row_num'],
                                          'action': "ERROR: Edit failed (Transfer_Lnk+Grp)",
                                          'destination': '', 'extra_msg': '', 'scheduled_time': ''})
                    continue

            transfer_result, error = await self._handle_transfer(msg_info, spreadsheet_id)
            if not transfer_result:
                stats['errors'] += 1
                sheet_updates.append({'row_num': msg_info['row_num'],
                                      'action': f"ERROR: Transfer_Lnk+Grp – {error}",
                                      'destination': '', 'extra_msg': '', 'scheduled_time': ''})
                continue

            stats['transferred'] += 1
            msg_info['transfer_result'] = transfer_result

            # Build new_message_link from new_id (format: "channel_id:message_id")
            new_link = transfer_result.get('new_message_link', '')
            if not new_link and transfer_result.get('new_id'):
                try:
                    _ch, _mid = transfer_result['new_id'].split(':')
                    _ch_clean = str(_ch).replace('-100', '')
                    new_link = f"https://t.me/c/{_ch_clean}/{_mid}"
                except Exception:
                    pass

            # Use Title column; fall back to Channel Name if empty
            msg_title = msg_info.get('title', '').strip()
            if not msg_title:
                msg_title = msg_info.get('channel_name', '').strip()

            cleaned   = clean_title(msg_title, ['Pub_lnk'] + actions)
            _pub_tok_grp = next((a for a in actions if a.startswith('Pub_lnk[')), '')
            transferred_msgs.append({
                'row_num':          msg_info['row_num'],
                'title':            cleaned or msg_title,
                'new_message_link': new_link,
                'destination':      msg_info.get('destination', ''),
                'extra_msg':        post_title if is_leader else '',
                'original_actions': actions,
                'pub_lnk_token':    _pub_tok_grp,
            })
            update = await self._build_update_data(msg_info, transfer_result, spreadsheet_id, False)
            sheet_updates.append(update)

        if transferred_msgs:
            pub_updates = await self._handle_pub_lnk_after_transfer(transferred_msgs, stats)
            pub_rows    = {u['row_num']: u for u in pub_updates}
            sheet_updates = [pub_rows.get(u['row_num'], u) for u in sheet_updates]

        return sheet_updates

    async def _transfer_with_comments(self, msg_info, spreadsheet_id, stats):
        """
        Transfer a channel post AND re-post all its comments to the destination.

        Steps
        -----
        1. Transfer the main post  →  get new_post_id in destination channel.
        2. Resolve the source discussion group (linked chat of source channel).
        3. Fetch every top-level comment that replies to the original post.
        4. For each comment, send it as a reply to new_post_id in the
           destination discussion group, prefixed with the original author name.

        Args
        ----
        msg_info      : dict   – same format used by Transfer
        spreadsheet_id: str
        stats         : dict   – updated in place

        Returns
        -------
        dict  – spreadsheet update row  (same shape as _process_single_message)
        """
        from telethon.tl.functions.channels import GetFullChannelRequest

        print("\n🔄 Transfer_Cmts: transferring post + comments...")

        # ── Step 1: transfer the main post ──────────────────────────────────
        transfer_result, error = await self._handle_transfer(msg_info, spreadsheet_id)

        if not transfer_result:
            stats['errors'] += 1
            return {
                'row_num': msg_info['row_num'],
                'action': f"ERROR: Transfer_Cmts – main post failed: {error}",
                'destination': '',
                'extra_msg': '',
                'scheduled_time': '',
            }

        stats['transferred'] += 1
        if transfer_result.get('scheduled'):
            stats['scheduled'] = stats.get('scheduled', 0) + 1

        new_id_str = transfer_result['new_id']          # "channel_id:message_id"
        try:
            dest_channel_id_str, new_post_id_str = new_id_str.split(':')
            dest_channel_id = int(dest_channel_id_str)
            new_post_id     = int(new_post_id_str)
        except Exception as e:
            stats['errors'] += 1
            return {
                'row_num': msg_info['row_num'],
                'action': f"ERROR: Transfer_Cmts – could not parse new ID: {e}",
                'destination': '',
                'extra_msg': '',
                'scheduled_time': '',
            }

        print(f"  ✅ Main post transferred → new ID: {new_post_id} in channel {dest_channel_id}")

        # ── Step 2: find source discussion group ────────────────────────────
        src_channel_id, src_message_id = self._parse_message_id(msg_info['id'])

        try:
            full = await self.client(GetFullChannelRequest(src_channel_id))
            discussion_group_id = getattr(full.full_chat, 'linked_chat_id', None)
        except Exception as e:
            print(f"  ⚠️  Could not get discussion group for source channel: {e}")
            discussion_group_id = None

        if not discussion_group_id:
            print("  ℹ️  No discussion group linked to source channel – skipping comments.")
            return await self._build_update_data(msg_info, transfer_result, spreadsheet_id, False)

        print(f"  💬 Source discussion group ID: {discussion_group_id}")

        # ── Step 3: fetch comments via CommentFetcher (correct method) ──────
        # The channel post is FORWARDED into the discussion group with a NEW ID.
        # We must first find that forwarded message, then fetch replies to it.
        from .comment_fetcher import CommentFetcher
        fetcher  = CommentFetcher(self.client)
        comments = await fetcher.get_post_comments(
            channel_id=src_channel_id,
            post_id=src_message_id,
            limit=200,
        )
        # get_post_comments already returns a list (newest-first from iter_messages)

        if not comments:
            print("  ℹ️  No comments found for this post.")
            return await self._build_update_data(msg_info, transfer_result, spreadsheet_id, False)

        # Reverse to chronological order (iter_messages returns newest-first)
        comments = list(reversed(comments))
        print(f"  📨 Found {len(comments)} comment(s) – re-posting to destination...")

        # ── Step 4: resolve destination discussion group + find forwarded msg ID
        # The transferred channel post (new_post_id) is auto-forwarded into the
        # discussion group with a NEW message ID. We need that ID for reply_to,
        # NOT the channel post ID.
        try:
            dest_full = await self.client(GetFullChannelRequest(dest_channel_id))
            dest_discussion_id = getattr(dest_full.full_chat, 'linked_chat_id', None)
        except Exception as e:
            print(f"  ⚠️  Could not get destination discussion group: {e}")
            dest_discussion_id = None

        if not dest_discussion_id:
            print("  ⚠️  Destination channel has no linked discussion group – cannot post comments.")
            return await self._build_update_data(msg_info, transfer_result, spreadsheet_id, False)

        print(f"  💬 Destination discussion group ID: {dest_discussion_id}")

        # Find the forwarded copy of new_post_id inside the discussion group
        # Give Telegram a moment to forward the post before we search
        await asyncio.sleep(3)
        dest_forwarded_id = None
        try:
            dest_channel_id_clean = int(str(dest_channel_id).replace('-100', ''))
            async for disc_msg in self.client.iter_messages(dest_discussion_id, limit=50):
                if (disc_msg.fwd_from
                        and disc_msg.fwd_from.from_id
                        and hasattr(disc_msg.fwd_from.from_id, 'channel_id')):
                    fwd_ch = int(str(disc_msg.fwd_from.from_id.channel_id).replace('-100', ''))
                    if (fwd_ch == dest_channel_id_clean
                            and disc_msg.fwd_from.channel_post == new_post_id):
                        dest_forwarded_id = disc_msg.id
                        print(f"  🔗 Found forwarded post in discussion group → ID: {dest_forwarded_id}")
                        break
        except Exception as e:
            print(f"  ⚠️  Could not find forwarded post in discussion group: {e}")

        if not dest_forwarded_id:
            print("  ⚠️  Forwarded post not found in discussion group.")
            print("      Comments will be posted as standalone messages (no thread).")
            # Fall back to new_post_id — may or may not thread correctly
            dest_forwarded_id = new_post_id

        # reply_to_id is now the correct discussion group message ID
        reply_to_id = dest_forwarded_id

        # ── Step 5: re-post each comment preserving original format + media ──
        posted_ok    = 0
        comment_links = []   # list of (title, telegram_link) for Step 6
        for idx, comment in enumerate(comments, 1):
            text     = comment.message or ''
            entities = comment.entities or None   # preserves bold/italic/links/code
            media    = comment.media    or None   # photo, video, document, etc.

            async def _send(txt=text, ents=entities, med=media):
                # Skip web page previews — not real files
                if med and med.__class__.__name__ == 'MessageMediaWebPage':
                    med = None
                if med:
                    # Send with media (caption = original text, entities preserved)
                    return await self.client.send_file(
                        entity=dest_discussion_id,
                        file=med,
                        caption=txt,
                        formatting_entities=ents,
                        reply_to=reply_to_id,
                    )
                else:
                    # Text-only comment
                    return await self.client.send_message(
                        entity=dest_discussion_id,
                        message=txt,
                        formatting_entities=ents,
                        reply_to=reply_to_id,
                    )

            try:
                _sent_msg = await _send()
                print(f"    [{idx}/{len(comments)}] ✓ Re-posted comment")
                posted_ok += 1

                # Collect (title, link) for the pub-links block (Step 6)
                if _sent_msg:
                    # Handle list (album) or single message
                    _ref_msg = _sent_msg[0] if isinstance(_sent_msg, list) else _sent_msg
                    _disc_ch = _ref_msg.peer_id.channel_id if hasattr(_ref_msg.peer_id, 'channel_id') else dest_discussion_id
                    _disc_ch_clean = str(_disc_ch).replace('-100', '')
                    _cmt_link = f"https://t.me/c/{_disc_ch_clean}/{_ref_msg.id}"
                    # First non-hashtag, non-empty line (skip #tag lines)
                    _cmt_title = ''
                    for _ln in (comment.message or '').split('\n'):
                        _ln_stripped = _ln.strip()
                        if _ln_stripped and not _ln_stripped.startswith('#'):
                            _cmt_title = _ln_stripped
                            break
                    if not _cmt_title:
                        # All lines are hashtags or empty – fall back to first non-empty
                        for _ln in (comment.message or '').split('\n'):
                            if _ln.strip():
                                _cmt_title = _ln.strip()
                                break
                    # No text at all → extract filename from media
                    if not _cmt_title and comment.media:
                        _cmt_title = self._extract_media_filename(comment.media)
                    comment_links.append((_cmt_title, _cmt_link))

                await asyncio.sleep(1)

            except FloodWaitError as e:
                print(f"    [{idx}/{len(comments)}] ⏳ Flood wait {e.seconds}s...")
                await asyncio.sleep(e.seconds)
                try:
                    _sent_msg = await _send()
                    posted_ok += 1
                    if _sent_msg:
                        _ref_msg = _sent_msg[0] if isinstance(_sent_msg, list) else _sent_msg
                        _disc_ch = _ref_msg.peer_id.channel_id if hasattr(_ref_msg.peer_id, 'channel_id') else dest_discussion_id
                        _disc_ch_clean = str(_disc_ch).replace('-100', '')
                        _cmt_link = f"https://t.me/c/{_disc_ch_clean}/{_ref_msg.id}"
                        # First non-hashtag, non-empty line (skip #tag lines)
                        _cmt_title = ''
                        for _ln in (comment.message or '').split('\n'):
                            _ln_stripped = _ln.strip()
                            if _ln_stripped and not _ln_stripped.startswith('#'):
                                _cmt_title = _ln_stripped
                                break
                        if not _cmt_title:
                            for _ln in (comment.message or '').split('\n'):
                                if _ln.strip():
                                    _cmt_title = _ln.strip()
                                    break
                        # No text → extract filename from media
                        if not _cmt_title and comment.media:
                            _cmt_title = self._extract_media_filename(comment.media)
                        comment_links.append((_cmt_title, _cmt_link))
                except Exception as retry_err:
                    print(f"    [{idx}/{len(comments)}] ✗ Retry failed: {retry_err}")

            except Exception as e:
                print(f"    [{idx}/{len(comments)}] ✗ Failed: {e}")

        print(f"  ✅ Transfer_Cmts complete: {posted_ok}/{len(comments)} comments re-posted.")
        stats['post_comments'] = stats.get('post_comments', 0) + posted_ok

        # ── Step 6: append pub-links block to the transferred channel post ──
        # Skipped when no comments were collected.
        if posted_ok > 0 and comment_links:
            print(f"  📝 Building pub-links block for {len(comment_links)} comment(s)...")
            try:
                # Build embed links block using _build_pub_lnk_post pipeline
                # Format:  - [first non-hashtag line](https://t.me/c/...)
                _publications = []
                for _title, _url in comment_links:
                    _raw = _title.strip()
                    # Strip leading emoji/punctuation chars until we hit a letter or digit
                    import unicodedata as _ud
                    _i = 0
                    while _i < len(_raw):
                        _cat = _ud.category(_raw[_i])
                        # So = Symbol/other (emoji), Sk = modifier, Ps/Pe = brackets
                        # Also skip spaces after emoji
                        if _cat in ('So', 'Sk', 'Sm', 'Ps', 'Pe', 'Po') or _raw[_i] in (' ', '\t', '-', '•', '·', '–', '—'):
                            _i += 1
                        else:
                            break
                    _label = _raw[_i:].strip() if _raw[_i:].strip() else _raw or _url
                    _publications.append({'title': _label, 'link': _url})

                # _build_pub_lnk_post adds #Pub_lnk header + bold title line
                # which we don't want here — build the list directly instead,
                # then convert via markdown_to_telegram_entities + adjust_entity_offsets
                # (identical pipeline to _build_pub_lnk_post)
                _link_md_lines = []
                for _pub in _publications:
                    _link_md_lines.append(f"- [{_pub['title']}]({_pub['link']})")
                _links_md = '\n'.join(_link_md_lines)

                # Convert markdown → plain text + entities (resolves [label](url))
                _links_plain, _links_ents = markdown_to_telegram_entities(_links_md)

                # Adjust entity offsets (same as _build_pub_lnk_post)
                if _links_ents:
                    _links_ents = adjust_entity_offsets(_links_plain, _links_ents)

                # Fetch current text + entities of the transferred post
                _transferred = await self.client.get_messages(
                    dest_channel_id, ids=new_post_id)

                if _transferred:
                    _cur_text     = _transferred.message or ''
                    _cur_entities = list(_transferred.entities or [])
                    _sep          = '\n\n' if _cur_text.strip() else ''

                    # Shift new entities by the length of existing text + separator
                    # CRITICAL: Telegram uses UTF-16 offsets.
                    # Emojis are 2 UTF-16 units but 1 Python char → must convert.
                    from .utils.markdown_converter import _python_offset_to_utf16
                    _prefix = _cur_text + _sep
                    _shift = _python_offset_to_utf16(_prefix, len(_prefix))
                    _merged_ents  = list(_cur_entities)
                    if _links_ents:
                        for _e in _links_ents:
                            _e.offset += _shift
                        _merged_ents.extend(_links_ents)

                    _new_text = _cur_text + _sep + _links_plain

                    await self.client.edit_message(
                        entity=dest_channel_id,
                        message=new_post_id,
                        text=_new_text,
                        formatting_entities=_merged_ents or None,
                        link_preview=False,
                    )
                    print(f"  ✅ Transferred post edited – {len(comment_links)} embed link(s) appended.")
                else:
                    print("  ⚠️  Could not fetch transferred post for editing.")

            except Exception as _e6:
                print(f"  ⚠️  Step 6 failed: {_e6}")
                import traceback; traceback.print_exc()

        return await self._build_update_data(msg_info, transfer_result, spreadsheet_id, False)

    async def _transfer_group_as_comments(self, group, spreadsheet_id, stats):
        """
        Grp + Transfer_Cmts group mode.

        Steps
        -----
        1. Create hub post in destination channel:
               #Pub_lnk
               🔥 ***{extra_msg}***
        2. Find hub's forwarded copy in the discussion group (reply_to anchor).
        3. Transfer every message in the group as a comment on the hub post.
        4. Collect (title, link) for each successfully transferred comment.
        5. Edit the hub post to append the pub-links list.

        Args
        ----
        group          : list of msg_info dicts (leader first, then followers)
        spreadsheet_id : str
        stats          : dict – updated in place

        Returns
        -------
        list of update dicts for spreadsheet
        """
        from telethon.tl.functions.channels import GetFullChannelRequest

        leader     = group[0]
        post_title = (leader.get('extra_msg') or '').strip()
        if not post_title:
            print("  ✗ Transfer_Cmts+Grp: Extra_Msg is empty on leader – aborting.")
            stats['errors'] += 1
            return [{'row_num': leader['row_num'], 'action': 'ERROR: Transfer_Cmts+Grp needs Extra_Msg',
                     'destination': '', 'extra_msg': '', 'scheduled_time': ''}]

        print(f"\n🔄 Transfer_Cmts+Grp: '{post_title}' ({len(group)} post(s))...")

        # ── Step 1: resolve destination channel ─────────────────────────────
        dest_channel = self._get_destination_channel(
            spreadsheet_id, leader['destination'], fetch_metadata=False)
        if not dest_channel:
            stats['errors'] += 1
            return [{'row_num': leader['row_num'],
                     'action': f"ERROR: Transfer_Cmts+Grp – destination not found",
                     'destination': '', 'extra_msg': '', 'scheduled_time': ''}]

        ch_val = dest_channel['id']
        dest_channel_id = int(ch_val) if str(ch_val).lstrip('-').isdigit() else ch_val

        # If dest_channel_id is a string, resolve to numeric ID.
        # Required for GetFullChannelRequest and fwd_from integer comparison to work correctly.
        if isinstance(dest_channel_id, str):
            try:
                if dest_channel_id.startswith('+'):
                    # Use cached helper — avoids repeated CheckChatInviteRequest
                    # calls that trigger FloodWait when processing large groups.
                    resolved = await self._resolve_invite_link(dest_channel_id)
                    dest_channel['id']       = str(resolved['id'])
                    dest_channel['name']     = resolved['name'] or dest_channel.get('name', '')
                    dest_channel['username'] = resolved['username']
                    dest_channel_id          = resolved['id']
                else:
                    # Regular username (e.g. 'ZEDDraft')
                    ent = await self.client.get_entity(dest_channel_id)
                    real_id = int(f"-100{ent.id}") if ent.id > 0 else ent.id
                    print(f"  🔍 Resolved @{dest_channel_id} → numeric ID: {real_id}")
                    dest_channel['id']       = str(real_id)
                    dest_channel['name']     = getattr(ent, 'title', '') or dest_channel.get('name', '')
                    dest_channel['username'] = getattr(ent, 'username', '') or dest_channel_id
                    dest_channel_id = real_id
            except Exception as e:
                print(f"  ⚠️  Could not resolve '{dest_channel_id}': {e}")

        # ── Step 2: create the hub post ──────────────────────────────────────
        hub_md   = f"#Pub_lnk    #ZED_MBset\n🔥 ***{post_title}***"
        hub_plain, hub_ents = markdown_to_telegram_entities(hub_md)
        if hub_ents:
            hub_ents = adjust_entity_offsets(hub_plain, hub_ents)

        try:
            hub_msg = await self.client.send_message(
                entity=dest_channel_id,
                message=hub_plain,
                formatting_entities=hub_ents or None,
                link_preview=False,
            )
            hub_post_id = hub_msg.id
            print(f"  ✅ Hub post created → ID: {hub_post_id}")
        except Exception as e:
            print(f"  ✗ Could not create hub post: {e}")
            stats['errors'] += 1
            return [{'row_num': leader['row_num'],
                     'action': f"ERROR: Transfer_Cmts+Grp – hub post failed: {e}",
                     'destination': '', 'extra_msg': '', 'scheduled_time': ''}]

        # ── Step 3: find hub's forwarded copy in the discussion group ────────
        try:
            dest_full = await self.client(GetFullChannelRequest(dest_channel_id))
            dest_disc_id = getattr(dest_full.full_chat, 'linked_chat_id', None)
        except Exception as e:
            print(f"  ⚠️  Could not get discussion group: {e}")
            dest_disc_id = None

        if not dest_disc_id:
            print("  ⚠️  Destination has no discussion group – cannot post comments.")
            stats['errors'] += 1
            return [{'row_num': leader['row_num'],
                     'action': 'ERROR: Transfer_Cmts+Grp – no discussion group',
                     'destination': '', 'extra_msg': '', 'scheduled_time': ''}]

        print(f"  💬 Discussion group ID: {dest_disc_id}")

        # Wait for Telegram to forward the hub post into the discussion group
        import asyncio as _asyncio
        await _asyncio.sleep(3)

        reply_to_id = None
        try:
            dest_ch_clean = int(str(dest_channel_id).replace('-100', ''))
            async for disc_msg in self.client.iter_messages(dest_disc_id, limit=30):
                if (disc_msg.fwd_from
                        and disc_msg.fwd_from.from_id
                        and hasattr(disc_msg.fwd_from.from_id, 'channel_id')):
                    fwd_ch = int(str(disc_msg.fwd_from.from_id.channel_id).replace('-100', ''))
                    if fwd_ch == dest_ch_clean and disc_msg.fwd_from.channel_post == hub_post_id:
                        reply_to_id = disc_msg.id
                        print(f"  🔗 Hub forwarded msg in group → ID: {reply_to_id}")
                        break
        except Exception as e:
            print(f"  ⚠️  Error finding hub in discussion group: {e}")

        if not reply_to_id:
            print("  ⚠️  Hub forwarded message not found – using hub_post_id as fallback.")
            reply_to_id = hub_post_id

        # ── Step 4: transfer each post as a comment on the hub ───────────────
        comment_links = []   # (title, link)
        sheet_updates = []

        # Resolve joinus_cmts: if set, we append the Join Us line to every comment
        _leader_acts_pre  = leader.get('actions', [])
        _pub_lnk_tok_pre  = next((a for a in _leader_acts_pre if a.startswith('Pub_lnk[')), '')
        _opts_pre         = self._parse_pub_lnk_token(_pub_lnk_tok_pre)
        _joinus_cmts      = _opts_pre.get('joinus_cmts', False)
        _joinus_name_cmts = None
        _joinus_link_cmts = None
        if _joinus_cmts and _opts_pre.get('joinus_tag'):
            _joinus_name_cmts, _joinus_link_cmts = await self._resolve_joinus_tag(
                _opts_pre['joinus_tag'], dest_channel=dest_channel)
            if _joinus_name_cmts and _joinus_link_cmts:
                print(f"  ☛ Join Us (comments): {_joinus_name_cmts} → {_joinus_link_cmts}")
            else:
                print("  ⚠️  joinus_CHN_LNK[Cmts]: could not resolve name/link — skipping append")
                _joinus_cmts = False

        for idx, msg_info in enumerate(group):
            print(f"\n  [{idx+1}/{len(group)}] Transferring: {msg_info['id']}")

            src_channel_id, src_message_id = self._parse_message_id(msg_info['id'])

            try:
                src_msg = await self.client.get_messages(src_channel_id, ids=src_message_id)
            except Exception as e:
                print(f"    ✗ Could not fetch source message: {e}")
                stats['errors'] += 1
                sheet_updates.append({'row_num': msg_info['row_num'],
                                      'action': f'ERROR: fetch failed: {e}',
                                      'destination': '', 'extra_msg': '', 'scheduled_time': ''})
                continue

            if not src_msg:
                print(f"    ✗ Source message not found")
                stats['errors'] += 1
                sheet_updates.append({'row_num': msg_info['row_num'],
                                      'action': 'ERROR: source not found',
                                      'destination': '', 'extra_msg': '', 'scheduled_time': ''})
                continue

            text     = src_msg.message or ''
            entities = list(src_msg.entities or [])
            media    = (src_msg.media
                        if src_msg.media and
                           src_msg.media.__class__.__name__ != 'MessageMediaWebPage'
                        else None)

            # Append Join Us line to comment text if joinus_cmts is active
            if _joinus_cmts and _joinus_name_cmts and _joinus_link_cmts:
                # ── Strip any existing Join Us block first (prevent duplication) ──
                import re as _re_joinus
                _JOINUS_PAT = _re_joinus.compile(
                    r'\n{0,2}[>\s]*Join us\s*☛[^\n]*',
                    _re_joinus.IGNORECASE
                )
                _match = _JOINUS_PAT.search(text)
                if _match:
                    _strip_start = _match.start()
                    # Remove trailing whitespace/newlines before the joinus block
                    while _strip_start > 0 and text[_strip_start - 1] in ('\n', ' '):
                        _strip_start -= 1
                    text = text[:_strip_start]
                    # Drop entities that fall inside the stripped region
                    from .utils.markdown_converter import _python_offset_to_utf16
                    _strip_utf16 = _python_offset_to_utf16(text, len(text))
                    entities = [_e for _e in entities
                                if _e.offset + _e.length <= _strip_utf16]
                    print(f"    ♻️  Stripped existing Join Us from comment")
                # ── Now append the fresh Join Us block ──────────────────────────
                _joinus_md   = f"\n\n> ***Join us ☛*** [***{_joinus_name_cmts}***]({_joinus_link_cmts})"
                _joinus_plain, _joinus_ents = markdown_to_telegram_entities(_joinus_md)
                if _joinus_ents:
                    _joinus_ents = adjust_entity_offsets(_joinus_plain, _joinus_ents)
                # Shift joinus entities by current text length (UTF-16 aware)
                from .utils.markdown_converter import _python_offset_to_utf16
                _shift = _python_offset_to_utf16(text, len(text))
                if _joinus_ents:
                    for _je in _joinus_ents:
                        _je.offset += _shift
                    entities = entities + _joinus_ents
                text = text + _joinus_plain

            try:
                if media:
                    sent = await self.client.send_file(
                        entity=dest_disc_id,
                        file=media,
                        caption=text,
                        formatting_entities=entities or None,
                        reply_to=reply_to_id,
                    )
                else:
                    sent = await self.client.send_message(
                        entity=dest_disc_id,
                        message=text,
                        formatting_entities=entities or None,
                        reply_to=reply_to_id,
                    )

                stats['transferred'] += 1
                ref = sent[0] if isinstance(sent, list) else sent
                disc_ch_clean = str(ref.peer_id.channel_id if hasattr(ref.peer_id, 'channel_id')
                                    else dest_disc_id).replace('-100', '')
                cmt_link = f"https://t.me/c/{disc_ch_clean}/{ref.id}"

                # Title: first non-hashtag, non-empty line of the message
                import unicodedata as _ud
                cmt_title = ''
                for _ln in text.split('\n'):
                    _s = _ln.strip()
                    if _s and not _s.startswith('#'):
                        cmt_title = _s
                        break
                if not cmt_title:
                    for _ln in text.split('\n'):
                        if _ln.strip():
                            cmt_title = _ln.strip()
                            break

                # Strip leading emoji/punctuation
                _i = 0
                while _i < len(cmt_title):
                    _cat = _ud.category(cmt_title[_i])
                    if _cat in ('So','Sk','Sm','Ps','Pe','Po') or cmt_title[_i] in (' ','-','•','–','—','\t'):
                        _i += 1
                    else:
                        break
                cmt_title = cmt_title[_i:].strip() or cmt_title

                # Use msg title from spreadsheet if available and non-empty
                sheet_title = (msg_info.get('title') or '').strip()
                if sheet_title:
                    cmt_title = sheet_title

                comment_links.append((cmt_title, cmt_link))
                print(f"    ✓ Transferred → comment ID: {ref.id}")

                sheet_updates.append({'row_num': msg_info['row_num'],
                                      'action': 'Done', 'destination': '',
                                      'extra_msg': post_title, 'scheduled_time': ''})
                await _asyncio.sleep(1)

            except FloodWaitError as e:
                print(f"    ⏳ Flood wait {e.seconds}s...")
                await _asyncio.sleep(e.seconds)
                stats['errors'] += 1
                sheet_updates.append({'row_num': msg_info['row_num'],
                                      'action': f'ERROR: flood wait',
                                      'destination': '', 'extra_msg': '', 'scheduled_time': ''})
            except Exception as e:
                print(f"    ✗ Failed: {e}")
                stats['errors'] += 1
                sheet_updates.append({'row_num': msg_info['row_num'],
                                      'action': f'ERROR: {e}',
                                      'destination': '', 'extra_msg': '', 'scheduled_time': ''})

        print(f"\n  ✅ {len(comment_links)}/{len(group)} post(s) transferred as comments.")

        # ── Step 5: edit hub post to append pub-links (opts-aware) ─────────
        if comment_links:
            print(f"  📝 Appending {len(comment_links)} pub-link(s) to hub post...")
            try:
                _leader_acts = leader.get('actions', [])
                _pub_lnk_tok = next((a for a in _leader_acts if a.startswith('Pub_lnk[')), '')
                _opts        = self._parse_pub_lnk_token(_pub_lnk_tok)
                _joinus_name = None
                _joinus_link = None
                if _opts.get('joinus_tag'):
                    _joinus_name, _joinus_link = await self._resolve_joinus_tag(
                        _opts['joinus_tag'], dest_channel=dest_channel)
                    if _joinus_name and _joinus_link:
                        print(f"  ☛ Join Us: {_joinus_name} → {_joinus_link}")
                _raw_pubs = [{'title': _t, 'link': _u} for _t, _u in comment_links]
                _grouped  = self._group_parts(_raw_pubs)
                _link_md_lines = []
                _seq = 0
                for _gpub in _grouped:
                    _seq += 1
                    if _gpub.get('parts'):
                        _pfx, _cmain = self._apply_pub_lnk_label(_gpub['title'], _opts, index=_seq)
                        _part_lnks = ' - '.join(
                            f"[{_p['label']}]({_p['link']})" for _p in _gpub['parts']
                        )
                        _link_md_lines.append(f"{_pfx}{_cmain}: {_part_lnks}")
                    else:
                        _pfx, _clean = self._apply_pub_lnk_label(_gpub['title'], _opts, index=_seq)
                        _link_md_lines.append(f"{_pfx}[{_clean}]({_gpub['link']})")
                if _joinus_name and _joinus_link:
                    _link_md_lines.append('')
                    _link_md_lines.append(
                        f"> ***Join us ☛*** [***{_joinus_name}***]({_joinus_link})")
                _links_md = '\n'.join(_link_md_lines)

                _links_plain, _links_ents = markdown_to_telegram_entities(_links_md)
                if _links_ents:
                    _links_ents = adjust_entity_offsets(_links_plain, _links_ents)

                _hub = await self.client.get_messages(dest_channel_id, ids=hub_post_id)
                if _hub:
                    _cur_text  = _hub.message or ''
                    _cur_ents  = list(_hub.entities or [])
                    _sep       = '\n\n' if _cur_text.strip() else ''

                    from .utils.markdown_converter import _python_offset_to_utf16
                    _prefix = _cur_text + _sep
                    _shift  = _python_offset_to_utf16(_prefix, len(_prefix))

                    _merged = list(_cur_ents)
                    if _links_ents:
                        for _e in _links_ents:
                            _e.offset += _shift
                        _merged.extend(_links_ents)

                    await self.client.edit_message(
                        entity=dest_channel_id,
                        message=hub_post_id,
                        text=_cur_text + _sep + _links_plain,
                        formatting_entities=_merged or None,
                        link_preview=False,
                    )
                    print(f"  ✅ Hub post edited – {len(comment_links)} embed link(s) appended.")
            except Exception as _e5:
                print(f"  ⚠️  Could not edit hub post: {_e5}")
                import traceback; traceback.print_exc()

        stats['pub_lnk_posts'] = stats.get('pub_lnk_posts', 0) + 1
        stats['pub_lnk_pubs']  = stats.get('pub_lnk_pubs',  0) + len(comment_links)
        return sheet_updates

    def _print_summary(self, stats):
        """Print execution summary."""
        print(f"\n{'='*60}")
        print("📊 EXECUTION SUMMARY")
        print(f"{'='*60}")
        print(f"Total messages: {stats['total']}")
        print(f"✓ Transferred: {stats['transferred']}")
        print(f"✓ Edited: {stats['edited']}")
        print(f"✓ Cleared: {stats.get('cleared', 0)}")
        print(f"✓ Deleted: {stats['deleted']}")
        print(f"✓ Updated: {stats['updated']}")
        print(f"✓ Pub_lnk posts: {stats['pub_lnk_posts']} ({stats['pub_lnk_pubs']} publications)")
        print(f"✓ Comments posted: {stats['post_comments']}")
        if stats.get('transfer_cmts', 0) > 0:
            print(f"✓ Transfer_Cmts: {stats['transfer_cmts']} post(s) with comments")
        if stats.get('deleted_rows', 0) > 0:
            print(f"🗑️  Rows deleted from sheet: {stats['deleted_rows']}")
        print(f"✗ Errors: {stats['errors']}")
        print(f"{'='*60}\n")
    
    async def execute_actions(self, spreadsheet_id, sheet_name=None):
        """
        Execute all actions marked in spreadsheet.
        
        Process:
        1. Read messages with actions from sheet
        2. Execute actions in order: Transfer → Edit → Delete → Update
        3. Update spreadsheet with results
        
        Args:
            spreadsheet_id (str): Google Sheets spreadsheet ID
            sheet_name (str, optional): Sheet name (default: config.ALL_MSGS_SHEET_NAME)
        
        Returns:
            dict: Execution statistics
        """
        if not sheet_name:
            sheet_name = config.ALL_MSGS_SHEET_NAME
        
        stats = {'errors': 0, 'total': 0}
        try:
            # ── PRE-STEP: single sheet read shared by all steps ──────────────
            # read_action_rows_only() fetches only the Action column first,
            # then batch-fetches only the rows that actually have actions.
            # This replaces two separate get_all_values() calls with one
            # smart fetch, dramatically reducing data transfer.
            print("  📥 Reading sheet (action rows only)...")
            _preloaded = google_sheets_helper.read_action_rows_only(
                spreadsheet_id, sheet_name
            )

            # STEP 1: Check for standalone Pub_lnk messages (existing links)
            # Returns a LIST – one entry per group (leader = Extra_Msg + Destination filled)
            # Pass preloaded_data so no second full download happens.
            pub_lnk_groups = google_sheets_helper.get_pub_lnk_messages(
                spreadsheet_id, sheet_name, preloaded_data=_preloaded
            )

            pub_lnk_updates = []
            stats = self._init_stats(0)  # Will update total later

            # Filter to valid groups only
            valid_pub_lnk_groups = [g for g in pub_lnk_groups if g.get('valid') and g.get('publications')]

            if valid_pub_lnk_groups:
                print(f"\n{'='*60}")
                print(f"📋 Processing standalone Pub_lnk messages... ({len(valid_pub_lnk_groups)} group(s))")

                for group_idx, pub_lnk_data in enumerate(valid_pub_lnk_groups, start=1):
                    print(f"\n  📦 Group {group_idx}/{len(valid_pub_lnk_groups)}: "
                          f"'{pub_lnk_data['title']}' → {pub_lnk_data['destination']}")
                    print(f"  📝 {len(pub_lnk_data['publications'])} publications")

                    pub_lnk_data['pub_lnk_token'] = pub_lnk_data.get('pub_lnk_token','')
                    sent_id = await self._send_pub_lnk_post(pub_lnk_data)

                    if sent_id:
                        stats['pub_lnk_posts'] = stats.get('pub_lnk_posts', 0) + 1
                        stats['pub_lnk_pubs']  = stats.get('pub_lnk_pubs',  0) + len(pub_lnk_data['publications'])

                        for pub in pub_lnk_data['publications']:
                            pub_lnk_updates.append({
                                'row_num'       : pub['row_num'],
                                'action'        : 'Done',
                                'destination'   : '',
                                'extra_msg'     : '',
                                'scheduled_time': '',
                            })
                    else:
                        stats['errors'] += 1
                        pub_lnk_updates.append({
                            'row_num'       : pub_lnk_data['publications'][0]['row_num'],
                            'action'        : f"ERROR: Pub_lnk post {group_idx} failed to send",
                            'destination'   : '',
                            'extra_msg'     : '',
                            'scheduled_time': '',
                        })

            # Keep backward-compat: expose a single pub_lnk_data for the validity check below
            pub_lnk_data = pub_lnk_groups[0] if pub_lnk_groups else {'valid': False}
            
            # STEP 2: Get messages for action (includes Transfer + Pub_lnk)
            # Reuse the same preloaded data – zero extra API calls.
            messages = google_sheets_helper.get_messages_for_action(
                spreadsheet_id, sheet_name, preloaded_data=_preloaded
            )
            stats['total'] = len(messages)
            
            if not messages and not pub_lnk_data['valid']:
                print("ℹ️  No messages marked for action")
                return stats
            
            print(f"\n{'='*60}")
            print(f"🔍 Found {len(messages)} messages with actions")
            
            # STEP 3: Separate groups from regular messages using "Grp" action
            # NEW LOGIC: Messages with "Grp" action are grouped together
            # First message with "Grp" is the leader (has all actions)
            # Subsequent messages with "Grp" are followers (inherit from leader)
            grouped_messages = []
            regular_messages = []
            
            i = 0
            while i < len(messages):
                msg = messages[i]
                
                # Check if this message has "Grp" action
                if 'Grp' in msg['actions']:
                    # Check if this is a group leader (has actions other than "Group")
                    non_grp_actions = [a for a in msg['actions'] if a != 'Grp']
                    
                    if non_grp_actions:
                        # This is a GROUP LEADER (has Grp + other actions)
                        group = [msg]
                        group_actions = msg['actions'].copy()  # Store leader's actions
                        group_destination = msg['destination']
                        
                        # Look ahead for subsequent "Group" messages (followers)
                        j = i + 1
                        while j < len(messages):
                            next_msg = messages[j]
                            
                            # Check if next message is a group follower (has ONLY "Grp" action)
                            if 'Grp' in next_msg['actions']:
                                next_non_grp_actions = [a for a in next_msg['actions'] if a != 'Grp']
                                
                                # If it has other actions besides Grp, it's a new group leader
                                if next_non_grp_actions:
                                    break
                                
                                # This is a follower - inherit actions and destination from leader
                                next_msg['actions'] = group_actions.copy()
                                if not next_msg['destination'] or next_msg['destination'].strip() == '':
                                    next_msg['destination'] = group_destination
                                
                                group.append(next_msg)
                                j += 1
                            else:
                                # Not a Grp message, stop grouping
                                break
                        
                        grouped_messages.append(group)
                        i = j  # Skip all messages we just grouped
                    else:
                        # This message has ONLY "Grp" action with no leader before it
                        # This is an error - Grp followers must have a leader
                        print(f"⚠️  Warning: Row {msg['row_num']} has 'Grp' action without a leader. Skipping.")
                        i += 1
                else:
                    # Regular message (no Grp action)
                    regular_messages.append(msg)
                    i += 1
            
            # STEP 4: Process messages and collect updates
            sheet_updates = []
            
            # Process regular messages (without Group tag)
            for msg_info in regular_messages:
                update = await self._process_single_message(msg_info, spreadsheet_id, stats)
                sheet_updates.append(update)
            
            # STEP 5: Process grouped messages (with Group tag)
            for group in grouped_messages:
                print(f"\n{'='*60}")
                print(f"📦 Processing Group:")
                print(f"   Leader: Row {group[0]['row_num']}")
                print(f"   Actions: {', '.join(group[0]['actions'])}")
                print(f"   Group size: {len(group)} messages")
                print(f"   Destination: {group[0]['destination']}")
                
                # Detect group type from new token syntax
                _g0_acts = group[0]['actions']
                _transfer_tok = next((a for a in _g0_acts if a.startswith('Transfer[')), None)
                _pub_tok      = next((a for a in _g0_acts if a.startswith('Pub_lnk[')),  None)

                if _transfer_tok == 'Transfer[Cmts]':
                    print(f"   Type: Transfer[Cmts] + Grp")
                    grp_updates = await self._transfer_group_as_comments(
                        group, spreadsheet_id, stats)
                    sheet_updates.extend(grp_updates)

                elif _transfer_tok == 'Transfer[Posts]' and _pub_tok:
                    print(f"   Type: Transfer[Posts] + Pub_lnk + Grp")
                    grp_updates = await self._transfer_lnk_group(group, spreadsheet_id, stats)
                    sheet_updates.extend(grp_updates)

                elif _transfer_tok == 'Transfer[Posts]':
                    print(f"   Type: Transfer[Posts] + Grp (no Pub_lnk)")
                    for idx, msg_info in enumerate(group):
                        print(f"\n  [{idx+1}/{len(group)}] Processing: {msg_info['id']}")
                        update = await self._process_single_message(msg_info, spreadsheet_id, stats)
                        sheet_updates.append(update)


                elif 'Transfer_Orig' in _g0_acts or 'Transfer_Orig_Hide' in _g0_acts:
                    print(f"   Type: {'Transfer_Orig_Hide' if 'Transfer_Orig_Hide' in _g0_acts else 'Transfer_Orig'} + Grp (native forward)")
                    for idx, msg_info in enumerate(group):
                        print(f"\n  [{idx+1}/{len(group)}] Forwarding original: {msg_info['id']}")
                        update = await self._process_single_message(msg_info, spreadsheet_id, stats)
                        sheet_updates.append(update)
                # Check if this is a Transfer/Post_Comment + Pub_lnk group (legacy)
                elif (has_transfer := 'Transfer' in group[0]['actions']) or \
                     (has_post_comment := 'Post_Comment' in group[0]['actions']):
                    has_pub_lnk = 'Pub_lnk' in group[0]['actions']
                    if has_pub_lnk:
                        # This is a Transfer/Post_Comment + Pub_lnk group
                        action_type = "Transfer" if has_transfer else "Post_Comment"
                        print(f"   Type: {action_type} + Pub_lnk")
                        
                        # CRITICAL: Mark ALL messages in this group for Pub_lnk collection
                        for msg in group:
                            msg['is_in_pub_lnk_group'] = True
                        
                        transferred_messages = []
                        first_msg_extra_msg = group[0].get('extra_msg', '')
                        
                        # Process all messages in group (Transfer or Post_Comment)
                        for idx, msg_info in enumerate(group):
                            is_leader = (idx == 0)
                            print(f"\n  [{idx+1}/{len(group)}] Processing: {msg_info['id']}")
                            print(f"      Actions: {', '.join(msg_info['actions'])}")
                            print(f"      Destination: {msg_info['destination']}")
                            
                            update = await self._process_single_message(msg_info, spreadsheet_id, stats)
                            sheet_updates.append(update)
                            
                            # Collect transfer/post_comment info for Pub_lnk
                            result_data = msg_info.get('transfer_result') or msg_info.get('post_comment_result')
                            if result_data:
                                # Get title from spreadsheet data
                                msg_title = msg_info.get('title', '').strip()
                                if not msg_title:
                                    msg_title = msg_info.get('channel_name', '').strip()
                                # Build link from new_id if new_message_link not set
                                new_link = result_data.get('new_message_link', '')
                                if not new_link and result_data.get('new_id'):
                                    try:
                                        _ch, _mid = result_data['new_id'].split(':')
                                        _ch_clean = str(_ch).replace('-100', '')
                                        new_link = f"https://t.me/c/{_ch_clean}/{_mid}"
                                    except Exception:
                                        pass
                                
                                print(f"      → Collected: Title='{msg_title}', Link={new_link}")
                                
                                transferred_messages.append({
                                    'row_num': msg_info['row_num'],
                                    'title': msg_title,
                                    'new_message_link': new_link,
                                    'destination': msg_info.get('destination', ''),
                                    'extra_msg': first_msg_extra_msg if is_leader else '',
                                    'original_actions': msg_info.get('original_actions', [])
                                })
                        
                        # NOW create Pub_lnk post AFTER all transfers complete
                        print(f"\n{'='*60}")
                        print(f"📝 All {len(group)} messages processed successfully")
                        print(f"📋 Collected {len(transferred_messages)} publications:")
                        for idx, pub in enumerate(transferred_messages, 1):
                            print(f"    {idx}. Title: '{pub.get('title', '(MISSING)')}' → Link: {pub.get('new_message_link', '(MISSING)')}")
                        
                        if len(transferred_messages) == 0:
                            print(f"⚠️  WARNING: No publications collected! Check Title column in spreadsheet")
                        
                        print(f"📋 Now creating Pub_lnk post with {len(transferred_messages)} publication links...")
                        
                        pub_lnk_group_updates = await self._handle_pub_lnk_after_transfer(transferred_messages, stats)
                        sheet_updates.extend(pub_lnk_group_updates)
                        
                    else:
                        # Transfer/Post_Comment without Pub_lnk — regular group
                        print(f"   Type: Regular group (Transfer, no Pub_lnk)")
                        for idx, msg_info in enumerate(group):
                            print(f"\n  [{idx+1}/{len(group)}] Processing: {msg_info['id']}")
                            update = await self._process_single_message(msg_info, spreadsheet_id, stats)
                            sheet_updates.append(update)

                else:
                    # No Transfer, no Transfer_Cmts → regular group
                    print(f"   Type: Regular group")
                    
                    for idx, msg_info in enumerate(group):
                        print(f"\n  [{idx+1}/{len(group)}] Processing: {msg_info['id']}")
                        print(f"      Actions: {', '.join(msg_info['actions'])}")
                        
                        update = await self._process_single_message(msg_info, spreadsheet_id, stats)
                        sheet_updates.append(update)
            
            # STEP 6: Update spreadsheet (combine all updates) and handle deletions
            all_updates = pub_lnk_updates + sheet_updates
            
            # Separate rows to delete from rows to update
            rows_to_delete = []
            rows_to_update = []
            
            for update in all_updates:
                # Check if action is "delete" (case-insensitive)
                action_value = update.get('action', '').strip().lower()
                if action_value == 'delete':
                    rows_to_delete.append(update['row_num'])
                else:
                    rows_to_update.append(update)
            
            # First, update rows (clear actions, update IDs, etc.)
            if rows_to_update:
                print(f"\n{'='*60}")
                print("Updating spreadsheet...")
                google_sheets_helper.update_action_results(spreadsheet_id, rows_to_update, sheet_name)
                print(f"✓ Updated {len(rows_to_update)} rows in spreadsheet")
            
            # Then, delete rows marked with "delete" action
            if rows_to_delete:
                print(f"\n{'='*60}")
                print(f"Deleting {len(rows_to_delete)} rows with 'delete' action...")
                try:
                    google_sheets_helper.delete_rows(spreadsheet_id, rows_to_delete, sheet_name)
                    print(f"✅ Successfully deleted {len(rows_to_delete)} rows from sheet")
                    stats['deleted_rows'] = len(rows_to_delete)
                except Exception as e:
                    print(f"❌ Error deleting rows: {str(e)}")
                    stats['errors'] += len(rows_to_delete)
            
            # Print summary
            self._print_summary(stats)
            
            return stats
        
        except Exception as e:
            print(f"\n✗ Execution failed: {str(e)}")
            import traceback
            traceback.print_exc()
            stats['errors'] = stats.get('errors', 0)
            return stats