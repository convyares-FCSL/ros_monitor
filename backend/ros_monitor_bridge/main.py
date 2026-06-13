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

    # --- Standardized run mode ---
    #   --sim   : NO ROS — never use rclpy (the introspection view runs on demo data)
    #   --insp  : introspection DEMO (simulated graph) even when ROS is present
    #   --bt    : Behavior Tree DEMO (bt_simulation)
    #   --btros : Behavior Tree REAL (Groot2 v4 client)
    #   (none)  : REAL — connect to the live ROS graph
    introspection_demo = args.sim or args.insp or not ROS_AVAILABLE
    use_real_ros = not introspection_demo
    mode = {
        "no_ros": not use_real_ros,
        "introspection": "demo" if introspection_demo else "live",
        # No explicit BT source → "auto": probe a local Groot2 executor.
        "behavior_tree": "real" if args.btros else ("demo" if args.bt else "auto"),
    }

    config = BridgeConfig(
        frontend_dir=frontend_dir,
        http_port=args.port,
        ws_port=args.ws_port,
        ws_host=DEFAULT_WS_HOST,
        rate_limit_hz=args.rate_limit,
        sim_mode=introspection_demo,
        bt_mode=args.bt,
        btros=args.btros,
    )

    _log_run_mode(logger, args, mode)

    runtime = BridgeRuntime()
    rate_limiter = RateLimiter(config.rate_limit_hz)

    try:
        asyncio.run(async_main(config, runtime, rate_limiter, mode, logger))
    except KeyboardInterrupt:
        logger.info("Shutting down bridge...")
    finally:
        logger.info("Bridge closed.")


def _log_run_mode(logger, args, mode):
    if args.sim:
        ros_line = "NOT USED (--sim — no ROS)"
    elif mode["no_ros"]:
        ros_line = "not found — falling back to demo introspection"
    else:
        ros_line = "connected (live graph)"
    insp = "DEMO (simulated graph)" if mode["introspection"] == "demo" else "LIVE (real ROS graph)"
    bt = {
        "real": f"REAL (Groot2 {args.btros})",
        "demo": "DEMO (bt_simulation)",
        "auto": "AUTO (probing localhost:1667 for a Groot2 executor)",
    }[mode["behavior_tree"]]
    bar = "=" * 64
    logger.info(bar)
    logger.info(" RUN MODE")
    logger.info(f"   ROS 2          : {ros_line}")
    logger.info(f"   Introspection  : {insp}")
    logger.info(f"   Behavior Tree  : {bt}")
    logger.info(bar)


async def mode_broadcaster(runtime, mode):
    """Re-announce the run mode so late-joining clients can show a badge."""
    import time as _time
    while True:
        runtime.dispatch_event({"type": "bridge_mode", "timestamp": _time.time(), "data": mode})
        await asyncio.sleep(3.0)


async def async_main(config, runtime, rate_limiter, mode, logger):
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
        mode_task = asyncio.create_task(mode_broadcaster(runtime, mode))

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
        elif not config.bt_mode:
            # No explicit BT source — auto-probe a local Groot2 executor so that
            # running with no args still picks up a live tree if one is present.
            bt_ros = BTRosBridge(runtime, logger, host="localhost",
                                 port=DEFAULT_GROOT_PORT, quiet=True)
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
            mode_task.cancel()
            broadcaster_task.cancel()


def parse_args():
    parser = argparse.ArgumentParser(description="ROS 2 Browser-based 3D Network Visualizer Bridge")
    parser.add_argument("--port", type=int, default=DEFAULT_HTTP_PORT, help="Port to serve frontend files (HTTP)")
    parser.add_argument("--ws-port", type=int, default=DEFAULT_WS_PORT, help="Port to run WebSocket server")
    parser.add_argument("--sim", action="store_true", help="NO ROS — never use rclpy (introspection runs on demo data)")
    parser.add_argument(
        "--insp",
        action="store_true",
        help="Introspection DEMO — use the simulated ROS graph even when ROS is present",
    )
    parser.add_argument(
        "--bt",
        action="store_true",
        help="Behavior Tree DEMO — run the demo tree emitter (bt_blueprint / bt_delta)",
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

