# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — build the React frontend (frontend_new/dist)
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-slim AS frontend

WORKDIR /build
# Install deps first for layer caching.
COPY frontend_new/package.json frontend_new/package-lock.json ./
RUN npm ci

# Build the static bundle.
COPY frontend_new/ ./
RUN npm run build      # → /build/dist

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — runtime: ROS 2 Jazzy + Python bridge + built frontend
# ─────────────────────────────────────────────────────────────────────────────
# ros:jazzy-ros-base ships rclpy and the standard interface packages
# (rcl_interfaces, lifecycle_msgs, std_msgs, …) on Ubuntu 24.04 / Python 3.12.
FROM ros:jazzy-ros-base AS runtime

# Python deps for the bridge. rclpy comes from the ROS base image; these are the
# pure-Python extras. pyzmq is required for the live Groot2 BT client (--btros /
# auto-probe in full mode); msgpack + websockets are in requirements.txt.
COPY requirements.txt /tmp/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages \
        -r /tmp/requirements.txt pyzmq \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Backend bridge code.
COPY backend/ /app/backend/

# Built frontend from stage 1.
COPY --from=frontend /build/dist /app/frontend/dist

# Entrypoint sources ROS (and any mounted overlay) before launching the bridge.
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/backend \
    ROS_MONITOR_FRONTEND_DIR=/app/frontend/dist

# Informational only — with `network_mode: host` these bind directly on the host.
#   7260 = HTTP (frontend UI),  8765 = WebSocket (live event stream)
EXPOSE 7260 8765

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["--mode", "full"]
