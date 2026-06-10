// --- 3D ROS 2 Network Visualizer Frontend Core ---

// WebSocket Configuration
const WS_PORT = 8765;
const wsUrl = `ws://${window.location.hostname || 'localhost'}:${WS_PORT}`;
let socket = null;
let reconnectTimer = null;
let isSimulationMode = false;

// Statistics & Telemetry Counters
let messageCount = 0;
let bytesReceived = 0;
let lastBytesTime = Date.now();
let currentBandwidth = 0; // bytes/sec

// Three.js Global Variables
let scene, camera, renderer, controls;
let container = document.getElementById('canvas-container');

// Graph Layout Vertices and Edges
const vertices = {}; // id -> { id, name, type, mesh, sprite, velocity, pos, connections }
const links = [];    // Array of { sourceId, targetId, lineMesh }
let activeParticles = []; // Array of message particle animations
let pausedParticle = null; // References currently inspected/paused particle

// Force-Directed Graph Layout Parameters
const K_REPULSION = 18.0;
const K_ATTRACTION = 0.08;
const L_REST = 6.0;
const K_GRAVITY = 0.05;
const DAMPING = 0.85;
const MAX_SPEED = 0.5;

// Types definition for color & mesh rendering
const NODE_TYPES = {
    NODE: 'node',
    TOPIC: 'topic',
    SERVICE: 'service',
    ACTION: 'action'
};

const TYPE_VISIBILITY = {
    [NODE_TYPES.NODE]: true,
    [NODE_TYPES.TOPIC]: true,
    [NODE_TYPES.SERVICE]: true,
    [NODE_TYPES.ACTION]: true
};

const SECTION_COLLAPSE = {
    [NODE_TYPES.NODE]: false,
    [NODE_TYPES.TOPIC]: false,
    [NODE_TYPES.SERVICE]: false,
    [NODE_TYPES.ACTION]: false
};

const itemVisibility = {};
const messageHistory = {};
const MAX_HISTORY_PER_TOPIC = 10;
const genericTopicIds = new Set(['topic:/rosout']);
const topicOrderIndex = {};
let nextTopicOrderIndex = 0;
const inspectorGroupState = {};
let selectedHistoryEntryId = null;
let historyEntrySequence = 0;
let latestGraphData = null;
let pendingGraphData = null;
let isScenePaused = false;
let selectedEntityId = null;
let isolatedVertexIds = null;
let isolatedRootId = null;
let contextMenuTargetId = null;
let rightClickStart = null;
let rightClickMoved = false;

// Colors matching style.css (vibrant HSL palettes)
const COLORS = {
    [NODE_TYPES.NODE]: 0x06b6d4,      // Cyan
    [NODE_TYPES.TOPIC]: 0xf97316,     // Orange
    [NODE_TYPES.SERVICE]: 0x10b981,   // Green
    [NODE_TYPES.ACTION]: 0xa855f7,    // Purple
    BG_DARK: 0x030712
};

// Raycasting (for mouse selection of particles)
let raycaster = null;
let mouse = null;

// --- Init Application ---
window.addEventListener('load', () => {
    initWebSocket();
    setupUIEventListeners();

    try {
        initThree();
        animate();
    } catch (err) {
        logger(`3D initialization failed: ${err.message}`, true);
        showRuntimeBanner(`3D initialization failed: ${err.message}`);
    }

    if (window.lucide && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
    }
});

// --- Initialize Three.js Scene ---
function initThree() {
    if (!window.THREE) {
        throw new Error('Three.js not loaded');
    }

    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // 1. Scene Setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(COLORS.BG_DARK);
    scene.fog = new THREE.FogExp2(COLORS.BG_DARK, 0.015);

    // 2. Camera Setup
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 15, 25);

    // 3. Renderer Setup
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    // 4. Controls Setup
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxDistance = 150;
    controls.minDistance = 5;

    // 5. Lighting Setup
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.35);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.7);
    dirLight1.position.set(20, 40, 20);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x06b6d4, 0.4);
    dirLight2.position.set(-20, -10, -20);
    scene.add(dirLight2);

    // 6. Floor Grid (anchors the scene visually)
    const gridHelper = new THREE.GridHelper(100, 50, 0x1e293b, 0x0f172a);
    gridHelper.position.y = -8;
    scene.add(gridHelper);

    // 7. Immersive Space Starfield
    createStarfield();

    // 8. Event Listeners
    window.addEventListener('resize', onWindowResize);
    window.addEventListener('click', onSceneClick);
    window.addEventListener('contextmenu', onSceneContextMenu);
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);
}

// Create a starfield background
function createStarfield() {
    const starCount = 1500;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount * 3; i += 3) {
        // Distribute in a shell far away
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(Math.random() * 2 - 1);
        const radius = 80 + Math.random() * 60;

        positions[i] = radius * Math.sin(phi) * Math.cos(theta);
        positions[i + 1] = radius * Math.sin(phi) * Math.sin(theta);
        positions[i + 2] = radius * Math.cos(phi);

        // Add subtle blue-ish/white colors
        const colorVal = 0.7 + Math.random() * 0.3;
        colors[i] = colorVal * 0.8;
        colors[i + 1] = colorVal * 0.9;
        colors[i + 2] = colorVal;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
        size: 0.8,
        vertexColors: true,
        transparent: true,
        opacity: 0.7
    });

    const starfield = new THREE.Points(geometry, material);
    scene.add(starfield);
}

// --- WebSocket Connection ---
function initWebSocket() {
    updateConnStatus('disconnected', 'CONNECTING...');
    
    if (socket) {
        socket.close();
    }

    logger(`Connecting to WebSocket bridge at ${wsUrl}...`);
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        logger("WebSocket connection established.");
        updateConnStatus(isSimulationMode ? 'simulating' : 'connected', isSimulationMode ? 'SIMULATING' : 'CONNECTED');
        if (reconnectTimer) {
            clearInterval(reconnectTimer);
            reconnectTimer = null;
        }
    };

    socket.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            
            // Stats updates
            bytesReceived += event.data.length;
            updateBandwidthStats();

            if (msg.type === 'graph_update') {
                handleGraphUpdate(msg.data);
            } else if (msg.type === 'message_event') {
                handleMessageEvent({
                    ...msg.data,
                    timestamp: msg.timestamp
                });
            }
        } catch (err) {
            console.error("Error processing websocket message:", err);
        }
    };

    socket.onerror = (error) => {
        logger("WebSocket error: " + error.message, true);
    };

    socket.onclose = () => {
        logger("WebSocket connection closed. Retrying in 4 seconds...", true);
        updateConnStatus('disconnected', 'DISCONNECTED');
        clearGraph();
        
        // Start reconnection loop if not already running
        if (!reconnectTimer) {
            reconnectTimer = setInterval(initWebSocket, 4000);
        }
    };
}

// --- Handle Graph Updates (Topological Sync) ---
function handleGraphUpdate(data) {
    if (isScenePaused) {
        pendingGraphData = data;
        return;
    }

    latestGraphData = data;
    const activeIds = new Set();

    // Helper to add/sync vertex in layout
    function syncVertex(id, name, type) {
        activeIds.add(id);
        if (!vertices[id]) {
            // Instantiate new vertex
            const pos = new THREE.Vector3(
                (Math.random() - 0.5) * 5,
                (Math.random() - 0.5) * 5,
                (Math.random() - 0.5) * 5
            );
            
            // Create mesh based on type
            const mesh = createMeshForType(type);
            mesh.position.copy(pos);
            scene.add(mesh);

            // Create text sprite label
            const labelSprite = createLabelSprite(name, COLORS[type]);
            labelSprite.position.copy(pos).y += (type === NODE_TYPES.NODE ? 1.5 : 1.0);
            scene.add(labelSprite);

            vertices[id] = {
                id,
                name,
                type,
                mesh,
                sprite: labelSprite,
                pos,
                velocity: new THREE.Vector3(0, 0, 0),
                connections: new Set()
            };
            mesh.userData.vertexId = id;
        } else {
            // Keep reference to existing
            vertices[id].type = type; // safety
        }

        applyVertexVisibility(vertices[id]);
    }

    // 1. Process Nodes
    data.nodes.forEach(n => {
        const id = `node:${n.name}`;
        syncVertex(id, n.name, NODE_TYPES.NODE);
    });

    // 2. Process Topics
    data.topics.forEach(t => {
        const id = `topic:${t.name}`;
        syncVertex(id, t.name, NODE_TYPES.TOPIC);
    });

    // 3. Process Services
    data.services.forEach(s => {
        const id = `service:${s.name}`;
        syncVertex(id, s.name, NODE_TYPES.SERVICE);
    });

    // 4. Process Actions
    data.actions.forEach(a => {
        const id = `action:${a.name}`;
        syncVertex(id, a.name, NODE_TYPES.ACTION);
    });

    // 5. Clean up old vertices no longer present
    Object.keys(vertices).forEach(id => {
        if (!activeIds.has(id)) {
            // Destroy mesh & sprite
            scene.remove(vertices[id].mesh);
            vertices[id].mesh.geometry.dispose();
            if (Array.isArray(vertices[id].mesh.material)) {
                vertices[id].mesh.material.forEach(m => m.dispose());
            } else {
                vertices[id].mesh.material.dispose();
            }
            
            scene.remove(vertices[id].sprite);
            vertices[id].sprite.material.dispose();
            
            delete vertices[id];
        }
    });

    // 6. Reset connections on vertices to rebuild links map
    Object.values(vertices).forEach(v => v.connections.clear());
    
    // Clear old lines
    links.forEach(l => {
        scene.remove(l.lineMesh);
        l.lineMesh.geometry.dispose();
        l.lineMesh.material.dispose();
    });
    links.length = 0;

    // Helper to add links
    function addLink(sourceId, targetId, colorHex = 0x475569) {
        if (vertices[sourceId] && vertices[targetId]) {
            vertices[sourceId].connections.add(targetId);
            vertices[targetId].connections.add(sourceId);

            // Create lines
            const geom = new THREE.BufferGeometry().setFromPoints([
                vertices[sourceId].pos,
                vertices[targetId].pos
            ]);
            const mat = new THREE.LineBasicMaterial({
                color: colorHex,
                transparent: true,
                opacity: 0.35
            });
            const line = new THREE.Line(geom, mat);
            scene.add(line);

            links.push({
                sourceId,
                targetId,
                lineMesh: line
            });
        }
    }

    // 7. Rebuild links based on data publishers / subscribers
    // Topic: Publisher Node -> Topic Node -> Subscriber Node
    data.topics.forEach(t => {
        const topicId = `topic:${t.name}`;
        t.publishers.forEach(pub => {
            addLink(`node:${pub}`, topicId, COLORS[NODE_TYPES.TOPIC]);
        });
        t.subscribers.forEach(sub => {
            addLink(topicId, `node:${sub}`, COLORS[NODE_TYPES.TOPIC]);
        });
    });

    // Service: Server Node -> Service Node
    data.services.forEach(s => {
        const srvId = `service:${s.name}`;
        s.servers.forEach(srv => {
            addLink(`node:${srv}`, srvId, COLORS[NODE_TYPES.SERVICE]);
        });
    });

    // Action: Clients -> Action Node -> Servers
    data.actions.forEach(a => {
        const actId = `action:${a.name}`;
        a.servers.forEach(srv => {
            addLink(actId, `node:${srv}`, COLORS[NODE_TYPES.ACTION]);
        });
        a.clients.forEach(cli => {
            addLink(`node:${cli}`, actId, COLORS[NODE_TYPES.ACTION]);
        });
    });

    if (isolatedRootId) {
        isolatedVertexIds = buildIsolationSet(isolatedRootId);
    }
    refreshLinkVisibility();
    refreshParticleVisibility();

    // 8. Update HUD Counter Lists
    updateHUDStats(data);

    if (selectedEntityId && vertices[selectedEntityId]) {
        inspectEntity(vertices[selectedEntityId]);
    }
}

// Create geometrical representation based on graph category
function createMeshForType(type) {
    let geom, mat;
    
    switch (type) {
        case NODE_TYPES.NODE:
            // Cylinder for Nodes
            geom = new THREE.CylinderGeometry(0.8, 0.8, 1.6, 16);
            mat = new THREE.MeshStandardMaterial({
                color: COLORS[type],
                metalness: 0.7,
                roughness: 0.2,
                emissive: COLORS[type],
                emissiveIntensity: 0.15
            });
            break;
            
        case NODE_TYPES.TOPIC:
            // Spheres for Topics
            geom = new THREE.SphereGeometry(0.5, 16, 16);
            mat = new THREE.MeshStandardMaterial({
                color: COLORS[type],
                metalness: 0.1,
                roughness: 0.5,
                emissive: COLORS[type],
                emissiveIntensity: 0.2
            });
            break;
            
        case NODE_TYPES.SERVICE:
            // Cubes for Services
            geom = new THREE.BoxGeometry(0.8, 0.8, 0.8);
            mat = new THREE.MeshStandardMaterial({
                color: COLORS[type],
                metalness: 0.4,
                roughness: 0.3,
                emissive: COLORS[type],
                emissiveIntensity: 0.25
            });
            break;
            
        case NODE_TYPES.ACTION:
            // Purple Icosahedron for Action Clusters
            geom = new THREE.IcosahedronGeometry(0.7, 1);
            mat = new THREE.MeshStandardMaterial({
                color: COLORS[type],
                metalness: 0.8,
                roughness: 0.15,
                emissive: COLORS[type],
                emissiveIntensity: 0.3
            });
            break;
    }
    
    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}

// Generate canvas texture sprite for sharp text labels
function createLabelSprite(text, colorHex) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    
    // Transparent background
    ctx.clearRect(0, 0, 256, 64);
    
    // Draw Text with clean fonts
    ctx.font = 'bold 20px "Outfit", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#' + colorHex.toString(16).padStart(6, '0');
    
    // Drop shadow text
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 2;
    ctx.fillText(text, 128, 30);
    
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(material);
    
    // Scaling
    sprite.scale.set(6, 1.5, 1);
    return sprite;
}

// --- Message Events (Particle Animations along Directed Edges) ---
function handleMessageEvent(data) {
    recordMessageHistory(data);

    if (isScenePaused) {
        return;
    }

    messageCount++;
    document.getElementById('stat-bandwidth').innerText = formatBandwidth(currentBandwidth);

    const topicName = data.topic;
    
    // Find the visual topic representation
    const topicId = `topic:${topicName}`;
    const topicVertex = vertices[topicId];
    if (!topicVertex) {
        // It might be an Action topic inside an action cluster
        if (topicName.includes('/_action/')) {
            const baseAction = topicName.split('/_action/')[0];
            const actionVertex = vertices[`action:${baseAction}`];
            if (actionVertex && isVertexVisible(actionVertex.id)) {
                // Animate to/from Action Node!
                spawnActionParticle(actionVertex, topicName, data);
            }
        }
        return;
    }

    if (!isVertexVisible(topicId)) {
        return;
    }

    // Determine publishers and subscribers from current graph links
    const topicLinks = links.filter(l => l.sourceId === topicId || l.targetId === topicId);
    const publishers = topicLinks.filter(l => l.targetId === topicId).map(l => l.sourceId);
    const subscribers = topicLinks.filter(l => l.sourceId === topicId).map(l => l.targetId);

    // If there's no publisher mesh, we start from a random point or skip
    if (publishers.length === 0) return;

    // We animate a particle: Publisher -> Topic -> Subscriber
    publishers.forEach(pubId => {
        const pubVertex = vertices[pubId];
        if (!pubVertex) return;

        // If there are subscribers, we split the paths.
        if (subscribers.length > 0) {
            subscribers.forEach(subId => {
                const subVertex = vertices[subId];
                if (!subVertex) return;

                // Spawn double-leg particle
                createParticle(pubVertex, topicVertex, subVertex, data);
            });
        } else {
            // No subscribers: just animate Publisher -> Topic
            createParticle(pubVertex, topicVertex, null, data);
        }
    });
}

// Special particle for actions
function spawnActionParticle(actionVertex, topicName, data) {
    // Determine path based on action subtopic
    // feedback/status flows Action Server -> Client (represented by client nodes connected to action node)
    // goal/cancel flows Client -> Server
    const clients = actionVertex.connections; // client and server nodes are connected
    
    // Just animate random paths connected to this action node to keep it simple and visual
    const actionLinks = links.filter(l => l.sourceId === actionVertex.id || l.targetId === actionVertex.id);
    if (actionLinks.length === 0) return;
    
    const pubId = actionLinks[0].sourceId === actionVertex.id ? actionLinks[0].targetId : actionLinks[0].sourceId;
    const pubVertex = vertices[pubId];
    if (pubVertex) {
        createParticle(pubVertex, actionVertex, null, data);
    }
}

// Helper to spawn 3D mesh particle
function createParticle(startNode, midNode, endNode, eventData) {
    if (
        !startNode ||
        !midNode ||
        !isVertexVisible(startNode.id) ||
        !isVertexVisible(midNode.id) ||
        (endNode && !isVertexVisible(endNode.id))
    ) {
        return;
    }

    // Unique color per topic/type
    let color = COLORS[NODE_TYPES.TOPIC];
    if (eventData.topic.includes('/_action/')) {
        color = COLORS[NODE_TYPES.ACTION];
    } else if (eventData.topic.includes('/_service/')) {
        color = COLORS[NODE_TYPES.SERVICE];
    }

    // Geometric shape: Spheres for standard topic messages, Diamonds/Icosahedrons for actions
    let geom;
    if (eventData.topic.includes('/_action/')) {
        geom = new THREE.OctahedronGeometry(0.25);
    } else {
        geom = new THREE.SphereGeometry(0.18, 8, 8);
    }

    const mat = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.9,
        wireframe: false
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(startNode.pos);
    mesh.visible = true;
    scene.add(mesh);

    // Particle travels along paths. Speed is proportional to data rate (frequency)
    // Let's set speed. Standard range 0.005 to 0.03
    const speed = 0.015;

    activeParticles.push({
        mesh,
        startNode,
        midNode,
        endNode,
        progress: 0.0,
        leg: 1, // leg 1: Start -> Mid. leg 2: Mid -> End
        speed,
        paused: false,
        eventData,
        sourceName: startNode.name,
        targetName: endNode ? endNode.name : midNode.name
    });
}

// --- Force-Directed Layout Physics Loop ---
function updateGraphLayout() {
    const keys = Object.keys(vertices);
    const count = keys.length;
    if (count === 0) return;

    // 1. Repulsion forces between ALL nodes
    for (let i = 0; i < count; i++) {
        const u = vertices[keys[i]];
        for (let j = i + 1; j < count; j++) {
            const v = vertices[keys[j]];

            const dir = new THREE.Vector3().subVectors(u.pos, v.pos);
            let dist = dir.length();
            if (dist < 0.2) dist = 0.2; // avoid division by zero

            const forceMag = K_REPULSION / (dist * dist);
            dir.normalize().multiplyScalar(forceMag);

            // Accumulate forces
            u.velocity.add(dir);
            v.velocity.sub(dir);
        }
    }

    // 2. Attraction forces along active links
    links.forEach(link => {
        const u = vertices[link.sourceId];
        const v = vertices[link.targetId];
        if (!u || !v) return;

        const dir = new THREE.Vector3().subVectors(v.pos, u.pos);
        const dist = dir.length();
        if (dist === 0) return;

        // Hooke's Law: force proportional to displacement
        const forceMag = K_ATTRACTION * (dist - L_REST);
        dir.normalize().multiplyScalar(forceMag);

        u.velocity.add(dir);
        v.velocity.sub(dir);
    });

    // 3. Central gravity and position integration
    keys.forEach(id => {
        const v = vertices[id];
        
        // Central gravity pulling to center (0,0,0)
        const gravity = v.pos.clone().multiplyScalar(-K_GRAVITY);
        v.velocity.add(gravity);

        // Apply damping & clamp speed
        v.velocity.multiplyScalar(DAMPING);
        if (v.velocity.length() > MAX_SPEED) {
            v.velocity.setLength(MAX_SPEED);
        }

        // Integrate
        v.pos.add(v.velocity);

        // Sync meshes and labels
        v.mesh.position.copy(v.pos);
        v.sprite.position.copy(v.pos);
        v.sprite.position.y += (v.type === NODE_TYPES.NODE ? 1.5 : 1.0);
    });

    // 4. Update visual line geometries
    links.forEach(link => {
        const u = vertices[link.sourceId];
        const v = vertices[link.targetId];
        if (!u || !v) return;

        const positions = link.lineMesh.geometry.attributes.position.array;
        positions[0] = u.pos.x;
        positions[1] = u.pos.y;
        positions[2] = u.pos.z;
        positions[3] = v.pos.x;
        positions[4] = v.pos.y;
        positions[5] = v.pos.z;
        link.lineMesh.geometry.attributes.position.needsUpdate = true;
    });
}

// --- Animation Frame Loop ---
function animate() {
    requestAnimationFrame(animate);

    if (!isScenePaused) {
        // 1. Physics update for layout
        updateGraphLayout();

        // 2. Telemetry Particle updates
        for (let i = activeParticles.length - 1; i >= 0; i--) {
            const p = activeParticles[i];

            if (p.paused) continue; // Freeze if clicked/inspected

            if (p.leg === 1) {
                // Leg 1: Start -> Mid
                p.progress += p.speed;
                if (p.progress >= 1.0) {
                    if (p.endNode) {
                        p.leg = 2;
                        p.progress = 0.0;
                    } else {
                        // Journey completed (no subscriber)
                        scene.remove(p.mesh);
                        p.mesh.geometry.dispose();
                        p.mesh.material.dispose();
                        activeParticles.splice(i, 1);
                        continue;
                    }
                } else {
                    p.mesh.position.lerpVectors(p.startNode.pos, p.midNode.pos, p.progress);
                }
            }

            if (p.leg === 2) {
                // Leg 2: Mid -> End
                p.progress += p.speed;
                if (p.progress >= 1.0) {
                    // Journey completed
                    scene.remove(p.mesh);
                    p.mesh.geometry.dispose();
                    p.mesh.material.dispose();
                    activeParticles.splice(i, 1);
                } else {
                    p.mesh.position.lerpVectors(p.midNode.pos, p.endNode.pos, p.progress);
                }
            }
        }

        // 3. Spin individual node cylinders/boxes slightly for dynamic feel
        Object.values(vertices).forEach(v => {
            if (v.type === NODE_TYPES.NODE) {
                v.mesh.rotation.y += 0.01;
            } else if (v.type === NODE_TYPES.SERVICE || v.type === NODE_TYPES.ACTION) {
                v.mesh.rotation.x += 0.01;
                v.mesh.rotation.y += 0.01;
            }
        });
    }

    // 4. Render Updates
    controls.update();
    renderer.render(scene, camera);
}

// --- Click Interaction & Raycasting ---
function onSceneClick(event) {
    // Only raycast if the click occurred on the 3D canvas (not on HUD overlay panels)
    if (event.target !== renderer.domElement) return;

    hideContextMenu();

    // Calculate mouse position in normalized device coordinates
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    // Filter mesh targets from our active particles list
    const particleTargets = activeParticles.map(p => p.mesh);
    const particleIntersects = raycaster.intersectObjects(particleTargets);

    if (particleIntersects.length > 0) {
        // Find matching particle
        const hitMesh = particleIntersects[0].object;
        const clickedParticle = activeParticles.find(p => p.mesh === hitMesh);
        
        if (clickedParticle) {
            inspectParticle(clickedParticle);
            return;
        }
    }

    const vertexTargets = Object.values(vertices).filter((vertex) => vertex.mesh.visible).map((vertex) => vertex.mesh);
    const vertexIntersects = raycaster.intersectObjects(vertexTargets);
    if (vertexIntersects.length > 0) {
        const hitVertexId = vertexIntersects[0].object.userData.vertexId;
        if (hitVertexId && vertices[hitVertexId]) {
            inspectEntity(vertices[hitVertexId]);
        }
    }
}

function onSceneContextMenu(event) {
    if (!renderer || event.target !== renderer.domElement) {
        hideContextMenu();
        return;
    }

    event.preventDefault();

    if (rightClickMoved) {
        hideContextMenu();
        return;
    }
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const vertexTargets = Object.values(vertices).filter((vertex) => vertex.mesh.visible).map((vertex) => vertex.mesh);
    const vertexIntersects = raycaster.intersectObjects(vertexTargets);
    if (vertexIntersects.length === 0) {
        hideContextMenu();
        return;
    }

    const hitVertexId = vertexIntersects[0].object.userData.vertexId;
    if (hitVertexId && vertices[hitVertexId]) {
        showContextMenu(hitVertexId, event.clientX, event.clientY);
    }
}

function onPointerDown(event) {
    if (!renderer || event.target !== renderer.domElement || event.button !== 2) {
        return;
    }

    rightClickStart = { x: event.clientX, y: event.clientY };
    rightClickMoved = false;
}

function onPointerMove(event) {
    if (!rightClickStart) {
        return;
    }

    const dx = event.clientX - rightClickStart.x;
    const dy = event.clientY - rightClickStart.y;
    if (Math.hypot(dx, dy) > 6) {
        rightClickMoved = true;
    }
}

function onPointerUp(event) {
    if (event.button === 2) {
        setTimeout(() => {
            rightClickStart = null;
            rightClickMoved = false;
        }, 0);
    }
}

// Inspect and Pause message particle
function inspectParticle(particle) {
    selectedEntityId = null;
    // Unpause previous
    if (pausedParticle) {
        pausedParticle.paused = false;
        pausedParticle.mesh.scale.set(1.0, 1.0, 1.0);
        if (pausedParticle.mesh.material) {
            pausedParticle.mesh.material.wireframe = false;
        }
    }

    // Set new paused particle
    pausedParticle = particle;
    particle.paused = true;
    
    // Scale up and wireframe highlight to show selection
    particle.mesh.scale.set(2.0, 2.0, 2.0);
    particle.mesh.material.wireframe = true;

    // Populate Inspector UI
    const content = document.getElementById('inspector-content');
    const footer = document.getElementById('inspector-footer');
    
    const data = particle.eventData;
    const date = new Date(data.timestamp * 1000);
    const timeStr = date.toLocaleTimeString() + '.' + String(Math.floor((data.timestamp % 1) * 1000)).padStart(3, '0');

    let payloadHTML = '';
    if (data.dropped_payload) {
        payloadHTML = `
            <div class="trimmed-warning">
                <i data-lucide="alert-triangle"></i>
                <div>
                    <strong>Heavy Payload Trimmed</strong><br>
                    Binary data (arrays/images) was dropped from the pipeline to save performance.
                </div>
            </div>
        `;
    } else {
        payloadHTML = `
            <div class="inspector-payload-title">JSON Payload</div>
            <pre class="json-container">${JSON.stringify(data.payload, null, 2)}</pre>
        `;
    }

    content.innerHTML = `
        <div class="inspector-header-info">
            <div class="inspector-row">
                <span class="lbl">Topic</span>
                <span class="val text-orange">${data.topic}</span>
            </div>
            <div class="inspector-row">
                <span class="lbl">Type</span>
                <span class="val badge">${data.msg_type}</span>
            </div>
            <div class="inspector-row">
                <span class="lbl">Timestamp</span>
                <span class="val">${timeStr}</span>
            </div>
            <div class="inspector-row">
                <span class="lbl">Telemetry Size</span>
                <span class="val">${data.size_bytes} Bytes</span>
            </div>
            <div class="inspector-row">
                <span class="lbl">From Node</span>
                <span class="val text-cyan">${particle.sourceName}</span>
            </div>
            <div class="inspector-row">
                <span class="lbl">To Destination</span>
                <span class="val text-cyan">${particle.targetName}</span>
            </div>
        </div>
        ${payloadHTML}
    `;

    footer.style.display = 'block';
    document.getElementById('inspector-title').innerHTML = '<i data-lucide="search" class="icon-inline"></i> Packet Inspector';
    
    // Open panel drawer
    document.getElementById('inspector-panel').classList.remove('collapsed');
    
    if (window.lucide && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
    }
}

function inspectEntity(vertex) {
    releasePausedParticle();
    selectedEntityId = vertex.id;

    const content = document.getElementById('inspector-content');
    const footer = document.getElementById('inspector-footer');
    const groups = getEntityHistoryGroups(vertex);
    const selectedEntry = resolveSelectedHistoryEntry(groups);

    const subtitle = {
        [NODE_TYPES.NODE]: 'Node Activity',
        [NODE_TYPES.TOPIC]: 'Topic Activity',
        [NODE_TYPES.ACTION]: 'Action Activity',
        [NODE_TYPES.SERVICE]: 'Service Activity'
    }[vertex.type] || 'Entity Activity';

    document.getElementById('inspector-title').innerHTML = `<i data-lucide="search" class="icon-inline"></i> ${subtitle}`;

    let groupsHtml = '';
    if (groups.length === 0) {
        groupsHtml = renderEntityInspector(vertex, groups, selectedEntry);
    } else {
        groupsHtml = renderEntityInspector(vertex, groups, selectedEntry);
    }

    content.innerHTML = `
        <div class="inspector-header-info">
            <div class="inspector-row">
                <span class="lbl">Selection</span>
                <span class="val text-cyan">${vertex.name}</span>
            </div>
            <div class="inspector-row">
                <span class="lbl">Type</span>
                <span class="val badge">${vertex.type}</span>
            </div>
            <div class="inspector-row">
                <span class="lbl">Recent Topics</span>
                <span class="val">${groups.length}</span>
            </div>
        </div>
        ${groupsHtml}
    `;

    footer.style.display = 'none';
    document.getElementById('inspector-panel').classList.remove('collapsed');
    bindInspectorInteractions();

    if (window.lucide && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
    }
}

function renderEntityInspector(vertex, groups, selectedEntry) {
    switch (vertex.type) {
        case NODE_TYPES.NODE:
            return renderNodeInspector(vertex, groups, selectedEntry);
        case NODE_TYPES.TOPIC:
            return renderTopicInspector(vertex, groups[0] || null, selectedEntry);
        case NODE_TYPES.ACTION:
            return renderActionInspector(vertex, groups, selectedEntry);
        case NODE_TYPES.SERVICE:
            return renderServiceInspector(vertex, groups, selectedEntry);
        default:
            return renderGroupedInspector(vertex, groups, selectedEntry);
    }
}

function renderGroupedInspector(vertex, groups, selectedEntry) {
    const selectionState = getInspectorGroupState(vertex.id);
    const groupsHtml = groups.map((group) => {
        const expanded = selectionState[group.topic] === true;
        const entriesHtml = group.entries.map((entry) => renderHistoryRow(entry, selectedEntry)).join('');
        return `
            <details class="history-topic-group" data-topic-name="${group.topic}" ${expanded ? 'open' : ''}>
                <summary class="history-topic-header">
                    <div class="history-topic-name">${group.topic}</div>
                    <div class="history-topic-count">${group.entries.length} entr${group.entries.length === 1 ? 'y' : 'ies'}</div>
                </summary>
                <div class="history-topic-body">
                    <div class="history-entry-list">
                        ${entriesHtml}
                    </div>
                </div>
            </details>
        `;
    }).join('');

    return `
        <div class="history-groups">${groupsHtml}</div>
        ${renderDataViewer(selectedEntry)}
    `;
}

function renderNodeInspector(vertex, groups, selectedEntry) {
    const nodeTopics = latestGraphData?.topics?.filter((topic) => topic.publishers.includes(vertex.name) || topic.subscribers.includes(vertex.name)) || [];
    const publishes = nodeTopics.filter((topic) => topic.publishers.includes(vertex.name)).map((topic) => topic.name);
    const subscribes = nodeTopics.filter((topic) => topic.subscribers.includes(vertex.name)).map((topic) => topic.name);
    const actionLinks = latestGraphData?.actions?.filter((action) => action.servers.includes(vertex.name) || action.clients.includes(vertex.name)) || [];

    return `
        <section class="entity-info-grid">
            ${renderInfoCard('Publishes', publishes)}
            ${renderInfoCard('Subscribes', subscribes)}
            ${renderInfoCard('Actions', actionLinks.map((action) => action.name))}
        </section>
        ${groups.length ? renderGroupedInspector(vertex, groups, selectedEntry) : `<div class="history-empty">No recent message history for this node yet.</div>`}
    `;
}

function renderTopicInspector(vertex, group, selectedEntry) {
    const topicData = latestGraphData?.topics?.find((topic) => topic.name === vertex.name);
    const publishers = topicData?.publishers || [];
    const subscribers = topicData?.subscribers || [];
    const entriesHtml = group ? group.entries.map((entry) => renderHistoryRow(entry, selectedEntry)).join('') : '<div class="history-empty">No recent message history for this topic yet.</div>';

    return `
        <section class="topic-io-grid">
            <div class="topic-io-card">
                <div class="topic-io-title">Inputs</div>
                <div class="topic-io-list">
                    ${publishers.length ? publishers.map((publisher) => `<div class="topic-io-chip">${publisher}</div>`).join('') : '<div class="history-empty">No publishers</div>'}
                </div>
            </div>
            <div class="topic-io-card">
                <div class="topic-io-title">Outputs</div>
                <div class="topic-io-list">
                    ${subscribers.length ? subscribers.map((subscriber) => `<div class="topic-io-chip">${subscriber}</div>`).join('') : '<div class="history-empty">No subscribers</div>'}
                </div>
            </div>
        </section>
        <section class="history-topic-flat">
            <div class="history-topic-header static">
                <div class="history-topic-name">${group ? group.topic : vertex.name}</div>
                <div class="history-topic-count">${group ? `${group.entries.length} entr${group.entries.length === 1 ? 'y' : 'ies'}` : '0 entries'}</div>
            </div>
            <div class="history-topic-body">
                <div class="history-entry-list">
                    ${entriesHtml}
                </div>
            </div>
        </section>
        ${renderDataViewer(selectedEntry)}
    `;
}

function renderActionInspector(vertex, groups, selectedEntry) {
    const actionData = latestGraphData?.actions?.find((action) => action.name === vertex.name);
    const servers = actionData?.servers || [];
    const clients = actionData?.clients || [];

    return `
        <section class="entity-info-grid">
            ${renderInfoCard('Servers', servers)}
            ${renderInfoCard('Clients', clients)}
            ${renderInfoCard('Action Topics', groups.map((group) => group.topic))}
        </section>
        ${groups.length ? renderGroupedInspector(vertex, groups, selectedEntry) : `<div class="history-empty">No recent action traffic for this selection yet.</div>`}
    `;
}

function renderServiceInspector(vertex, groups, selectedEntry) {
    const serviceData = latestGraphData?.services?.find((service) => service.name === vertex.name);
    const servers = serviceData?.servers || [];
    const serviceTypes = serviceData?.types || [];

    return `
        <section class="entity-info-grid">
            ${renderInfoCard('Servers', servers)}
            ${renderInfoCard('Service Types', serviceTypes)}
            ${renderInfoCard('Related Traffic', groups.map((group) => group.topic))}
        </section>
        ${groups.length ? renderGroupedInspector(vertex, groups, selectedEntry) : `
            <section class="data-viewer-panel">
                <div class="data-viewer-title">Service Inspector</div>
                <div class="history-empty">This service has no recent message history in the current bridge stream. Service topology is still shown above.</div>
            </section>
        `}
    `;
}

function renderInfoCard(title, items) {
    return `
        <div class="entity-info-card">
            <div class="entity-info-title">${title}</div>
            <div class="entity-info-list">
                ${items && items.length ? items.map((item) => `<div class="topic-io-chip">${item}</div>`).join('') : '<div class="history-empty">None</div>'}
            </div>
        </div>
    `;
}

function renderHistoryRow(entry, selectedEntry) {
    const date = new Date(entry.timestamp * 1000);
    const timeStr = `${date.toLocaleTimeString()}.${String(Math.floor((entry.timestamp % 1) * 1000)).padStart(3, '0')}`;
    const selected = selectedEntry && selectedEntry.id === entry.id;

    return `
        <button class="history-entry-row ${selected ? 'selected' : ''}" data-entry-id="${entry.id}">
            <span class="history-entry-meta">${timeStr}</span>
            <span class="history-entry-meta">${entry.size_bytes} Bytes</span>
            <span class="history-entry-type">${entry.msg_type}</span>
        </button>
    `;
}

function renderDataViewer(selectedEntry) {
    if (!selectedEntry) {
        return `
            <section class="data-viewer-panel">
                <div class="data-viewer-title">Payload Viewer</div>
                <div class="history-empty">Select an event row to inspect its payload.</div>
            </section>
        `;
    }

    const date = new Date(selectedEntry.timestamp * 1000);
    const timeStr = `${date.toLocaleTimeString()}.${String(Math.floor((selectedEntry.timestamp % 1) * 1000)).padStart(3, '0')}`;
    const payloadHtml = selectedEntry.dropped_payload
        ? `
            <div class="trimmed-warning">
                <i data-lucide="alert-triangle"></i>
                <div>
                    <strong>Heavy Payload Trimmed</strong><br>
                    Binary data was dropped from the frontend payload stream.
                </div>
            </div>
        `
        : `<pre class="json-container">${JSON.stringify(selectedEntry.payload, null, 2)}</pre>`;

    return `
        <section class="data-viewer-panel">
            <div class="data-viewer-title">Payload Viewer</div>
            <div class="data-viewer-meta">
                <span class="history-entry-meta">${selectedEntry.topic}</span>
                <span class="history-entry-meta">${timeStr}</span>
                <span class="history-entry-meta">${selectedEntry.size_bytes} Bytes</span>
            </div>
            ${payloadHtml}
        </section>
    `;
}

function bindInspectorInteractions() {
    document.querySelectorAll('.history-topic-group').forEach((details) => {
        details.addEventListener('toggle', () => {
            if (!selectedEntityId) {
                return;
            }
            const topicName = details.dataset.topicName;
            getInspectorGroupState(selectedEntityId)[topicName] = details.open;
        });
    });

    document.querySelectorAll('.history-entry-row').forEach((button) => {
        button.addEventListener('click', () => {
            selectedHistoryEntryId = Number(button.dataset.entryId);
            if (selectedEntityId && vertices[selectedEntityId]) {
                inspectEntity(vertices[selectedEntityId]);
            }
        });
    });
}

function resolveSelectedHistoryEntry(groups) {
    const allEntries = groups.flatMap((group) => group.entries);
    if (allEntries.length === 0) {
        selectedHistoryEntryId = null;
        return null;
    }

    if (selectedHistoryEntryId !== null) {
        const existing = allEntries.find((entry) => entry.id === selectedHistoryEntryId);
        if (existing) {
            return existing;
        }
    }

    selectedHistoryEntryId = allEntries[0].id;
    return allEntries[0];
}

function getInspectorGroupState(selectionId) {
    if (!inspectorGroupState[selectionId]) {
        inspectorGroupState[selectionId] = {};
    }
    return inspectorGroupState[selectionId];
}

function getEntityHistoryGroups(vertex) {
    if (!latestGraphData) {
        return [];
    }

    const topicNames = [];
    const topicNameSet = new Set();

    function addTopicName(topicName) {
        if (!topicNameSet.has(topicName)) {
            topicNameSet.add(topicName);
            topicNames.push(topicName);
        }
    }

    if (vertex.type === NODE_TYPES.TOPIC) {
        addTopicName(vertex.name);
    }

    if (vertex.type === NODE_TYPES.NODE) {
        latestGraphData.topics.forEach((topic) => {
            if (topic.publishers.includes(vertex.name) || topic.subscribers.includes(vertex.name)) {
                addTopicName(topic.name);
            }
        });

        latestGraphData.actions.forEach((action) => {
            if (action.servers.includes(vertex.name) || action.clients.includes(vertex.name)) {
                Object.keys(messageHistory)
                    .filter((topicName) => topicName.startsWith(`${action.name}/_action/`))
                    .sort((a, b) => (topicOrderIndex[a] ?? Number.MAX_SAFE_INTEGER) - (topicOrderIndex[b] ?? Number.MAX_SAFE_INTEGER))
                    .forEach((topicName) => addTopicName(topicName));
            }
        });
    }

    if (vertex.type === NODE_TYPES.ACTION) {
        Object.keys(messageHistory)
            .filter((topicName) => topicName.startsWith(`${vertex.name}/_action/`))
            .sort((a, b) => (topicOrderIndex[a] ?? Number.MAX_SAFE_INTEGER) - (topicOrderIndex[b] ?? Number.MAX_SAFE_INTEGER))
            .forEach((topicName) => addTopicName(topicName));
    }

    const orderedTopicNames = topicNames.slice().sort((a, b) => (topicOrderIndex[a] ?? Number.MAX_SAFE_INTEGER) - (topicOrderIndex[b] ?? Number.MAX_SAFE_INTEGER));
    const groups = orderedTopicNames
        .map((topicName) => ({
            topic: topicName,
            entries: (messageHistory[topicName] || []).slice().reverse()
        }))
        .filter((group) => group.entries.length > 0 && isTopicHistoryVisible(group.topic));

    return groups;
}

// Resume paused particle and close drawer
function resumeTelemetry() {
    releasePausedParticle();
    selectedEntityId = null;
    selectedHistoryEntryId = null;
    document.getElementById('inspector-panel').classList.add('collapsed');
}

function releasePausedParticle() {
    if (pausedParticle) {
        pausedParticle.paused = false;
        pausedParticle.mesh.scale.set(1.0, 1.0, 1.0);
        pausedParticle.mesh.material.wireframe = false;
        pausedParticle = null;
    }
}

// --- UI Updates & Subscriptions ---
function updateHUDStats(data) {
    document.getElementById('stat-node-count').innerText = data.nodes.length;
    document.getElementById('stat-topic-count').innerText = data.topics.length;
    document.getElementById('stat-action-count').innerText = data.actions.length;
    
    document.getElementById('count-nodes').innerText = formatSectionCount(data.nodes, NODE_TYPES.NODE);
    document.getElementById('count-topics').innerText = formatSectionCount(data.topics, NODE_TYPES.TOPIC);
    document.getElementById('count-actions').innerText = formatSectionCount(data.actions, NODE_TYPES.ACTION);
    document.getElementById('count-services').innerText = formatSectionCount(data.services, NODE_TYPES.SERVICE);

    // Populate Sidebar Lists
    populateList('node-list', data.nodes, NODE_TYPES.NODE);
    populateList('topic-list', data.topics, NODE_TYPES.TOPIC);
    populateList('action-list', data.actions, NODE_TYPES.ACTION);
    populateList('service-list', data.services, NODE_TYPES.SERVICE);
    refreshSectionToggles();
}

function populateList(elementId, items, entityType) {
    const list = document.getElementById(elementId);
    list.innerHTML = '';
    
    if (items.length === 0) {
        list.innerHTML = `<li class="empty-list">No active ${elementId.split('-')[0]}s</li>`;
        return;
    }
    
    items.forEach(item => {
        const li = document.createElement('li');
        const name = item.name;
        const vertexId = `${entityType}:${name}`;
        const visible = isEntityDisplayed(entityType, vertexId);

        li.classList.toggle('is-hidden', !visible);
        
        li.innerHTML = `
            <span class="list-item-main">
                <span class="li-name">${name}</span>
            </span>
            <button class="item-toggle ${visible ? '' : 'is-off'}" data-vertex-id="${vertexId}" title="${visible ? 'Hide' : 'Show'} ${name}" aria-label="${visible ? 'Hide' : 'Show'} ${name}">
                <i data-lucide="${visible ? 'eye' : 'eye-off'}"></i>
            </button>
        `;
        
        // Add click listener to center camera on vertex
        li.onclick = () => {
            const vertex = vertices[vertexId];
            if (vertex) {
                // Smooth camera transition using OrbitControls target
                gsapScrollTo(vertex.pos);
                inspectEntity(vertex);
            }
        };

        li.querySelector('.item-toggle').onclick = (event) => {
            event.stopPropagation();
            toggleItemVisibility(vertexId);
        };

        li.oncontextmenu = (event) => {
            event.preventDefault();
            showContextMenu(vertexId, event.clientX, event.clientY);
        };
        
        list.appendChild(li);
    });
    
    if (window.lucide && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
    }
}

// Camera transition helper
function gsapScrollTo(targetPos) {
    // Smooth transition
    const duration = 25; // animation frames
    let frame = 0;
    
    const startTarget = controls.target.clone();
    
    function step() {
        if (frame <= duration) {
            const t = frame / duration;
            // Smooth ease Out
            const ease = 1 - Math.pow(1 - t, 3);
            
            controls.target.lerpVectors(startTarget, targetPos, ease);
            frame++;
            requestAnimationFrame(step);
        }
    }
    step();
}

// Compute bandwidth
function updateBandwidthStats() {
    const now = Date.now();
    const elapsed = (now - lastBytesTime) / 1000.0;
    if (elapsed >= 1.0) {
        currentBandwidth = bytesReceived / elapsed;
        bytesReceived = 0;
        lastBytesTime = now;
    }
}

function formatBandwidth(bps) {
    if (bps > 1024 * 1024) return (bps / (1024 * 1024)).toFixed(2) + ' MB/s';
    if (bps > 1024) return (bps / 1024).toFixed(1) + ' KB/s';
    return bps.toFixed(0) + ' B/s';
}

function updateConnStatus(statusClass, label) {
    const indicator = document.getElementById('conn-status');
    indicator.className = `status-indicator ${statusClass}`;
    indicator.querySelector('.status-text').innerText = label;
}

function clearGraph() {
    if (!scene) {
        return;
    }

    // Clean up Three.js objects
    Object.keys(vertices).forEach(id => {
        scene.remove(vertices[id].mesh);
        scene.remove(vertices[id].sprite);
        delete vertices[id];
    });

    links.forEach(l => {
        scene.remove(l.lineMesh);
    });
    links.length = 0;

    activeParticles.forEach(p => {
        scene.remove(p.mesh);
    });
    activeParticles.length = 0;
    selectedEntityId = null;
    hideContextMenu();
    document.getElementById('inspector-panel').classList.add('collapsed');
}

// --- UI Controls Event Listeners ---
function setupUIEventListeners() {
    // 1. Sidebar Toggle
    const sidebar = document.getElementById('sidebar-panel');
    const toggleBtn = document.getElementById('toggle-sidebar');
    toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        const icon = toggleBtn.querySelector('i');
        if (sidebar.classList.contains('collapsed')) {
            icon.setAttribute('data-lucide', 'chevron-right');
        } else {
            icon.setAttribute('data-lucide', 'chevron-left');
        }
        if (window.lucide && typeof lucide.createIcons === 'function') {
            lucide.createIcons();
        }
    });

    // 2. Recenter Camera
    document.getElementById('btn-recenter').addEventListener('click', () => {
        gsapScrollTo(new THREE.Vector3(0, 0, 0));
        // Reset zoom
        camera.position.set(0, 15, 25);
    });

    document.querySelectorAll('.section-toggle').forEach((button) => {
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            toggleTypeVisibility(button.dataset.filterType);
        });
    });

    document.querySelectorAll('.section-collapse').forEach((button) => {
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            toggleSectionCollapsed(button.dataset.sectionType);
        });
    });

    // 3. Toggle Simulation (Sends instruction to WebSocket server if connected)
    const toggleSimBtn = document.getElementById('btn-toggle-sim');
    toggleSimBtn.addEventListener('click', () => {
        isSimulationMode = !isSimulationMode;
        if (isSimulationMode) {
            toggleSimBtn.classList.add('simulating');
            toggleSimBtn.innerHTML = '<i data-lucide="square"></i> Stop Simulation';
            updateConnStatus('simulating', 'SIMULATING');
            // If websocket is disconnected, we can force mock generation locally
            startLocalSimulation();
        } else {
            toggleSimBtn.classList.remove('simulating');
            toggleSimBtn.innerHTML = '<i data-lucide="play"></i> Toggle Simulation';
            updateConnStatus(socket && socket.readyState === WebSocket.OPEN ? 'connected' : 'disconnected', socket && socket.readyState === WebSocket.OPEN ? 'CONNECTED' : 'DISCONNECTED');
            stopLocalSimulation();
        }
        if (window.lucide && typeof lucide.createIcons === 'function') {
            lucide.createIcons();
        }
    });

    document.getElementById('btn-toggle-pause').addEventListener('click', () => {
        setScenePaused(!isScenePaused);
    });

    document.getElementById('ctx-hide-item').addEventListener('click', () => {
        if (contextMenuTargetId) {
            itemVisibility[contextMenuTargetId] = false;
            updateVisibilityState();
            hideContextMenu();
        }
    });

    document.getElementById('ctx-isolate-item').addEventListener('click', () => {
        if (contextMenuTargetId) {
            isolateFromVertex(contextMenuTargetId);
            hideContextMenu();
        }
    });

    document.getElementById('ctx-toggle-generic').addEventListener('click', () => {
        if (contextMenuTargetId && isTopicVertexId(contextMenuTargetId)) {
            toggleGenericTopic(contextMenuTargetId);
            hideContextMenu();
        }
    });

    document.getElementById('ctx-clear-isolation').addEventListener('click', () => {
        clearIsolation();
        hideContextMenu();
    });

    document.addEventListener('click', (event) => {
        const menu = document.getElementById('graph-context-menu');
        if (menu && !menu.contains(event.target)) {
            hideContextMenu();
        }
    });

    updatePauseButton();
    refreshSectionToggles();
    refreshSectionCollapseButtons();

    // 4. Close Inspector
    document.getElementById('close-inspector').addEventListener('click', resumeTelemetry);
    document.getElementById('btn-resume-particle').addEventListener('click', resumeTelemetry);
}

// Handle window resizing
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Logger output
function logger(msg, isError = false) {
    if (isError) {
        console.error(`[Bridge] ${msg}`);
    } else {
        console.log(`[Bridge] ${msg}`);
    }
}

function showRuntimeBanner(message) {
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

function recordMessageHistory(data) {
    if (topicOrderIndex[data.topic] === undefined) {
        topicOrderIndex[data.topic] = nextTopicOrderIndex++;
    }

    if (!messageHistory[data.topic]) {
        messageHistory[data.topic] = [];
    }

    messageHistory[data.topic].push({
        id: ++historyEntrySequence,
        topic: data.topic,
        timestamp: data.timestamp,
        msg_type: data.msg_type,
        payload: data.payload,
        dropped_payload: data.dropped_payload,
        size_bytes: data.size_bytes
    });

    if (messageHistory[data.topic].length > MAX_HISTORY_PER_TOPIC) {
        messageHistory[data.topic].shift();
    }

    if (selectedEntityId && vertices[selectedEntityId]) {
        inspectEntity(vertices[selectedEntityId]);
    }
}

function isTypeVisible(type) {
    return TYPE_VISIBILITY[type] !== false;
}

function isItemVisible(id) {
    if (Object.prototype.hasOwnProperty.call(itemVisibility, id)) {
        return itemVisibility[id] !== false;
    }

    if (genericTopicIds.has(id)) {
        return false;
    }

    return true;
}

function isEntityVisible(type, id) {
    return isTypeVisible(type) && isItemVisible(id);
}

function isEntityDisplayed(type, id) {
    return isEntityVisible(type, id) && (!isolatedVertexIds || isolatedVertexIds.has(id));
}

function isVertexVisible(id) {
    const vertex = vertices[id];
    if (!vertex) {
        return isItemVisible(id) && (!isolatedVertexIds || isolatedVertexIds.has(id));
    }

    return isEntityDisplayed(vertex.type, id);
}

function formatSectionCount(items, entityType) {
    const visibleCount = items.filter((item) => isEntityDisplayed(entityType, `${entityType}:${item.name}`)).length;
    return visibleCount === items.length ? String(items.length) : `${visibleCount}/${items.length}`;
}

function applyVertexVisibility(vertex) {
    const visible = isEntityDisplayed(vertex.type, vertex.id);
    vertex.mesh.visible = visible;
    vertex.sprite.visible = visible;
}

function refreshLinkVisibility() {
    links.forEach((link) => {
        link.lineMesh.visible = isVertexVisible(link.sourceId) && isVertexVisible(link.targetId);
    });
}

function refreshParticleVisibility() {
    activeParticles.forEach((particle) => {
        particle.mesh.visible =
            isVertexVisible(particle.startNode.id) &&
            isVertexVisible(particle.midNode.id) &&
            (!particle.endNode || isVertexVisible(particle.endNode.id));
    });
}

function showContextMenu(vertexId, clientX, clientY) {
    const menu = document.getElementById('graph-context-menu');
    if (!menu) {
        return;
    }

    contextMenuTargetId = vertexId;
    menu.classList.remove('hidden');
    const maxLeft = window.innerWidth - 196;
    const maxTop = window.innerHeight - 160;
    menu.style.left = `${Math.min(clientX, maxLeft)}px`;
    menu.style.top = `${Math.min(clientY, maxTop)}px`;

    const clearIsolationButton = document.getElementById('ctx-clear-isolation');
    clearIsolationButton.style.display = isolatedVertexIds ? 'flex' : 'none';

    const genericButton = document.getElementById('ctx-toggle-generic');
    if (isTopicVertexId(vertexId)) {
        genericButton.style.display = 'flex';
        genericButton.innerHTML = `<i data-lucide="filter"></i> ${genericTopicIds.has(vertexId) ? 'Unmark Generic' : 'Mark Generic'}`;
    } else {
        genericButton.style.display = 'none';
    }

    if (window.lucide && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
    }
}

function hideContextMenu() {
    const menu = document.getElementById('graph-context-menu');
    if (!menu) {
        return;
    }

    menu.classList.add('hidden');
    contextMenuTargetId = null;
}

function isTopicVertexId(vertexId) {
    return typeof vertexId === 'string' && vertexId.startsWith('topic:');
}

function toggleGenericTopic(vertexId) {
    if (!isTopicVertexId(vertexId)) {
        return;
    }

    if (genericTopicIds.has(vertexId)) {
        genericTopicIds.delete(vertexId);
        delete itemVisibility[vertexId];
    } else {
        genericTopicIds.add(vertexId);
        itemVisibility[vertexId] = false;
    }

    if (isolatedRootId) {
        isolatedVertexIds = buildIsolationSet(isolatedRootId);
    }
    updateVisibilityState();
}

function isolateFromVertex(rootId) {
    isolatedRootId = rootId;
    isolatedVertexIds = buildIsolationSet(rootId);
    updateVisibilityState();
}

function buildIsolationSet(rootId) {
    const visibleNeighborhood = new Set([rootId]);
    const frontier = [{ id: rootId, depth: 0 }];

    while (frontier.length > 0) {
        const current = frontier.shift();
        if (current.depth >= 2) {
            continue;
        }

        links.forEach((link) => {
            let neighborId = null;
            const currentVisible = isBaseVertexVisible(current.id);
            if (link.sourceId === current.id) {
                neighborId = link.targetId;
            } else if (link.targetId === current.id) {
                neighborId = link.sourceId;
            }

            if (currentVisible && neighborId && isBaseVertexVisible(neighborId) && !visibleNeighborhood.has(neighborId)) {
                visibleNeighborhood.add(neighborId);
                frontier.push({ id: neighborId, depth: current.depth + 1 });
            }
        });
    }

    return visibleNeighborhood;
}

function clearIsolation() {
    isolatedVertexIds = null;
    isolatedRootId = null;
    updateVisibilityState();
}

function updateVisibilityState() {
    Object.values(vertices).forEach(applyVertexVisibility);
    refreshLinkVisibility();
    refreshParticleVisibility();

    if (latestGraphData) {
        updateHUDStats(latestGraphData);
    } else {
        refreshSectionToggles();
    }

    if (selectedEntityId && vertices[selectedEntityId]) {
        inspectEntity(vertices[selectedEntityId]);
    }
}

function isBaseVertexVisible(id) {
    const vertex = vertices[id];
    if (!vertex) {
        return isItemVisible(id);
    }

    return isEntityVisible(vertex.type, id);
}

function isTopicHistoryVisible(topicName) {
    const topicVertexId = `topic:${topicName}`;
    if (vertices[topicVertexId]) {
        return isVertexVisible(topicVertexId);
    }

    if (topicName.includes('/_action/')) {
        const baseAction = topicName.split('/_action/')[0];
        const actionVertexId = `action:${baseAction}`;
        if (vertices[actionVertexId]) {
            return isVertexVisible(actionVertexId) && isItemVisible(topicVertexId);
        }
    }

    return isItemVisible(topicVertexId);
}

function toggleTypeVisibility(type) {
    TYPE_VISIBILITY[type] = !TYPE_VISIBILITY[type];
    updateVisibilityState();
}

function toggleItemVisibility(id) {
    itemVisibility[id] = !isItemVisible(id);
    updateVisibilityState();
}

function refreshSectionToggles() {
    document.querySelectorAll('.section-toggle').forEach((button) => {
        const type = button.dataset.filterType;
        const visible = isTypeVisible(type);
        button.classList.toggle('is-off', !visible);
        button.title = `${visible ? 'Hide' : 'Show'} all ${type}s`;
        button.setAttribute('aria-label', button.title);
        button.innerHTML = `<i data-lucide="${visible ? 'eye' : 'eye-off'}"></i>`;
    });

    if (window.lucide && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
    }
}

function toggleSectionCollapsed(type) {
    SECTION_COLLAPSE[type] = !SECTION_COLLAPSE[type];
    refreshSectionCollapseButtons();
}

function refreshSectionCollapseButtons() {
    document.querySelectorAll('.explorer-section').forEach((section) => {
        const type = section.dataset.sectionType;
        section.classList.toggle('is-collapsed', SECTION_COLLAPSE[type] === true);
    });

    document.querySelectorAll('.section-collapse').forEach((button) => {
        const type = button.dataset.sectionType;
        const collapsed = SECTION_COLLAPSE[type] === true;
        button.classList.toggle('is-collapsed', collapsed);
        button.title = `${collapsed ? 'Expand' : 'Collapse'} ${type}s`;
        button.setAttribute('aria-label', button.title);
        button.innerHTML = `<i data-lucide="${collapsed ? 'chevron-right' : 'chevron-down'}"></i>`;
    });

    if (window.lucide && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
    }
}

function updatePauseButton() {
    const button = document.getElementById('btn-toggle-pause');
    if (!button) {
        return;
    }

    button.classList.toggle('paused', isScenePaused);
    button.innerHTML = `<i data-lucide="${isScenePaused ? 'play' : 'pause'}"></i> ${isScenePaused ? 'Resume View' : 'Pause View'}`;

    if (window.lucide && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
    }
}

function setScenePaused(paused) {
    isScenePaused = paused;
    updatePauseButton();

    if (!isScenePaused && pendingGraphData) {
        const nextGraphData = pendingGraphData;
        pendingGraphData = null;
        handleGraphUpdate(nextGraphData);
    }
}

// --- Local Frontend Sandbox Simulation Mode (Fallback when backend offline) ---
let localSimInterval = null;
function startLocalSimulation() {
    logger("Activating local simulation sandbox.");
    // Clear graph before simulating
    clearGraph();
    
    // Construct fake graph update
    const mockData = {
        nodes: [
            { name: "/telemetry_collector", namespace: "/" },
            { name: "/kinematics_engine", namespace: "/" },
            { name: "/trajectory_planner", namespace: "/" },
            { name: "/hardware_interface", namespace: "/" }
        ],
        topics: [
            {
                name: "/sensor_telemetry",
                types: ["geometry_msgs/msg/Point"],
                publishers: ["/telemetry_collector"],
                subscribers: ["/kinematics_engine"]
            },
            {
                name: "/state_estimate",
                types: ["nav_msgs/msg/Odometry"],
                publishers: ["/kinematics_engine"],
                subscribers: ["/trajectory_planner"]
            },
            {
                name: "/joint_commands",
                types: ["sensor_msgs/msg/JointState"],
                publishers: ["/trajectory_planner"],
                subscribers: ["/hardware_interface"]
            }
        ],
        services: [
            {
                name: "/calibrate_sensors",
                types: ["std_srvs/srv/Trigger"],
                servers: ["/telemetry_collector"]
            }
        ],
        actions: [
            {
                name: "/execute_motion",
                type: "control_msgs/action/FollowJointTrajectory",
                servers: ["/hardware_interface"],
                clients: ["/trajectory_planner"]
            }
        ]
    };

    handleGraphUpdate(mockData);

    // Message event simulator
    let t = 0;
    localSimInterval = setInterval(() => {
        t += 0.5;
        
        // Spawn particles
        const now = Date.now() / 1000.0;
        
        // Telemetry events
        handleMessageEvent({
            topic: "/sensor_telemetry",
            msg_type: "geometry_msgs/msg/Point",
            timestamp: now,
            payload: { x: Math.sin(t).toFixed(3), y: Math.cos(t).toFixed(3), z: 0.0 },
            dropped_payload: false,
            size_bytes: 24
        });

        if (Math.floor(t) % 2 === 0) {
            handleMessageEvent({
                topic: "/state_estimate",
                msg_type: "nav_msgs/msg/Odometry",
                timestamp: now,
                payload: {
                    pose: {
                        position: { x: (t * 0.1).toFixed(2), y: 0.0, z: 0.0 },
                        orientation: { x: 0, y: 0, z: 0, w: 1 }
                    }
                },
                dropped_payload: false,
                size_bytes: 48
            });
        }

        if (Math.floor(t) % 3 === 0) {
            handleMessageEvent({
                topic: "/joint_commands",
                msg_type: "sensor_msgs/msg/JointState",
                timestamp: now,
                payload: null,
                dropped_payload: true, // test drop payload warning
                size_bytes: 2048
            });
        }
    }, 1000);
}

function stopLocalSimulation() {
    logger("Stopping local simulation sandbox.");
    if (localSimInterval) {
        clearInterval(localSimInterval);
        localSimInterval = null;
    }
    clearGraph();
    // Try reconnecting to backend
    initWebSocket();
}
