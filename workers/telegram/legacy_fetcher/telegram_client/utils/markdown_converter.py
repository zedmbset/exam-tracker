"""
Markdown Converter Utility
===========================
Converts between Telegram entities and Markdown format
"""

import re
from telethon.tl import types


def _utf16_offset_to_python(text, utf16_offset):
    """Convert UTF-16 offset to Python string index."""
    utf16_pos = 0
    for python_pos, char in enumerate(text):
        if utf16_pos >= utf16_offset:
            return python_pos
        utf16_pos += 1 if ord(char) < 0x10000 else 2
    return len(text)


def _python_offset_to_utf16(text, python_offset):
    """
    Convert Python string index to UTF-16 offset (used by Telegram).
    This is the REVERSE of _utf16_offset_to_python().
    """
    utf16_pos = 0
    for i, char in enumerate(text):
        if i >= python_offset:
            return utf16_pos
        # Count UTF-16 code units for this character
        utf16_pos += 2 if ord(char) >= 0x10000 else 1
    return utf16_pos


def validate_entity_positions(text, entities):
    """
    Validate that entities don't include leading/trailing newlines.
    
    This function checks if entities have been properly cleaned.
    Entities should point to actual content, not whitespace.
    
    Args:
        text (str): Text to validate against
        entities (list): List of entity objects
    
    Returns:
        dict: {
            'valid': bool,
            'errors': list of error messages,
            'warnings': list of warning messages
        }
    """
    if not entities:
        return {'valid': True, 'errors': [], 'warnings': []}
    
    errors = []
    warnings = []
    
    for i, entity in enumerate(entities):
        # Get entity text
        start = _utf16_offset_to_python(text, entity.offset)
        end = _utf16_offset_to_python(text, entity.offset + entity.length)
        
        if start >= len(text) or end > len(text):
            errors.append(f"Entity {i} ({entity.__class__.__name__}) out of bounds")
            continue
        
        covered_text = text[start:end]
        
        # Check for leading newline
        if covered_text.startswith('\n'):
            errors.append(f"Entity {i} ({entity.__class__.__name__}) includes leading newline")
        
        # Check for trailing newline (except blockquote)
        if entity.__class__.__name__ != 'MessageEntityBlockquote':
            if covered_text.endswith('\n'):
                warnings.append(f"Entity {i} ({entity.__class__.__name__}) includes trailing newline")
        
        # Check for all-whitespace entity
        if not covered_text.strip():
            errors.append(f"Entity {i} ({entity.__class__.__name__}) covers only whitespace")
    
    return {
        'valid': len(errors) == 0,
        'errors': errors,
        'warnings': warnings
    }


def adjust_entity_offsets(text, entities):
    """
    Fix entities that incorrectly include leading/trailing newlines.
    
    Problem: Telegram entities often include \n at start/end of formatted text
    Example: Bold entity covers "\nbold" instead of "bold"
    
    CRITICAL FIX: Telegram entities that start with \n are also 1 char too short!
    Example: Entity covers "\nbol" but should cover "\nbold"
    
    Solution: Trim newlines, adjust offsets, AND extend length by 1 if needed
    
    Args:
        text (str): Original text
        entities (list): List of Telegram entity objects
    
    Returns:
        list: Adjusted entity objects
    """
    if not entities:
        return []
    
    from telethon.tl import types
    
    adjusted = []
    
    for entity in entities:
        # Get Python positions from UTF-16 offsets
        start_pos = _utf16_offset_to_python(text, entity.offset)
        end_pos = _utf16_offset_to_python(text, entity.offset + entity.length)
        
        # Get covered text
        covered_text = text[start_pos:end_pos]
        
        # Track adjustments
        offset_adjustment = 0
        length_adjustment = 0
        needs_extension = False
        
        # Check if entity starts with newline (the problematic pattern)
        if covered_text and covered_text[0] == '\n':
            needs_extension = True  # Mark for extension
        
        # Trim leading newlines
        while covered_text and covered_text[0] == '\n':
            covered_text = covered_text[1:]
            offset_adjustment += 1
            length_adjustment -= 1
        
        # Trim trailing newlines (but keep one if it's part of blockquote)
        if entity.__class__.__name__ != 'MessageEntityBlockquote':
            while covered_text and covered_text[-1] == '\n':
                covered_text = covered_text[:-1]
                length_adjustment -= 1
        
        # Only adjust if text remains
        if not covered_text:
            # Entity was only newlines, skip it
            continue
        
        # CRITICAL FIX: If entity started with \n, extend by 1 to get the missing char
        if needs_extension:
            # Check if there's a character after the current end position
            new_end = start_pos + offset_adjustment + len(covered_text)
            if new_end < len(text) and text[new_end] not in ['\n']:
                # There's a valid character we should include
                covered_text += text[new_end]
                length_adjustment += 1
        
        # Calculate new UTF-16 offset and length
        new_offset = entity.offset + offset_adjustment
        new_length = entity.length + length_adjustment
        
        # Skip if length becomes zero or negative
        if new_length <= 0:
            continue
        
        # Create adjusted entity
        entity_class = type(entity)
        
        try:
            if isinstance(entity, types.MessageEntityTextUrl):
                adjusted_entity = entity_class(new_offset, new_length, entity.url)
            elif isinstance(entity, types.MessageEntityPre):
                adjusted_entity = entity_class(new_offset, new_length, entity.language)
            elif isinstance(entity, types.MessageEntityCustomEmoji):
                # Custom emojis need document_id parameter
                adjusted_entity = entity_class(new_offset, new_length, entity.document_id)
            elif isinstance(entity, types.MessageEntityMentionName):
                # Mention names need user_id parameter
                adjusted_entity = entity_class(new_offset, new_length, entity.user_id)
            else:
                adjusted_entity = entity_class(new_offset, new_length)
            
            adjusted.append(adjusted_entity)
        except Exception as e:
            print(f"⚠ Could not adjust entity {entity_class.__name__}: {e}")
            # Keep original if adjustment fails
            adjusted.append(entity)
    
    return adjusted


def filter_and_adjust_description_entities(text, entities, desc_start_pos):
    """
    Filter entities for description and adjust their offsets.
    
    Args:
        text (str): Full message text
        entities (list): All message entities
        desc_start_pos (int): Python string position where description starts
    
    Returns:
        tuple: (description_text, adjusted_entities_for_description)
    """
    if not entities:
        return text[desc_start_pos:], []
    
    from telethon.tl import types
    
    # Get description text
    desc_text = text[desc_start_pos:]
    
    # Filter entities that belong to description
    desc_entities = []
    
    for entity in entities:
        # Skip hashtag entities
        if isinstance(entity, types.MessageEntityHashtag):
            continue
        
        # Get entity positions in original text
        entity_start = _utf16_offset_to_python(text, entity.offset)
        entity_end = _utf16_offset_to_python(text, entity.offset + entity.length)
        
        # Skip entities completely before description
        if entity_end <= desc_start_pos:
            continue
        
        # Skip entities that start before description but end after
        # (these span the title/description boundary and would cause issues)
        if entity_start < desc_start_pos and entity_end > desc_start_pos:
            # Trim the entity to only include description part
            trimmed_start = desc_start_pos
            trimmed_text = text[trimmed_start:entity_end]
            
            # Calculate new offset relative to description
            new_offset_in_desc = 0  # Starts at beginning of description
            
            # Calculate UTF-16 length of trimmed text
            new_length = len(trimmed_text.encode('utf-16-le')) // 2
            
            # Create trimmed entity
            entity_class = type(entity)
            try:
                if isinstance(entity, types.MessageEntityTextUrl):
                    trimmed_entity = entity_class(new_offset_in_desc, new_length, entity.url)
                elif isinstance(entity, types.MessageEntityPre):
                    trimmed_entity = entity_class(new_offset_in_desc, new_length, entity.language)
                elif isinstance(entity, types.MessageEntityCustomEmoji):
                    trimmed_entity = entity_class(new_offset_in_desc, new_length, entity.document_id)
                elif isinstance(entity, types.MessageEntityMentionName):
                    trimmed_entity = entity_class(new_offset_in_desc, new_length, entity.user_id)
                else:
                    trimmed_entity = entity_class(new_offset_in_desc, new_length)
                
                desc_entities.append(trimmed_entity)
            except:
                pass  # Skip if trimming fails
            
            continue
        
        # Include entities that start within description
        if entity_start >= desc_start_pos:
            # Calculate offset relative to description start (in UTF-16 units)
            prefix_text = text[desc_start_pos:entity_start]
            offset_in_desc = len(prefix_text.encode('utf-16-le')) // 2
            
            # Create entity with adjusted offset
            entity_class = type(entity)
            
            try:
                if isinstance(entity, types.MessageEntityTextUrl):
                    adjusted_entity = entity_class(offset_in_desc, entity.length, entity.url)
                elif isinstance(entity, types.MessageEntityPre):
                    adjusted_entity = entity_class(offset_in_desc, entity.length, entity.language)
                elif isinstance(entity, types.MessageEntityCustomEmoji):
                    adjusted_entity = entity_class(offset_in_desc, entity.length, entity.document_id)
                elif isinstance(entity, types.MessageEntityMentionName):
                    adjusted_entity = entity_class(offset_in_desc, entity.length, entity.user_id)
                else:
                    adjusted_entity = entity_class(offset_in_desc, entity.length)
                
                desc_entities.append(adjusted_entity)
            except Exception as e:
                print(f"⚠ Could not adjust entity {entity_class.__name__}: {e}")
    
    # Now adjust for leading/trailing newlines
    adjusted_desc_entities = adjust_entity_offsets(desc_text, desc_entities)
    
    return desc_text, adjusted_desc_entities


def telegram_entities_to_markdown(text, entities):
    """Convert Telegram entities to Markdown (STORAGE - this works perfectly!)"""
    if not entities or not text:
        return text
    
    # Validate entities before conversion
    validation = validate_entity_positions(text, entities)
    if not validation['valid']:
        print("⚠️  Entity validation warnings:")
        for error in validation['errors']:
            print(f"   - {error}")
    
    try:
        from telethon.tl import types
        
        def utf16_offset_to_python(text, utf16_offset):
            utf16_pos = 0
            for python_pos, char in enumerate(text):
                if utf16_pos >= utf16_offset:
                    return python_pos
                utf16_pos += 2 if ord(char) >= 0x10000 else 1
            return len(text)
        
        entity_list = []
        for ent in entities:
            if isinstance(ent, dict):
                entity_list.append({
                    'type': ent.get('type', ''),
                    'offset': ent.get('offset', 0),
                    'length': ent.get('length', 0),
                    'url': ent.get('url', ''),
                    'language': ent.get('language', '')
                })
            else:
                entity_list.append({
                    'type': ent.__class__.__name__,
                    'offset': ent.offset,
                    'length': ent.length,
                    'url': getattr(ent, 'url', ''),
                    'language': getattr(ent, 'language', '')
                })
        
        entity_list.sort(key=lambda x: (x['offset'], -x['length']))
        
        position_map = {}
        blockquote_ranges = []
        
        for entity in entity_list:
            entity_type = entity['type']
            offset = entity['offset']
            length = entity['length']
            
            start_pos = utf16_offset_to_python(text, offset)
            end_pos = utf16_offset_to_python(text, offset + length)
            
            if start_pos >= len(text) or end_pos > len(text):
                continue
            
            if entity_type == 'MessageEntityBlockquote':
                blockquote_ranges.append((start_pos, end_pos))
                continue
            
            if entity_type == 'MessageEntityBold':
                open_marker, close_marker = '**', '**'
            elif entity_type == 'MessageEntityItalic':
                open_marker, close_marker = '*', '*'
            elif entity_type == 'MessageEntityUnderline':
                open_marker, close_marker = '__', '__'
            elif entity_type == 'MessageEntityStrike':
                open_marker, close_marker = '~~', '~~'
            elif entity_type == 'MessageEntityCode':
                open_marker, close_marker = '`', '`'
            elif entity_type == 'MessageEntityPre':
                # Extract the actual code content
                code_text = text[start_pos:end_pos]
                lang = entity.get('language', '')
                
                # FIX: If language is present OR content has newlines, use multi-line format
                # This ensures `pythonprint('hi')` doesn't happen.
                has_newlines = '\n' in code_text
                
                if lang or has_newlines:
                    # Multi-line code block - force newlines for structure
                    open_marker = f'```{lang}\n' if lang else '```\n'
                    close_marker = '\n```'
                else:
                    # Single-line code block - no newlines
                    open_marker = '```'
                    close_marker = '```'

            elif entity_type == 'MessageEntityTextUrl':
                url = entity.get('url', '')
                open_marker, close_marker = '[', f']({url})'
            elif entity_type == 'MessageEntitySpoiler':
                open_marker, close_marker = '||', '||'
            else:
                continue
            
            if start_pos not in position_map:
                position_map[start_pos] = {'open': [], 'close': []}
            if end_pos not in position_map:
                position_map[end_pos] = {'open': [], 'close': []}
            
            position_map[start_pos]['open'].append(open_marker)
            if end_pos > 0:
                if (end_pos - 1) not in position_map:
                    position_map[end_pos - 1] = {'open': [], 'close': []}
                if 'close_after' not in position_map[end_pos - 1]:
                    position_map[end_pos - 1]['close_after'] = []
                position_map[end_pos - 1]['close_after'].insert(0, close_marker)
        
        result = []
        for i, char in enumerate(text):
            is_blockquote_line = False
            for bq_start, bq_end in blockquote_ranges:
                if bq_start <= i < bq_end:
                    if i == bq_start or (i > 0 and text[i-1] == '\n'):
                        is_blockquote_line = True
                        break
            
            if is_blockquote_line:
                result.append('> ')
            
            if i in position_map and 'open' in position_map[i]:
                for marker in position_map[i]['open']:
                    result.append(marker)
            
            result.append(char)
            
            if i in position_map and 'close_after' in position_map[i]:
                for marker in position_map[i]['close_after']:
                    result.append(marker)
        
        return ''.join(result)
        
    except Exception as e:
        print(f"⚠️  Markdown conversion error: {e}")
        return text


def markdown_to_telegram_entities(text):
    """
    Convert Markdown to Telegram entities with PROPER ordering.
    """
    if not text:
        return text, []
    
    try:
        entities = []
        plain_chars = []
        i = 0
        stack = []  # Stack of (type, start_position, marker_info) tuples
        
        while i < len(text):
            char = text[i]
            matched = False
            
            # ==========================================
            # CRITICAL: Check longest patterns FIRST
            # ==========================================
            
            # ========== 5-CHARACTER PATTERNS ==========
            if i + 4 < len(text):
                five_char = text[i:i+5]
                
                # Pattern: ***__ or __*** (Bold + Italic + Underline)
                if five_char in ['***__', '__***']:
                    has_bold = any(s[0] == 'bold' for s in stack)
                    has_italic = any(s[0] == 'italic' for s in stack)
                    has_underline = any(s[0] == 'underline' for s in stack)
                    
                    if has_bold and has_italic and has_underline:
                        # CLOSING
                        new_stack = []
                        bold_start = None
                        italic_start = None
                        underline_start = None
                        
                        for typ, start_py, marker in stack:
                            if typ == 'bold' and bold_start is None:
                                bold_start = start_py
                            elif typ == 'italic' and italic_start is None:
                                italic_start = start_py
                            elif typ == 'underline' and underline_start is None:
                                underline_start = start_py
                            else:
                                new_stack.append((typ, start_py, marker))
                        
                        stack = new_stack
                        
                        # Create entities in CORRECT order for nesting
                        plain_so_far = ''.join(plain_chars)
                        end_py = len(plain_chars)
                        
                        # Order matters! Add in visual nesting order
                        if bold_start is not None:
                            start_utf16 = _python_offset_to_utf16(plain_so_far, bold_start)
                            end_utf16 = _python_offset_to_utf16(plain_so_far, end_py)
                            entities.append(types.MessageEntityBold(start_utf16, end_utf16 - start_utf16))
                        
                        if italic_start is not None:
                            start_utf16 = _python_offset_to_utf16(plain_so_far, italic_start)
                            end_utf16 = _python_offset_to_utf16(plain_so_far, end_py)
                            entities.append(types.MessageEntityItalic(start_utf16, end_utf16 - start_utf16))
                        
                        if underline_start is not None:
                            start_utf16 = _python_offset_to_utf16(plain_so_far, underline_start)
                            end_utf16 = _python_offset_to_utf16(plain_so_far, end_py)
                            entities.append(types.MessageEntityUnderline(start_utf16, end_utf16 - start_utf16))
                    else:
                        # OPENING: Track which marker opened it
                        stack.append(('bold', len(plain_chars), five_char))
                        stack.append(('italic', len(plain_chars), five_char))
                        stack.append(('underline', len(plain_chars), five_char))
                    
                    i += 5
                    matched = True
            
            if matched:
                continue
            
            # ========== 4-CHARACTER PATTERNS ==========
            if i + 3 < len(text):
                four_char = text[i:i+4]
                
                # Pattern: **** (Empty Bold)
                # CRITICAL FIX: Must detect this BEFORE 3-char patterns like ***
                if four_char == '****':
                    i += 4
                    matched = True
                    continue

                # Pattern: **__ or __** (Bold + Underline)
                if four_char in ['**__', '__**']:
                    has_bold = any(s[0] == 'bold' for s in stack)
                    has_underline = any(s[0] == 'underline' for s in stack)
                    
                    if has_bold and has_underline:
                        # CLOSING
                        new_stack = []
                        bold_start = None
                        underline_start = None
                        
                        for typ, start_py, marker in stack:
                            if typ == 'bold' and bold_start is None:
                                bold_start = start_py
                            elif typ == 'underline' and underline_start is None:
                                underline_start = start_py
                            else:
                                new_stack.append((typ, start_py, marker))
                        
                        stack = new_stack
                        
                        plain_so_far = ''.join(plain_chars)
                        end_py = len(plain_chars)
                        
                        # Add in correct order
                        if bold_start is not None:
                            start_utf16 = _python_offset_to_utf16(plain_so_far, bold_start)
                            end_utf16 = _python_offset_to_utf16(plain_so_far, end_py)
                            entities.append(types.MessageEntityBold(start_utf16, end_utf16 - start_utf16))
                        
                        if underline_start is not None:
                            start_utf16 = _python_offset_to_utf16(plain_so_far, underline_start)
                            end_utf16 = _python_offset_to_utf16(plain_so_far, end_py)
                            entities.append(types.MessageEntityUnderline(start_utf16, end_utf16 - start_utf16))
                    else:
                        # OPENING
                        stack.append(('bold', len(plain_chars), four_char))
                        stack.append(('underline', len(plain_chars), four_char))
                    
                    i += 4
                    matched = True
                
                # Pattern: *__ or __* (Italic + Underline)
                elif four_char in ['*__', '__*']:
                    if four_char == '*__':
                        if i > 0 and i >= 2 and text[i-2:i] == '**':
                            plain_chars.append(char)
                            i += 1
                            continue
                    elif four_char == '__*':
                        if i + 4 < len(text) and text[i+3:i+5] == '**':
                            plain_chars.append(char)
                            i += 1
                            continue
                    
                    has_italic = any(s[0] == 'italic' for s in stack)
                    has_underline = any(s[0] == 'underline' for s in stack)
                    
                    if has_italic and has_underline:
                        # CLOSING
                        new_stack = []
                        italic_start = None
                        underline_start = None
                        opening_marker = None
                        
                        for typ, start_py, marker in stack:
                            if typ == 'italic' and italic_start is None:
                                italic_start = start_py
                                opening_marker = marker
                            elif typ == 'underline' and underline_start is None:
                                underline_start = start_py
                            else:
                                new_stack.append((typ, start_py, marker))
                        
                        stack = new_stack
                        
                        plain_so_far = ''.join(plain_chars)
                        end_py = len(plain_chars)
                        
                        if italic_start is not None:
                            start_utf16 = _python_offset_to_utf16(plain_so_far, italic_start)
                            end_utf16 = _python_offset_to_utf16(plain_so_far, end_py)
                            entities.append(types.MessageEntityItalic(start_utf16, end_utf16 - start_utf16))
                        
                        if underline_start is not None:
                            start_utf16 = _python_offset_to_utf16(plain_so_far, underline_start)
                            end_utf16 = _python_offset_to_utf16(plain_so_far, end_py)
                            entities.append(types.MessageEntityUnderline(start_utf16, end_utf16 - start_utf16))
                    else:
                        # OPENING
                        stack.append(('italic', len(plain_chars), four_char))
                        stack.append(('underline', len(plain_chars), four_char))
                    
                    i += 4
                    matched = True
            
            if matched:
                continue
            
            # ========== 3-CHARACTER PATTERNS ==========
            if i + 2 < len(text):
                three_char = text[i:i+3]
                
                # Pattern: *** (Bold + Italic)
                if three_char == '***':
                    has_bold = any(s[0] == 'bold' for s in stack)
                    has_italic = any(s[0] == 'italic' for s in stack)
                    
                    if has_bold and has_italic:
                        # CLOSING
                        new_stack = []
                        bold_start = None
                        italic_start = None
                        
                        for typ, start_py, marker in stack:
                            if typ == 'bold' and bold_start is None:
                                bold_start = start_py
                            elif typ == 'italic' and italic_start is None:
                                italic_start = start_py
                            else:
                                new_stack.append((typ, start_py, marker))
                        
                        stack = new_stack
                        
                        plain_so_far = ''.join(plain_chars)
                        end_py = len(plain_chars)
                        
                        # Standard order: Bold then Italic
                        if bold_start is not None:
                            start_utf16 = _python_offset_to_utf16(plain_so_far, bold_start)
                            end_utf16 = _python_offset_to_utf16(plain_so_far, end_py)
                            entities.append(types.MessageEntityBold(start_utf16, end_utf16 - start_utf16))
                        
                        if italic_start is not None:
                            start_utf16 = _python_offset_to_utf16(plain_so_far, italic_start)
                            end_utf16 = _python_offset_to_utf16(plain_so_far, end_py)
                            entities.append(types.MessageEntityItalic(start_utf16, end_utf16 - start_utf16))
                    else:
                        # OPENING
                        stack.append(('bold', len(plain_chars), three_char))
                        stack.append(('italic', len(plain_chars), three_char))
                    
                    i += 3
                    matched = True
                
                # Code block: ```
                elif three_char == '```':
                    close_idx = text.find('```', i + 3)
                    if close_idx != -1:
                        code_start = i + 3
                        newline_idx = text.find('\n', code_start)
                        
                        if newline_idx != -1 and newline_idx < close_idx:
                            language = text[code_start:newline_idx].strip()
                            code_content = text[newline_idx + 1:close_idx]
                            if code_content.endswith('\n'):
                                code_content = code_content[:-1]
                        else:
                            language = ''
                            code_content = text[code_start:close_idx]
                        
                        plain_so_far = ''.join(plain_chars)
                        start_utf16 = _python_offset_to_utf16(plain_so_far, len(plain_chars))
                        plain_chars.extend(code_content)
                        plain_with_code = ''.join(plain_chars)
                        end_utf16 = _python_offset_to_utf16(plain_with_code, len(plain_chars))
                        entities.append(types.MessageEntityPre(start_utf16, end_utf16 - start_utf16, language))
                        i = close_idx + 3
                        matched = True
            
            if matched:
                continue
            
            # ========== 2-CHARACTER PATTERNS ==========
            if i + 1 < len(text):
                two_char = text[i:i+2]
                
                # Pattern: ** (Bold only)
                if two_char == '**':
                    if stack and any(s[0] == 'bold' for s in stack):
                        # CLOSING
                        new_stack = []
                        bold_start = None
                        for typ, start_py, marker in stack:
                            if typ == 'bold' and bold_start is None:
                                bold_start = start_py
                            else:
                                new_stack.append((typ, start_py, marker))
                        stack = new_stack
                        
                        if bold_start is not None:
                            # Check if content is empty
                            if len(plain_chars) > bold_start:
                                plain_so_far = ''.join(plain_chars)
                                start_utf16 = _python_offset_to_utf16(plain_so_far, bold_start)
                                end_utf16 = _python_offset_to_utf16(plain_so_far, len(plain_chars))
                                entities.append(types.MessageEntityBold(start_utf16, end_utf16 - start_utf16))
                            # If empty, don't create entity
                        i += 2
                        matched = True
                    else:
                        stack.append(('bold', len(plain_chars), two_char))
                        i += 2
                        matched = True
                
                # Pattern: __ (Underline only)
                elif two_char == '__':
                    if stack and any(s[0] == 'underline' for s in stack):
                        # CLOSING
                        new_stack = []
                        underline_start = None
                        for typ, start_py, marker in stack:
                            if typ == 'underline' and underline_start is None:
                                underline_start = start_py
                            else:
                                new_stack.append((typ, start_py, marker))
                        stack = new_stack
                        
                        if underline_start is not None and len(plain_chars) > underline_start:
                            plain_so_far = ''.join(plain_chars)
                            start_utf16 = _python_offset_to_utf16(plain_so_far, underline_start)
                            end_utf16 = _python_offset_to_utf16(plain_so_far, len(plain_chars))
                            entities.append(types.MessageEntityUnderline(start_utf16, end_utf16 - start_utf16))
                    else:
                        # OPENING
                        stack.append(('underline', len(plain_chars), two_char))
                    i += 2
                    matched = True
                
                # Pattern: ~~ (Strikethrough)
                elif two_char == '~~':
                    if stack and any(s[0] == 'strike' for s in stack):
                        new_stack = []
                        strike_start = None
                        for typ, start_py, marker in stack:
                            if typ == 'strike' and strike_start is None:
                                strike_start = start_py
                            else:
                                new_stack.append((typ, start_py, marker))
                        stack = new_stack
                        
                        if strike_start is not None and len(plain_chars) > strike_start:
                            plain_so_far = ''.join(plain_chars)
                            start_utf16 = _python_offset_to_utf16(plain_so_far, strike_start)
                            end_utf16 = _python_offset_to_utf16(plain_so_far, len(plain_chars))
                            entities.append(types.MessageEntityStrike(start_utf16, end_utf16 - start_utf16))
                    else:
                        stack.append(('strike', len(plain_chars), two_char))
                    i += 2
                    matched = True
                
                # Pattern: || (Spoiler) - SPECIAL HANDLING
                elif two_char == '||':
                    if stack and any(s[0] == 'spoiler' for s in stack):
                        # CLOSING SPOILER
                        new_stack = []
                        spoiler_start = None
                        for typ, start_py, marker in stack:
                            if typ == 'spoiler' and spoiler_start is None:
                                spoiler_start = start_py
                            else:
                                new_stack.append((typ, start_py, marker))
                        stack = new_stack
                        
                        if spoiler_start is not None and len(plain_chars) > spoiler_start:
                            plain_so_far = ''.join(plain_chars)
                            start_utf16 = _python_offset_to_utf16(plain_so_far, spoiler_start)
                            end_utf16 = _python_offset_to_utf16(plain_so_far, len(plain_chars))
                            
                            # CRITICAL: Insert spoiler BEFORE other entities with same range
                            insert_pos = 0
                            for idx, entity in enumerate(entities):
                                if entity.offset == start_utf16 and entity.length == (end_utf16 - start_utf16):
                                    insert_pos = idx
                                    break
                                elif entity.offset > start_utf16:
                                    insert_pos = idx
                                    break
                                else:
                                    insert_pos = idx + 1
                            
                            entities.insert(insert_pos, types.MessageEntitySpoiler(start_utf16, end_utf16 - start_utf16))
                    else:
                        # OPENING SPOILER
                        stack.append(('spoiler', len(plain_chars), two_char))
                    i += 2
                    matched = True
            
            if matched:
                continue
            
            # ========== SINGLE CHARACTER PATTERNS ==========
            
            # Inline code: `
            if char == '`':
                if stack and any(s[0] == 'code' for s in stack):
                    new_stack = []
                    code_start = None
                    for typ, start_py, marker in stack:
                        if typ == 'code' and code_start is None:
                            code_start = start_py
                        else:
                            new_stack.append((typ, start_py, marker))
                    stack = new_stack
                    
                    if code_start is not None and len(plain_chars) > code_start:
                        plain_so_far = ''.join(plain_chars)
                        start_utf16 = _python_offset_to_utf16(plain_so_far, code_start)
                        end_utf16 = _python_offset_to_utf16(plain_so_far, len(plain_chars))
                        entities.append(types.MessageEntityCode(start_utf16, end_utf16 - start_utf16))
                else:
                    stack.append(('code', len(plain_chars), char))
                i += 1
                continue
            
            # Italic (single *) - must not be part of ** or ***
            if char == '*':
                if (i == 0 or text[i-1] != '*') and (i + 1 >= len(text) or text[i+1] != '*'):
                    if stack and any(s[0] == 'italic' for s in stack):
                        new_stack = []
                        italic_start = None
                        for typ, start_py, marker in stack:
                            if typ == 'italic' and italic_start is None:
                                italic_start = start_py
                            else:
                                new_stack.append((typ, start_py, marker))
                        stack = new_stack
                        
                        if italic_start is not None and len(plain_chars) > italic_start:
                            plain_so_far = ''.join(plain_chars)
                            start_utf16 = _python_offset_to_utf16(plain_so_far, italic_start)
                            end_utf16 = _python_offset_to_utf16(plain_so_far, len(plain_chars))
                            entities.append(types.MessageEntityItalic(start_utf16, end_utf16 - start_utf16))
                    else:
                        stack.append(('italic', len(plain_chars), char))
                    i += 1
                    continue
            
            # Blockquote: > at start of line
            if char == '>' and (i == 0 or text[i-1] == '\n'):
                # Handle space after >
                content_start = i + 1
                if content_start < len(text) and text[content_start] == ' ':
                    content_start += 1
                
                # Find end of line
                line_end = text.find('\n', i)
                if line_end == -1:
                    line_end = len(text)
                
                # Extract the raw markdown text inside the blockquote
                raw_inner_text = text[content_start:line_end]
                
                # RECURSIVE CALL: Parse formatting INSIDE the blockquote
                # This handles the ||...||, **...**, etc. nested inside
                inner_plain_text, inner_entities = markdown_to_telegram_entities(raw_inner_text)
                
                # Calculate offsets for the new text
                current_plain_len = len(''.join(plain_chars))
                start_utf16 = _python_offset_to_utf16(''.join(plain_chars), current_plain_len)
                
                # Append the parsed inner text to our main plain text
                plain_chars.extend(inner_plain_text)
                
                # Calculate end offset
                new_plain_len = len(''.join(plain_chars))
                end_utf16 = _python_offset_to_utf16(''.join(plain_chars), new_plain_len)
                
                # 1. Add the Blockquote entity covering the whole line
                entities.append(types.MessageEntityBlockquote(start_utf16, end_utf16 - start_utf16))
                
                # 2. Add all the inner entities (Bold, Spoiler, etc.), adjusted for the new offset
                for inner_ent in inner_entities:
                    # We need to shift the offset of inner entities to match the current position
                    # inner_ent.offset is relative to the start of the blockquote text
                    # We add start_utf16 to make it relative to the start of the whole message
                    
                    # Create a new copy of the entity with shifted offset
                    shifted_ent = type(inner_ent)(
                        inner_ent.offset + start_utf16,
                        inner_ent.length,
                        *([inner_ent.url] if hasattr(inner_ent, 'url') else []),
                        *([inner_ent.language] if hasattr(inner_ent, 'language') else [])
                    )
                    entities.append(shifted_ent)
                
                # Skip past the processed line
                i = line_end
                continue
            
            # Links: [text](url)
            if char == '[':
                close_bracket = text.find(']', i)
                if close_bracket != -1 and close_bracket + 1 < len(text) and text[close_bracket + 1] == '(':
                    close_paren = text.find(')', close_bracket + 2)
                    if close_paren != -1:
                        link_text = text[i+1:close_bracket]
                        url = text[close_bracket+2:close_paren]
                        
                        # Check if this link is wrapped by any open formatting
                        wrapping_formats = []
                        temp_stack = []
                        
                        for typ, start_py, marker in stack:
                            if start_py == len(plain_chars):  # Started at current position
                                wrapping_formats.append((typ, start_py, marker))
                            else:
                                temp_stack.append((typ, start_py, marker))
                        
                        stack = temp_stack
                        
                        # Parse markdown inside link text recursively
                        link_plain, link_entities = markdown_to_telegram_entities(link_text)
                        
                        plain_so_far = ''.join(plain_chars)
                        start_utf16 = _python_offset_to_utf16(plain_so_far, len(plain_chars))
                        
                        # Adjust link entity offsets
                        for link_entity in link_entities:
                            adjusted_entity = type(link_entity)(
                                start_utf16 + link_entity.offset,
                                link_entity.length,
                                *([link_entity.url] if hasattr(link_entity, 'url') else []),
                                *([link_entity.language] if hasattr(link_entity, 'language') else [])
                            )
                            entities.append(adjusted_entity)
                        
                        plain_chars.extend(link_plain)
                        plain_with_link = ''.join(plain_chars)
                        end_utf16 = _python_offset_to_utf16(plain_with_link, len(plain_chars))
                        entities.append(types.MessageEntityTextUrl(start_utf16, end_utf16 - start_utf16, url))
                        
                        # Re-add wrapping formats to stack
                        stack.extend(wrapping_formats)
                        
                        i = close_paren + 1
                        continue
            
            # Regular character - add to plain text
            plain_chars.append(char)
            i += 1
        
        result_text = ''.join(plain_chars)
        
        # Detect hashtags and create MessageEntityHashtag entities
        hashtag_pattern = r'#[A-Za-z0-9_]+'
        for match in re.finditer(hashtag_pattern, result_text):
            start_py = match.start()
            end_py = match.end()
            start_utf16 = _python_offset_to_utf16(result_text, start_py)
            end_utf16 = _python_offset_to_utf16(result_text, end_py)
            
            has_entity = any(
                e.offset == start_utf16 and isinstance(e, types.MessageEntityHashtag)
                for e in entities
            )
            if not has_entity:
                entities.append(types.MessageEntityHashtag(start_utf16, end_utf16 - start_utf16))
        
        # Sort entities by offset, then by descending length, then by type priority
        type_priority = {
            'MessageEntitySpoiler': 0,
            'MessageEntityBold': 1,
            'MessageEntityItalic': 2,
            'MessageEntityUnderline': 3,
            'MessageEntityStrike': 4,
            'MessageEntityCode': 5,
            'MessageEntityPre': 6,
            'MessageEntityTextUrl': 7,
            'MessageEntityBlockquote': 8,
            'MessageEntityHashtag': 9,
        }
        
        def get_sort_key(entity):
            entity_type = entity.__class__.__name__
            priority = type_priority.get(entity_type, 99)
            return (entity.offset, -entity.length, priority)
        
        entities.sort(key=get_sort_key)
        
        return result_text, entities
        
    except Exception as e:
        print(f"⚠️ Markdown parsing error: {e}")
        import traceback
        traceback.print_exc()
        return text, []