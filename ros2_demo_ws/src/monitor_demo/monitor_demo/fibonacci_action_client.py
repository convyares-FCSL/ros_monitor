import rclpy
from example_interfaces.action import Fibonacci
from rclpy.action import ActionClient
from rclpy.node import Node

from monitor_demo.node_utils import spin_node


class FibonacciActionClient(Node):
    def __init__(self):
        super().__init__("fibonacci_action_client")
        self.client = ActionClient(self, Fibonacci, "/monitor_demo/fibonacci")
        self.goal_in_flight = False
        self.goal_order = 6
        self.create_timer(12.0, self.send_goal)

    def send_goal(self):
        if self.goal_in_flight or not self.client.wait_for_server(timeout_sec=0.2):
            return

        goal = Fibonacci.Goal()
        goal.order = self.goal_order
        self.goal_in_flight = True

        future = self.client.send_goal_async(goal, feedback_callback=self.on_feedback)
        future.add_done_callback(self.on_goal_response)
        self.goal_order = 8 if self.goal_order == 6 else 6

    def on_goal_response(self, future):
        goal_handle = future.result()
        if not goal_handle.accepted:
            self.goal_in_flight = False
            return

        result_future = goal_handle.get_result_async()
        result_future.add_done_callback(self.on_result)

    def on_feedback(self, feedback_msg):
        _ = feedback_msg.feedback.sequence

    def on_result(self, future):
        try:
            future.result()
        finally:
            self.goal_in_flight = False


def main():
    rclpy.init()
    node = FibonacciActionClient()
    spin_node(node)
