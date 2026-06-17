import asyncio
import os
import sys
import unittest


sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

from ros_monitor_bridge.main import _worker_failure_reasons
from ros_monitor_bridge.runtime import BridgeRuntime


class _DoneTask:
    def __init__(self, exc=None):
        self._exc = exc

    def done(self):
        return True

    def exception(self):
        return self._exc


class _ThreadStub:
    def __init__(self, alive):
        self._alive = alive

    def is_alive(self):
        return self._alive


class BridgeRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.loop = asyncio.new_event_loop()

    def tearDown(self):
        self.loop.close()

    def test_queue_drops_oldest_when_full(self):
        runtime = BridgeRuntime(event_queue_maxsize=2, drop_log_interval_s=0.0)
        runtime.attach_loop(self.loop)

        runtime._enqueue_event({"type": "first", "value": 1})
        runtime._enqueue_event({"type": "second", "value": 2})
        runtime._enqueue_event({"type": "third", "value": 3})

        queued = [
            runtime.event_queue.get_nowait(),
            runtime.event_queue.get_nowait(),
        ]

        self.assertEqual([item["type"] for item in queued], ["second", "third"])
        self.assertEqual(runtime.dropped_events, 1)
        self.assertEqual(runtime.dropped_event_types["first"], 1)

    def test_worker_failure_reasons_reports_dead_workers(self):
        issues = _worker_failure_reasons(
            http_thread=_ThreadStub(alive=False),
            ros_thread=_ThreadStub(alive=False),
            tasks=(
                ("broadcaster", _DoneTask(RuntimeError("boom"))),
                ("mode", _DoneTask()),
            ),
        )

        self.assertIn("HTTP server thread stopped", issues)
        self.assertIn("ROS executor thread stopped", issues)
        self.assertIn("broadcaster task failed: boom", issues)
        self.assertIn("mode task stopped unexpectedly", issues)


if __name__ == "__main__":
    unittest.main()
