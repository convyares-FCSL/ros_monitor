// --- Graph Topology Sync, Force-Directed Layout & Particle Animation ---

import {
    state,
    NODE_TYPES,
    COLORS,
    HZ_HEALTH,
    HZ_HEALTH_COLORS,
    K_REPULSION,
    K_ATTRACTION,
    L_REST,
    K_GRAVITY,
    DAMPING,
    MAX_SPEED,
    formatBandwidth,
} from './state.js';
import {
    createMeshForType,
    createLabelSprite,
    createHzSprite,
    updateHzSprite,
    updateNodeLifecycleColor,
} from './scene.js';
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

    function syncVertex(id, name, type) {
        activeIds.add(id);
        if (!vertices[id]) {
            const pos = new THREE.Vector3(
                (Math.random() - 0.5) * 5,
                (Math.random() - 0.5) * 5,
                (Math.random() - 0.5) * 5
            );

            const mesh = createMeshForType(type);
            mesh.position.copy(pos);
            state.scene.add(mesh);

            const labelSprite = createLabelSprite(name, COLORS[type]);
            labelSprite.position.copy(pos);
            labelSprite.position.y += (type === NODE_TYPES.NODE ? 1.5 : 1.0);
            state.scene.add(labelSprite);

            const entry = {
                id,
                name,
                type,
                mesh,
                sprite: labelSprite,
                hzSprite: null,
                pos,
                velocity: new THREE.Vector3(0, 0, 0),
                connections: new Set()
            };

            // Hz indicator sprite for topic vertices only
            if (type === NODE_TYPES.TOPIC) {
                const hzSprite = createHzSprite();
                hzSprite.position.copy(pos);
                hzSprite.position.y -= 0.9;
                state.scene.add(hzSprite);
                entry.hzSprite = hzSprite;

                // If we already have Hz data for this topic (reconnect scenario), apply it
                const existing = state.topicHz[name];
                if (existing) {
                    updateHzSprite(entry, existing.hz, existing.health);
                }
            }

            vertices[id] = entry;
            mesh.userData.vertexId = id;

            // Apply current lifecycle color if we already know the state
            if (type === NODE_TYPES.NODE) {
                const lcState = state.nodeLifecycleState[name];
                if (lcState) updateNodeLifecycleColor(entry, lcState);
            }
        } else {
            vertices[id].type = type;
        }

        applyVertexVisibility(vertices[id]);
    }

    // 1. Process Nodes
    data.nodes.forEach(n => syncVertex(`node:${n.name}`, n.name, NODE_TYPES.NODE));

    // 2. Process Topics
    data.topics.forEach(t => syncVertex(`topic:${t.name}`, t.name, NODE_TYPES.TOPIC));

    // 3. Process Services
    data.services.forEach(s => syncVertex(`service:${s.name}`, s.name, NODE_TYPES.SERVICE));

    // 4. Process Actions
    data.actions.forEach(a => syncVertex(`action:${a.name}`, a.name, NODE_TYPES.ACTION));

    // 5. Clean up old vertices
    Object.keys(vertices).forEach(id => {
        if (!activeIds.has(id)) {
            const v = vertices[id];
            state.scene.remove(v.mesh);
            v.mesh.geometry.dispose();
            if (Array.isArray(v.mesh.material)) {
                v.mesh.material.forEach(m => m.dispose());
            } else {
                v.mesh.material.dispose();
            }

            state.scene.remove(v.sprite);
            v.sprite.material.dispose();

            if (v.hzSprite) {
                state.scene.remove(v.hzSprite);
                if (v.hzSprite.material.map) v.hzSprite.material.map.dispose();
                v.hzSprite.material.dispose();
            }

            delete vertices[id];
        }
    });

    // 6. Reset connections and rebuild link geometry
    Object.values(vertices).forEach(v => v.connections.clear());

    links.forEach(l => {
        state.scene.remove(l.lineMesh);
        l.lineMesh.geometry.dispose();
        l.lineMesh.material.dispose();
    });
    links.length = 0;

    function addLink(sourceId, targetId, colorHex = 0x475569, topicId = null) {
        if (vertices[sourceId] && vertices[targetId]) {
            vertices[sourceId].connections.add(targetId);
            vertices[targetId].connections.add(sourceId);

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

            links.push({ sourceId, targetId, lineMesh: line, topicId });
        }
    }

    // 7. Rebuild links
    data.topics.forEach(t => {
        const topicId = `topic:${t.name}`;
        // Hz-driven color: use existing health if known
        const hzInfo = state.topicHz[t.name];
        const linkColor = hzInfo ? HZ_HEALTH_COLORS[hzInfo.health] : COLORS[NODE_TYPES.TOPIC];
        t.publishers.forEach(pub => addLink(`node:${pub}`, topicId, linkColor, topicId));
        t.subscribers.forEach(sub => addLink(topicId, `node:${sub}`, linkColor, topicId));
    });

    data.services.forEach(s => {
        const srvId = `service:${s.name}`;
        s.servers.forEach(srv => addLink(`node:${srv}`, srvId, COLORS[NODE_TYPES.SERVICE]));
        (s.clients || []).forEach(cli => addLink(`node:${cli}`, srvId, COLORS[NODE_TYPES.SERVICE]));
    });

    data.actions.forEach(a => {
        const actId = `action:${a.name}`;
        a.servers.forEach(srv => addLink(actId, `node:${srv}`, COLORS[NODE_TYPES.ACTION]));
        a.clients.forEach(cli => addLink(`node:${cli}`, actId, COLORS[NODE_TYPES.ACTION]));
    });

    if (state.isolatedRootId) {
        state.isolatedVertexIds = buildIsolationSet(state.isolatedRootId);
    }
    refreshLinkVisibility();
    refreshParticleVisibility();

    // 8. Update HUD
    updateHUDStats(data);

    if (state.selectedEntityId && vertices[state.selectedEntityId]) {
        inspectEntity(vertices[state.selectedEntityId]);
    }
}

// --- Lifecycle event: morph node emissive color ---
export function handleLifecycleEvent(data) {
    const nodeName = data.node_name;
    state.nodeLifecycleState[nodeName] = data.goal_state;

    const vertex = state.vertices[`node:${nodeName}`];
    if (vertex) {
        updateNodeLifecycleColor(vertex, data.goal_state);
    }

    // Refresh inspector if this node is currently selected
    const nodeId = `node:${nodeName}`;
    if (state.selectedEntityId === nodeId && state.vertices[nodeId]) {
        inspectEntity(state.vertices[nodeId]);
    }
}

// --- Frequency update: update Hz sprites and link colors ---
export function handleFrequencyUpdate(data) {
    const now = Date.now();
    const HZ_JITTER_THRESHOLD = 0.3;

    Object.entries(data.updates).forEach(([topicName, hz]) => {
        const prev = state.topicHz[topicName];

        let health = HZ_HEALTH.STABLE;
        if (prev && prev.hz > 0) {
            const drift = Math.abs(hz - prev.hz) / prev.hz;
            if (drift > HZ_JITTER_THRESHOLD) health = HZ_HEALTH.JITTER;
        }

        state.topicHz[topicName] = { hz, health, lastUpdate: now };

        // Append to 30s Hz history
        if (!state.topicHzHistory[topicName]) state.topicHzHistory[topicName] = [];
        state.topicHzHistory[topicName].push({ ts: now, hz });
        // Prune to last 30 seconds
        const cutoff = now - 30000;
        const hist = state.topicHzHistory[topicName];
        while (hist.length > 0 && hist[0].ts < cutoff) hist.shift();

        // Visual updates
        const topicVertex = state.vertices[`topic:${topicName}`];
        if (topicVertex) {
            updateHzSprite(topicVertex, hz, health);
        }
        _updateTopicLinkColors(topicName, health);
    });
}

// --- Node params event: store params and refresh inspector if needed ---
export function handleNodeParams(data) {
    state.nodeParams[data.node_name] = data.params;

    const nodeId = `node:${data.node_name}`;
    if (state.selectedEntityId === nodeId && state.vertices[nodeId]) {
        inspectEntity(state.vertices[nodeId]);
    }
}

// --- Message Events (Particle Animations along Directed Edges) ---
export function handleMessageEvent(data) {
    recordMessageHistory(data);

    if (state.isScenePaused) return;

    document.getElementById('stat-bandwidth').innerText = formatBandwidth(state.currentBandwidth);

    const topicName = data.topic;
    const topicId = `topic:${topicName}`;
    const topicVertex = state.vertices[topicId];
    if (!topicVertex) {
        if (topicName.includes('/_action/')) {
            const baseAction = topicName.split('/_action/')[0];
            const actionVertex = state.vertices[`action:${baseAction}`];
            if (actionVertex && isVertexVisible(actionVertex.id)) {
                spawnActionParticle(actionVertex, topicName, data);
            }
        }
        return;
    }

    if (!isVertexVisible(topicId)) return;

    const topicLinks = state.links.filter(l => l.sourceId === topicId || l.targetId === topicId);
    const publishers = topicLinks.filter(l => l.targetId === topicId).map(l => l.sourceId);
    const subscribers = topicLinks.filter(l => l.sourceId === topicId).map(l => l.targetId);

    if (publishers.length === 0) return;

    publishers.forEach(pubId => {
        const pubVertex = state.vertices[pubId];
        if (!pubVertex) return;

        if (subscribers.length > 0) {
            subscribers.forEach(subId => {
                const subVertex = state.vertices[subId];
                if (!subVertex) return;
                createParticle(pubVertex, topicVertex, subVertex, data);
            });
        } else {
            createParticle(pubVertex, topicVertex, null, data);
        }
    });
}

function spawnActionParticle(actionVertex, topicName, data) {
    const actionLinks = state.links.filter(l => l.sourceId === actionVertex.id || l.targetId === actionVertex.id);
    if (actionLinks.length === 0) return;

    const pubId = actionLinks[0].sourceId === actionVertex.id ? actionLinks[0].targetId : actionLinks[0].sourceId;
    const pubVertex = state.vertices[pubId];
    if (pubVertex) createParticle(pubVertex, actionVertex, null, data);
}

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

    let color = COLORS[NODE_TYPES.TOPIC];
    if (eventData.topic.includes('/_action/')) color = COLORS[NODE_TYPES.ACTION];
    else if (eventData.topic.includes('/_service/')) color = COLORS[NODE_TYPES.SERVICE];

    let geom;
    if (eventData.topic.includes('/_action/')) {
        geom = new THREE.OctahedronGeometry(0.25);
    } else {
        geom = new THREE.SphereGeometry(0.18, 8, 8);
    }

    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(startNode.pos);
    mesh.visible = true;
    state.scene.add(mesh);

    state.activeParticles.push({
        mesh,
        startNode,
        midNode,
        endNode,
        progress: 0.0,
        leg: 1,
        speed: 0.015,
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

    for (let i = 0; i < count; i++) {
        const u = vertices[keys[i]];
        for (let j = i + 1; j < count; j++) {
            const v = vertices[keys[j]];
            const dir = new THREE.Vector3().subVectors(u.pos, v.pos);
            let dist = dir.length();
            if (dist < 0.2) dist = 0.2;
            const forceMag = K_REPULSION / (dist * dist);
            dir.normalize().multiplyScalar(forceMag);
            u.velocity.add(dir);
            v.velocity.sub(dir);
        }
    }

    links.forEach(link => {
        const u = vertices[link.sourceId];
        const v = vertices[link.targetId];
        if (!u || !v) return;
        const dir = new THREE.Vector3().subVectors(v.pos, u.pos);
        const dist = dir.length();
        if (dist === 0) return;
        const forceMag = K_ATTRACTION * (dist - L_REST);
        dir.normalize().multiplyScalar(forceMag);
        u.velocity.add(dir);
        v.velocity.sub(dir);
    });

    keys.forEach(id => {
        const v = vertices[id];
        const gravity = v.pos.clone().multiplyScalar(-K_GRAVITY);
        v.velocity.add(gravity);
        v.velocity.multiplyScalar(DAMPING);
        if (v.velocity.length() > MAX_SPEED) v.velocity.setLength(MAX_SPEED);
        v.pos.add(v.velocity);

        v.mesh.position.copy(v.pos);
        v.sprite.position.copy(v.pos);
        v.sprite.position.y += (v.type === NODE_TYPES.NODE ? 1.5 : 1.0);

        if (v.hzSprite) {
            v.hzSprite.position.copy(v.pos);
            v.hzSprite.position.y -= 0.9;
        }
    });

    links.forEach(link => {
        const u = vertices[link.sourceId];
        const v = vertices[link.targetId];
        if (!u || !v) return;
        const positions = link.lineMesh.geometry.attributes.position.array;
        positions[0] = u.pos.x; positions[1] = u.pos.y; positions[2] = u.pos.z;
        positions[3] = v.pos.x; positions[4] = v.pos.y; positions[5] = v.pos.z;
        link.lineMesh.geometry.attributes.position.needsUpdate = true;
    });
}

// Mark stale topics whose frequency_update hasn't arrived in >2s
let _staleCheckFrame = 0;
function checkTopicStaleness() {
    const now = Date.now();
    Object.entries(state.topicHz).forEach(([topicName, info]) => {
        if (info.health !== HZ_HEALTH.STALE && now - info.lastUpdate > 2000) {
            state.topicHz[topicName].health = HZ_HEALTH.STALE;
            const v = state.vertices[`topic:${topicName}`];
            if (v) updateHzSprite(v, info.hz, HZ_HEALTH.STALE);
            _updateTopicLinkColors(topicName, HZ_HEALTH.STALE);
        }
    });
}

function _updateTopicLinkColors(topicName, health) {
    const topicId = `topic:${topicName}`;
    const color = HZ_HEALTH_COLORS[health] ?? HZ_HEALTH_COLORS.unknown;
    state.links.forEach(link => {
        if (link.topicId === topicId) {
            link.lineMesh.material.color.setHex(color);
        }
    });
}

// --- Animation Frame Loop ---
export function animate() {
    requestAnimationFrame(animate);

    if (!state.isScenePaused) {
        updateGraphLayout();

        const activeParticles = state.activeParticles;
        for (let i = activeParticles.length - 1; i >= 0; i--) {
            const p = activeParticles[i];
            if (p.paused) continue;

            if (p.leg === 1) {
                p.progress += p.speed;
                if (p.progress >= 1.0) {
                    if (p.endNode) {
                        p.leg = 2;
                        p.progress = 0.0;
                    } else {
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
                p.progress += p.speed;
                if (p.progress >= 1.0) {
                    state.scene.remove(p.mesh);
                    p.mesh.geometry.dispose();
                    p.mesh.material.dispose();
                    activeParticles.splice(i, 1);
                } else {
                    p.mesh.position.lerpVectors(p.midNode.pos, p.endNode.pos, p.progress);
                }
            }
        }

        Object.values(state.vertices).forEach(v => {
            if (v.type === NODE_TYPES.NODE) {
                v.mesh.rotation.y += 0.01;
            } else if (v.type === NODE_TYPES.SERVICE || v.type === NODE_TYPES.ACTION) {
                v.mesh.rotation.x += 0.01;
                v.mesh.rotation.y += 0.01;
            }
        });
    }

    // Staleness check every ~60 frames (~1s at 60fps)
    _staleCheckFrame++;
    if (_staleCheckFrame >= 60) {
        _staleCheckFrame = 0;
        checkTopicStaleness();
    }

    state.controls.update();
    state.renderer.render(state.scene, state.camera);
}

// --- Scene Teardown ---
export function clearGraph() {
    if (!state.scene) return;

    Object.keys(state.vertices).forEach(id => {
        const v = state.vertices[id];
        state.scene.remove(v.mesh);
        state.scene.remove(v.sprite);
        if (v.hzSprite) {
            state.scene.remove(v.hzSprite);
            if (v.hzSprite.material.map) v.hzSprite.material.map.dispose();
            v.hzSprite.material.dispose();
        }
        delete state.vertices[id];
    });

    state.links.forEach(l => state.scene.remove(l.lineMesh));
    state.links.length = 0;

    state.activeParticles.forEach(p => state.scene.remove(p.mesh));
    state.activeParticles.length = 0;
    state.selectedEntityId = null;
    hideContextMenu();
    document.getElementById('inspector-panel').classList.add('collapsed');
}
