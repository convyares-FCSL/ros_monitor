# Running ROS Monitor (and HyFleet) in Docker

This guide containerises the ROS Monitor bridge and shows how to run it
alongside **HyFleet** (a separate, not-yet-dockerised ROS 2 system) on the
**same host** using **host networking**, so both share one DDS domain and
discover each other automatically.

```
┌─────────────────────────── one host (network_mode: host) ───────────────────────────┐
│                                                                                      │
│   ┌──────────────────┐         DDS (ROS_DOMAIN_ID=N)        ┌──────────────────────┐ │
│   │  ros-monitor      │  ◀───────  pub/sub, services  ─────▶ │  hyfleet              │ │
│   │  rclpy bridge     │            actions, /rosout         │  your ROS 2 nodes     │ │
│   │  :7260 UI :8765 WS│                                     │                        │ │
│   └──────────────────┘                                     └──────────────────────┘ │
│                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────┘
        browser → http://localhost:7260
```

---

## 1. Prerequisites

- **Docker Desktop with WSL 2 integration enabled.** Currently `docker` is not
  reachable from this WSL distro — enable it in *Docker Desktop → Settings →
  Resources → WSL Integration* (toggle on for this distro), then reopen the
  shell and confirm:

  ```bash
  docker --version && docker compose version
  ```

- Both containers must run on the **same `ROS_DOMAIN_ID`** (default `0`).

---

## 2. Build & run the monitor

From `projects/ros_monitor/`:

```bash
# Build the image and start the bridge in live (full) mode.
ROS_DOMAIN_ID=0 docker compose up --build
```

Then open **http://localhost:7260**.

The image is multi-stage:
1. `node:20` builds `frontend_new/dist`.
2. `ros:jazzy-ros-base` runs `backend/bridge.py --mode full` and serves the
   built UI.

`--mode full` connects to the live ROS 2 graph and auto-probes `localhost` for
Groot2 BT executors. To run a self-contained instance with no live ROS (useful
to smoke-test the image), override the command:

```bash
docker compose run --rm --service-ports ros-monitor --mode sim
```

---

## 3. Decoding HyFleet's custom message types  ⚠️ important

The monitor deserialises messages using the interface definitions available in
its own ROS environment. The base image includes the **standard** packages
(`std_msgs`, `sensor_msgs`, `rcl_interfaces`, `lifecycle_msgs`, …). If HyFleet
publishes **custom messages**, the monitor needs those `.msg` definitions too —
otherwise those topics appear in the graph but their payloads can't be
introspected.

Mount HyFleet's built workspace and point the overlay hook at it. In
`docker-compose.yml`, uncomment:

```yaml
    environment:
      - ROS_MONITOR_OVERLAY_SETUP=/overlay/install/setup.bash
    volumes:
      - /home/ecm/ai-workspace/projects/hyfleet_ws/install:/overlay/install:ro
```

`entrypoint.sh` sources that overlay before launching the bridge.

> The HyFleet workspace must be built for the **same ROS distro (Jazzy)** as the
> monitor image for the interfaces to load cleanly.

---

## 4. Dockerising HyFleet (template)

HyFleet has no Docker yet. Drop a `Dockerfile` like this at the root of the
HyFleet workspace (adjust package names / launch file):

```dockerfile
# hyfleet_ws/Dockerfile
FROM ros:jazzy-ros-base AS build
WORKDIR /ws
COPY src/ ./src/
RUN apt-get update \
 && rosdep update \
 && rosdep install --from-paths src --ignore-src -y \
 && rm -rf /var/lib/apt/lists/*
RUN . /opt/ros/jazzy/setup.sh \
 && colcon build --symlink-install

# Source ROS + the built overlay, then launch.
RUN printf '#!/usr/bin/env bash\nset -e\nsource /opt/ros/jazzy/setup.bash\nsource /ws/install/setup.bash\nexec "$@"\n' \
      > /entrypoint.sh && chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
CMD ["ros2", "launch", "hyfleet_bringup", "hyfleet.launch.py"]
```

Then add a sibling Compose file (or a service in a shared one). The **only**
networking requirements are host networking + a matching `ROS_DOMAIN_ID`:

```yaml
# hyfleet_ws/docker-compose.yml
services:
  hyfleet:
    build: .
    image: hyfleet:latest
    container_name: hyfleet
    network_mode: host
    environment:
      - ROS_DOMAIN_ID=${ROS_DOMAIN_ID:-0}
    restart: unless-stopped
```

---

## 5. Running both together

Two independent stacks on the same host network discover each other over DDS.
Start each from its own directory (shared domain id):

```bash
# Terminal 1 — the system under test
cd /home/ecm/ai-workspace/projects/hyfleet_ws
ROS_DOMAIN_ID=0 docker compose up --build

# Terminal 2 — the monitor
cd /home/ecm/ai-workspace/projects/ros_monitor
ROS_DOMAIN_ID=0 docker compose up --build
```

Prefer a single file? Add the `hyfleet` service (Section 4) into this repo's
`docker-compose.yml` and `docker compose up` brings up both. Keep both services
on `network_mode: host` and the same `ROS_DOMAIN_ID`.

---

## 6. Notes & caveats

- **Host networking on Docker Desktop / WSL 2:** containers run inside the WSL 2
  VM. Both containers using `network_mode: host` share that VM's network
  namespace, so DDS multicast discovery and loopback (Groot2 ZMQ on `:1667`)
  work between them, and `localhost:7260` is reachable from the Windows browser.
- **`ROS_DOMAIN_ID` must match** across every participant, or they won't see
  each other.
- **Custom RMW:** if HyFleet uses a non-default RMW (e.g. CycloneDDS), set the
  same `RMW_IMPLEMENTATION` on the monitor service (commented line provided).
- **Node → host-PID mapping:** the introspection view maps ROS nodes to OS PIDs
  via `/proc`. Inside a container this only sees the container's own processes.
  Add `pid: host` to the monitor service to map host-run nodes; it won't reach
  PIDs inside *other* containers (separate PID namespaces) — expect that column
  to be partial in a fully containerised setup.
- **BT replay logs:** mount `./bt_logs:/app/bt_logs` (commented in compose) to
  persist recordings outside the container.
