// --- Graph Topology Sync, Force-Directed Layout & Animation ---

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
    createActionOrbital,
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

// Module-level timing state for the animate loop
let _lastFrameMs = performance.now();

// Throttle map: topic name → last particle spawn time (ms)
const _particleThrottle = {};

// ---------------------------------------------------------------------------
// Graph topology sync
// ---------------------------------------------------------------------------

export function handleGraphUpdate(data) {
    if (state.isScenePaused) {
        state.pendingGraphData = data;
        return;
    }

    state.latestGraphData = data;
    const vertices = state.vertices;
    const links = state.links;
    const activeIds = new Set();

    // Preserve artery flow offsets across topology rebuilds so animation is seamless
    const savedFlowOffsets = {};
    links.forEach(link => {
        if (link.isArtery) {
            savedFlowOffsets[`${link.sourceId}|${link.targetId}`] = link.flowOffset ?? 0;
        }
    });

    function syncVertex(id, name, type) {
        activeIds.add(id);
        if (vertices[id]) {
            vertices[id].type = type;
            applyVertexVisibility(vertices[id]);
            return;
        }

        const pos = new THREE.Vector3(
            (Math.random() - 0.5) * 5,
            (Math.random() - 0.5) * 5,
            (Math.random() - 0.5) * 5
        );

        const entry = {
            id, name, type,
            mesh: null,
            ringMesh: null,   // action orbital only
            hzSprite: null,   // topic only
            sprite: null,
            pos,
            velocity: new THREE.Vector3(0, 0, 0),
            connections: new Set(),
            // Per-vertex animation scratch
            flashStart: null,     // service flash
            actionProgress: 0,    // action orbital progress (0–1)
        };

        if (type === NODE_TYPES.ACTION) {
            const { coreMesh, ringMesh } = createActionOrbital();
            coreMesh.position.copy(pos);
            ringMesh.position.copy(pos);
            state.scene.add(coreMesh);
            state.scene.add(ringMesh);
            coreMesh.userData.vertexId = id;
            entry.mesh    = coreMesh;
            entry.ringMesh = ringMesh;
        } else {
            const mesh = createMeshForType(type);
            mesh.position.copy(pos);
            state.scene.add(mesh);
            mesh.userData.vertexId = id;
            entry.mesh = mesh;

            // Hz sprite underneath topic junction sphere
            if (type === NODE_TYPES.TOPIC) {
                const hzSprite = createHzSprite();
                hzSprite.position.copy(pos);
                hzSprite.position.y -= 0.9;
                state.scene.add(hzSprite);
                entry.hzSprite = hzSprite;

                const existing = state.topicHz[name];
                if (existing) updateHzSprite(entry, existing.hz, existing.health);
            }
        }

        const labelSprite = createLabelSprite(name, COLORS[type]);
        labelSprite.position.copy(pos);
        labelSprite.position.y += (type === NODE_TYPES.NODE ? 1.5 : 1.0);
        state.scene.add(labelSprite);
        entry.sprite = labelSprite;

        vertices[id] = entry;

        // Apply any lifecycle colour that was received before this vertex existed
        if (type === NODE_TYPES.NODE) {
            const lcState = state.nodeLifecycleState[name];
            if (lcState) updateNodeLifecycleColor(entry, lcState);
        }

        applyVertexVisibility(entry);
    }

    data.nodes.forEach(n => {
        syncVertex(`node:${n.name}`, n.name, NODE_TYPES.NODE);
        // pid: number = confirmed alive, null = scan ran but not found (phantom candidate)
        // undefined = no scan data (simulation mode) — don't overwrite with undefined
        if ('pid' in n) state.nodePids[n.name] = n.pid;
    });
    data.topics.forEach(t  => syncVertex(`topic:${t.name}`,   t.name,  NODE_TYPES.TOPIC));
    data.services.forEach(s => syncVertex(`service:${s.name}`, s.name, NODE_TYPES.SERVICE));
    data.actions.forEach(a  => syncVertex(`action:${a.name}`,  a.name,  NODE_TYPES.ACTION));

    // Remove vertices no longer in the topology
    Object.keys(vertices).forEach(id => {
        if (activeIds.has(id)) return;
        _disposeVertex(vertices[id]);
        delete vertices[id];
    });

    // Rebuild connections and link geometry
    Object.values(vertices).forEach(v => v.connections.clear());
    links.forEach(l => {
        state.scene.remove(l.lineMesh);
        l.lineMesh.geometry.dispose();
        l.lineMesh.material.dispose();
    });
    links.length = 0;

    function addLink(sourceId, targetId, topicId = null) {
        if (!vertices[sourceId] || !vertices[targetId]) return;

        vertices[sourceId].connections.add(targetId);
        vertices[targetId].connections.add(sourceId);

        const isArtery = topicId !== null;

        let lineMesh;
        if (isArtery) {
            // Flowing data artery — Line2 (thick screen-space lines) with animated dashOffset
            const hzInfo    = state.topicHz[topicId.replace('topic:', '')];
            const health    = hzInfo?.health ?? HZ_HEALTH.UNKNOWN;
            const lineColor = _arteryColor(health);
            const opacity   = _hzToOpacity(hzInfo?.hz ?? 0);

            const mat = new THREE.LineMaterial({
                color: lineColor,
                linewidth: 3.5,
                dashed: true,
                dashSize: 0.45,
                gapSize: 0.18,
                transparent: true,
                opacity,
                resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
            });
            const geom = new THREE.LineGeometry();
            geom.setPositions([
                vertices[sourceId].pos.x, vertices[sourceId].pos.y, vertices[sourceId].pos.z,
                vertices[targetId].pos.x, vertices[targetId].pos.y, vertices[targetId].pos.z,
            ]);
            lineMesh = new THREE.Line2(geom, mat);
            lineMesh.computeLineDistances();

            const key = `${sourceId}|${targetId}`;
            const flowOffset = savedFlowOffsets[key] ?? 0;
            const flowSpeed  = _hzToFlowSpeed(hzInfo?.hz ?? 0);

            state.scene.add(lineMesh);
            links.push({ sourceId, targetId, lineMesh, topicId, isArtery: true, flowOffset, flowSpeed });
        } else {
            // Static structural connection (services, actions)
            const type   = sourceId.split(':')[0];
            const color  = type === 'service' ? COLORS[NODE_TYPES.SERVICE]
                         : type === 'action'  ? COLORS[NODE_TYPES.ACTION]
                         : 0x475569;
            const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35 });
            const geom = new THREE.BufferGeometry().setFromPoints([
                vertices[sourceId].pos,
                vertices[targetId].pos,
            ]);
            lineMesh = new THREE.Line(geom, mat);
            state.scene.add(lineMesh);
            links.push({ sourceId, targetId, lineMesh, topicId: null, isArtery: false });
        }
    }

    data.topics.forEach(t => {
        const tid = `topic:${t.name}`;
        t.publishers.forEach(pub => addLink(`node:${pub}`, tid, tid));
        t.subscribers.forEach(sub => addLink(tid, `node:${sub}`, tid));
    });

    data.services.forEach(s => {
        const sid = `service:${s.name}`;
        s.servers.forEach(srv => addLink(`node:${srv}`, sid));
        (s.clients || []).forEach(cli => addLink(`node:${cli}`, sid));
    });

    data.actions.forEach(a => {
        const aid = `action:${a.name}`;
        a.servers.forEach(srv => addLink(aid, `node:${srv}`));
        a.clients.forEach(cli => addLink(`node:${cli}`, aid));
    });

    if (state.isolatedRootId) {
        state.isolatedVertexIds = buildIsolationSet(state.isolatedRootId);
    }
    refreshLinkVisibility();
    refreshParticleVisibility();
    updateHUDStats(data);

    if (state.selectedEntityId && vertices[state.selectedEntityId]) {
        inspectEntity(vertices[state.selectedEntityId]);
    }
}

// ---------------------------------------------------------------------------
// Lifecycle event → emissive colour morph
// ---------------------------------------------------------------------------

export function handleLifecycleEvent(data) {
    const nodeName = data.node_name;
    state.nodeLifecycleState[nodeName] = data.goal_state;

    const vertex = state.vertices[`node:${nodeName}`];
    if (vertex) updateNodeLifecycleColor(vertex, data.goal_state);

    const nodeId = `node:${nodeName}`;
    if (state.selectedEntityId === nodeId && state.vertices[nodeId]) {
        inspectEntity(state.vertices[nodeId]);
    }
}

// ---------------------------------------------------------------------------
// Frequency update → artery speed + Hz sprites + link colours
// ---------------------------------------------------------------------------

export function handleFrequencyUpdate(data) {
    const now = Date.now();

    Object.entries(data.updates).forEach(([topicName, hz]) => {
        const prev   = state.topicHz[topicName];
        let health   = HZ_HEALTH.STABLE;
        if (prev?.hz > 0 && Math.abs(hz - prev.hz) / prev.hz > 0.3) {
            health = HZ_HEALTH.JITTER;
        }

        state.topicHz[topicName] = { hz, health, lastUpdate: now };

        // 30-second rolling history
        if (!state.topicHzHistory[topicName]) state.topicHzHistory[topicName] = [];
        state.topicHzHistory[topicName].push({ ts: now, hz });
        const cutoff = now - 30000;
        const hist = state.topicHzHistory[topicName];
        while (hist.length > 0 && hist[0].ts < cutoff) hist.shift();

        // Update Hz sprite
        const topicVertex = state.vertices[`topic:${topicName}`];
        if (topicVertex) updateHzSprite(topicVertex, hz, health);

        // Update artery links for this topic
        _updateTopicArteryLinks(topicName, hz, health);
    });
}

// ---------------------------------------------------------------------------
// Node params → stored for inspector
// ---------------------------------------------------------------------------

export function handleNodeParams(data) {
    state.nodeParams[data.node_name] = data.params;

    const nodeId = `node:${data.node_name}`;
    if (state.selectedEntityId === nodeId && state.vertices[nodeId]) {
        inspectEntity(state.vertices[nodeId]);
    }
}

// ---------------------------------------------------------------------------
// Service invoked → brightness spike on the hex prism
// ---------------------------------------------------------------------------

export function handleServiceInvoked(data) {
    const serviceId = `service:${data.service_name}`;
    const vertex    = state.vertices[serviceId];
    if (vertex?.type === NODE_TYPES.SERVICE) {
        vertex.flashStart = performance.now();
    }
}

// ---------------------------------------------------------------------------
// Message events — history + action orbital progress + artery particles
// ---------------------------------------------------------------------------

export function handleMessageEvent(data) {
    recordMessageHistory(data);
    if (state.isScenePaused) return;

    document.getElementById('stat-bandwidth').innerText = formatBandwidth(state.currentBandwidth);

    // Throttled particle: at most one per topic every 300 ms, cap total at 40.
    const now      = performance.now();
    const topicId  = `topic:${data.topic}`;
    const topicV   = state.vertices[topicId];
    if (topicV && (now - (_particleThrottle[data.topic] ?? 0)) > 300
            && state.activeParticles.length < 40) {
        _particleThrottle[data.topic] = now;
        state.links.forEach(link => {
            if (link.topicId !== topicId || !link.isArtery) return;
            const src = state.vertices[link.sourceId];
            const tgt = state.vertices[link.targetId];
            // Publisher→topic direction only (avoids spawning on both legs)
            if (src?.type === NODE_TYPES.NODE) _spawnArteryParticle(src, topicV);
        });
    }

    if (data.topic.includes('/_action/feedback')) {
        const actionName   = data.topic.split('/_action/')[0];
        const actionVertex = state.vertices[`action:${actionName}`];
        if (actionVertex) {
            const seq = data.payload?.sequence;
            // Fibonacci demo: sequence length vs assumed order=8
            actionVertex.actionProgress = Array.isArray(seq)
                ? Math.min(seq.length / 8.0, 1.0)
                : 0;
        }
    } else if (data.topic.includes('/_action/result')) {
        const actionName   = data.topic.split('/_action/')[0];
        const actionVertex = state.vertices[`action:${actionName}`];
        if (actionVertex) actionVertex.actionProgress = 0;
    }
}

// ---------------------------------------------------------------------------
// Force-directed layout physics
// ---------------------------------------------------------------------------

function updateGraphLayout() {
    const vertices = state.vertices;
    const links    = state.links;
    const keys     = Object.keys(vertices);
    const count    = keys.length;
    if (count === 0) return;

    for (let i = 0; i < count; i++) {
        const u = vertices[keys[i]];
        for (let j = i + 1; j < count; j++) {
            const v   = vertices[keys[j]];
            const dir = new THREE.Vector3().subVectors(u.pos, v.pos);
            let dist  = dir.length();
            if (dist < 0.2) dist = 0.2;
            const f = K_REPULSION / (dist * dist);
            dir.normalize().multiplyScalar(f);
            u.velocity.add(dir);
            v.velocity.sub(dir);
        }
    }

    links.forEach(link => {
        const u = vertices[link.sourceId];
        const v = vertices[link.targetId];
        if (!u || !v) return;
        const dir  = new THREE.Vector3().subVectors(v.pos, u.pos);
        const dist = dir.length();
        if (dist === 0) return;
        const f = K_ATTRACTION * (dist - L_REST);
        dir.normalize().multiplyScalar(f);
        u.velocity.add(dir);
        v.velocity.sub(dir);
    });

    keys.forEach(id => {
        const v = vertices[id];
        v.velocity.add(v.pos.clone().multiplyScalar(-K_GRAVITY));
        v.velocity.multiplyScalar(DAMPING);
        if (v.velocity.length() > MAX_SPEED) v.velocity.setLength(MAX_SPEED);
        v.pos.add(v.velocity);

        v.mesh.position.copy(v.pos);

        if (v.ringMesh) v.ringMesh.position.copy(v.pos);

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
        if (link.isArtery) {
            // Line2 geometry uses setPositions() rather than direct attribute mutation
            link.lineMesh.geometry.setPositions([
                u.pos.x, u.pos.y, u.pos.z,
                v.pos.x, v.pos.y, v.pos.z,
            ]);
            link.lineMesh.computeLineDistances();
        } else {
            const pos = link.lineMesh.geometry.attributes.position.array;
            pos[0] = u.pos.x; pos[1] = u.pos.y; pos[2] = u.pos.z;
            pos[3] = v.pos.x; pos[4] = v.pos.y; pos[5] = v.pos.z;
            link.lineMesh.geometry.attributes.position.needsUpdate = true;
        }
    });
}

// ---------------------------------------------------------------------------
// Staleness check — run at ~1 Hz in the render loop
// ---------------------------------------------------------------------------

let _staleCheckFrame = 0;

function checkTopicStaleness() {
    const now = Date.now();
    Object.entries(state.topicHz).forEach(([topicName, info]) => {
        if (info.health !== HZ_HEALTH.STALE && now - info.lastUpdate > 2000) {
            state.topicHz[topicName].health = HZ_HEALTH.STALE;
            const v = state.vertices[`topic:${topicName}`];
            if (v) updateHzSprite(v, info.hz, HZ_HEALTH.STALE);
            _updateTopicArteryLinks(topicName, info.hz, HZ_HEALTH.STALE);
        }
    });
}

// ---------------------------------------------------------------------------
// Main render loop
// ---------------------------------------------------------------------------

export function animate() {
    requestAnimationFrame(animate);

    const nowMs = performance.now();
    const delta = Math.min((nowMs - _lastFrameMs) / 1000, 0.1); // cap at 100 ms
    _lastFrameMs = nowMs;
    const t = nowMs / 1000;

    if (!state.isScenePaused) {
        updateGraphLayout();

        Object.values(state.vertices).forEach(v => {

            // ── NODE: breathing scale + lifecycle emissive modulation ──────────────
            if (v.type === NODE_TYPES.NODE) {
                // Subtle uniform "heartbeat" proving the node is alive
                v.mesh.scale.setScalar(1.0 + 0.03 * Math.sin(t * 1.5));
                v.mesh.rotation.y += 0.008;

                const lcState = state.nodeLifecycleState[v.name] ?? 'unconfigured';
                const mat     = v.mesh.material;

                switch (lcState) {
                    case 'inactive':
                        // Primed and waiting — pulsing amber/gold glow
                        mat.emissiveIntensity = 0.18 + 0.28 * (0.5 + 0.5 * Math.sin(t * 3.0));
                        break;
                    case 'active':
                        // Vibrant, steady cyan — fully operational
                        mat.emissiveIntensity = 0.55;
                        break;
                    case 'shuttingdown':
                    case 'shutting_down':
                        // Aggressive rapid strobe — ~10 Hz toggle signalling imminent exit
                        mat.emissiveIntensity = (Math.sin(t * 62.8) > 0) ? 0.95 : 0.02;
                        break;
                    case 'error_processing':
                    case 'error':
                        // Solid bright red alarm — holds until cleared
                        mat.emissiveIntensity = 0.85;
                        break;
                    case 'finalized':
                        mat.emissiveIntensity = 0.04;
                        break;
                    default:  // unconfigured
                        mat.emissiveIntensity = 0.08;
                        break;
                }

                // Phantom override: PID scan ran and found no matching process
                if (Object.prototype.hasOwnProperty.call(state.nodePids, v.name) && state.nodePids[v.name] === null) {
                    mat.emissive.setHex(0xffffff);
                    mat.emissiveIntensity = 0.04 + 0.06 * Math.abs(Math.sin(t * 0.7));
                }
            }

            // ── SERVICE: hexagonal prism + emissive spike on invocation ───────────
            if (v.type === NODE_TYPES.SERVICE) {
                v.mesh.rotation.x += 0.007;
                v.mesh.rotation.y += 0.007;

                if (v.flashStart !== null) {
                    const elapsed = nowMs - v.flashStart;
                    if (elapsed < 200) {
                        const p = 1.0 - elapsed / 200;            // 1 → 0 over 200 ms
                        v.mesh.material.emissiveIntensity = 0.12 + p * 1.9;
                        v.mesh.scale.setScalar(1.0 + p * 0.5);
                    } else {
                        v.mesh.material.emissiveIntensity = 0.12;
                        v.mesh.scale.setScalar(1.0);
                        v.flashStart = null;
                    }
                }
            }

            // ── ACTION: orbital ring spin + core swells with progress ─────────────
            if (v.type === NODE_TYPES.ACTION) {
                if (v.ringMesh) {
                    // Mirror core visibility — ring is not in raycaster's vertex list
                    v.ringMesh.visible = v.mesh.visible;
                    v.ringMesh.rotation.z += 0.022;
                    v.ringMesh.rotation.x += 0.007;
                }

                const progress = v.actionProgress ?? 0;
                // Core swells outward toward ring perimeter as action progresses
                v.mesh.scale.setScalar(1.0 + progress * 0.8);
                v.mesh.material.emissiveIntensity = 0.3 + progress * 0.6;
            }
        });

        // ── Artery flow animation ─────────────────────────────────────────────────
        state.links.forEach(link => {
            if (!link.isArtery) return;
            // Decrement offset to flow from source → destination
            link.flowOffset -= link.flowSpeed * delta;
            link.lineMesh.material.dashOffset = link.flowOffset;
        });

        // ── Drain legacy particles (pre-refactor residue) ─────────────────────────
        for (let i = state.activeParticles.length - 1; i >= 0; i--) {
            const p = state.activeParticles[i];
            if (p.paused) continue;
            p.progress += p.speed;
            if (p.progress >= 1.0) {
                state.scene.remove(p.mesh);
                p.mesh.geometry.dispose();
                p.mesh.material.dispose();
                state.activeParticles.splice(i, 1);
            } else {
                p.mesh.position.lerpVectors(
                    p.leg === 1 ? p.startNode.pos : p.midNode.pos,
                    p.leg === 1 ? p.midNode.pos   : (p.endNode?.pos ?? p.midNode.pos),
                    p.progress
                );
            }
        }
    }

    // Staleness check every ~60 frames
    if (++_staleCheckFrame >= 60) {
        _staleCheckFrame = 0;
        checkTopicStaleness();
    }

    state.controls.update();
    if (state.composer) {
        try {
            state.composer.render();
        } catch (e) {
            console.warn('[bloom] EffectComposer failed, disabling bloom:', e.message);
            state.composer = null;
            state.renderer.render(state.scene, state.camera);
        }
    } else {
        state.renderer.render(state.scene, state.camera);
    }
}

// ---------------------------------------------------------------------------
// Scene teardown
// ---------------------------------------------------------------------------

export function clearGraph() {
    if (!state.scene) return;

    Object.keys(state.vertices).forEach(id => {
        _disposeVertex(state.vertices[id]);
        delete state.vertices[id];
    });

    state.links.forEach(l => {
        state.scene.remove(l.lineMesh);
        l.lineMesh.geometry.dispose();
        l.lineMesh.material.dispose();
    });
    state.links.length = 0;

    state.activeParticles.forEach(p => state.scene.remove(p.mesh));
    state.activeParticles.length = 0;
    state.selectedEntityId = null;
    hideContextMenu();
    document.getElementById('inspector-panel').classList.add('collapsed');
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function _disposeVertex(v) {
    state.scene.remove(v.mesh);
    v.mesh.geometry.dispose();
    if (Array.isArray(v.mesh.material)) v.mesh.material.forEach(m => m.dispose());
    else v.mesh.material.dispose();

    if (v.ringMesh) {
        state.scene.remove(v.ringMesh);
        v.ringMesh.geometry.dispose();
        v.ringMesh.material.dispose();
    }

    if (v.sprite) {
        state.scene.remove(v.sprite);
        v.sprite.material.dispose();
    }

    if (v.hzSprite) {
        state.scene.remove(v.hzSprite);
        if (v.hzSprite.material.map) v.hzSprite.material.map.dispose();
        v.hzSprite.material.dispose();
    }
}

function _updateTopicArteryLinks(topicName, hz, health) {
    const topicId   = `topic:${topicName}`;
    const linkColor = _arteryColor(health);
    const opacity   = _hzToOpacity(hz);
    const flowSpeed = _hzToFlowSpeed(hz);

    state.links.forEach(link => {
        if (link.topicId !== topicId) return;
        link.lineMesh.material.color.setHex(linkColor);
        link.lineMesh.material.opacity = opacity;
        link.flowSpeed = flowSpeed;
    });
}

// Stable/unknown topics use the topic orange so the line matches its node sphere.
// Only jitter (amber) and stale (red) use the health colours — those signal problems.
function _arteryColor(health) {
    if (health === HZ_HEALTH.STALE)  return HZ_HEALTH_COLORS[HZ_HEALTH.STALE];
    if (health === HZ_HEALTH.JITTER) return HZ_HEALTH_COLORS[HZ_HEALTH.JITTER];
    return COLORS[NODE_TYPES.TOPIC]; // orange — healthy / unknown
}

function _hzToFlowSpeed(hz) {
    // Slower at 0 Hz (baseline drift), faster at high Hz
    return Math.max(0.15, hz * 0.09);
}

function _hzToOpacity(hz) {
    // Higher bandwidth = brighter artery
    return Math.min(0.3 + (hz / 10.0) * 0.5, 0.82);
}

// Spawn a small bright dot that travels from-vertex → to-vertex over the artery.
// Throttled per topic to avoid flooding at high Hz.
function _spawnArteryParticle(fromVertex, toVertex) {
    if (!fromVertex || !toVertex) return;
    const geom = new THREE.SphereGeometry(0.14, 5, 5);
    const mat  = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.88,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(fromVertex.pos);
    state.scene.add(mesh);
    state.activeParticles.push({
        mesh,
        startNode: fromVertex,
        midNode:   toVertex,
        endNode:   null,
        leg: 1, progress: 0, speed: 0.06, paused: false,
    });
}
