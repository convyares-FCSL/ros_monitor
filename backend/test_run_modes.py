import os
import sys
import unittest


sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

from ros_monitor_bridge.main import parse_args, resolve_run_mode


class RunModeTests(unittest.TestCase):
    def resolve(self, *argv):
        return resolve_run_mode(parse_args(list(argv)))

    def test_default_is_full(self):
        mode = self.resolve()
        self.assertEqual(mode.mode, "full")
        self.assertEqual(mode.introspection, "live")
        self.assertEqual(mode.behavior_tree, "auto")

    def test_sim_mode_uses_internal_demo_bt(self):
        mode = self.resolve("--mode", "sim")
        self.assertEqual(mode.mode, "sim")
        self.assertTrue(mode.no_ros)
        self.assertEqual(mode.introspection, "demo")
        self.assertEqual(mode.behavior_tree, "demo")

    def test_demo_mode_can_disable_bt(self):
        mode = self.resolve("--mode", "demo", "--no-bt")
        self.assertEqual(mode.mode, "demo")
        self.assertEqual(mode.behavior_tree, "off")

    def test_full_mode_can_use_explicit_bt_endpoint(self):
        mode = self.resolve("--mode", "full", "--btros", "localhost:1667")
        self.assertEqual(mode.mode, "full")
        self.assertEqual(mode.behavior_tree, "real")
        self.assertEqual(mode.btros, "localhost:1667")

    def test_legacy_sim_maps_to_sim_mode(self):
        mode = self.resolve("--sim")
        self.assertEqual(mode.mode, "sim")
        self.assertIn("--mode sim", mode.warnings[0])

    def test_legacy_bt_preserves_demo_bt_source(self):
        mode = self.resolve("--bt")
        self.assertEqual(mode.mode, "full")
        self.assertEqual(mode.behavior_tree, "demo")

    def test_sim_mode_rejects_btros(self):
        with self.assertRaises(SystemExit):
            self.resolve("--mode", "sim", "--btros", "localhost:1667")


if __name__ == "__main__":
    unittest.main()
