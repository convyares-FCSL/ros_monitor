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

// Colors matching style.css (vibrant HSL palettes)
const COLORS = {
    [NODE_TYPES.NODE]: 0x06b6d4,      // Cyan
    [NODE_TYPES.TOPIC]: 0xf97316,     // Orange
    [NODE_TYPES.SERVICE]: 0x10b981,   // Green
    [NODE_TYPES.ACTION]: 0xa855f7,    // Purple
    BG_DARK: 0x030712
};

// Raycasting (for mouse selection of particles)
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// --- Init Application ---
window.addEventListener('load', () => {
    initThree();
    initWebSocket();
    setupUIEventListeners();
    animate();
    
    // Refresh Lucide Icons
    lucide.createIcons();
});

// --- Initialize Three.js Scene ---
function initThree() {
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
                handleMessageEvent(msg.data);
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
        } else {
            // Keep reference to existing
            vertices[id].type = type; // safety
        }
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

    // 8. Update HUD Counter Lists
    updateHUDStats(data);
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
            if (actionVertex) {
                // Animate to/from Action Node!
                spawnActionParticle(actionVertex, topicName, data);
            }
        }
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

    // 4. Render Updates
    controls.update();
    renderer.render(scene, camera);
}

// --- Click Interaction & Raycasting ---
function onSceneClick(event) {
    // Only raycast if the click occurred on the 3D canvas (not on HUD overlay panels)
    if (event.target !== renderer.domElement) return;

    // Calculate mouse position in normalized device coordinates
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    // Filter mesh targets from our active particles list
    const targets = activeParticles.map(p => p.mesh);
    const intersects = raycaster.intersectObjects(targets);

    if (intersects.length > 0) {
        // Find matching particle
        const hitMesh = intersects[0].object;
        const clickedParticle = activeParticles.find(p => p.mesh === hitMesh);
        
        if (clickedParticle) {
            inspectParticle(clickedParticle);
        }
    }
}

// Inspect and Pause message particle
function inspectParticle(particle) {
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
    
    // Open panel drawer
    document.getElementById('inspector-panel').classList.remove('collapsed');
    
    lucide.createIcons();
}

// Resume paused particle and close drawer
function resumeTelemetry() {
    if (pausedParticle) {
        pausedParticle.paused = false;
        pausedParticle.mesh.scale.set(1.0, 1.0, 1.0);
        pausedParticle.mesh.material.wireframe = false;
        pausedParticle = null;
    }
    
    document.getElementById('inspector-panel').classList.add('collapsed');
}

// --- UI Updates & Subscriptions ---
function updateHUDStats(data) {
    document.getElementById('stat-node-count').innerText = data.nodes.length;
    document.getElementById('stat-topic-count').innerText = data.topics.length;
    document.getElementById('stat-action-count').innerText = data.actions.length;
    
    document.getElementById('count-nodes').innerText = data.nodes.length;
    document.getElementById('count-topics').innerText = data.topics.length;
    document.getElementById('count-actions').innerText = data.actions.length;
    document.getElementById('count-services').innerText = data.services.length;

    // Populate Sidebar Lists
    populateList('node-list', data.nodes, 'node', 'text-cyan');
    populateList('topic-list', data.topics, 'git-commit', 'text-orange');
    populateList('action-list', data.actions, 'layers', 'text-purple');
    populateList('service-list', data.services, 'arrow-right-left', 'text-green');
}

function populateList(elementId, items, iconName, colorClass) {
    const list = document.getElementById(elementId);
    list.innerHTML = '';
    
    if (items.length === 0) {
        list.innerHTML = `<li class="empty-list">No active ${elementId.split('-')[0]}s</li>`;
        return;
    }
    
    items.forEach(item => {
        const li = document.createElement('li');
        const name = item.name;
        
        li.innerHTML = `
            <span class="li-name">${name}</span>
            <i data-lucide="${iconName}" class="section-icon ${colorClass}"></i>
        `;
        
        // Add click listener to center camera on vertex
        li.onclick = () => {
            const vertexId = `${elementId.split('-')[0]}:${name}`;
            const vertex = vertices[vertexId];
            if (vertex) {
                // Smooth camera transition using OrbitControls target
                gsapScrollTo(vertex.pos);
            }
        };
        
        list.appendChild(li);
    });
    
    lucide.createIcons();
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
        lucide.createIcons();
    });

    // 2. Recenter Camera
    document.getElementById('btn-recenter').addEventListener('click', () => {
        gsapScrollTo(new THREE.Vector3(0, 0, 0));
        // Reset zoom
        camera.position.set(0, 15, 25);
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
        lucide.createIcons();
    });

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
