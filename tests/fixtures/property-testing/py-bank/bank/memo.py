def encode_memo(fields: dict[str, str]) -> str:
    """Store string fields as 'key=value;key=value'."""
    parts = []
    for key, value in fields.items():
        parts.append(f"{key}={value.replace(';', '%3B')}")
    return ";".join(parts)


def decode_memo(text: str) -> dict[str, str]:
    if not text:
        return {}
    out = {}
    for part in text.split(";"):
        key, _, value = part.partition("=")
        out[key] = value.replace("%3B", ";")
    return out
