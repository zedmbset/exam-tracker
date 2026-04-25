"""
Formatting Utilities
Functions for formatting durations, file extensions, and other data
"""


def format_duration(seconds):
    """
    Format duration in seconds to MM:SS or HH:MM:SS format.
    
    Args:
        seconds (int or float): Duration in seconds
    
    Returns:
        str: Formatted duration string
    
    Example:
        >>> format_duration(125)
        '02:05'
        >>> format_duration(3665)
        '01:01:05'
    """
    if seconds is None:
        return ''
    
    # Convert to int to handle float values
    seconds = int(seconds)
    
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60
    
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    else:
        return f"{minutes:02d}:{secs:02d}"


def get_file_extension(document):
    """
    Get file extension from Telegram document attributes.
    
    Args:
        document: Telegram document object
    
    Returns:
        str: File extension (e.g., 'pdf', 'mp3') or empty string
    
    Example:
        If document has filename "report.pdf", returns "pdf"
    """
    if not document:
        return ''
    
    # Try to get from attributes first (DocumentAttributeFilename)
    if hasattr(document, 'attributes'):
        for attr in document.attributes:
            if hasattr(attr, 'file_name') and attr.file_name:
                # Extract extension from filename
                filename = attr.file_name
                if '.' in filename:
                    return filename.rsplit('.', 1)[1].lower()
    
    # Fallback to MIME type
    if hasattr(document, 'mime_type') and document.mime_type:
        mime = document.mime_type
        
        # Map common MIME types to extensions
        mime_to_ext = {
            'application/pdf': 'pdf',
            'application/msword': 'doc',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
            'application/vnd.ms-excel': 'xls',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
            'application/zip': 'zip',
            'application/x-rar-compressed': 'rar',
            'text/plain': 'txt',
            'audio/mpeg': 'mp3',
            'audio/mp4': 'm4a',
            'audio/ogg': 'ogg',
            'video/mp4': 'mp4',
            'video/x-matroska': 'mkv',
            'video/webm': 'webm',
            'image/jpeg': 'jpg',
            'image/png': 'png',
            'image/gif': 'gif'
        }
        
        if mime in mime_to_ext:
            return mime_to_ext[mime]
        
        # Generic fallback: extract from mime type (e.g., "video/mp4" -> "mp4")
        if '/' in mime:
            return mime.split('/')[-1].lower()
    
    return ''