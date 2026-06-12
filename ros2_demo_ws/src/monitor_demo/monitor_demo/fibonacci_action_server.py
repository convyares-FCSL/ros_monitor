import time

import rclpy
from example_interfaces.action import Fibonacci
from rclpy.action import ActionServer
from rclpy.node import Node

from monitor_demo.node_utils import spin_node


class FibonacciActionServer(Node):
    def __init__(self):
        super().__init__("fibonacci_action_server")
        # Mirrors each goal/feedback/result exchange onto /_action/... introspection topics.
        # Override at launch: --ros-args -p action_server_configure_introspection:=metadata
        self.declare_parameter("action_server_configure_introspection", "contents")
        self.server = ActionServer(
            self,
            Fibonacci,
            "/monitor_demo/fibonacci",
            execute_callback=self.execute_callback,
        )

    def execute_callback(self, goal_handle):
        feedback = Fibonacci.Feedback()
        feedback.sequence = [0, 1]

        for _ in range(1, goal_handle.request.order):
            feedback.sequence.append(feedback.sequence[-1] + feedback.sequence[-2])
            goal_handle.publish_feedback(feedback)
            time.sleep(0.75)

        goal_handle.succeed()
        result = Fibonacci.Result()
        result.sequence = feedback.sequence
        return result


def main():
    rclpy.init()
    node = FibonacciActionServer()
    spin_node(node)
