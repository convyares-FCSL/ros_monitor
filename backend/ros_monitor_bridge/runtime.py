import asyncio
import time
from collections import Counter


class BridgeRuntime:
    def __init__(self, event_queue_maxsize: int = 4096, drop_log_interval_s: float = 5.0):
        self.loop = None
        self.event_queue = None
        self.connected_clients = set()
        # Set by main.py when replay mode is active; None otherwise.
        self.replay_controller = None
        self.logger = None
        self.event_queue_maxsize = max(1, int(event_queue_maxsize))
        self.drop_log_interval_s = max(0.0, float(drop_log_interval_s))
        self.dropped_events = 0
        self.dropped_event_types = Counter()
        self._last_drop_log_monotonic = 0.0

    def attach_loop(self, loop, logger=None):
        self.loop = loop
        self.logger = logger
        self.event_queue = asyncio.Queue(maxsize=self.event_queue_maxsize)

    def dispatch_event(self, event_dict):
        if self.loop and self.event_queue:
            try:
                self.loop.call_soon_threadsafe(self._enqueue_event, event_dict)
            except Exception:
                pass

    def _enqueue_event(self, event_dict):
        if self.event_queue is None:
            return

        if self.event_queue.full():
            try:
                dropped = self.event_queue.get_nowait()
                self.event_queue.task_done()
                self._record_drop(dropped)
            except asyncio.QueueEmpty:
                pass

        try:
            self.event_queue.put_nowait(event_dict)
        except asyncio.QueueFull:
            self._record_drop(event_dict)

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

    def _record_drop(self, event_dict):
        self.dropped_events += 1
        event_type = event_dict.get("type", "unknown") if isinstance(event_dict, dict) else "unknown"
        self.dropped_event_types[event_type] += 1

        if self.logger is None:
            return

        now = time.monotonic()
        if now - self._last_drop_log_monotonic < self.drop_log_interval_s:
            return
        self._last_drop_log_monotonic = now
        top = ", ".join(
            f"{event_type}={count}"
            for event_type, count in self.dropped_event_types.most_common(3)
        )
        self.logger.warning(
            "Bridge event queue saturated; dropped %s events so far (top types: %s)",
            self.dropped_events,
            top or "none",
        )
