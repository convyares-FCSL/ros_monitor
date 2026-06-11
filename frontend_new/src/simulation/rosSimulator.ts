import type { GraphUpdate, MessageEvent, ServiceInvokedEvent, LifecycleEvent, NodeParamsEvent, WsFrame } from '../types';

// Realistic ROS 2 nav/drive stack
const SIM_GRAPH: GraphUpdate = {
  nodes: [
    { name: 'mserve_base', namespace: '/', pid: 130569 },
    { name: 'mserve_drivechain', namespace: '/', pid: 130602 },
    { name: 'lidar_driver', namespace: '/', pid: 130688 },
    { name: 'camera_node', namespace: '/camera', pid: 130701 },
    { name: 'slam_toolbox', namespace: '/', pid: 130744 },
    { name: 'planner_server', namespace: '/navigation', pid: 130800 },
    { name: 'controller_server', namespace: '/navigation', pid: 130812 },
    { name: 'bt_navigator', namespace: '/navigation', pid: 130850 },
    { name: 'robot_state_publisher', namespace: '/', pid: 130400 },
    { name: 'joint_state_broadcaster', namespace: '/', pid: 130422 },
    { name: 'teleop_twist_keyboard', namespace: '/', pid: null },
  ],
  topics: [
    { name: '/cmd_vel', types: ['geometry_msgs/msg/Twist'], publishers: ['mserve_base', 'controller_server', 'teleop_twist_keyboard'], subscribers: ['mserve_drivechain'] },
    { name: '/odom', types: ['nav_msgs/msg/Odometry'], publishers: ['mserve_drivechain'], subscribers: ['controller_server', 'slam_toolbox'] },
    { name: '/scan', types: ['sensor_msgs/msg/LaserScan'], publishers: ['lidar_driver'], subscribers: ['slam_toolbox', 'controller_server'] },
    { name: '/tf', types: ['tf2_msgs/msg/TFMessage'], publishers: ['robot_state_publisher', 'mserve_drivechain'], subscribers: ['slam_toolbox', 'planner_server', 'controller_server', 'bt_navigator'] },
    { name: '/map', types: ['nav_msgs/msg/OccupancyGrid'], publishers: ['slam_toolbox'], subscribers: ['planner_server'] },
    { name: '/plan', types: ['nav_msgs/msg/Path'], publishers: ['planner_server'], subscribers: ['controller_server'] },
    { name: '/joint_states', types: ['sensor_msgs/msg/JointState'], publishers: ['joint_state_broadcaster'], subscribers: ['robot_state_publisher'] },
    { name: '/camera/image_raw', types: ['sensor_msgs/msg/Image'], publishers: ['camera_node'], subscribers: [] },
    { name: '/camera/depth', types: ['sensor_msgs/msg/Image'], publishers: ['camera_node'], subscribers: ['slam_toolbox'] },
    { name: '/goal_pose', types: ['geometry_msgs/msg/PoseStamped'], publishers: [], subscribers: ['bt_navigator'] },
    { name: '/local_costmap', types: ['nav_msgs/msg/OccupancyGrid'], publishers: ['controller_server'], subscribers: [] },
    { name: '/navigation/feedback', types: ['nav2_msgs/msg/NavigateToPoseFeedback'], publishers: ['bt_navigator'], subscribers: [] },
  ],
  services: [
    { name: '/mserve_drivechain/drive', types: ['interfaces/srv/Drive'], servers: ['mserve_drivechain'], clients: ['mserve_base'] },
    { name: '/mserve_drivechain/get_state', types: ['interfaces/srv/GetState'], servers: ['mserve_drivechain'], clients: [] },
    { name: '/mserve_drivechain/set_parameters', types: ['rcl_interfaces/srv/SetParameters'], servers: ['mserve_drivechain'], clients: [] },
    { name: '/mserve_drivechain/get_parameters', types: ['rcl_interfaces/srv/GetParameters'], servers: ['mserve_drivechain'], clients: [] },
    { name: '/slam_toolbox/save_map', types: ['slam_toolbox/srv/SaveMap'], servers: ['slam_toolbox'], clients: [] },
    { name: '/navigation/compute_path', types: ['nav2_msgs/srv/ComputePathToPose'], servers: ['planner_server'], clients: ['bt_navigator'] },
    { name: '/lidar_driver/get_parameters', types: ['rcl_interfaces/srv/GetParameters'], servers: ['lidar_driver'], clients: [] },
    { name: '/camera_node/set_camera_info', types: ['sensor_msgs/srv/SetCameraInfo'], servers: ['camera_node'], clients: [] },
  ],
  actions: [
    { name: '/navigate_to_pose', type: 'nav2_msgs/action/NavigateToPose', servers: ['bt_navigator'], clients: ['planner_server'] },
    { name: '/follow_path', type: 'nav2_msgs/action/FollowPath', servers: ['controller_server'], clients: ['bt_navigator'] },
  ],
};

const TOPIC_HZ: Record<string, number> = {
  '/cmd_vel': 20, '/odom': 30, '/scan': 10, '/tf': 100, '/map': 0.5,
  '/plan': 2, '/joint_states': 50, '/camera/image_raw': 30, '/camera/depth': 15,
  '/local_costmap': 1, '/navigation/feedback': 5,
};

const PAYLOADS: Record<string, () => Record<string, unknown>> = {
  '/cmd_vel': () => ({ linear: { x: +(Math.random() * 0.5).toFixed(3), y: 0, z: 0 }, angular: { x: 0, y: 0, z: +((Math.random() - 0.5) * 1).toFixed(3) } }),
  '/odom': () => ({ header: { frame_id: 'odom' }, child_frame_id: 'base_footprint', pose: { pose: { position: { x: +(Math.random() * 5).toFixed(3), y: +(Math.random() * 5).toFixed(3), z: 0 } } }, twist: { twist: { linear: { x: +(Math.random() * 0.3).toFixed(3) } } } }),
  '/scan': () => ({ header: { frame_id: 'laser_frame' }, angle_min: -3.14159, angle_max: 3.14159, range_min: 0.12, range_max: 10.0, ranges: '[1440 float32]' }),
  '/tf': () => ({ transforms: [{ header: { frame_id: 'odom' }, child_frame_id: 'base_footprint', transform: { translation: { x: +(Math.random() * 3).toFixed(3), y: +(Math.random() * 3).toFixed(3), z: 0 }, rotation: { z: 0.04, w: 0.999 } } }] }),
  '/joint_states': () => ({ name: ['wheel_left', 'wheel_right'], position: [+(Math.random() * 6.28).toFixed(4), +(Math.random() * 6.28).toFixed(4)], velocity: [+(Math.random() * 2).toFixed(3), +(Math.random() * 2).toFixed(3)] }),
  '/plan': () => ({ header: { frame_id: 'map' }, poses: `[${Math.floor(Math.random() * 40 + 10)} PoseStamped]` }),
};

const MSG_TOPICS = ['/cmd_vel', '/odom', '/scan', '/tf', '/joint_states', '/plan'];

let msgCounter = 0;

export function generateGraphUpdate(): WsFrame {
  return { type: 'graph_update', timestamp: Date.now() / 1000, data: SIM_GRAPH };
}

export function generateFrequencyUpdate(): WsFrame {
  const updates: Record<string, number> = {};
  for (const [topic, hz] of Object.entries(TOPIC_HZ)) {
    if (hz > 0) updates[topic] = +(hz * (0.9 + Math.random() * 0.2)).toFixed(2);
  }
  return { type: 'frequency_update', timestamp: Date.now() / 1000, data: { updates } };
}

export function generateMessageEvent(): WsFrame {
  const topic = MSG_TOPICS[Math.floor(Math.random() * MSG_TOPICS.length)];
  const topicMeta = SIM_GRAPH.topics.find(t => t.name === topic);
  const payloadFn = PAYLOADS[topic];
  const sizeBytes = topic === '/camera/image_raw' ? 921600 : Math.floor(Math.random() * 800 + 100);
  const dropped = sizeBytes > 50000;

  const ev: MessageEvent = {
    id: `sim-${++msgCounter}`,
    topic,
    msg_type: topicMeta?.types[0] ?? 'std_msgs/msg/String',
    payload: dropped ? null : (payloadFn?.() ?? {}),
    dropped_payload: dropped,
    size_bytes: sizeBytes,
    timestamp: Date.now(),
  };

  return { type: 'message_event', timestamp: Date.now() / 1000, data: ev };
}

export function generateServiceInvoked(): WsFrame {
  const service = '/mserve_drivechain/drive';
  const ev: ServiceInvokedEvent = {
    id: `svc-${++msgCounter}`,
    service_name: service,
    event_type: Math.random() > 0.5 ? 0 : 1,
    payload: { left_speed: +(Math.random() * 100).toFixed(1), right_speed: +(Math.random() * 100).toFixed(1) },
    timestamp: Date.now(),
  };
  return { type: 'service_invoked', timestamp: Date.now() / 1000, data: ev };
}

export function generateLifecycleEvent(): WsFrame {
  const nodes = ['mserve_drivechain', 'controller_server', 'slam_toolbox'];
  const ev: LifecycleEvent = {
    node_name: nodes[Math.floor(Math.random() * nodes.length)],
    start_state: 'inactive',
    goal_state: 'active',
    transition_id: 3,
  };
  return { type: 'lifecycle_event', timestamp: Date.now() / 1000, data: ev };
}

export function generateNodeParams(): WsFrame {
  const ev: NodeParamsEvent = {
    node_name: 'mserve_drivechain',
    params: { max_speed: 1.5, acceleration: 0.8, wheel_radius: 0.05, track_width: 0.3 },
  };
  return { type: 'node_params_event', timestamp: Date.now() / 1000, data: ev };
}

export function getSimGraph(): GraphUpdate {
  return SIM_GRAPH;
}
