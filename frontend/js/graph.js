// --- Graph Topology Sync, Force-Directed Layout & Particle Animation ---

import {
    state,
    NODE_TYPES,
    COLORS,
    K_REPULSION,
    K_ATTRACTION,
    L_REST,
    K_GRAVITY,
    DAMPING,
    MAX_SPEED,
    formatBandwidth,
} from './state.js';
import { createMeshForType, createLabelSprite } from './scene.js';
import {
    applyVertexVisibility,
    refreshLinkVisibility,
    refreshParticleVisibility,
    buildIsolationSet,
    isVertexVisible,
} from './visibility.js';
import { hideContextMenu } from './visibility.js';
import { inspectEntity, recordMessageHistory } from './inspector.js';
import { updateHUDStats } from './sidebar.js';

// --- Handle Graph Updates (Topological Sync) ---
export function handleGraphUpdate(data) {
    if (state.isScenePaused) {
        state.pendingGraphData = data;
        return;
    }

    state.latestGraphData = data;
    const vertices = state.vertices;
    const links = state.links;
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
            state.scene.add(mesh);

            // Create text sprite label
            const labelSprite = createLabelSprite(name, COLORS[type]);
            labelSprite.position.copy(pos).y += (type === NODE_TYPES.NODE ? 1.5 : 1.0);
            state.scene.add(labelSprite);

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
            state.scene.remove(vertices[id].mesh);
            vertices[id].mesh.geometry.dispose();
            if (Array.isArray(vertices[id].mesh.material)) {
                vertices[id].mesh.material.forEach(m => m.dispose());
            } else {
                vertices[id].mesh.material.dispose();
            }

            state.scene.remove(vertices[id].sprite);
            vertices[id].sprite.material.dispose();

            delete vertices[id];
        }
    });

    // 6. Reset connections on vertices to rebuild links map
    Object.values(vertices).forEach(v => v.connections.clear());

    // Clear old lines
    links.forEach(l => {
        state.scene.remove(l.lineMesh);
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
            state.scene.add(line);

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

    // Service: Server Node -> Service Node <- Client Node
    data.services.forEach(s => {
        const srvId = `service:${s.name}`;
        s.servers.forEach(srv => {
            addLink(`node:${srv}`, srvId, COLORS[NODE_TYPES.SERVICE]);
        });
        (s.clients || []).forEach(cli => {
            addLink(`node:${cli}`, srvId, COLORS[NODE_TYPES.SERVICE]);
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

    if (state.isolatedRootId) {
        state.isolatedVertexIds = buildIsolationSet(state.isolatedRootId);
    }
    refreshLinkVisibility();
    refreshParticleVisibility();

    // 8. Update HUD Counter Lists
    updateHUDStats(data);

    if (state.selectedEntityId && vertices[state.selectedEntityId]) {
        inspectEntity(vertices[state.selectedEntityId]);
    }
}

// --- Message Events (Particle Animations along Directed Edges) ---
export function handleMessageEvent(data) {
    recordMessageHistory(data);

    if (state.isScenePaused) {
        return;
    }

    document.getElementById('stat-bandwidth').innerText = formatBandwidth(state.currentBandwidth);

    const topicName = data.topic;

    // Find the visual topic representation
    const topicId = `topic:${topicName}`;
    const topicVertex = state.vertices[topicId];
    if (!topicVertex) {
        // It might be an Action topic inside an action cluster
        if (topicName.includes('/_action/')) {
            const baseAction = topicName.split('/_action/')[0];
            const actionVertex = state.vertices[`action:${baseAction}`];
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
    const topicLinks = state.links.filter(l => l.sourceId === topicId || l.targetId === topicId);
    const publishers = topicLinks.filter(l => l.targetId === topicId).map(l => l.sourceId);
    const subscribers = topicLinks.filter(l => l.sourceId === topicId).map(l => l.targetId);

    // If there's no publisher mesh, we start from a random point or skip
    if (publishers.length === 0) return;

    // We animate a particle: Publisher -> Topic -> Subscriber
    publishers.forEach(pubId => {
        const pubVertex = state.vertices[pubId];
        if (!pubVertex) return;

        // If there are subscribers, we split the paths.
        if (subscribers.length > 0) {
            subscribers.forEach(subId => {
                const subVertex = state.vertices[subId];
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
    // Determine path based on action subtopic:
    // feedback/status flows Action Server -> Client, goal/cancel flows Client -> Server.
    // Just animate a path connected to this action node to keep it simple and visual.
    const actionLinks = state.links.filter(l => l.sourceId === actionVertex.id || l.targetId === actionVertex.id);
    if (actionLinks.length === 0) return;

    const pubId = actionLinks[0].sourceId === actionVertex.id ? actionLinks[0].targetId : actionLinks[0].sourceId;
    const pubVertex = state.vertices[pubId];
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
    state.scene.add(mesh);

    // Particle travels along paths. Speed is proportional to data rate (frequency)
    // Standard range 0.005 to 0.03
    const speed = 0.015;

    state.activeParticles.push({
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
    const vertices = state.vertices;
    const links = state.links;
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
export function animate() {
    requestAnimationFrame(animate);

    if (!state.isScenePaused) {
        // 1. Physics update for layout
        updateGraphLayout();

        // 2. Telemetry Particle updates
        const activeParticles = state.activeParticles;
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
                        state.scene.remove(p.mesh);
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
                    state.scene.remove(p.mesh);
                    p.mesh.geometry.dispose();
                    p.mesh.material.dispose();
                    activeParticles.splice(i, 1);
                } else {
                    p.mesh.position.lerpVectors(p.midNode.pos, p.endNode.pos, p.progress);
                }
            }
        }

        // 3. Spin individual node cylinders/boxes slightly for dynamic feel
        Object.values(state.vertices).forEach(v => {
            if (v.type === NODE_TYPES.NODE) {
                v.mesh.rotation.y += 0.01;
            } else if (v.type === NODE_TYPES.SERVICE || v.type === NODE_TYPES.ACTION) {
                v.mesh.rotation.x += 0.01;
                v.mesh.rotation.y += 0.01;
            }
        });
    }

    // 4. Render Updates
    state.controls.update();
    state.renderer.render(state.scene, state.camera);
}

// --- Scene Teardown (on disconnect / sim toggle) ---
export function clearGraph() {
    if (!state.scene) {
        return;
    }

    // Clean up Three.js objects
    Object.keys(state.vertices).forEach(id => {
        state.scene.remove(state.vertices[id].mesh);
        state.scene.remove(state.vertices[id].sprite);
        delete state.vertices[id];
    });

    state.links.forEach(l => {
        state.scene.remove(l.lineMesh);
    });
    state.links.length = 0;

    state.activeParticles.forEach(p => {
        state.scene.remove(p.mesh);
    });
    state.activeParticles.length = 0;
    state.selectedEntityId = null;
    hideContextMenu();
    document.getElementById('inspector-panel').classList.add('collapsed');
}
