from launch import LaunchDescription
from launch_ros.actions import Node


def generate_launch_description():
    return LaunchDescription(
        [
            Node(package="monitor_demo", executable="sensor_hub", output="screen"),
            Node(package="monitor_demo", executable="control_node", output="screen"),
            Node(package="monitor_demo", executable="math_service", output="screen"),
            Node(package="monitor_demo", executable="math_client", output="screen"),
            Node(package="monitor_demo", executable="fibonacci_action_server", output="screen"),
            Node(package="monitor_demo", executable="fibonacci_action_client", output="screen"),
        ]
    )
