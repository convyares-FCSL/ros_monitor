import asyncio


class BridgeRuntime:
    def __init__(self):
        self.loop = None
        self.event_queue = None
        self.connected_clients = set()

    def attach_loop(self, loop):
        self.loop = loop
        self.event_queue = asyncio.Queue()

    def dispatch_event(self, event_dict):
        if self.loop and self.event_queue:
            try:
                self.loop.call_soon_threadsafe(self.event_queue.put_nowait, event_dict)
            except Exception:
                pass

