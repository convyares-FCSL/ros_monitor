from dataclasses import dataclass


DEFAULT_HTTP_PORT = 7260
DEFAULT_WS_PORT = 8765
DEFAULT_WS_HOST = "0.0.0.0"
DEFAULT_RATE_LIMIT_HZ = 10.0

HEAVY_MESSAGE_TYPES = {
    "sensor_msgs/msg/Image",
    "sensor_msgs/msg/CompressedImage",
    "sensor_msgs/msg/PointCloud2",
    "sensor_msgs/msg/LaserScan",
    "nav_msgs/msg/OccupancyGrid",
}


@dataclass(slots=True)
class BridgeConfig:
    frontend_dir: str
    http_port: int = DEFAULT_HTTP_PORT
    ws_port: int = DEFAULT_WS_PORT
    ws_host: str = DEFAULT_WS_HOST
    rate_limit_hz: float = DEFAULT_RATE_LIMIT_HZ
    mode: str = "full"
    sim_mode: bool = False
    bt_mode: bool = False
    no_bt: bool = False
    btros: str | None = None  # "HOST[:PORT]" of a live Groot2 v4 executor
