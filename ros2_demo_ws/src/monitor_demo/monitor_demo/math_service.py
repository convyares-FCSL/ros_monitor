import rclpy
from example_interfaces.srv import AddTwoInts
from rclpy.node import Node

from monitor_demo.node_utils import spin_node


class MathService(Node):
    def __init__(self):
        super().__init__("math_service")
        self.create_service(AddTwoInts, "/monitor_demo/add_two_ints", self.handle_add)

    def handle_add(self, request, response):
        response.sum = request.a + request.b
        return response


def main():
    rclpy.init()
    node = MathService()
    spin_node(node)
