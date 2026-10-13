import re

SLUG_PATTERN = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")


def validate_slug(value: str) -> str:
    """Reject invalid identifiers without silently changing their identity."""
    if not 1 <= len(value) <= 80 or SLUG_PATTERN.fullmatch(value) is None:
        raise ValueError(
            "Slug must contain 1–80 lowercase ASCII letters or digits in hyphen-separated segments."
        )
    return value
