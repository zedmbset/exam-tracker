"""
Utils Package - Enhanced Version
Centralized utility functions for message parsing and formatting
"""

from .formatters import format_duration, get_file_extension
from .text_extractors import (
    # Core parsing function (SINGLE SOURCE OF TRUTH)
    parse_message_text,
    
    # Individual extractors
    extract_title,
    detect_emoji_title,
    extract_hashtags_from_line,
    
    # Normalization and formatting
    normalize_hashtags,
    format_hashtags_for_telegram,
    format_for_telegram,
    
    # Validation
    validate_text_parts,
    
    # Patterns (for advanced usage)
    EMOJI_PATTERN,
    EMOJI_START_PATTERN
)

__all__ = [
    # Formatters
    'format_duration',
    'get_file_extension',
    
    # Text parsing (PRIMARY INTERFACE)
    'parse_message_text',  # Use this for all text parsing
    
    # Individual extractors
    'extract_title',
    'detect_emoji_title',
    'extract_hashtags_from_line',
    
    # Normalization
    'normalize_hashtags',
    'format_hashtags_for_telegram',
    'format_for_telegram',
    
    # Validation
    'validate_text_parts',
    
    # Patterns
    'EMOJI_PATTERN',
    'EMOJI_START_PATTERN'
]