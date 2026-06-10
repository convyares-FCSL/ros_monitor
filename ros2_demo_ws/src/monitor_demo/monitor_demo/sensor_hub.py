import math

import rclpy
from geometry_msgs.msg import Twist
from rclpy.node import Node
from std_msgs.msg import String

from monitor_demo.node_utils import spin_node


class SensorHub(Node):
    def __init__(self):
        super().__init__("sensor_hub")
        self.heartbeat_pub = self.create_publisher(String, "/monitor_demo/heartbeat", 10)
        self.telemetry_pub = self.create_publisher(Twist, "/monitor_demo/telemetry", 10)
        self.heartbeat_timer = self.create_timer(1.0, self.publish_heartbeat)
        self.telemetry_timer = self.create_timer(0.25, self.publish_telemetry)
        self.tick = 0
        self.phase = 0.0

    def publish_heartbeat(self):
        msg = String()
        msg.data = f"tick-{self.tick}"
        self.heartbeat_pub.publish(msg)
        self.tick += 1

    def publish_telemetry(self):
        msg = Twist()
        msg.linear.x = 0.5 + 0.3 * math.sin(self.phase)
        msg.linear.y = 0.1 * math.cos(self.phase / 2.0)
        msg.angular.z = 0.2 * math.cos(self.phase)
        self.telemetry_pub.publish(msg)
        self.phase += 0.15


def main():
    rclpy.init()
    node = SensorHub()
    spin_node(node)
