#!/usr/bin/env python3
import argparse
import asyncio
import logging
import os
import threading

import websockets

from ros_monitor_bridge.config import (
    DEFAULT_HTTP_PORT,
    DEFAULT_RATE_LIMIT_HZ,
    DEFAULT_WS_HOST,
    DEFAULT_WS_PORT,
    BridgeConfig,
)
from ros_monitor_bridge.ros_bridge import ROS_AVAILABLE, run_ros2_node
from ros_monitor_bridge.runtime import BridgeRuntime
from ros_monitor_bridge.server import (
    create_ws_handler,
    process_plain_http_request,
    run_http_server,
    websocket_broadcaster,
)
from ros_monitor_bridge.bt_simulation import BTSimulation
from ros_monitor_bridge.btros_bridge import DEFAULT_GROOT_PORT, BTRosBridge
from ros_monitor_bridge.simulation import SimulatedBridge
from ros_monitor_bridge.utils import RateLimiter


def main():
    logging.basicConfig(level=logging.INFO, format="[%(asctime)s] [%(levelname)s] %(message)s")
    logger = logging.getLogger("ROS2Bridge")

    args = parse_args()
    frontend_dir = resolve_frontend_dir()
    config = BridgeConfig(
        frontend_dir=frontend_dir,
        http_port=args.port,
        ws_port=args.ws_port,
        ws_host=DEFAULT_WS_HOST,
        rate_limit_hz=args.rate_limit,
        sim_mode=args.sim or not ROS_AVAILABLE,
        bt_mode=args.bt,
        btros=args.btros,
    )

    if ROS_AVAILABLE:
        logger.info("ROS 2 environment detected. Running in standard ROS 2 Mode.")
    else:
        logger.warning("ROS 2 (rclpy/rosidl) not found. Falling back to Simulation Mode.")

    if args.sim:
        logger.info("Simulation mode forced via --sim flag.")

    runtime = BridgeRuntime()
    rate_limiter = RateLimiter(config.rate_limit_hz)

    try:
        asyncio.run(async_main(config, runtime, rate_limiter, logger))
    except KeyboardInterrupt:
        logger.info("Shutting down bridge...")
    finally:
        logger.info("Bridge closed.")


async def async_main(config, runtime, rate_limiter, logger):
    runtime.attach_loop(asyncio.get_running_loop())
    stop_event = threading.Event()
    ros_thread = None
    ws_handler = create_ws_handler(runtime, logger)

    async with websockets.serve(
        ws_handler, config.ws_host, config.ws_port,
        process_request=process_plain_http_request,
    ):
        logger.info(f"WebSocket server started on ws://{config.ws_host}:{config.ws_port}")
        broadcaster_task = asyncio.create_task(websocket_broadcaster(runtime, logger))

        http_thread = threading.Thread(
            target=run_http_server,
            args=(config.frontend_dir, config.http_port, logger),
            daemon=True,
        )
        http_thread.start()

        if config.sim_mode:
            simulator = SimulatedBridge(runtime, logger)
            simulator.start()
        else:
            simulator = None
            ros_thread = threading.Thread(target=run_ros2_node, args=(runtime, rate_limiter, stop_event, logger))
            ros_thread.start()

        # The BT data sources are independent: they run alongside either the ROS
        # bridge or the simulation. --bt = Python demo emitter; --btros = real
        # Groot2 v4 client against a live executor.
        bt_sim = None
        if config.bt_mode:
            bt_sim = BTSimulation(runtime, logger)
            bt_sim.start()

        bt_ros = None
        if config.btros:
            host, _, port = config.btros.partition(":")
            bt_ros = BTRosBridge(runtime, logger, host=host or "localhost",
                                 port=int(port) if port else DEFAULT_GROOT_PORT)
            bt_ros.start()

        try:
            await asyncio.Future()
        except asyncio.CancelledError:
            pass
        finally:
            if simulator is not None:
                simulator.stop()
            else:
                stop_event.set()
                if ros_thread is not None:
                    ros_thread.join(timeout=3.0)
            if bt_sim is not None:
                bt_sim.stop()
            if bt_ros is not None:
                bt_ros.stop()
            broadcaster_task.cancel()


def parse_args():
    parser = argparse.ArgumentParser(description="ROS 2 Browser-based 3D Network Visualizer Bridge")
    parser.add_argument("--port", type=int, default=DEFAULT_HTTP_PORT, help="Port to serve frontend files (HTTP)")
    parser.add_argument("--ws-port", type=int, default=DEFAULT_WS_PORT, help="Port to run WebSocket server")
    parser.add_argument("--sim", action="store_true", help="Force simulation mode")
    parser.add_argument(
        "--bt",
        action="store_true",
        help="Start the Behavior Tree demo emitter (bt_blueprint / bt_delta events)",
    )
    parser.add_argument(
        "--btros",
        type=str,
        default=None,
        metavar="HOST[:PORT]",
        help="Connect to a live Groot2 v4 executor (BehaviorTree.CPP) and forward its tree",
    )
    parser.add_argument(
        "--rate-limit",
        type=float,
        default=DEFAULT_RATE_LIMIT_HZ,
        help="Throttling rate for messages (Hz)",
    )
    return parser.parse_args()


def resolve_frontend_dir():
    # Allow serving an alternative frontend (e.g. the React build in
    # frontend_new/dist) without changing code: scripts/run_visualizer_new.sh
    override = os.environ.get("ROS_MONITOR_FRONTEND_DIR")
    if override:
        return os.path.abspath(override)

    package_dir = os.path.dirname(os.path.realpath(__file__))
    frontend_dir = os.path.abspath(os.path.join(package_dir, "..", "..", "frontend"))
    if not os.path.exists(frontend_dir):
        frontend_dir = os.path.abspath(os.path.join(os.getcwd(), "frontend"))
    os.makedirs(frontend_dir, exist_ok=True)
    return frontend_dir

