"""
Helper Functions for Smart Group Tag Handling During Reconstruction

Add these functions to your reconstruction code to handle Group tag intelligently:
- Grouped photos → Treat as album (keep grouping)
- Grouped videos/documents/audio → Treat as standalone (ignore grouping)
"""

def should_treat_as_album(parsed_tags):
    """
    Determine if a message with Group tag should be treated as part of an album.
    
    Logic:
    - Photos with Group tag → True (treat as album)
    - Videos/Documents/Audio with Group tag → False (treat as standalone)
    
    Args:
        parsed_tags (dict): Result from parse_structured_tags() or parse_tags_flexible()
            Format: {
                'media': {'type': 'Photo', 'ext': 'jpg', 'duration': ''},
                'flags': ['Group', 'hash'],
                'forward': {...},
                'reply': ''
            }
    
    Returns:
        bool: True if should be treated as album, False if standalone
    
    Examples:
        >>> tags = parse_structured_tags("Photo(jpg); Group")
        >>> should_treat_as_album(tags)
        True
        
        >>> tags = parse_structured_tags("Video(mp4, 03:45); Group")
        >>> should_treat_as_album(tags)
        False
        
        >>> tags = parse_structured_tags("Document(pdf); Group")
        >>> should_treat_as_album(tags)
        False
    """
    # Check if Group flag is present
    has_group = 'Group' in parsed_tags.get('flags', [])
    
    if not has_group:
        return False
    
    # Check media type
    media_type = parsed_tags.get('media', {}).get('type', '')
    
    # Only Photos with Group tag are treated as albums
    return media_type == 'Photo'


def get_grouping_behavior(parsed_tags):
    """
    Get detailed grouping behavior information.
    
    Args:
        parsed_tags (dict): Result from parse_structured_tags()
    
    Returns:
        dict: Grouping behavior info
            {
                'has_group_tag': bool,
                'media_type': str,
                'treat_as_album': bool,
                'reason': str
            }
    
    Example:
        >>> tags = parse_structured_tags("Video(mp4); Group")
        >>> get_grouping_behavior(tags)
        {
            'has_group_tag': True,
            'media_type': 'Video',
            'treat_as_album': False,
            'reason': 'Videos with Group tag are treated as standalone'
        }
    """
    has_group = 'Group' in parsed_tags.get('flags', [])
    media_type = parsed_tags.get('media', {}).get('type', '')
    
    result = {
        'has_group_tag': has_group,
        'media_type': media_type,
        'treat_as_album': False,
        'reason': ''
    }
    
    if not has_group:
        result['reason'] = 'No Group tag - treat as standalone'
        return result
    
    if media_type == 'Photo':
        result['treat_as_album'] = True
        result['reason'] = 'Photo with Group tag - treat as album'
    elif media_type == 'Video':
        result['reason'] = 'Video with Group tag - treat as standalone'
    elif media_type == 'Document':
        result['reason'] = 'Document with Group tag - treat as standalone'
    elif media_type == 'Audio':
        result['reason'] = 'Audio with Group tag - treat as standalone'
    else:
        result['reason'] = f'{media_type or "Unknown"} with Group tag - treat as standalone'
    
    return result


def process_messages_with_smart_grouping(messages_data):
    """
    Process messages with smart Group tag handling.
    
    This function demonstrates how to use the grouping logic in your reconstruction code.
    
    Args:
        messages_data (list): List of message dictionaries from spreadsheet
            Each dict should have 'Tags' field
    
    Returns:
        dict: Processed messages categorized by grouping behavior
    
    Example:
        messages = [
            {'ID': '1', 'Tags': 'Photo(jpg); Group', 'Text': 'Photo 1'},
            {'ID': '2', 'Tags': 'Photo(jpg); Group', 'Text': 'Photo 2'},
            {'ID': '3', 'Tags': 'Video(mp4); Group', 'Text': 'Video 1'},
            {'ID': '4', 'Tags': 'Video(mp4); Group', 'Text': 'Video 2'},
        ]
        
        result = process_messages_with_smart_grouping(messages)
        # Photos 1 & 2 grouped together as album
        # Videos 1 & 2 processed separately as standalone
    """
    from google_sheets_helper import parse_tags_flexible
    
    result = {
        'albums': [],      # Photos with Group tag (keep as albums)
        'standalone': []   # Everything else (including grouped videos/docs)
    }
    
    for msg in messages_data:
        tags_str = msg.get('Tags', '')
        parsed_tags = parse_tags_flexible(tags_str)
        
        if should_treat_as_album(parsed_tags):
            result['albums'].append(msg)
        else:
            result['standalone'].append(msg)
    
    return result


# ============= USAGE EXAMPLES =============

def example_usage():
    """Examples of how to use the smart grouping functions."""
    from google_sheets_helper import parse_structured_tags
    
    print("=" * 70)
    print("SMART GROUP TAG HANDLING EXAMPLES")
    print("=" * 70)
    
    # Example 1: Grouped Photos (treat as album)
    print("\n1. GROUPED PHOTOS:")
    tags1 = parse_structured_tags("Photo(jpg); Group; hash")
    behavior1 = get_grouping_behavior(tags1)
    print(f"   Tags: Photo(jpg); Group; hash")
    print(f"   Treat as album? {behavior1['treat_as_album']}")
    print(f"   Reason: {behavior1['reason']}")
    
    # Example 2: Grouped Videos (treat as standalone)
    print("\n2. GROUPED VIDEOS:")
    tags2 = parse_structured_tags("Video(mp4, 03:45); Group")
    behavior2 = get_grouping_behavior(tags2)
    print(f"   Tags: Video(mp4, 03:45); Group")
    print(f"   Treat as album? {behavior2['treat_as_album']}")
    print(f"   Reason: {behavior2['reason']}")
    
    # Example 3: Grouped Documents (treat as standalone)
    print("\n3. GROUPED DOCUMENTS:")
    tags3 = parse_structured_tags("Document(pdf); Group")
    behavior3 = get_grouping_behavior(tags3)
    print(f"   Tags: Document(pdf); Group")
    print(f"   Treat as album? {behavior3['treat_as_album']}")
    print(f"   Reason: {behavior3['reason']}")
    
    # Example 4: Single Photo (no Group tag)
    print("\n4. SINGLE PHOTO:")
    tags4 = parse_structured_tags("Photo(jpg)")
    behavior4 = get_grouping_behavior(tags4)
    print(f"   Tags: Photo(jpg)")
    print(f"   Treat as album? {behavior4['treat_as_album']}")
    print(f"   Reason: {behavior4['reason']}")
    
    print("\n" + "=" * 70)


def example_reconstruction_workflow():
    """Example of complete reconstruction workflow with smart grouping."""
    print("\n" + "=" * 70)
    print("RECONSTRUCTION WORKFLOW EXAMPLE")
    print("=" * 70)
    
    # Simulated data from spreadsheet
    messages = [
        {'ID': '1', 'Tags': 'Photo(jpg); Group', 'Text': 'Beach photo 1'},
        {'ID': '2', 'Tags': 'Photo(jpg); Group', 'Text': 'Beach photo 2'},
        {'ID': '3', 'Tags': 'Photo(jpg); Group', 'Text': 'Beach photo 3'},
        {'ID': '4', 'Tags': 'Video(mp4, 03:45); Group', 'Text': 'Tutorial video 1'},
        {'ID': '5', 'Tags': 'Video(mp4, 02:15); Group', 'Text': 'Tutorial video 2'},
        {'ID': '6', 'Tags': 'Document(pdf); Group', 'Text': 'Report file 1'},
        {'ID': '7', 'Tags': 'Document(pdf); Group', 'Text': 'Report file 2'},
    ]
    
    print("\n📥 Input Messages:")
    for msg in messages:
        print(f"   ID {msg['ID']}: {msg['Tags']}")
    
    # Process with smart grouping
    from google_sheets_helper import parse_tags_flexible
    
    albums = []
    standalone = []
    
    for msg in messages:
        parsed = parse_tags_flexible(msg['Tags'])
        if should_treat_as_album(parsed):
            albums.append(msg)
        else:
            standalone.append(msg)
    
    print("\n📸 ALBUMS (grouped photos):")
    for msg in albums:
        print(f"   ID {msg['ID']}: {msg['Text']}")
    
    print("\n📄 STANDALONE (everything else):")
    for msg in standalone:
        print(f"   ID {msg['ID']}: {msg['Text']}")
    
    print("\n✅ Result:")
    print(f"   - Photos 1-3: Treated as single album (3 photos)")
    print(f"   - Videos 4-5: Treated as 2 separate standalone videos")
    print(f"   - Documents 6-7: Treated as 2 separate standalone documents")
    
    print("\n" + "=" * 70)


if __name__ == "__main__":
    example_usage()
    example_reconstruction_workflow()
