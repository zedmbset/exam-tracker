"""
Text Extraction Utilities - Tags Style
Hashtags stored as plain tags (without #), add # only when formatting for Telegram
"""
import re


# ============= EMOJI PATTERNS =============

EMOJI_PATTERN = re.compile(
    "["
    "\U0001F600-\U0001F64F"
    "\U0001F300-\U0001F5FF"
    "\U0001F680-\U0001F6FF"
    "\U0001F1E0-\U0001F1FF"
    "\U00002700-\U000027BF"
    "\U00002600-\U000026FF"
    "\U0001F900-\U0001F9FF"
    "\U0001FA00-\U0001FAFF"
    "\U00002300-\U000023FF"
    "\u203C-\u3299"
    "\uFE00-\uFE0F"
    "\u200D"
    "]+",
    flags=re.UNICODE
)

EMOJI_START_PATTERN = re.compile(
    r'^['
    r'\U0001F600-\U0001F64F'
    r'\U0001F300-\U0001F5FF'
    r'\U0001F680-\U0001F6FF'
    r'\U0001F1E0-\U0001F1FF'
    r'\U00002700-\U000027BF'
    r'\U00002600-\U000026FF'
    r'\U0001F900-\U0001F9FF'
    r'\U0001FA00-\U0001FAFF'
    r']\s+\w+',
    flags=re.UNICODE
)


# ============= HASHTAG UTILITIES (TAGS STYLE) =============

def extract_hashtags_from_line(line, as_tags=True):
    """
    Extract hashtags from a single line.
    
    Args:
        line (str): Text line to extract from
        as_tags (bool): If True, return without # (e.g., "news, tech")
                       If False, return with # (e.g., "#news #tech")
    
    Returns:
        str: Comma-separated tags OR space-separated hashtags
    
    Examples:
        >>> extract_hashtags_from_line("#news #tech", as_tags=True)
        'news, tech'
        
        >>> extract_hashtags_from_line("#news #tech", as_tags=False)
        '#news #tech'
    """
    if not line:
        return ''
    
    # Find all hashtags (# followed by word characters)
    hashtags = re.findall(r'#(\w+)', line)  # Captures without #
    
    if not hashtags:
        return ''
    
    if as_tags:
        # Return as comma-separated tags (no #)
        return ', '.join(hashtags)
    else:
        # Return as space-separated hashtags (with #)
        return ' '.join(f'#{tag}' for tag in hashtags)


def normalize_hashtags(hashtags_str, as_tags=True):
    """
    Normalize hashtags to consistent format.
    
    Args:
        hashtags_str (str): Hashtags in any format
        as_tags (bool): If True, output as "tag1, tag2, tag3"
                       If False, output as "#tag1 #tag2 #tag3"
    
    Returns:
        str: Normalized format
    
    Examples:
        >>> normalize_hashtags("#tag1 #tag2", as_tags=True)
        'tag1, tag2'
        
        >>> normalize_hashtags("tag1, tag2", as_tags=True)
        'tag1, tag2'
        
        >>> normalize_hashtags("tag1, tag2", as_tags=False)
        '#tag1 #tag2'
    """
    if not hashtags_str:
        return ''
    
    # Extract all word sequences (with or without #)
    words = re.findall(r'#?(\w+)', hashtags_str)
    
    # Filter out empty strings
    tags = [word.strip() for word in words if word.strip()]
    
    if not tags:
        return ''
    
    if as_tags:
        # Return as comma-separated tags (no #)
        return ', '.join(tags)
    else:
        # Return as space-separated hashtags (with #)
        return ' '.join(f'#{tag}' for tag in tags)


def format_hashtags_for_telegram(hashtags_str):
    """
    Format hashtags for Telegram message with tab separation.
    Converts tags to hashtags if needed.
    
    Args:
        hashtags_str (str): Tags string (e.g., "news, tech" OR "#news #tech")
    
    Returns:
        str: Tab-separated hashtags for Telegram (e.g., "#news\t#tech")
    
    Examples:
        >>> format_hashtags_for_telegram("news, tech, python")
        '#news\t#tech\t#python'
        
        >>> format_hashtags_for_telegram("#news #tech")
        '#news\t#tech'
    """
    if not hashtags_str:
        return ''
    
    # Normalize to hashtag format (with #)
    hashtags_with_hash = normalize_hashtags(hashtags_str, as_tags=False)
    
    # Replace spaces with tabs
    return hashtags_with_hash.replace(' ', '\t')


def tags_to_hashtags(tags_str):
    """
    Convert tags to hashtags.
    
    Args:
        tags_str (str): Tags like "news, tech, python"
    
    Returns:
        str: Hashtags like "#news #tech #python"
    
    Examples:
        >>> tags_to_hashtags("news, tech, python")
        '#news #tech #python'
    """
    return normalize_hashtags(tags_str, as_tags=False)


def hashtags_to_tags(hashtags_str):
    """
    Convert hashtags to tags.
    
    Args:
        hashtags_str (str): Hashtags like "#news #tech"
    
    Returns:
        str: Tags like "news, tech"
    
    Examples:
        >>> hashtags_to_tags("#news #tech #python")
        'news, tech, python'
    """
    return normalize_hashtags(hashtags_str, as_tags=True)


# ============= TITLE EXTRACTION =============

def extract_title(text, remove_emojis=True, remove_hashtags=True):
    """
    Extract title from text (first meaningful line).
    
    Args:
        text (str): Full text to extract from
        remove_emojis (bool): Remove emojis from title
        remove_hashtags (bool): Remove hashtags from title
    
    Returns:
        str: Extracted title (first non-empty line after cleaning)
    """
    if not text:
        return ''
    
    lines = text.split('\n')
    
    for line in lines:
        cleaned = line.strip()
        
        # Skip empty lines
        if not cleaned:
            continue
        
        # Skip hashtag-only lines
        if cleaned.startswith('#') and remove_hashtags:
            # Check if line is ONLY hashtags
            without_tags = re.sub(r'#\w+\s*', '', cleaned).strip()
            if not without_tags:
                continue
        
        # Remove emojis if requested
        if remove_emojis:
            cleaned = EMOJI_PATTERN.sub('', cleaned)
        
        # Remove hashtags if requested
        if remove_hashtags:
            cleaned = re.sub(r'#\w+\s*', '', cleaned)
        
        # Clean up extra spaces
        cleaned = ' '.join(cleaned.split()).strip()
        
        # Return first meaningful line
        if cleaned and len(cleaned) > 1:
            return cleaned
    
    return ''


def detect_emoji_title(text):
    """
    Detect if text starts with emoji followed by text pattern.
    
    Args:
        text (str): Text to check
    
    Returns:
        bool: True if starts with "emoji + space + text"
    """
    if not text:
        return False
    
    return bool(EMOJI_START_PATTERN.match(text.strip()))


# ============= COMPLETE TEXT PARSING (TAGS STYLE) =============

def parse_message_text(text, store_as_tags=True):
    """
    Parse message text into structured components.
    
    Args:
        text (str): Full message text
        store_as_tags (bool): If True, store hashtags as "tag1, tag2" (no #)
                             If False, store as "#tag1 #tag2"
    
    Returns:
        dict: {
            'hashtags': str,      # "tag1, tag2" OR "#tag1 #tag2"
            'title': str,         # Title without emojis/hashtags
            'description': str,   # Remaining text
            'has_emoji_title': bool
        }
    
    Example (store_as_tags=True):
        Input: "#news #tech\n🔥 Breaking News\n\nFull story"
        Output: {
            'hashtags': 'news, tech',  # NO # symbols
            'title': 'Breaking News',
            'description': 'Full story',
            'has_emoji_title': True
        }
    
    Example (store_as_tags=False):
        Input: "#news #tech\n🔥 Breaking News\n\nFull story"
        Output: {
            'hashtags': '#news #tech',  # WITH # symbols
            'title': 'Breaking News',
            'description': 'Full story',
            'has_emoji_title': True
        }
    """
    if not text:
        return {
            'hashtags': '',
            'title': '',
            'description': '',
            'has_emoji_title': False
        }
    
    lines = text.split('\n')
    hashtags = ''
    title = ''
    description_lines = []
    has_emoji_title = False
    title_found = False
    
    # Step 1: Extract first line hashtags (only if line STARTS with #)
    if lines and lines[0].strip().startswith('#'):
        hashtags = extract_hashtags_from_line(lines[0], as_tags=store_as_tags)
        lines = lines[1:]
    
    # Step 2: Find title (first non-empty, non-hashtag-only line)
    while lines and not title_found:
        line = lines[0].strip()
        
        if not line:
            lines = lines[1:]
            continue
        
        # Check if line is hashtags only
        if line.startswith('#'):
            without_tags = re.sub(r'#\w+\s*', '', line).strip()
            if not without_tags:
                lines = lines[1:]
                continue
        
        # Found title line
        has_emoji_title = detect_emoji_title(line)
        title = extract_title(line, remove_emojis=True, remove_hashtags=True)
        title_found = True
        lines = lines[1:]
        break
    
    # Step 3: Skip blank lines after title
    while lines and not lines[0].strip():
        lines = lines[1:]
    
    # Step 4: Everything else is description
    description = '\n'.join(lines).strip()
    
    return {
        'hashtags': hashtags,
        'title': title,
        'description': description,
        'has_emoji_title': has_emoji_title
    }


# ============= VALIDATION =============

def validate_text_parts(hashtags, title, description, max_total_length=4096):
    """
    Validate text components before sending to Telegram.
    
    Args:
        hashtags (str): Hashtags/tags string
        title (str): Title string
        description (str): Description string
        max_total_length (int): Maximum total length
    
    Returns:
        dict: Validation result
    """
    errors = []
    warnings = []
    
    hashtags = hashtags or ''
    title = title or ''
    description = description or ''
    
    # Convert tags to hashtags for length calculation
    hashtags_formatted = normalize_hashtags(hashtags, as_tags=False)
    
    # Calculate formatted length
    formatted_length = len(hashtags_formatted)
    if title:
        formatted_length += len(title) + (len(hashtags_formatted) > 0)
    if description:
        formatted_length += len(description) + 2
    
    # Check total length
    if formatted_length > max_total_length:
        errors.append(f"Total length {formatted_length} exceeds Telegram limit {max_total_length}")
    elif formatted_length > max_total_length * 0.9:
        warnings.append(f"Total length {formatted_length} is close to Telegram limit")
    
    # Check if all empty
    if not hashtags and not title and not description:
        errors.append("All text components are empty")
    
    # Check title length
    if title and len(title) > 200:
        warnings.append(f"Title is very long ({len(title)} chars)")
    
    return {
        'valid': len(errors) == 0,
        'errors': errors,
        'warnings': warnings,
        'total_length': formatted_length
    }


# ============= FORMATTING FOR TELEGRAM =============

def format_for_telegram(hashtags, title, description, add_emoji=True):
    """
    Format text components for Telegram message.
    Automatically converts tags to hashtags if needed.
    
    Format:
    - Line 1: #hashtags (tab-separated)
    - Line 2: 🔥 ***Title***
    - Line 3: Blank
    - Lines 4+: Description
    
    Args:
        hashtags (str): Tags like "news, tech" OR hashtags like "#news #tech"
        title (str): Title string
        description (str): Description string
        add_emoji (bool): Add 🔥 emoji before title
    
    Returns:
        str: Formatted text ready for Telegram
    
    Example:
        >>> format_for_telegram("news, tech", "Breaking News", "Full story")
        '#news\t#tech\n🔥 ***Breaking News***\n\nFull story'
    """
    lines = []
    
    # Format hashtags (converts tags to hashtags if needed)
    if hashtags:
        formatted_tags = format_hashtags_for_telegram(hashtags)
        if formatted_tags:
            lines.append(formatted_tags)
    
    # Format title
    if title:
        clean_title = title.strip()
        if add_emoji:
            formatted_title = f"🔥 {clean_title}"
        else:
            formatted_title = f"{clean_title}"
        lines.append(formatted_title)
    
    # Add blank line
    if lines:
        lines.append('')
    
    # Add description
    if description:
        lines.append(description.strip())
    
    return '\n'.join(lines)




# ============= ENTITY OFFSET RECALCULATION =============

def recalculate_entity_offsets_for_transfer(entities, hashtags, title):
    """
    Recalculate entity offsets when transferring messages.
    
    When we transfer a message, we reconstruct it as:
    #hashtags\t#hashtags    ← Line 1
    🔥 Title                ← Line 2
    (blank line)           ← Line 3
    Description            ← Line 4+ (entities apply here)
    
    Original entities are for DESCRIPTION ONLY (from Description_Format_JSON).
    We need to adjust their offsets to account for the hashtags + title above them.
    
    Args:
        entities (list): List of entity dicts from Description_Format_JSON
        hashtags (str): Hashtags string (e.g., "news, tech")
        title (str): Title string
    
    Returns:
        list: Entities with recalculated offsets
    
    Example:
        Original description entity: {offset: 0, length: 10, type: "Bold"}
        After adding hashtags + title, offset becomes: 25 (not 0!)
    """
    if not entities:
        return []
    
    # Calculate where description starts in the reconstructed message
    offset = 0
    
    # Add hashtags line length
    if hashtags:
        hashtag_line = format_hashtags_for_telegram(hashtags)
        offset += len(hashtag_line) + 1  # +1 for newline
    
    # Add title line length
    if title:
        title_line = f"🔥 {title}"
        offset += len(title_line) + 2  # +2 for double newline (blank line)
    
    # Adjust all entity offsets
    adjusted_entities = []
    for entity in entities:
        adjusted = entity.copy()
        adjusted['offset'] = entity['offset'] + offset
        adjusted_entities.append(adjusted)
    
    return adjusted_entities


# ============= TESTING =============

if __name__ == "__main__":
    print("=" * 60)
    print("TAGS STYLE TEXT EXTRACTION - TEST SUITE")
    print("=" * 60)
    
    # Test cases
    test_cases = [
        {
            'name': 'Standard format with hashtags',
            'text': '#news #tech #python\n🔥 Breaking News Title\n\nThis is the description'
        },
        {
            'name': 'No hashtags',
            'text': '🔥 Just a Title\n\nDescription here'
        },
        {
            'name': 'Multiple hashtag lines',
            'text': '#tag1 #tag2\n#tag3\nTitle Here\n\nDescription'
        }
    ]
    
    for i, test in enumerate(test_cases, 1):
        print(f"\n{'=' * 60}")
        print(f"TEST {i}: {test['name']}")
        print(f"{'=' * 60}")
        print(f"Input:\n{repr(test['text'])}\n")
        
        # Parse as TAGS (store_as_tags=True)
        result = parse_message_text(test['text'], store_as_tags=True)
        print(f"Parsed (as tags):")
        print(f"  Hashtags: {repr(result['hashtags'])} ← NO # symbols!")
        print(f"  Title: {repr(result['title'])}")
        print(f"  Description: {repr(result['description'])}")
        
        # Format back for Telegram
        formatted = format_for_telegram(
            result['hashtags'],
            result['title'],
            result['description']
        )
        print(f"\nFormatted for Telegram:")
        print(formatted)
        print(f"\n← Notice: # symbols added back automatically!")
    
    print("\n" + "=" * 60)
    print("CONVERSION TESTS")
    print("=" * 60)
    
    print("\nTags → Hashtags:")
    print(f"  Input:  'news, tech, python'")
    print(f"  Output: '{tags_to_hashtags('news, tech, python')}'")
    
    print("\nHashtags → Tags:")
    print(f"  Input:  '#news #tech #python'")
    print(f"  Output: '{hashtags_to_tags('#news #tech #python')}'")


# ============= TAG PARSING UTILITIES =============

def parse_structured_tags(tags_str):
    """
    Parse structured tags string into components.
    
    Format: Video(mp4, 03:45); Group; hash; Forward(John Doe, 123); Reply(42)
    
    Args:
        tags_str (str): Structured tags string
    
    Returns:
        dict: {
            'media': {
                'type': str,       # e.g., "Video", "Audio File"
                'ext': str,        # e.g., "mp4", "mp3"
                'duration': str    # e.g., "03:45"
            },
            'flags': list,         # e.g., ["Group", "hash", "Title"]
            'forward': {
                'name': str,
                'id': str
            },
            'reply': str           # Reply message ID
        }
    
    Examples:
        >>> parse_structured_tags("Video(mp4, 03:45); Group; hash")
        {
            'media': {'type': 'Video', 'ext': 'mp4', 'duration': '03:45'},
            'flags': ['Group', 'hash'],
            'forward': {'name': '', 'id': ''},
            'reply': ''
        }
    """
    result = {
        'media': {'type': '', 'ext': '', 'duration': ''},
        'flags': [],
        'forward': {'name': '', 'id': ''},
        'reply': ''
    }
    
    if not tags_str:
        return result
    
    # Split by semicolon
    parts = [p.strip() for p in tags_str.split(';')]
    
    for part in parts:
        if not part:
            continue
        
        # Check for media with params: Video(mp4, 03:45)
        media_match = re.match(r'^(.+?)\(([^)]+)\)$', part)
        if media_match:
            media_type = media_match.group(1).strip()
            params = [p.strip() for p in media_match.group(2).split(',')]
            
            # Check if it's Forward or Reply
            if media_type == 'Forward':
                if len(params) >= 2:
                    result['forward']['name'] = params[0]
                    result['forward']['id'] = params[1]
                elif len(params) == 1:
                    # Could be name or ID
                    if params[0].isdigit():
                        result['forward']['id'] = params[0]
                    else:
                        result['forward']['name'] = params[0]
            elif media_type == 'Reply':
                if params:
                    result['reply'] = params[0]
            else:
                # It's media
                result['media']['type'] = media_type
                if len(params) >= 1:
                    result['media']['ext'] = params[0]
                if len(params) >= 2:
                    result['media']['duration'] = params[1]
            
            continue
        
        # Check for simple flags or media types without params
        if part in ['Group', 'hash', 'Title']:
            result['flags'].append(part)
        elif part in ['Photo', 'Sticker', 'Poll', 'Link']:
            result['media']['type'] = part
    
    return result


def build_structured_tags(media_type='', media_ext='', duration='', 
                          flags=None, forward_name='', forward_id='', 
                          reply_to_id=''):
    """
    Build structured tags string from components.
    
    Args:
        media_type (str): Media type (e.g., "Video", "Audio File", "Photo")
        media_ext (str): File extension (e.g., "mp4", "mp3")
        duration (str): Duration (e.g., "03:45")
        flags (list): Content flags (e.g., ["Group", "hash", "Title"])
        forward_name (str): Forward source name
        forward_id (str): Forward source ID
        reply_to_id (str): Reply message ID
    
    Returns:
        str: Structured tags string
    
    Examples:
        >>> build_structured_tags(
        ...     media_type="Video",
        ...     media_ext="mp4",
        ...     duration="03:45",
        ...     flags=["Group", "hash"],
        ...     forward_name="John Doe",
        ...     forward_id="123456789"
        ... )
        'Video(mp4, 03:45); Group; hash; Forward(John Doe, 123456789)'
    """
    components = []
    
    # 1. Media info
    if media_type:
        media_part = media_type
        
        # Add parameters if available
        params = []
        if media_ext:
            params.append(media_ext)
        if duration:
            params.append(duration)
        
        if params:
            media_part += f"({', '.join(params)})"
        
        components.append(media_part)
    
    # 2. Content flags
    if flags:
        components.extend(flags)
    
    # 3. Forward info
    if forward_name or forward_id:
        if forward_name and forward_id:
            components.append(f"Forward({forward_name}, {forward_id})")
        elif forward_name:
            components.append(f"Forward({forward_name})")
        elif forward_id:
            components.append(f"Forward({forward_id})")
    
    # 4. Reply info
    if reply_to_id:
        components.append(f"Reply({reply_to_id})")
    
    return '; '.join(components) if components else ''


# ============= LEGACY PARSING (for migration) =============

def parse_legacy_forwarded_from(forwarded_str):
    """
    Parse legacy forwarded format.
    
    Args:
        forwarded_str (str): Legacy format like "John Doe_id:123456789"
    
    Returns:
        tuple: (name, id)
    
    Examples:
        >>> parse_legacy_forwarded_from("John Doe_id:123456789")
        ('John Doe', '123456789')
        
        >>> parse_legacy_forwarded_from("_id:123456789")
        ('', '123456789')
    """
    if not forwarded_str:
        return '', ''
    
    name = ''
    user_id = ''
    
    if '_id:' in forwarded_str:
        parts = forwarded_str.split('_id:')
        name = parts[0].strip()
        user_id = parts[1].strip() if len(parts) > 1 else ''
    else:
        name = forwarded_str.strip()
    
    return name, user_id




# ============= ENTITY OFFSET RECALCULATION =============

def recalculate_entity_offsets_for_transfer(entities, hashtags, title):
    """
    Recalculate entity offsets when transferring messages.
    
    When we transfer a message, we reconstruct it as:
    #hashtags\t#hashtags    ← Line 1
    🔥 Title                ← Line 2
    (blank line)           ← Line 3
    Description            ← Line 4+ (entities apply here)
    
    Original entities are for DESCRIPTION ONLY (from Description_Format_JSON).
    We need to adjust their offsets to account for the hashtags + title above them.
    
    Args:
        entities (list): List of entity dicts from Description_Format_JSON
        hashtags (str): Hashtags string (e.g., "news, tech")
        title (str): Title string
    
    Returns:
        list: Entities with recalculated offsets
    
    Example:
        Original description entity: {offset: 0, length: 10, type: "Bold"}
        After adding hashtags + title, offset becomes: 25 (not 0!)
    """
    if not entities:
        return []
    
    # Calculate where description starts in the reconstructed message
    offset = 0
    
    # Add hashtags line length
    if hashtags:
        hashtag_line = format_hashtags_for_telegram(hashtags)
        offset += len(hashtag_line) + 1  # +1 for newline
    
    # Add title line length
    if title:
        title_line = f"🔥 {title}"
        offset += len(title_line) + 2  # +2 for double newline (blank line)
    
    # Adjust all entity offsets
    adjusted_entities = []
    for entity in entities:
        adjusted = entity.copy()
        adjusted['offset'] = entity['offset'] + offset
        adjusted_entities.append(adjusted)
    
    return adjusted_entities


# ============= TESTING =============

if __name__ == "__main__":
    print("=" * 60)
    print("TAG UTILITIES TEST SUITE")
    print("=" * 60)
    
    # Test 1: Build and parse full tags
    print("\nTest 1: Full tags with all components")
    print("-" * 60)
    
    built = build_structured_tags(
        media_type="Video",
        media_ext="mp4",
        duration="03:45",
        flags=["Group", "hash", "Title"],
        forward_name="John Doe",
        forward_id="123456789",
        reply_to_id="42"
    )
    print(f"Built: {built}")
    
    parsed = parse_structured_tags(built)
    print(f"Parsed:")
    print(f"  Media: {parsed['media']}")
    print(f"  Flags: {parsed['flags']}")
    print(f"  Forward: {parsed['forward']}")
    print(f"  Reply: {parsed['reply']}")
    
    # Test 2: Simple media without params
    print("\nTest 2: Simple photo with hash")
    print("-" * 60)
    
    built = build_structured_tags(
        media_type="Photo",
        flags=["hash"]
    )
    print(f"Built: {built}")
    parsed = parse_structured_tags(built)
    print(f"Parsed: {parsed}")
    
    # Test 3: Audio with duration only
    print("\nTest 3: Audio with duration")
    print("-" * 60)
    
    built = build_structured_tags(
        media_type="Audio File",
        media_ext="mp3",
        duration="12:30"
    )
    print(f"Built: {built}")
    parsed = parse_structured_tags(built)
    print(f"Parsed: {parsed}")
    
    # Test 4: Legacy forwarded format
    print("\nTest 4: Parse legacy forwarded format")
    print("-" * 60)
    
    legacy_formats = [
        "John Doe_id:123456789",
        "_id:987654321",
        "Alice Smith"
    ]
    
    for legacy in legacy_formats:
        name, user_id = parse_legacy_forwarded_from(legacy)
        print(f"Legacy: {legacy}")
        print(f"  Name: {name}, ID: {user_id}")