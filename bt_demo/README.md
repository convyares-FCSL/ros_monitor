# bt_demo — real BehaviorTree.CPP v4 Groot2 source

A tiny standalone C++ program that runs a small BT.CPP **v4** tree and exposes it
over the **Groot2** protocol (TCP `1667`). Use it to validate the bridge's
`--btros` Groot2 client ([btros_bridge.py](../backend/ros_monitor_bridge/btros_bridge.py))
without needing the mserve / hyfleet stacks.

The tree (`ChargeManager`): `Sequence [ IsConnected, Timeout(RampCurrent), HoldVoltage ]`
with input/output ports and a blackboard key (`{state_of_charge}`).

## Build

Requires `behaviortree_cpp` from the ROS install (provides the lib + Groot2 publisher).

```bash
source /opt/ros/jazzy/setup.bash
cd bt_demo
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
```

## Run + connect the bridge

```bash
# terminal 1 — the real Groot2 source
source /opt/ros/jazzy/setup.bash
./bt_demo/build/bt_demo            # publishes ChargeManager on Groot2 port 1667

# terminal 2 — the visualizer bridge, pointed at it
pip install pyzmq                  # one-time (the --bt sim path needs no deps)
python3 backend/bridge.py --btros localhost:1667
# open the Behavior Tree page → ChargeManager appears in the tree selector
```

Validated: the bridge fetches the tree (`FULLTREE`), parses the XML `_uid` map,
folds the `Timeout` decorator into a cap on `RampCurrent`, and streams live
`STATUS` deltas as `bt_delta` events — identical to the `--bt` simulation.
