from setuptools import find_packages, setup

package_name = "monitor_demo"

setup(
    name=package_name,
    version="0.0.1",
    packages=find_packages(exclude=["test"]),
    data_files=[
        ("share/ament_index/resource_index/packages", ["resource/" + package_name]),
        ("share/" + package_name, ["package.xml"]),
        ("share/" + package_name + "/launch", ["launch/monitor_demo.launch.py"]),
    ],
    install_requires=["setuptools"],
    zip_safe=True,
    maintainer="ecm",
    maintainer_email="ecm@example.com",
    description="Simple ROS 2 demo graph for the ros_monitor visualizer.",
    license="MIT",
    entry_points={
        "console_scripts": [
            "sensor_hub = monitor_demo.sensor_hub:main",
            "control_node = monitor_demo.control_node:main",
            "math_service = monitor_demo.math_service:main",
            "math_client = monitor_demo.math_client:main",
            "fibonacci_action_server = monitor_demo.fibonacci_action_server:main",
            "fibonacci_action_client = monitor_demo.fibonacci_action_client:main",
        ],
    },
)
