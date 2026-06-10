import time


def trim_payload(data, max_list_len=50):
    """Recursively prune large arrays and byte payloads for lightweight JSON."""
    if isinstance(data, dict):
        return {key: trim_payload(value, max_list_len) for key, value in data.items()}
    if isinstance(data, list):
        if len(data) > max_list_len:
            return f"[Array truncated, original length={len(data)}]"
        return [trim_payload(item, max_list_len) for item in data]
    if isinstance(data, (bytes, bytearray)):
        return f"[Bytes truncated, length={len(data)}]"
    return data


class RateLimiter:
    def __init__(self, limit_hz):
        self.interval = 1.0 / limit_hz if limit_hz > 0 else 0
        self.last_sent = {}

    def is_allowed(self, key):
        if self.interval == 0:
            return True

        now = time.time()
        last = self.last_sent.get(key, 0)
        if now - last >= self.interval:
            self.last_sent[key] = now
            return True
        return False

