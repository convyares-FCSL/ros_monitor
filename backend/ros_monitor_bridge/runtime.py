import asyncio


class BridgeRuntime:
    def __init__(self):
        self.loop = None
        self.event_queue = None
        self.connected_clients = set()
        # Set by main.py when replay mode is active; None otherwise.
        self.replay_controller = None

    def attach_loop(self, loop):
        self.loop = loop
        self.event_queue = asyncio.Queue()

    def dispatch_event(self, event_dict):
        if self.loop and self.event_queue:
            try:
                self.loop.call_soon_threadsafe(self.event_queue.put_nowait, event_dict)
            except Exception:
                pass

    def handle_control(self, data: dict, logger) -> bool:
        """Route a replay_control message from the WebSocket client.

        Returns True if the message was handled, False if ignored.
        """
        if data.get("type") != "replay_control" or self.replay_controller is None:
            return False
        action = data.get("action")
        ctrl = self.replay_controller
        if action == "play":
            ctrl.play()
        elif action == "pause":
            ctrl.pause()
        elif action == "seek":
            try:
                ctrl.seek(float(data["position_s"]))
            except (KeyError, TypeError, ValueError) as exc:
                logger.warning(f"replay_control seek: bad position — {exc}")
        elif action == "set_speed":
            try:
                ctrl.set_speed(float(data["speed"]))
            except (KeyError, TypeError, ValueError) as exc:
                logger.warning(f"replay_control set_speed: bad value — {exc}")
        else:
            logger.warning(f"replay_control: unknown action '{action}'")
        return True

