"""
Message Parser Module - SIMPLIFIED VERSION
==========================================
Converts Telegram messages into spreadsheet row format

NEW STRATEGY: Convert to Markdown FIRST, then parse
This eliminates ALL entity offset issues!

Schema (15 columns):
ID | Channel Name | Date & Time | Author | Topic | Text |
Hashtags | Title | Description_MD | Tags | Message Link | Extra_Msg | Action | Destination | Scheduled_Time
"""

import json
import sys
import os

# Add Config_Tlg to path
parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
config_path = os.path.join(parent_dir, 'Config_Tlg')
if config_path not in sys.path:
    sys.path.insert(0, config_path)

# Import ONLY from local utils (single source of truth)
from .utils.text_extractors import (
    parse_message_text,
    normalize_hashtags,
    build_structured_tags
)
from .utils.formatters import format_duration, get_file_extension
from .utils.markdown_converter import telegram_entities_to_markdown


def _sanitize_entities(text, entities):
    """
    Clean Telegram entities before Markdown conversion.

    Fixes three classes of malformed formatting found in real Telegram posts:

    1. Entity covers ONLY whitespace  →  drop it entirely
       e.g. bold("   ") is invalid and makes Telegram reject the edit.

    2. Entity starts or ends on whitespace  →  trim boundaries inward
       e.g. bold("Introduction ") becomes bold("Introduction")
       This prevents MessageEntityBold covering trailing space.

    3. Entity starts mid-word  →  extend left to word boundary
       e.g. text[5:15] = "T**énectéplase**" → extend to include the "T"
       Applies only to Bold / Italic / Underline / Strike (formatting types).

    Args:
        text (str): Raw message text (plain, not markdown)
        entities (list): List of Telegram entity objects (MessageEntityBold, etc.)

    Returns:
        list: Cleaned entity list (same objects, mutated copies)
    """
    import copy
    from telethon.tl.types import (
        MessageEntityBold, MessageEntityItalic,
        MessageEntityUnderline, MessageEntityStrike,
        MessageEntityCode, MessageEntityPre,
    )

    FORMATTING_TYPES = (
        MessageEntityBold, MessageEntityItalic,
        MessageEntityUnderline, MessageEntityStrike,
    )

    if not entities or not text:
        return entities or []

    cleaned = []
    for entity in entities:
        e = copy.copy(entity)

        # Guard: clamp to text length
        if e.offset >= len(text):
            continue
        if e.offset + e.length > len(text):
            e.length = len(text) - e.offset
        if e.length <= 0:
            continue

        covered = text[e.offset: e.offset + e.length]

        # ── Fix 1: drop entities that cover ONLY whitespace ──────────────────
        if not covered.strip():
            continue  # silently drop

        # ── Fix 2: trim leading/trailing whitespace from boundaries ──────────
        lstripped = covered.lstrip()
        leading_removed = len(covered) - len(lstripped)
        e.offset += leading_removed

        rstripped = lstripped.rstrip()
        e.length = len(rstripped)

        if e.length <= 0:
            continue

        # ── Fix 3: extend left to word boundary for formatting entities ──────
        if isinstance(e, FORMATTING_TYPES):
            while e.offset > 0 and text[e.offset - 1].isalpha():
                e.offset -= 1
                e.length += 1

        cleaned.append(e)

    return cleaned


class MessageParser:
    """Converts Telegram messages to spreadsheet row format."""
    
    def __init__(self, telegram_fetcher):
        """
        Initialize message parser.
        
        Args:
            telegram_fetcher: TelegramMessageFetcher instance for async operations
        """
        self.fetcher = telegram_fetcher
    
    def _get_media_filename(self, msg):
        """
        Extract filename from ANY media message (without extension).
        Works for: audio, video, document, photo (rare), voice.
        
        Args:
            msg: Telegram Message object
        
        Returns:
            str: Filename without extension, or empty string if not found
        """
        filename = ''
        
        # Check for audio attribute
        if msg.audio:
            if hasattr(msg.audio, 'attributes'):
                for attr in msg.audio.attributes:
                    if hasattr(attr, 'file_name') and attr.file_name:
                        filename = attr.file_name
                        break
            if not filename and hasattr(msg.audio, 'file_name') and msg.audio.file_name:
                filename = msg.audio.file_name
        
        # Check for video attribute
        elif msg.video:
            if hasattr(msg.video, 'attributes'):
                for attr in msg.video.attributes:
                    if hasattr(attr, 'file_name') and attr.file_name:
                        filename = attr.file_name
                        break
            if not filename and hasattr(msg.video, 'file_name') and msg.video.file_name:
                filename = msg.video.file_name
        
        # Check for document (includes files, PDFs, etc.)
        elif msg.document:
            if hasattr(msg.document, 'attributes'):
                for attr in msg.document.attributes:
                    if hasattr(attr, 'file_name') and attr.file_name:
                        filename = attr.file_name
                        break
            if not filename and hasattr(msg.document, 'file_name') and msg.document.file_name:
                filename = msg.document.file_name
        
        # Check for voice note (less common to have filename, but check anyway)
        elif msg.voice:
            if hasattr(msg.voice, 'attributes'):
                for attr in msg.voice.attributes:
                    if hasattr(attr, 'file_name') and attr.file_name:
                        filename = attr.file_name
                        break
        
        # Remove file extension if present
        if filename:
            if '.' in filename:
                filename = filename.rsplit('.', 1)[0]
        
        return filename
    
    def _get_author(self, msg):
        """
        Extract author information from message.
        
        Format: "John Doe (@johndoe)" or "John Doe" or "@johndoe"
        
        Args:
            msg: Telegram Message object
        
        Returns:
            str: Author name with username (if available) or empty string
        """
        author = ''
        username = ''
        
        if msg.post_author:
            author = msg.post_author
        elif msg.sender:
            # Get the display name
            if hasattr(msg.sender, 'first_name'):
                author = msg.sender.first_name
                if hasattr(msg.sender, 'last_name') and msg.sender.last_name:
                    author += f" {msg.sender.last_name}"
            elif hasattr(msg.sender, 'title'):
                author = msg.sender.title
            
            # Get the username separately
            if hasattr(msg.sender, 'username') and msg.sender.username:
                username = msg.sender.username
        
        # Combine name and username
        if author and username:
            return f"{author} (@{username})"
        elif author:
            return author
        elif username:
            return f"@{username}"
        else:
            return ''

    async def _get_topic(self, msg):
        """
        Extract topic information from message.
        
        Handles two cases in forum (topic-enabled) groups:
          1. reply_to_top_id is set   → use it directly (threaded replies)
          2. reply_to_top_id is None  → fall back to reply_to_msg_id
             (messages posted in a topic but not replying to another message)
          3. No reply_to at all       → default to 'Discussion' (main topic)
        
        Args:
            msg: Telegram Message object
        
        Returns:
            str: Topic title or 'Discussion' for messages without topic assignment
        """
        topic = ''
        
        try:
            if hasattr(msg, 'reply_to') and msg.reply_to:
                # Primary: reply_to_top_id (set for threaded replies inside topics)
                topic_id = getattr(msg.reply_to, 'reply_to_top_id', None)
                
                # Fallback: reply_to_msg_id (set for ALL messages in a topic,
                # including ones that are not threaded replies)
                if not topic_id:
                    topic_id = getattr(msg.reply_to, 'reply_to_msg_id', None)
                
                if topic_id:
                    topic = await self.fetcher.get_topic_title(topic_id)
            
            # If still no topic found, assign to default 'Discussion' topic
            # This handles messages posted directly to channel without any topic
            if not topic:
                topic = 'Discussion'
                
        except Exception as e:
            # Log the error instead of silently swallowing it
            print(f"  ⚠️  Could not fetch topic for message: {e}")
            # Default to 'Discussion' on error to avoid blank cells
            topic = 'Discussion'
        
        return topic
    
    def _get_media_info(self, msg):
        """
        Extract media type, extension, and duration.
        
        Args:
            msg: Telegram Message object
        
        Returns:
            tuple: (media_type, media_ext, duration_str)
        """
        media_type = ''
        media_ext = ''
        duration = ''
        
        if msg.photo:
            media_type = 'Photo'
        
        elif msg.video:
            media_type = 'Video'
            media_ext = get_file_extension(msg.video)
            
            if hasattr(msg.video, 'duration') and msg.video.duration:
                duration = format_duration(msg.video.duration)
            elif hasattr(msg.video, 'attributes'):
                for attr in msg.video.attributes:
                    if hasattr(attr, 'duration') and attr.duration:
                        duration = format_duration(attr.duration)
                        break
        
        elif msg.voice:
            media_type = 'Audio File'  # Changed from 'Voice Message' to 'Audio File'
            media_ext = 'ogg'  # Voice messages in Telegram are typically OGG Opus format
            
            if hasattr(msg.voice, 'duration') and msg.voice.duration:
                duration = format_duration(msg.voice.duration)
            elif hasattr(msg.voice, 'attributes'):
                for attr in msg.voice.attributes:
                    if hasattr(attr, 'duration') and attr.duration:
                        duration = format_duration(attr.duration)
                        break
        
        elif msg.audio:
            media_type = 'Audio File'
            media_ext = get_file_extension(msg.audio)
            
            if hasattr(msg.audio, 'duration') and msg.audio.duration:
                duration = format_duration(msg.audio.duration)
            elif hasattr(msg.audio, 'attributes'):
                for attr in msg.audio.attributes:
                    if hasattr(attr, 'duration') and attr.duration:
                        duration = format_duration(attr.duration)
                        break
        
        elif msg.document:
            media_ext = get_file_extension(msg.document)
            
            if hasattr(msg.document, 'mime_type'):
                mime = msg.document.mime_type
                
                if mime.startswith('video/'):
                    media_type = 'Video'
                    
                    if hasattr(msg.document, 'attributes'):
                        for attr in msg.document.attributes:
                            if hasattr(attr, 'duration') and attr.duration:
                                duration = format_duration(attr.duration)
                                break
                    
                    if not duration and hasattr(msg.document, 'duration') and msg.document.duration:
                        duration = format_duration(msg.document.duration)
                
                elif mime.startswith('audio/'):
                    media_type = 'Audio File'
                    
                    if hasattr(msg.document, 'attributes'):
                        for attr in msg.document.attributes:
                            if hasattr(attr, 'duration') and attr.duration:
                                duration = format_duration(attr.duration)
                                break
                    
                    if not duration and hasattr(msg.document, 'duration') and msg.document.duration:
                        duration = format_duration(msg.document.duration)
                
                else:
                    media_type = 'Document'
            else:
                media_type = 'Document'
        
        elif msg.sticker:
            media_type = 'Sticker'
        
        elif msg.poll:
            media_type = 'Poll'
        
        elif msg.web_preview:
            media_type = 'Link'
        
        return media_type, media_ext, duration

    async def _build_structured_tags(self, msg, parsed_data, media_type, media_ext, duration):
        """
        Build structured tags string with all message metadata.
        
        Format: Video(mp4, 03:45); Group; hash; Forward(Name, ID); Reply(TOPIC_ID:MESSAGE_ID)
        
        Args:
            msg: Telegram Message object
            parsed_data (dict): Parsed text data from parse_message_text()
            media_type (str): Media type (e.g., "Video", "Photo")
            media_ext (str): File extension (e.g., "mp4", "mp3")
            duration (str): Duration string (e.g., "03:45")
        
        Returns:
            str: Structured tags string
        """
        flags = []
        
        # Check for grouped media (ALL media types: photos, videos, documents, audio)
        is_grouped = hasattr(msg, 'grouped_id') and msg.grouped_id is not None
        if is_grouped:
            flags.append('Group')
        
        # Check for hashtags
        if parsed_data.get('hashtags'):
            flags.append('hash')
        
        # Check for emoji title pattern
        if parsed_data.get('has_emoji_title'):
            flags.append('Title')
        
        # Get forward info
        forward_name = ''
        forward_id = ''
        if msg.forward:
            forward_name, forward_id = await self.fetcher.get_forward_entity_info(msg.forward)
        
        # Get reply info - ENHANCED for forum topics
        reply_to_id = ''
        topic_id = None
        
        if hasattr(msg, 'reply_to') and msg.reply_to:
            # Get the message ID being replied to
            reply_msg_id = getattr(msg.reply_to, 'reply_to_msg_id', None)
            
            # Get the topic ID (for forum topics)
            # Priority: reply_to_top_id (for threaded replies in topics)
            # Fallback: reply_to_msg_id (for messages posted in topic)
            topic_id = getattr(msg.reply_to, 'reply_to_top_id', None)
            if not topic_id:
                # For messages in topics that aren't threaded replies,
                # reply_to_msg_id IS the topic ID
                topic_id = reply_msg_id
            
            # Build Reply tag
            if reply_msg_id:
                if topic_id and topic_id != reply_msg_id:
                    # This is a threaded reply in a forum topic
                    # Format: Reply(TOPIC_ID:MESSAGE_ID)
                    reply_to_id = f"{topic_id}:{reply_msg_id}"
                else:
                    # Simple reply (not in a topic, or replying to topic post itself)
                    # Format: Reply(MESSAGE_ID)
                    reply_to_id = str(reply_msg_id)
        
        # Build structured tags using centralized function
        return build_structured_tags(
            media_type=media_type,
            media_ext=media_ext,
            duration=duration,
            flags=flags,
            forward_name=forward_name,
            forward_id=forward_id,
            reply_to_id=reply_to_id
        )

    
    async def parse_message(self, msg, channel_id, channel_name):
        """
        Parse single Telegram message into spreadsheet row format.
        
        NEW STRATEGY: Convert to Markdown FIRST, then parse!
        This eliminates ALL entity offset calculation issues.
        
        Schema (14 columns):
        ID | Channel Name | Date & Time | Author | Topic | Text |
        Hashtags | Title | Description_MD | Tags | Message Link | Extra_Msg | Action | Destination
        
        Args:
            msg: Telegram Message object
            channel_id (int): Channel ID
            channel_name (str): Channel name
        
        Returns:
            list: Row data (15 columns) or None if message should be skipped
        """
        # Skip service messages
        if msg.action:
            return None
        
        # Extract basic info
        msg_id = f"{channel_id}:{msg.id}"
        datetime_str = msg.date.strftime('%Y-%m-%d %H:%M:%S') if msg.date else ''
        author = self._get_author(msg)
        topic = await self._get_topic(msg)
        
        # Get raw text
        text = msg.message if msg.message else ''
        
        # If no text but has media, try to extract filename for ALL media types
        if msg.media and not text:
            # Try to get filename from ANY media type (audio, video, document, PDF, etc.)
            media_filename = self._get_media_filename(msg)
            if media_filename:
                # Use filename as text (will become title later)
                text = media_filename
            else:
                # No filename found - leave text empty for no_caption tag
                text = ''
        
        # Parse text content
        description_md = ''
        
        # ENHANCEMENT: For text-only posts with only hashtags, keep title empty
        # Check if this is a text-only post (no media)
        text_is_only_hashtags = False
        if text and not msg.media:
            # Check if text contains only hashtags and whitespace
            text_stripped = text.strip()
            if text_stripped and text_stripped.startswith('#'):
                # Remove all hashtags and check if anything remains
                import re
                text_without_hashtags = re.sub(r'#\w+', '', text_stripped).strip()
                if not text_without_hashtags:
                    text_is_only_hashtags = True
        
        if msg.entities and text:
            # STRATEGY: Convert to markdown FIRST using entity offsets
            from .utils.markdown_converter import adjust_entity_offsets, telegram_entities_to_markdown
            
            # Step 1: Convert Telegram UTF-16 offsets → Python Unicode offsets.
            # Suppress all validation output — we re-sanitize in step 2.
            import io, contextlib
            _buf = io.StringIO()
            with contextlib.redirect_stdout(_buf), contextlib.redirect_stderr(_buf):
                offset_adjusted = adjust_entity_offsets(text, msg.entities)
            
            # Step 2: Sanitize AFTER offset conversion (correct Unicode space).
            cleaned_entities = _sanitize_entities(text, offset_adjusted)
            
            # Step 3: Convert to full markdown (suppress any remaining validation output)
            with contextlib.redirect_stdout(_buf), contextlib.redirect_stderr(_buf):
                full_markdown = telegram_entities_to_markdown(text, cleaned_entities)
            
            # Parse plain text for hashtags and title
            parsed_plain = parse_message_text(text, store_as_tags=True)
            
            hashtags = parsed_plain['hashtags']
            title = parsed_plain['title']
            plain_description = parsed_plain['description']
            
            # If text is only hashtags, clear the title
            if text_is_only_hashtags:
                title = ''
                plain_description = ''  # Also clear description
            
            # Extract description_md from markdown
            # If there's a description, extract it from the markdown version
            if plain_description:
                # Split markdown into lines
                md_lines = full_markdown.split('\n')
                
                # Remove title line if present
                if md_lines and md_lines[0].startswith('#'):
                    md_lines = md_lines[1:]
                
                # Remove the blank line after title
                if md_lines:
                    for i, line in enumerate(md_lines):
                        if line.strip():
                            md_lines = md_lines[i+1:]
                            break
                
                # Remove leading blank lines
                while md_lines and not md_lines[0].strip():
                    md_lines = md_lines[1:]
                
                # Rejoin
                description_md = '\n'.join(md_lines).strip()
        else:
            # No entities - parse plain text
            parsed_data = parse_message_text(text, store_as_tags=True)
            hashtags = parsed_data['hashtags']
            title = parsed_data['title']
            description_md = parsed_data['description']
            
            # If text is only hashtags, clear the title
            if text_is_only_hashtags:
                title = ''
                description_md = ''  # Also clear description
        
        # Normalize hashtags to be comma-separated tags
        if hashtags:
            hashtags = normalize_hashtags(hashtags, as_tags=True)
        
        # Get media info
        media_type, media_ext, duration = self._get_media_info(msg)
        
        # ENHANCEMENT: Check if we need to add "no_caption" tag
        needs_no_caption = False
        
        # Case 1: Media without caption (text is empty or just media indicator)
        if msg.media and not text:
            needs_no_caption = True
        
        # Case 2: No title OR no description (but has some content)
        # Only for posts that actually have some content (not pure hashtag posts)
        if not needs_no_caption:
            # Check if there's actual content beyond hashtags
            has_content_beyond_hashtags = False
            if text:
                # Remove hashtags and check if anything remains
                text_without_hashtags = text
                if hashtags:
                    for tag in hashtags.split(','):
                        text_without_hashtags = text_without_hashtags.replace(f'#{tag.strip()}', '')
                if text_without_hashtags.strip():
                    has_content_beyond_hashtags = True
            
            # If has content but missing title or description, add tag
            if has_content_beyond_hashtags and (not title or not description_md):
                needs_no_caption = True
        
        # Build structured tags
        tags_str = await self._build_structured_tags(
            msg, parsed_data if not msg.entities else parsed_plain,
            media_type, media_ext, duration
        )
        
        # Add no_caption tag if needed
        if needs_no_caption:
            if tags_str:
                tags_str = f"{tags_str}, no_caption"
            else:
                tags_str = "no_caption"
        
        # Build message link
        if str(channel_id).startswith('-100'):
            channel_link_id = str(channel_id)[4:]
        else:
            channel_link_id = str(channel_id)
        
        message_link = f"https://t.me/c/{channel_link_id}/{msg.id}"
        
        # Return row (15 columns)
        return [
            msg_id, channel_name, datetime_str, author, topic,
            text, hashtags, title, description_md, tags_str, message_link,
            '', '', '', ''  # Extra_Msg, Action, Destination, Scheduled_Time
        ]
    
    async def parse_comment(self, comment_msg, parent_post_id, channel_id, channel_name,
                           discussion_group_id, forwarded_post_msg_id):
        """
        Parse a comment message (from discussion group) into spreadsheet row format.
        
        Args:
            comment_msg: Telegram Message object from discussion group
            parent_post_id (int): ID of the parent post in the channel
            channel_id (int): Channel ID
            channel_name (str): Channel name
            discussion_group_id (int): Discussion group ID
            forwarded_post_msg_id (int): Message ID of the forwarded post in discussion group
        
        Returns:
            list: Row data (15 columns)
        """
        # Composite ID format: CHANNEL_ID:POST_ID:COMMENT_ID
        composite_id = f"{channel_id}:{parent_post_id}:{comment_msg.id}"
        
        datetime_str = comment_msg.date.strftime('%Y-%m-%d %H:%M:%S') if comment_msg.date else ''
        author = self._get_author(comment_msg)
        topic = 'Discussion'
        
        text = comment_msg.message if comment_msg.message else ''
        # If no text but has media, indicate it
        # For audio files, try to use the filename instead of generic message
        if comment_msg.media and not text:
            # Check if this is an audio file
                text = '[Media without caption]'
        
        # Parse text (same as regular messages)
        description_md = ''
        
        if comment_msg.entities and text:
            from .utils.markdown_converter import adjust_entity_offsets, telegram_entities_to_markdown
            
            # Step 1: Convert Telegram UTF-16 offsets → Python Unicode offsets.
            # Suppress all validation output — we re-sanitize in step 2.
            import io, contextlib
            _buf = io.StringIO()
            with contextlib.redirect_stdout(_buf), contextlib.redirect_stderr(_buf):
                offset_adjusted = adjust_entity_offsets(text, comment_msg.entities)
            
            # Step 2: Sanitize AFTER offset conversion (correct Unicode space).
            cleaned_entities = _sanitize_entities(text, offset_adjusted)
            # Step 3: Convert to full markdown (suppress any remaining validation output)
            with contextlib.redirect_stdout(_buf), contextlib.redirect_stderr(_buf):
                full_markdown = telegram_entities_to_markdown(text, cleaned_entities)
            parsed_plain = parse_message_text(text, store_as_tags=True)
            
            hashtags = parsed_plain['hashtags']
            title = parsed_plain['title']
            plain_description = parsed_plain['description']
            
            if plain_description:
                md_lines = full_markdown.split('\n')
                if md_lines and md_lines[0].startswith('#'):
                    md_lines = md_lines[1:]
                if md_lines:
                    for i, line in enumerate(md_lines):
                        if line.strip():
                            md_lines = md_lines[i+1:]
                            break
                while md_lines and not md_lines[0].strip():
                    md_lines = md_lines[1:]
                description_md = '\n'.join(md_lines).strip()
        else:
            parsed_data = parse_message_text(text, store_as_tags=True)
            hashtags = parsed_data['hashtags']
            title = parsed_data['title']
            description_md = parsed_data['description']
        
        if hashtags:
            hashtags = normalize_hashtags(hashtags, as_tags=True)
        
        media_type, media_ext, duration = self._get_media_info(comment_msg)
        
        # Build comment-specific tags
        tags_str = await self._build_comment_tags(
            comment_msg, parent_post_id, channel_id, discussion_group_id,
            forwarded_post_msg_id, media_type, media_ext, duration
        )
        
        message_link = f"https://t.me/c/{str(discussion_group_id)[4:]}/{comment_msg.id}"
        
        return [
            composite_id, channel_name, datetime_str, author, topic,
            text, hashtags, title, description_md, tags_str, message_link,
            '', '', '', ''
        ]
    
    async def _build_comment_tags(self, comment_msg, parent_post_id, channel_id, 
                                  discussion_group_id, forwarded_post_msg_id,
                                  media_type, media_ext, duration):
        """Build structured tags for a comment."""
        tags = []
        
        # Comment identifier
        tags.append('Comment')
        
        # Parent post reference
        tags.append(f'Parent:{channel_id}:{parent_post_id}')
        
        # Check if replying to another comment (nested)
        if comment_msg.reply_to_msg_id and comment_msg.reply_to_msg_id != forwarded_post_msg_id:
            tags.append(f'Reply:{discussion_group_id}:{comment_msg.reply_to_msg_id}')
        
        # Media tags
        if media_type:
            tags.append(f'{media_type}:{media_ext}' if media_ext else media_type)
        if duration:
            tags.append(f'Duration:{duration}')
        
        # Standard flags
        if comment_msg.out:
            tags.append('Outgoing')
        
        return ', '.join(tags)
    
    async def parse_messages_with_comments(self, messages, channel_id, channel_name, 
                                          fetch_comments=False, max_comments_per_post=50):
        """
        Parse messages and optionally fetch their comments inline.
        
        When fetch_comments=True, comments are inserted immediately after each post.
        
        GROUPED MEDIA HANDLING (UPDATED):
        - For PHOTO groups only: keep only the FIRST message in the group
        - For VIDEO, DOCUMENT, or MIXED groups: create a row for EACH item with its own ID
        """
        rows = []
        seen_photo_groups = set()  # Only track photo groups
        skipped = 0
        total_comments = 0
        
        comment_fetcher = None
        if fetch_comments:
            from .comment_fetcher import CommentFetcher
            comment_fetcher = CommentFetcher(self.fetcher.client)
            print(f"\n💬 Comment fetching enabled (max {max_comments_per_post} per post)")
        
        for msg in messages:
            # UPDATED: Only skip duplicate PHOTO groups
            if hasattr(msg, 'grouped_id') and msg.grouped_id is not None:
                if msg.photo:  # Only check for photo groups
                    if msg.grouped_id in seen_photo_groups:
                        skipped += 1
                        continue
                    else:
                        seen_photo_groups.add(msg.grouped_id)
                # For videos, documents, or mixed groups: process each item separately
            
            # Parse the post
            post_row = await self.parse_message(msg, channel_id, channel_name)
            if post_row is None:
                skipped += 1
                continue
            
            rows.append(post_row)
            
            # Fetch comments inline
            if fetch_comments:
                try:
                    comments = await comment_fetcher.get_post_comments(
                        channel_id, msg.id, limit=max_comments_per_post
                    )
                    
                    if comments:
                        print(f"  💬 Post {msg.id}: {len(comments)} comments")
                        
                        discussion_group_id = await comment_fetcher.get_discussion_group(channel_id)
                        forwarded_msg = await comment_fetcher._find_forwarded_post(
                            discussion_group_id, channel_id, msg.id
                        )
                        forwarded_post_msg_id = forwarded_msg.id if forwarded_msg else None
                        
                        for comment in comments:
                            comment_row = await self.parse_comment(
                                comment, msg.id, channel_id, channel_name,
                                discussion_group_id, forwarded_post_msg_id
                            )
                            rows.append(comment_row)
                            total_comments += 1
                
                except Exception as e:
                    print(f"  ⚠️  Error fetching comments for post {msg.id}: {e}")
        
        if skipped > 0:
            print(f"ℹ️  Skipped {skipped} duplicate photos in photo groups")
        if total_comments > 0:
            print(f"✅ Total comments: {total_comments}")
        
        return rows

    async def parse_messages(self, messages, channel_id, channel_name):
        """
        Parse multiple Telegram messages.
        
        GROUPED MEDIA HANDLING (UPDATED):
        - For PHOTO groups only: keep only the FIRST message in the group
        - For VIDEO, DOCUMENT, or MIXED groups: create a row for EACH item with its own ID
        
        Args:
            messages (list): List of Telegram Message objects
            channel_id (int): Channel ID
            channel_name (str): Channel name
        
        Returns:
            list: List of row data for spreadsheet (15 columns each)
        """
        rows = []
        seen_photo_groups = set()  # Only track photo grouped_id's we've already processed
        skipped_photos = 0
        
        for msg in messages:
            # Check if this is part of a grouped media
            if hasattr(msg, 'grouped_id') and msg.grouped_id is not None:
                # Check if this is a PHOTO group
                # We only deduplicate pure photo groups
                if msg.photo:
                    # This is a photo in a group
                    if msg.grouped_id in seen_photo_groups:
                        # Already processed this photo group, skip
                        skipped_photos += 1
                        continue
                    else:
                        # First photo in this group - mark it as seen
                        seen_photo_groups.add(msg.grouped_id)
                # For videos, documents, or mixed groups: process each item separately
                # (no deduplication - each gets its own row)
            
            row = await self.parse_message(msg, channel_id, channel_name)
            if row is not None:
                rows.append(row)
            else:
                skipped_photos += 1
        
        if skipped_photos > 0:
            print(f"ℹ️  Skipped {skipped_photos} duplicate photos in photo groups (kept first of each group)")
        
        return rows