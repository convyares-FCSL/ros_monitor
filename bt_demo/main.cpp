// Minimal BehaviorTree.CPP v4 demo that runs a small tree and exposes it over
// the Groot2 protocol (TCP 1667) — a real source for validating btros_bridge.py
// (the --btros Groot2 client) without needing the mserve / hyfleet stacks.
//
// Build + run: see bt_demo/README.md (source ROS, cmake, ./bt_demo).
#include <chrono>
#include <thread>
#include <iostream>

#include "behaviortree_cpp/bt_factory.h"
#include "behaviortree_cpp/loggers/groot2_publisher.h"

using namespace BT;

// Condition: is the charger plugged in.
class IsConnected : public ConditionNode {
public:
  IsConnected(const std::string& name, const NodeConfig& cfg) : ConditionNode(name, cfg) {}
  static PortsList providedPorts() { return { InputPort<std::string>("port") }; }
  NodeStatus tick() override { return NodeStatus::SUCCESS; }
};

// Stateful action that dwells in RUNNING for a few ticks so status is visible.
class RampCurrent : public StatefulActionNode {
public:
  RampCurrent(const std::string& name, const NodeConfig& cfg) : StatefulActionNode(name, cfg) {}
  static PortsList providedPorts() {
    return { InputPort<double>("target_a"), OutputPort<double>("soc") };
  }
  NodeStatus onStart() override { ticks_ = 0; return NodeStatus::RUNNING; }
  NodeStatus onRunning() override {
    if (++ticks_ < 5) { setOutput("soc", ticks_ * 20.0); return NodeStatus::RUNNING; }
    setOutput("soc", 100.0);
    return NodeStatus::SUCCESS;
  }
  void onHalted() override {}
private:
  int ticks_ = 0;
};

class HoldVoltage : public StatefulActionNode {
public:
  HoldVoltage(const std::string& name, const NodeConfig& cfg) : StatefulActionNode(name, cfg) {}
  static PortsList providedPorts() { return { InputPort<double>("target_v") }; }
  NodeStatus onStart() override { ticks_ = 0; return NodeStatus::RUNNING; }
  NodeStatus onRunning() override { return (++ticks_ < 3) ? NodeStatus::RUNNING : NodeStatus::SUCCESS; }
  void onHalted() override {}
private:
  int ticks_ = 0;
};

static const char* kTreeXML = R"(
<root BTCPP_format="4">
  <BehaviorTree ID="ChargeManager">
    <Sequence name="root">
      <IsConnected port="DC-FAST-1"/>
      <Timeout msec="60000">
        <RampCurrent target_a="32.0" soc="{state_of_charge}"/>
      </Timeout>
      <HoldVoltage target_v="400.0"/>
    </Sequence>
  </BehaviorTree>
</root>
)";

int main() {
  BehaviorTreeFactory factory;
  factory.registerNodeType<IsConnected>("IsConnected");
  factory.registerNodeType<RampCurrent>("RampCurrent");
  factory.registerNodeType<HoldVoltage>("HoldVoltage");

  auto tree = factory.createTreeFromText(kTreeXML);
  Groot2Publisher publisher(tree, 1667);

  std::cout << "bt_demo: ChargeManager publishing on Groot2 port 1667 (Ctrl-C to stop)\n";
  while (true) {
    tree.tickOnce();              // re-ticks from the root after each completion
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
  }
  return 0;
}
