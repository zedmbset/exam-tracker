"""
Link Parser Utility
Extracts message IDs from Telegram post links
"""
import re


def extract_message_id_from_link(text):
    """
    Extract message ID from Telegram post link or return plain ID.
    
    Supported formats:
    - Plain ID: "12345" → 12345
    - Private channel: "https://t.me/c/1234567890/12345" → 12345
    - Public channel: "https://t.me/channelname/12345" → 12345
    - With query params: "https://t.me/c/123/456?single" → 456
    
    Args:
        text (str): Plain message ID or Telegram link
    
    Returns:
        int or None: Extracted message ID, or None if invalid
    
    Examples:
        >>> extract_message_id_from_link("12345")
        12345
        >>> extract_message_id_from_link("https://t.me/c/1234567890/12345")
        12345
        >>> extract_message_id_from_link("https://t.me/channel/67890")
        67890
    """
    if not text:
        return None
    
    text = text.strip()
    
    # Check if it's already a plain number
    if text.isdigit():
        return int(text)
    
    # Patterns for Telegram links
    patterns = [
        # Private channel: https://t.me/c/CHANNEL_ID/MESSAGE_ID
        r't\.me/c/\d+/(\d+)',
        # Public channel: https://t.me/USERNAME/MESSAGE_ID
        r't\.me/([^/\s]+)/(\d+)',
        # Just extract any number after last slash
        r'/(\d+)(?:\?|$)'
    ]
    
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            # Get the last group (message ID)
            groups = match.groups()
            msg_id = groups[-1] if len(groups) > 1 else groups[0]
            if msg_id.isdigit():
                return int(msg_id)
    
    return None


def is_telegram_link(text):
    """
    Check if text is a Telegram link.
    
    Args:
        text (str): Text to check
    
    Returns:
        bool: True if text contains t.me link
    """
    if not text:
        return False
    return 't.me/' in text.lower()
