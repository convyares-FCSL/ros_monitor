import rclpy
from geometry_msgs.msg import Twist
from rclpy.node import Node
from std_msgs.msg import String

from monitor_demo.node_utils import spin_node


class ControlNode(Node):
    def __init__(self):
        super().__init__("control_node")
        self.latest_heartbeat = "waiting"
        self.latest_linear_x = 0.0
        self.cmd_pub = self.create_publisher(Twist, "/monitor_demo/cmd_vel", 10)
        self.create_subscription(String, "/monitor_demo/heartbeat", self.on_heartbeat, 10)
        self.create_subscription(Twist, "/monitor_demo/telemetry", self.on_telemetry, 10)
        self.create_timer(0.5, self.publish_cmd)

    def on_heartbeat(self, msg: String):
        self.latest_heartbeat = msg.data

    def on_telemetry(self, msg: Twist):
        self.latest_linear_x = msg.linear.x

    def publish_cmd(self):
        msg = Twist()
        msg.linear.x = self.latest_linear_x * 0.8
        msg.angular.z = 0.1 if self.latest_heartbeat != "waiting" else 0.0
        self.cmd_pub.publish(msg)


def main():
    rclpy.init()
    node = ControlNode()
    spin_node(node)
