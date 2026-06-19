// Minimal BehaviorTree.CPP v4 demo that runs a small tree and exposes it over
// the Groot2 protocol (TCP 1667) — a real source for validating btros_bridge.py
// (the --btros Groot2 client) without needing the mserve / hyfleet stacks.
//
// Also writes a timestamped .btlog.db3 SQLite log via SqliteLogger so the
// VCR replay pipeline can be tested against a locally generated file.
//
// Also pushes a legacy HTTP blackboard snapshot to the bridge after each tick
// (superseded by btros_bridge.py polling the Groot2 'B' ZMQ request directly).
//
// Build + run: see bt_demo/README.md (source ROS, cmake, ./bt_demo).
#include <arpa/inet.h>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <filesystem>
#include <netinet/in.h>
#include <sys/socket.h>
#include <thread>
#include <iostream>
#include <unistd.h>

#include "behaviortree_cpp/bt_factory.h"
#include "behaviortree_cpp/loggers/groot2_publisher.h"
#include "behaviortree_cpp/loggers/bt_sqlite_logger.h"

// Bridge HTTP port (matches DEFAULT_HTTP_PORT in config.py).
static constexpr int kBridgeHttpPort = 7260;
static constexpr const char* kTreeId = "ChargeManager";

// Fire-and-forget HTTP POST of a JSON blackboard snapshot to the bridge.
// Silently does nothing if the bridge is not listening.
static void push_blackboard(double state_of_charge, double charge_current) {
  char body[256];
  std::snprintf(body, sizeof(body),
    R"({"tree_id":"%s","vars":{"state_of_charge":%.2f,"charge_current":%.2f,"charger_port":"DC-FAST-1"}})",
    kTreeId, state_of_charge, charge_current);
  int body_len = static_cast<int>(std::strlen(body));

  char req[512];
  std::snprintf(req, sizeof(req),
    "POST /api/bt_blackboard HTTP/1.1\r\n"
    "Host: localhost:%d\r\n"
    "Content-Type: application/json\r\n"
    "Content-Length: %d\r\n"
    "Connection: close\r\n"
    "\r\n"
    "%s",
    kBridgeHttpPort, body_len, body);

  int sock = socket(AF_INET, SOCK_STREAM, 0);
  if (sock < 0) return;

  struct timeval tv{};
  tv.tv_sec = 0;
  tv.tv_usec = 200000;  // 200 ms — don't block the tick loop
  setsockopt(sock, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
  setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));

  struct sockaddr_in addr{};
  addr.sin_family = AF_INET;
  addr.sin_port = htons(kBridgeHttpPort);
  inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);

  if (connect(sock, reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr)) == 0) {
    send(sock, req, std::strlen(req), MSG_NOSIGNAL);
  }
  close(sock);
}

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
    return { InputPort<double>("target_a"), OutputPort<double>("soc"), OutputPort<double>("current") };
  }
  NodeStatus onStart() override { ticks_ = 0; return NodeStatus::RUNNING; }
  NodeStatus onRunning() override {
    double target_a = 32.0;
    getInput("target_a", target_a);
    ++ticks_;
    if (ticks_ < 5) {
      double soc = ticks_ * 20.0;
      // CC phase: ramp current up to target over the first two ticks, then hold.
      double current = (ticks_ < 2) ? target_a * (ticks_ / 2.0) : target_a;
      setOutput("soc", soc);
      setOutput("current", current);
      return NodeStatus::RUNNING;
    }
    // CV phase: current tapers as cell voltage approaches limit.
    setOutput("soc", 100.0);
    setOutput("current", target_a * 0.05);
    return NodeStatus::SUCCESS;
  }
  void onHalted() override { setOutput("current", 0.0); }
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
        <RampCurrent target_a="32.0" soc="{state_of_charge}" current="{charge_current}"/>
      </Timeout>
      <HoldVoltage target_v="400.0"/>
    </Sequence>
  </BehaviorTree>
</root>
)";

static std::string make_log_path() {
  std::filesystem::create_directories("bt_logs");
  std::time_t now = std::time(nullptr);
  std::tm* t = std::localtime(&now);
  char buf[80];
  std::strftime(buf, sizeof(buf), "bt_logs/bt_log_%Y%m%dT%H%M%S.btlog.db3", t);
  return std::string(buf);
}

int main() {
  BehaviorTreeFactory factory;
  factory.registerNodeType<IsConnected>("IsConnected");
  factory.registerNodeType<RampCurrent>("RampCurrent");
  factory.registerNodeType<HoldVoltage>("HoldVoltage");

  auto tree = factory.createTreeFromText(kTreeXML);

  // Groot2Publisher: ZMQ REP on port 1667 — dashboard live view.
  Groot2Publisher publisher(tree, 1667);

  // SqliteLogger: one row per status change → .btlog.db3 for VCR replay.
  // Writes are sub-100µs; no impact at 300ms tick rate.
  const std::string log_path = make_log_path();
  SqliteLogger sqlite_logger(tree, log_path, /*append=*/false);

  std::cout << "bt_demo: ChargeManager publishing on Groot2 port 1667 (Ctrl-C to stop)\n";
  std::cout << "bt_demo: writing log to " << log_path << "\n";
  std::cout << "bt_demo: legacy HTTP blackboard push enabled on port " << kBridgeHttpPort << " (superseded by ZMQ 'B' poll)\n";

  while (true) {
    tree.tickOnce();

    // Legacy side-channel: push a snapshot to the bridge HTTP endpoint so older
    // bridge builds still show live blackboard data.  btros_bridge.py now reads
    // the same values directly via the Groot2 'B' ZMQ request and supersedes this.
    double soc = 0.0, current = 0.0;
    try { soc     = tree.rootBlackboard()->get<double>("state_of_charge"); } catch (...) {}
    try { current = tree.rootBlackboard()->get<double>("charge_current");  } catch (...) {}
    push_blackboard(soc, current);

    std::this_thread::sleep_for(std::chrono::milliseconds(300));
  }

  // Both loggers flush/close in their destructors (RAII).
  return 0;
}
