// --- Shared Configuration & Application State ---

// WebSocket Configuration
export const WS_PORT = 8765;
export const wsUrl = `ws://${window.location.hostname || 'localhost'}:${WS_PORT}`;

// Types definition for color & mesh rendering
export const NODE_TYPES = {
    NODE: 'node',
    TOPIC: 'topic',
    SERVICE: 'service',
    ACTION: 'action'
};

// Colors matching style.css (vibrant HSL palettes)
export const COLORS = {
    [NODE_TYPES.NODE]: 0x06b6d4,      // Cyan
    [NODE_TYPES.TOPIC]: 0xf97316,     // Orange
    [NODE_TYPES.SERVICE]: 0x10b981,   // Green
    [NODE_TYPES.ACTION]: 0xa855f7,    // Purple
    BG_DARK: 0x030712
};

// Emissive color per lifecycle state
export const LIFECYCLE_COLORS = {
    unconfigured:     0x64748b,  // slate grey
    inactive:         0xf59e0b,  // amber
    active:           0x06b6d4,  // cyan (normal)
    error_processing: 0xef4444,  // red
    finalized:        0xef4444,  // red
};

// Hz health status constants
export const HZ_HEALTH = {
    STABLE:  'stable',
    JITTER:  'jitter',
    STALE:   'stale',
    UNKNOWN: 'unknown',
};

// Three.js hex colors per Hz health state (used for link and sprite coloring)
export const HZ_HEALTH_COLORS = {
    stable:  0x10b981,  // green
    jitter:  0xf59e0b,  // amber
    stale:   0xef4444,  // red
    unknown: 0x475569,  // default slate
};

// Force-Directed Graph Layout Parameters
export const K_REPULSION = 18.0;
export const K_ATTRACTION = 0.08;
export const L_REST = 6.0;
export const K_GRAVITY = 0.05;
export const DAMPING = 0.85;
export const MAX_SPEED = 0.5;

export const MAX_HISTORY_PER_TOPIC = 10;

// Every ROS 2 node exposes these parameter-introspection services. They
// clutter the services list, so they are treated as "generic" (hidden,
// collapsible) by default - same as /rosout for topics.
export const GENERIC_SERVICE_SUFFIXES = [
    '/describe_parameters',
    '/get_parameter_types',
    '/get_parameters',
    '/list_parameters',
    '/set_parameters',
    '/set_parameters_atomically',
    '/get_type_description',
];

// The bridge's own ROS 2 node - all of its services are infrastructure noise.
export const GENERIC_NODE_PREFIXES = ['/ros_websocket_bridge/', '/ros2_websocket_bridge/'];

// Topics that are generic (hidden, collapsible) by default.
export const GENERIC_DEFAULT_TOPICS = new Set(['/rosout']);

// Nodes that are generic (hidden, collapsible) by default.
// Include both slash-prefixed (simulation) and plain (real ROS 2) name forms.
// Infra nodes (rosbridge, rosapi) subscribe to everything and misrepresent the
// system's real center of mass — muted by default, toggleable in BUILT-IN.
export const GENERIC_DEFAULT_NODES = new Set([
    'ros2_websocket_bridge', '/ros2_websocket_bridge',
    'ros_websocket_bridge',  '/ros_websocket_bridge',
    'rosbridge_websocket',   '/rosbridge_websocket',
    'rosapi',                '/rosapi',
    'rosapi_params',         '/rosapi_params',
]);

// Node name prefixes that are always built-in infrastructure noise.
// _ros2cli_daemon_* nodes have a random hex suffix so must be matched by prefix.
export const GENERIC_DEFAULT_NODE_PREFIXES = ['_ros2cli_daemon_', '/_ros2cli_daemon_'];

// --- Shared Mutable Application State ---
export const state = {
    socket: null,
    reconnectTimer: null,
    isSimulationMode: false,

    bytesReceived: 0,
    lastBytesTime: Date.now(),
    currentBandwidth: 0,

    // Three.js globals
    scene: null,
    camera: null,
    renderer: null,
    controls: null,
    raycaster: null,
    mouse: null,

    // Graph layout vertices and edges
    vertices: {}, // id -> { id, name, type, mesh, sprite, velocity, pos, connections }
    links: [],    // Array of { sourceId, targetId, lineMesh }
    activeParticles: [], // Array of message particle animations
    pausedParticle: null, // References currently inspected/paused particle

    // Visibility state
    typeVisibility: {
        [NODE_TYPES.NODE]: true,
        [NODE_TYPES.TOPIC]: true,
        [NODE_TYPES.SERVICE]: true,
        [NODE_TYPES.ACTION]: true
    },
    sectionCollapse: {
        [NODE_TYPES.NODE]: false,
        [NODE_TYPES.TOPIC]: false,
        [NODE_TYPES.SERVICE]: false,
        [NODE_TYPES.ACTION]: false
    },
    itemVisibility: {},
    genericOverrides: new Map(), // vertexId -> true/false (explicit user override)
    genericGroupExpanded: {},    // sidebar list element id -> bool (collapsed by default)
    inspectorCardExpanded: {},   // entity-info card title -> bool (collapsed by default)

    // Lifecycle & telemetry state
    nodeLifecycleState: {},   // node_name -> lifecycle state string
    nodeParams: {},            // node_name -> { param: value }
    nodePids: {},              // node_name -> pid (int) | null (not found = possible phantom)
    topicHz: {},              // topic_name -> { hz, health, lastUpdate }
    topicHzHistory: {},       // topic_name -> [{ts, hz}, ...] (30s rolling)

    // Message / inspector history
    messageHistory: {},
    topicOrderIndex: {},
    nextTopicOrderIndex: 0,
    inspectorGroupState: {},
    selectedHistoryEntryId: null,
    historyEntrySequence: 0,

    // Graph data & pause state
    latestGraphData: null,
    pendingGraphData: null,
    isScenePaused: false,

    // Selection & isolation
    selectedEntityId: null,
    isolatedVertexIds: null,
    isolatedRootId: null,

    // Context menu / right-click drag tracking
    contextMenuTargetId: null,
    rightClickStart: null,
    rightClickMoved: false,

    // Local simulation fallback
    localSimInterval: null,
};

// --- Logging & Diagnostics ---
export function logger(msg, isError = false) {
    if (isError) {
        console.error(`[Bridge] ${msg}`);
    } else {
        console.log(`[Bridge] ${msg}`);
    }
}

export function showRuntimeBanner(message) {
    let banner = document.getElementById('runtime-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'runtime-banner';
        banner.style.position = 'fixed';
        banner.style.right = '16px';
        banner.style.bottom = '16px';
        banner.style.zIndex = '50';
        banner.style.maxWidth = '420px';
        banner.style.padding = '12px 14px';
        banner.style.border = '1px solid rgba(239, 68, 68, 0.45)';
        banner.style.borderRadius = '8px';
        banner.style.background = 'rgba(127, 29, 29, 0.88)';
        banner.style.color = '#fee2e2';
        banner.style.fontSize = '14px';
        banner.style.lineHeight = '1.4';
        banner.style.pointerEvents = 'none';
        document.body.appendChild(banner);
    }
    banner.textContent = message;
}

// --- Connection / Bandwidth Helpers ---
export function updateConnStatus(statusClass, label) {
    const indicator = document.getElementById('conn-status');
    indicator.className = `status-indicator ${statusClass}`;
    indicator.querySelector('.status-text').innerText = label;
}

export function updateBandwidthStats() {
    const now = Date.now();
    const elapsed = (now - state.lastBytesTime) / 1000.0;
    if (elapsed >= 1.0) {
        state.currentBandwidth = state.bytesReceived / elapsed;
        state.bytesReceived = 0;
        state.lastBytesTime = now;
    }
}

export function formatBandwidth(bps) {
    if (bps > 1024 * 1024) return (bps / (1024 * 1024)).toFixed(2) + ' MB/s';
    if (bps > 1024) return (bps / 1024).toFixed(1) + ' KB/s';
    return bps.toFixed(0) + ' B/s';
}

// --- Lucide Icon Refresh ---
export function refreshIcons() {
    if (window.lucide && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
    }
}
