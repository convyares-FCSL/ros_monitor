import rclpy
from example_interfaces.srv import AddTwoInts
from rclpy.node import Node
from rclpy.qos import qos_profile_system_default
from rclpy.service_introspection import ServiceIntrospectionState

from monitor_demo.node_utils import spin_node


class MathClient(Node):
    def __init__(self):
        super().__init__("math_client")
        self.client = self.create_client(AddTwoInts, "/monitor_demo/add_two_ints")
        # Emit REQUEST_SENT events so the monitor shows the call leaving this node
        self.client.configure_introspection(
            self.get_clock(),
            qos_profile_system_default,
            ServiceIntrospectionState.CONTENTS,
        )
        self.counter = 1
        self.pending = None
        self.create_timer(6.0, self.send_request)

    def send_request(self):
        if self.pending is not None or not self.client.wait_for_service(timeout_sec=0.2):
            return

        request = AddTwoInts.Request()
        request.a = self.counter
        request.b = self.counter + 1
        self.pending = self.client.call_async(request)
        self.pending.add_done_callback(self.on_response)
        self.counter += 1

    def on_response(self, future):
        try:
            future.result()
        finally:
            self.pending = None


def main():
    rclpy.init()
    node = MathClient()
    spin_node(node)
