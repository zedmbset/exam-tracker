"""
Title Cleaner Utility
=====================
Cleans and modifies message titles in Pub_lnk lists based on action flags.

Supports:
- Remove_Num: Remove digits/punctuation before first letter
- Punct_"": Remove or replace leading dash with emoji/punctuation
"""

import re


def clean_title(title, actions):
    """
    Clean title based on actions for Pub_lnk list display.
    
    IMPORTANT: Cleaning actions (Remove_Num, Punct_) ONLY work when Pub_lnk is present!
    
    This ensures that:
    - "Transfer, Remove_Num" → Does NOT clean (no Pub_lnk)
    - "Transfer, Pub_lnk, Remove_Num" → Cleans title in Pub_lnk list
    
    Args:
        title (str): Original title from spreadsheet
        actions (list): List of action strings (e.g., ['Transfer', 'Grp', 'Pub_lnk', 'Remove_Num'])
    
    Returns:
        str: Cleaned title for Pub_lnk list (or original if no Pub_lnk)
    
    Examples:
        >>> clean_title("01- Python Basics", ["Transfer", "Remove_Num"])
        "01- Python Basics"  # NOT cleaned - no Pub_lnk
        
        >>> clean_title("01- Python Basics", ["Transfer", "Pub_lnk", "Remove_Num"])
        "Python Basics"  # Cleaned - has Pub_lnk
        
        >>> clean_title("- Introduction", ["Transfer", 'Punct_"📚"'])
        "- Introduction"  # NOT cleaned - no Pub_lnk
        
        >>> clean_title("- Introduction", ["Transfer", "Pub_lnk", 'Punct_"📚"'])
        "📚 Introduction"  # Cleaned - has Pub_lnk
    """
    if not title or not actions:
        return title
    
    # CRITICAL: Only clean if Pub_lnk action is present
    if 'Pub_lnk' not in actions:
        return title  # Return original title unchanged
    
    cleaned = title
    
    # Process Remove_Num action first
    if 'Remove_Num' in actions:
        cleaned = remove_numbers_and_punct_prefix(cleaned)
    
    # Process Punct_ actions second (after numbers are removed)
    for action in actions:
        if action.startswith('Punct_'):
            replacement = extract_punct_replacement(action)
            if replacement is not None:  # Only process if valid Punct_ action
                cleaned = replace_leading_dash(cleaned, replacement)
    
    return cleaned


def remove_numbers_and_punct_prefix(text):
    """
    Remove all digits, spaces, and punctuation before the first letter.
    
    This is useful for removing numbering prefixes like:
    - "01- Title" → "Title"
    - "- - Title" → "Title"
    - "123 Hello" → "Hello"
    - "--- Chapter" → "Chapter"
    
    Args:
        text (str): Input text
    
    Returns:
        str: Text with prefix removed
    
    Examples:
        >>> remove_numbers_and_punct_prefix("01- Python Basics")
        "Python Basics"
        
        >>> remove_numbers_and_punct_prefix("- - Getting Started")
        "Getting Started"
        
        >>> remove_numbers_and_punct_prefix("123abc")
        "abc"
    """
    if not text:
        return text
    
    # Find the position of the first letter (A-Z, a-z, or Unicode letters like À, Ñ, etc.)
    # \u00C0-\u024F covers most Latin extended characters
    # \u1E00-\u1EFF covers Latin extended additional
    match = re.search(r'[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]', text)
    
    if match:
        # Return text starting from first letter
        return text[match.start():].strip()
    
    # If no letter found, return original text
    return text


def extract_punct_replacement(action):
    """
    Extract replacement text from Punct_ action.
    
    Format: Punct_"replacement"
    Where replacement can be:
    - Empty string "" (remove dash)
    - An emoji like "📚"
    - A character like "•" or "→"
    
    Args:
        action (str): Action string like 'Punct_"..."'
    
    Returns:
        str or None: Replacement text, or None if not a valid Punct_ action
    
    Examples:
        >>> extract_punct_replacement('Punct_""')
        ''
        
        >>> extract_punct_replacement('Punct_"📚"')
        '📚'
        
        >>> extract_punct_replacement('Punct_"•"')
        '•'
        
        >>> extract_punct_replacement('Transfer')
        None
    """
    # Pattern: Punct_"..." where ... can be empty or any character(s)
    match = re.match(r'Punct_"(.*?)"', action)
    
    if match:
        return match.group(1)  # Returns the content between quotes (can be empty string)
    
    return None


def replace_leading_dash(text, replacement):
    """
    Replace the first dash/hyphen in text with replacement.
    
    Handles different types of dashes:
    - Hyphen-minus: -
    - En-dash: –
    - Em-dash: —
    
    Args:
        text (str): Input text
        replacement (str or None): Replacement text
            - Empty string "" means remove the dash
            - Non-empty string means replace with that character/emoji
            - None means no action
    
    Returns:
        str: Text with dash replaced/removed
    
    Examples:
        >>> replace_leading_dash("- Title", "")
        "Title"
        
        >>> replace_leading_dash("- Title", "📚")
        "📚 Title"
        
        >>> replace_leading_dash("— Title", "•")
        "• Title"
        
        >>> replace_leading_dash("No dash here", "")
        "No dash here"
    """
    if replacement is None or not text:
        return text
    
    # Find first dash (including em-dash, en-dash, hyphen-minus)
    match = re.search(r'[-–—]', text)
    
    if match:
        dash_pos = match.start()
        
        if replacement == '':
            # Remove the dash and any trailing spaces
            result = text[:dash_pos] + text[dash_pos+1:]
            return result.strip()
        else:
            # Replace the dash with the replacement
            result = text[:dash_pos] + replacement + text[dash_pos+1:]
            return result.strip()
    
    # No dash found - return original text
    return text


# ============= TESTING FUNCTIONS =============

def test_remove_numbers():
    """Test the remove_numbers_and_punct_prefix function."""
    print("\n" + "="*70)
    print("TEST: remove_numbers_and_punct_prefix")
    print("="*70)
    
    tests = [
        ("01- Title", "Title"),
        ("- - Title", "Title"),
        ("123 Hello", "Hello"),
        ("--- Chapter", "Chapter"),
        ("01- - Python Basics", "Python Basics"),
        ("No prefix", "No prefix"),
        ("", ""),
        ("123", "123"),  # No letters
    ]
    
    for input_text, expected in tests:
        result = remove_numbers_and_punct_prefix(input_text)
        status = "✓" if result == expected else "✗"
        print(f"  {status} '{input_text}' → '{result}' (expected: '{expected}')")


def test_punct_replacement():
    """Test the Punct_ action."""
    print("\n" + "="*70)
    print("TEST: Punct_ replacement")
    print("="*70)
    
    tests = [
        ("- Title", 'Punct_""', "Title"),
        ("- Title", 'Punct_"📚"', "📚 Title"),
        ("- Title", 'Punct_"•"', "• Title"),
        ("- Title", 'Punct_"→"', "→ Title"),
        ("— Title", 'Punct_"📚"', "📚 Title"),  # Em-dash
        ("– Title", 'Punct_"•"', "• Title"),    # En-dash
        ("No dash", 'Punct_"📚"', "No dash"),
        ("", 'Punct_""', ""),
    ]
    
    for input_text, action, expected in tests:
        replacement = extract_punct_replacement(action)
        result = replace_leading_dash(input_text, replacement)
        status = "✓" if result == expected else "✗"
        print(f"  {status} '{input_text}' + {action} → '{result}' (expected: '{expected}')")


def test_full_clean():
    """Test the full clean_title function."""
    print("\n" + "="*70)
    print("TEST: Full clean_title")
    print("="*70)
    
    tests = [
        ("01- Title", ["Remove_Num"], "Title"),
        ("- Title", ['Punct_""'], "Title"),
        ("01- - Title", ["Remove_Num", 'Punct_"📚"'], "📚 Title"),
        ("- Title", ['Punct_"📚"'], "📚 Title"),
        ("01- Python Basics", ["Transfer", "Pub_lnk", "Remove_Num"], "Python Basics"),
        ("01- Python Basics", ["Transfer", "Remove_Num"], "01- Python Basics"),  # No Pub_lnk = no cleaning
        ("- Introduction", ["Transfer", 'Punct_"📚"'], "📚 Introduction"),
        ("No action needed", ["Transfer"], "No action needed"),
    ]
    
    for input_text, actions, expected in tests:
        result = clean_title(input_text, actions)
        status = "✓" if result == expected else "✗"
        print(f"  {status} '{input_text}' + {actions}")
        print(f"      → '{result}' (expected: '{expected}')")


def test_realistic_scenarios():
    """Test realistic Pub_lnk scenarios."""
    print("\n" + "="*70)
    print("TEST: Realistic Pub_lnk Scenarios")
    print("="*70)
    
    print("\nScenario 1: Video series with numbering")
    titles = [
        "01- Introduction to Python",
        "02- Variables and Data Types",
        "03- Control Flow",
    ]
    actions = ["Transfer", "Grp", "Pub_lnk", "Remove_Num"]
    
    print(f"Actions: {actions}")
    print("Results in Pub_lnk list:")
    for title in titles:
        cleaned = clean_title(title, actions)
        print(f"  • {cleaned}")
    
    print("\nScenario 2: Articles with dash prefix + emoji replacement")
    titles = [
        "- Getting Started with AI",
        "- Deep Learning Basics",
        "- Neural Networks Explained",
    ]
    actions = ["Transfer", "Grp", "Pub_lnk", 'Punct_"📚"']
    
    print(f"Actions: {actions}")
    print("Results in Pub_lnk list:")
    for title in titles:
        cleaned = clean_title(title, actions)
        print(f"  • {cleaned}")
    
    print("\nScenario 3: Combined cleaning (numbers + dash replacement)")
    titles = [
        "01- - Chapter One",
        "02- - Chapter Two",
        "03- - Chapter Three",
    ]
    actions = ["Transfer", "Grp", "Pub_lnk", "Remove_Num", 'Punct_"→"']
    
    print(f"Actions: {actions}")
    print("Results in Pub_lnk list:")
    for title in titles:
        cleaned = clean_title(title, actions)
        print(f"  • {cleaned}")


if __name__ == "__main__":
    print("="*70)
    print("TITLE CLEANER - TESTS")
    print("="*70)
    
    test_remove_numbers()
    test_punct_replacement()
    test_full_clean()
    test_realistic_scenarios()
    
    print("\n" + "="*70)
    print("✅ All tests completed!")
    print("="*70)
