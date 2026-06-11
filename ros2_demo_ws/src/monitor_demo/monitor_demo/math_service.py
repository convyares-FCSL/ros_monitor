import rclpy
from example_interfaces.srv import AddTwoInts
from rclpy.node import Node
from rclpy.qos import qos_profile_system_default
from rclpy.service_introspection import ServiceIntrospectionState

from monitor_demo.node_utils import spin_node


class MathService(Node):
    def __init__(self):
        super().__init__("math_service")
        srv = self.create_service(AddTwoInts, "/monitor_demo/add_two_ints", self.handle_add)
        # Publish request/response contents on /monitor_demo/add_two_ints/_service_event
        # so the monitor bridge can observe live calls
        srv.configure_introspection(
            self.get_clock(),
            qos_profile_system_default,
            ServiceIntrospectionState.CONTENTS,
        )

    def handle_add(self, request, response):
        response.sum = request.a + request.b
        return response


def main():
    rclpy.init()
    node = MathService()
    spin_node(node)
