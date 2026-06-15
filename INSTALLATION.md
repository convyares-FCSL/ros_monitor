# Installation Guide

Covers a clean Ubuntu 22.04 / 24.04 machine with an NVIDIA GPU (Jetson or desktop).
The React frontend requires Node.js; the Python bridge requires ROS 2 Jazzy.

---

## 1. System prerequisites

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y \
  build-essential cmake git curl fuser \
  python3 python3-pip python3-venv
```

---

## 2. ROS 2 Jazzy

> Skip this section if ROS 2 Jazzy is already installed (`ros2 --version`).

```bash
# Locale
sudo apt install -y locales
sudo locale-gen en_US en_US.UTF-8
sudo update-locale LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8
export LANG=en_US.UTF-8

# Universe repository
sudo apt install -y software-properties-common
sudo add-apt-repository universe

# ROS 2 apt repository
sudo apt install -y curl gnupg lsb-release
sudo curl -sSL https://raw.githubusercontent.com/ros/rosdistro/master/ros.key \
  -o /usr/share/keyrings/ros-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) \
  signed-by=/usr/share/keyrings/ros-archive-keyring.gpg] \
  http://packages.ros.org/ros2/ubuntu $(lsb_release -cs) main" \
  | sudo tee /etc/apt/sources.list.d/ros2.list > /dev/null

sudo apt update
sudo apt install -y ros-jazzy-desktop ros-dev-tools

# Colcon
sudo apt install -y python3-colcon-common-extensions

# Source ROS 2 automatically in new shells
echo "source /opt/ros/jazzy/setup.bash" >> ~/.bashrc
source /opt/ros/jazzy/setup.bash
```

Verify:

```bash
ros2 --version
```

---

## 3. Node.js

The React frontend (`frontend_new/`) requires Node.js 18 or newer. The LTS
installer from NodeSource is the simplest method:

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs
```

Verify:

```bash
node --version   # 18.x or newer
npm --version
```

---

## 4. Clone the repository

```bash
git clone <repo-url> ~/ros_monitor
cd ~/ros_monitor
```

---

## 5. Python bridge environment

The launcher script handles this automatically on first run. To set it up
manually:

```bash
./scripts/setup_python_env.sh
```

This creates `.venv/` with `--system-site-packages` so that `rclpy` (installed
by ROS 2 into the system Python) remains visible inside the venv.

### Optional — live Groot2 / BT integration (`--btros`)

Only needed if you want to connect to a real BehaviorTree.CPP executor over the
Groot2 protocol (i.e. not using `--mode sim` or `--mode demo`):

```bash
.venv/bin/pip install pyzmq
```

---

## 6. Build the bundled demo workspace

Required for `--mode demo`. This builds the `monitor_demo` ROS 2 package:

```bash
source /opt/ros/jazzy/setup.bash
./scripts/build_demo.sh
```

---

## 7. Build the BT demo (optional)

Required for `--mode demo` with behavior tree support. The launcher builds it
automatically, but you can build it manually:

```bash
source /opt/ros/jazzy/setup.bash
cmake -S bt_demo -B bt_demo/build -DCMAKE_BUILD_TYPE=Release
cmake --build bt_demo/build
```

---

## 8. Build the React frontend

The launcher does this automatically. To build manually:

```bash
cd frontend_new
npm install
npm run build
cd ..
```

---

## 9. Run the visualizer

All three commands build or reuse existing assets automatically.

### Simulation mode (no ROS required)

```bash
./scripts/run_visualizer_new.sh --mode sim
```

### Bundled demo mode (ROS + BT demo processes, real protocols)

```bash
./scripts/run_visualizer_new.sh --mode demo
```

### Full live mode (connects to your running ROS 2 system)

```bash
source /opt/ros/jazzy/setup.bash
source /path/to/your_ws/install/setup.bash   # optional: expose custom interfaces
./scripts/run_visualizer_new.sh --mode full
```

Open `http://localhost:7260` in a browser.

### Faster restart (skip rebuild)

```bash
./scripts/run_visualizer_new.sh --mode demo --skip-build
```

---

## 10. Frontend development (hot reload)

```bash
# Terminal 1 — bridge
./scripts/run_visualizer.sh

# Terminal 2 — Vite dev server
cd frontend_new
npm run dev
```

Open `http://localhost:5173`. Changes to `frontend_new/src/` reload instantly.

---

## Troubleshooting

**`npm not found`** — Node.js was not installed. Re-run step 3.

**`ros2: command not found`** — ROS 2 is not sourced. Add
`source /opt/ros/jazzy/setup.bash` to your `~/.bashrc` and open a new terminal.

**`externally-managed-environment` pip error** — Do not use `pip install`
directly into system Python. The `.venv` created by `setup_python_env.sh` is
the right target; the launcher activates it automatically.

**`behaviortree_cpp` not found when building bt_demo** — Source the ROS setup
before running cmake: `source /opt/ros/jazzy/setup.bash`.

**`fuser: command not found`** — Install `psmisc`: `sudo apt install -y psmisc`.

**`colcon: command not found`** — Install colcon:
`sudo apt install -y python3-colcon-common-extensions`.

**Port already in use (8765 or 7260)** — The launcher kills stale processes on
startup. If it fails, run `fuser -k 8765/tcp 7260/tcp` manually.
