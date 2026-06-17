#!/usr/bin/env python3
import argparse
import asyncio
import logging
import os
import threading
from contextlib import suppress
from dataclasses import dataclass

from ros_monitor_bridge.config import (
    DEFAULT_HTTP_PORT,
    DEFAULT_RATE_LIMIT_HZ,
    DEFAULT_WS_HOST,
    DEFAULT_WS_PORT,
    BridgeConfig,
)
from ros_monitor_bridge.ros_bridge import ROS_AVAILABLE, run_ros2_node
from ros_monitor_bridge.runtime import BridgeRuntime
from ros_monitor_bridge.bt_simulation import BTSimulation
from ros_monitor_bridge.bt_replay import BTReplay
from ros_monitor_bridge.btros_bridge import DEFAULT_GROOT_PORT, GROOT_NODES, BTRosBridge
from ros_monitor_bridge.simulation import SimulatedBridge
from ros_monitor_bridge.utils import RateLimiter


@dataclass(slots=True)
class ResolvedRunMode:
    mode: str
    no_ros: bool
    introspection: str
    behavior_tree: str
    use_simulated_introspection: bool
    use_internal_bt_demo: bool
    btros: str | None
    warnings: tuple[str, ...]

    def event_payload(self) -> dict[str, str | bool | None]:
        return {
            "mode": self.mode,
            "no_ros": self.no_ros,
            "introspection": self.introspection,
            "behavior_tree": self.behavior_tree,
            "bt_endpoint": self.btros,
        }


def _resolve_groot_ports() -> dict[str, int]:
    """Return label→port map, overriding defaults from GROOT_PORT_<LABEL> env vars."""
    ports = dict(GROOT_NODES)
    for label in ports:
        val = os.environ.get(f"GROOT_PORT_{label.upper()}")
        if val:
            ports[label] = int(val)
    return ports


def main():
    logging.basicConfig(level=logging.INFO, format="[%(asctime)s] [%(levelname)s] %(message)s")
    logger = logging.getLogger("ROS2Bridge")

    args = parse_args()
    # Resolve replay path before async_main starts the HTTP server thread,
    # which calls os.chdir(frontend_dir) and would corrupt relative paths.
    if args.replay:
        args.replay = os.path.abspath(args.replay)
    frontend_dir = resolve_frontend_dir()
    run_mode = resolve_run_mode(args)

    config = BridgeConfig(
        frontend_dir=frontend_dir,
        http_port=args.port,
        ws_port=args.ws_port,
        ws_host=DEFAULT_WS_HOST,
        rate_limit_hz=args.rate_limit,
        mode=run_mode.mode,
        sim_mode=run_mode.use_simulated_introspection,
        bt_mode=run_mode.use_internal_bt_demo,
        no_bt=run_mode.behavior_tree == "off",
        btros=run_mode.btros,
        replay_file=args.replay,
    )

    for warning in run_mode.warnings:
        logger.warning(warning)
    _log_run_mode(logger, run_mode)

    event_queue_max = max(1, int(os.environ.get("ROS_MONITOR_EVENT_QUEUE_MAX", "4096")))
    runtime = BridgeRuntime(event_queue_maxsize=event_queue_max)
    rate_limiter = RateLimiter(config.rate_limit_hz)

    try:
        asyncio.run(async_main(config, runtime, rate_limiter, run_mode.event_payload(), logger))
    except KeyboardInterrupt:
        logger.info("Shutting down bridge...")
    except Exception:
        logger.exception("Bridge terminated due to a fatal runtime error.")
        raise
    finally:
        logger.info("Bridge closed.")


def resolve_run_mode(args) -> ResolvedRunMode:
    warnings: list[str] = []

    explicit_mode = args.mode
    effective_mode = explicit_mode or "full"

    if args.sim:
        warnings.append("[DEPRECATED] --sim maps to --mode sim.")
        if explicit_mode and explicit_mode != "sim":
            raise SystemExit("--sim cannot be combined with --mode values other than sim.")
        effective_mode = "sim"

    if args.insp:
        warnings.append(
            "[DEPRECATED] --insp has no direct canonical equivalent and now maps to --mode sim."
        )
        if explicit_mode and explicit_mode != "sim":
            raise SystemExit("--insp cannot be combined with --mode values other than sim.")
        effective_mode = "sim"

    if effective_mode == "sim" and args.btros:
        raise SystemExit("--btros is not supported in --mode sim. Use --mode full or --mode demo.")

    if args.no_ros_demo and effective_mode != "demo":
        warnings.append(f"[WARN] --no-ros-demo is ignored in --mode {effective_mode}.")

    legacy_bt_demo = False
    if args.bt:
        warnings.append(
            "[DEPRECATED] --bt is ambiguous. Use --mode sim for internal simulated BT, or --mode demo for bundled local BT demo."
        )
        if effective_mode == "sim":
            warnings.append("[WARN] --bt is redundant in --mode sim; simulated BT is already the default.")
        elif explicit_mode == "demo":
            warnings.append("[WARN] --bt is ignored in --mode demo; use the bundled BT demo or --no-bt.")
        else:
            legacy_bt_demo = True

    introspection = "demo" if effective_mode == "sim" else "live"
    no_ros = effective_mode == "sim"

    if args.no_bt:
        behavior_tree = "off"
    elif effective_mode == "sim":
        behavior_tree = "demo"
    elif args.btros:
        behavior_tree = "real"
    elif legacy_bt_demo:
        behavior_tree = "demo"
    else:
        behavior_tree = "auto"

    return ResolvedRunMode(
        mode=effective_mode,
        no_ros=no_ros,
        introspection=introspection,
        behavior_tree=behavior_tree,
        use_simulated_introspection=effective_mode == "sim",
        use_internal_bt_demo=behavior_tree == "demo",
        btros=args.btros,
        warnings=tuple(warnings),
    )


def _log_run_mode(logger, run_mode: ResolvedRunMode):
    ros_line = "NOT USED (sim mode)" if run_mode.no_ros else "connected (live ROS graph)"
    insp = "DEMO (simulated graph)" if run_mode.introspection == "demo" else "LIVE (real ROS graph)"
    bt = {
        "real": f"REAL (Groot2 {run_mode.btros})",
        "demo": "DEMO (bt_simulation)",
        "auto": "AUTO (probing {} Groot2 executors: {})".format(
            len(GROOT_NODES),
            ', '.join(f'{k}:{v}' for k, v in GROOT_NODES.items()),
        ),
        "off": "OFF (--no-bt)",
    }[run_mode.behavior_tree]
    bar = "=" * 64
    logger.info(bar)
    logger.info(" RUN MODE")
    logger.info(f"   Top-level mode : {run_mode.mode.upper()}")
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


def _worker_failure_reasons(http_thread=None, ros_thread=None, tasks=()):
    issues = []
    if http_thread is not None and not http_thread.is_alive():
        issues.append("HTTP server thread stopped")
    if ros_thread is not None and not ros_thread.is_alive():
        issues.append("ROS executor thread stopped")
    for label, task in tasks:
        if task is None or not task.done():
            continue
        try:
            exc = task.exception()
        except asyncio.CancelledError:
            continue
        if exc is None:
            issues.append(f"{label} task stopped unexpectedly")
        else:
            issues.append(f"{label} task failed: {exc}")
    return issues


async def worker_watchdog(http_thread=None, ros_thread=None, tasks=(), poll_s: float = 1.0):
    while True:
        issues = _worker_failure_reasons(http_thread=http_thread, ros_thread=ros_thread, tasks=tasks)
        if issues:
            raise RuntimeError("; ".join(issues))
        await asyncio.sleep(poll_s)


async def async_main(config, runtime, rate_limiter, mode, logger):
    import websockets
    from ros_monitor_bridge.server import (
        create_ws_handler,
        process_plain_http_request,
        run_http_server,
        websocket_broadcaster,
    )

    runtime.attach_loop(asyncio.get_running_loop(), logger)
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
            args=(config.frontend_dir, config.http_port, logger, runtime),
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
        # bridge or the simulation.
        bt_sim = None
        if config.bt_mode and not config.replay_file:
            bt_sim = BTSimulation(runtime, logger)
            bt_sim.start()

        # VCR replay mode: stream a .btlog.db3 instead of any live BT source.
        if config.replay_file:
            replayer = BTReplay(runtime, logger, config.replay_file)
            runtime.replay_controller = replayer
            replayer.start()
            logger.info(f"Replay mode: {config.replay_file}")

        bt_bridges: list[BTRosBridge] = []
        if config.replay_file or config.no_bt:
            pass
        elif config.btros:
            host, _, port = config.btros.partition(":")
            b = BTRosBridge(runtime, logger, host=host or "localhost",
                            port=int(port) if port else DEFAULT_GROOT_PORT,
                            label="custom")
            b.start()
            bt_bridges.append(b)
        elif not config.bt_mode:
            # Auto-probe each named executor. quiet=True so absent nodes don't
            # spam the log — connections (when they succeed) are still logged.
            for label, port in _resolve_groot_ports().items():
                b = BTRosBridge(runtime, logger, host="localhost", port=port,
                                label=label, quiet=True)
                b.start()
                bt_bridges.append(b)

        watchdog_task = None
        try:
            watchdog_task = asyncio.create_task(
                worker_watchdog(
                    http_thread=http_thread,
                    ros_thread=ros_thread,
                    tasks=(
                        ("websocket broadcaster", broadcaster_task),
                        ("mode broadcaster", mode_task),
                    ),
                )
            )
            await asyncio.gather(broadcaster_task, mode_task, watchdog_task)
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
            for b in bt_bridges:
                b.stop()
            if config.replay_file and runtime.replay_controller:
                runtime.replay_controller.stop()
            for task in (watchdog_task, mode_task, broadcaster_task):
                if task is not None:
                    task.cancel()
            for task in (watchdog_task, mode_task, broadcaster_task):
                if task is None:
                    continue
                with suppress(asyncio.CancelledError):
                    await task


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="ROS 2 Browser-based 3D Network Visualizer Bridge")
    parser.add_argument("--port", type=int, default=DEFAULT_HTTP_PORT, help="Port to serve frontend files (HTTP)")
    parser.add_argument("--ws-port", type=int, default=DEFAULT_WS_PORT, help="Port to run WebSocket server")
    parser.add_argument(
        "--mode",
        choices=("sim", "demo", "full"),
        default=None,
        help="Canonical run mode: sim = offline simulation, demo = bundled local demos, full = live system",
    )
    parser.add_argument(
        "--sim",
        action="store_true",
        help="Deprecated alias for --mode sim",
    )
    parser.add_argument(
        "--insp",
        action="store_true",
        help="Deprecated alias for introspection demo; currently maps to --mode sim",
    )
    parser.add_argument(
        "--bt",
        action="store_true",
        help="Deprecated, ambiguous BT demo flag retained for backward compatibility",
    )
    parser.add_argument(
        "--no-bt",
        action="store_true",
        help="Disable behavior tree integration entirely",
    )
    parser.add_argument(
        "--no-ros-demo",
        action="store_true",
        help="Launcher-facing demo option; ignored by the bridge outside demo-mode orchestration",
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
    parser.add_argument(
        "--replay",
        type=str,
        default=None,
        metavar="FILE.btlog.db3",
        help="Replay a .btlog.db3 file instead of connecting to a live BT executor",
    )
    return parser.parse_args(argv)


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
