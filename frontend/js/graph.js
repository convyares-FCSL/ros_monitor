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
    createServicePortMesh,
    SERVICE_PORT_IDLE_OPACITY,
    SERVICE_PORT_ACTIVE_OPACITY,
    updateHzSprite,
    updateNodeLifecycleColor,
} from './scene.js';
import {
    applyVertexVisibility,
    refreshLinkVisibility,
    hideDanglingTopicVertices,
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

    function syncVertex(id, name, type, hostId = null) {
        activeIds.add(id);

        // Re-dock if a service's host appeared/changed (mesh style differs)
        const wantDocked = type === NODE_TYPES.SERVICE && hostId !== null;
        if (vertices[id] && vertices[id].type === NODE_TYPES.SERVICE
                && Boolean(vertices[id].docked) !== wantDocked) {
            _disposeVertex(vertices[id]);
            delete vertices[id];
        }

        if (vertices[id]) {
            vertices[id].type = type;
            if (wantDocked) vertices[id].hostId = hostId;
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
            lastInvoked: 0,       // service activity glow window
            actionProgress: 0,    // action orbital progress (0–1)
            // Docked service-port fields
            docked: false,
            hostId: null,
            portIndex: 0,
            portCount: 1,
        };

        if (wantDocked) {
            entry.docked = true;
            entry.hostId = hostId;
            const portMesh = createServicePortMesh();
            // Start at the host's position; the orbit pass places it each frame
            if (vertices[hostId]) entry.pos.copy(vertices[hostId].pos);
            portMesh.position.copy(entry.pos);
            portMesh.userData.vertexId = id;
            state.scene.add(portMesh);
            entry.mesh = portMesh;
        } else if (type === NODE_TYPES.ACTION) {
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

        // Docked ports get a short label (path minus host prefix), hidden until selected
        const labelText = wantDocked && hostId
            ? name.replace(new RegExp(`^/?${vertices[hostId]?.name?.replace(/^\//, '') ?? ''}/`), '')
            : name;
        const labelSprite = createLabelSprite(labelText, COLORS[type]);
        labelSprite.position.copy(pos);
        labelSprite.position.y += (type === NODE_TYPES.NODE ? 1.5 : 1.0);
        if (wantDocked) {
            labelSprite.scale.set(4.2, 1.05, 1);
            labelSprite.visible = false;
        }
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
    data.services.forEach(s => {
        // Dock onto the first server node; no server → free-floating fallback
        const host = s.servers?.length ? `node:${s.servers[0]}` : null;
        syncVertex(`service:${s.name}`, s.name, NODE_TYPES.SERVICE, vertices[host] ? host : null);
        // Connected services (live client) render larger & brighter
        const v = vertices[`service:${s.name}`];
        if (v) {
            v.hasClients = (s.clients || []).length > 0;
            v.edgeAttach = null; // recomputed below once links are rebuilt
        }
    });
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
            // Flowing data artery — Line2 (thick screen-space lines)
            const hzInfo    = state.topicHz[topicId.replace('topic:', '')];
            const health    = hzInfo?.health ?? HZ_HEALTH.UNKNOWN;
            const lineColor = _arteryColor(health);
            const opacity   = _hzToOpacity(hzInfo?.hz ?? 0);
            const lateral   = _lateralFor(sourceId, targetId);

            const mat = new THREE.LineMaterial({
                color: lineColor,
                linewidth: _hzToWidth(hzInfo?.hz ?? 0),
                transparent: true,
                opacity,
                resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
            });
            const geom = new THREE.LineGeometry();
            geom.setPositions(_curvePositions(vertices[sourceId].pos, vertices[targetId].pos, lateral));
            lineMesh = new THREE.Line2(geom, mat);
            lineMesh.computeLineDistances();

            const key = `${sourceId}|${targetId}`;
            const flowOffset = savedFlowOffsets[key] ?? 0;
            const flowSpeed  = _hzToFlowSpeed(hzInfo?.hz ?? 0);

            state.scene.add(lineMesh);
            links.push({ sourceId, targetId, lineMesh, topicId, isArtery: true, flowOffset, flowSpeed, lateral });
        } else {
            // Static structural connection (services, actions) — same Line2 style as arteries
            const srcType = sourceId.split(':')[0];
            const tgtType = targetId.split(':')[0];
            const color  = (srcType === 'service' || tgtType === 'service') ? COLORS[NODE_TYPES.SERVICE]
                         : (srcType === 'action'  || tgtType === 'action')  ? COLORS[NODE_TYPES.ACTION]
                         : 0x475569;
            const mat = new THREE.LineMaterial({
                color,
                linewidth: 4,
                transparent: true,
                opacity: 0.65,
                resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
            });
            const lateral = _lateralFor(sourceId, targetId);
            const geom = new THREE.LineGeometry();
            geom.setPositions(_curvePositions(vertices[sourceId].pos, vertices[targetId].pos, lateral));
            lineMesh = new THREE.Line2(geom, mat);
            lineMesh.computeLineDistances();
            state.scene.add(lineMesh);
            links.push({ sourceId, targetId, lineMesh, topicId: null, isArtery: false, lateral });
        }
    }

    data.topics.forEach(t => {
        const tid = `topic:${t.name}`;
        t.publishers.forEach(pub => addLink(`node:${pub}`, tid, tid));
        t.subscribers.forEach(sub => addLink(tid, `node:${sub}`, tid));
    });

    // Service edges exist only when a client is connected: node→node.
    // Orphan services (no client) are just dim ports on their host ring — no edge.
    // Multiple services between the same node pair fan out as separate arcs.
    const pairServices = {};
    data.services.forEach(s => {
        const sid = `service:${s.name}`;
        (s.clients || []).forEach(cli => {
            s.servers.forEach(srv => {
                if (cli === srv) return; // self-call: port flare covers it
                const key = `node:${cli}|node:${srv}`;
                (pairServices[key] ??= []).push(sid);
            });
        });
    });
    Object.entries(pairServices).forEach(([key, sids]) => {
        const [clientId, serverId] = key.split('|');
        sids.forEach((sid, i) => {
            // Fan: spread arcs symmetrically; single edge keeps a gentle bow
            const lateral = sids.length === 1
                ? _lateralFor(clientId, serverId) * 0.5
                : (i / (sids.length - 1)) * 2 - 1;
            addServiceLink(clientId, serverId, sid, lateral);
        });
    });

    function addServiceLink(clientId, serverId, serviceId, lateral) {
        if (!vertices[clientId] || !vertices[serverId]) return;

        vertices[clientId].connections.add(serverId);
        vertices[serverId].connections.add(clientId);

        // Topic-artery styling in service green — connected services are first-class
        const mat = new THREE.LineMaterial({
            color: COLORS[NODE_TYPES.SERVICE],
            linewidth: 4,
            transparent: true,
            opacity: 0.7,
            resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
        });
        const geom = new THREE.LineGeometry();
        geom.setPositions(_curvePositions(vertices[clientId].pos, vertices[serverId].pos, lateral));
        const lineMesh = new THREE.Line2(geom, mat);
        lineMesh.computeLineDistances();
        state.scene.add(lineMesh);
        links.push({
            sourceId: clientId, targetId: serverId, lineMesh,
            topicId: null, isArtery: false,
            serviceId, serviceIds: new Set([serviceId]),
            lateral,
        });
    }

    data.actions.forEach(a => {
        const aid = `action:${a.name}`;
        a.servers.forEach(srv => addLink(aid, `node:${srv}`));
        a.clients.forEach(cli => addLink(`node:${cli}`, aid));
    });

    // Connected services sit ON their client→server arc like a topic junction
    // (one arc per service — same-pair arcs fan out via their lateral offsets).
    links.forEach(link => {
        if (!link.serviceIds) return;
        const ids = [...link.serviceIds];
        ids.forEach((sid, i) => {
            const v = vertices[sid];
            if (!v) return;
            v.edgeAttach = {
                sourceId: link.sourceId,
                targetId: link.targetId,
                lateral: link.lateral,
                t: (i + 1) / (ids.length + 1),
            };
            // Mid-edge junctions show the full service path (ring ports use short names)
            if (!v.labelIsFull) {
                state.scene.remove(v.sprite);
                if (v.sprite.material.map) v.sprite.material.map.dispose();
                v.sprite.material.dispose();
                v.sprite = createLabelSprite(v.name, COLORS[NODE_TYPES.SERVICE]);
                v.sprite.visible = false; // animate() drives visibility
                state.scene.add(v.sprite);
                v.labelIsFull = true;
            }
        });
    });

    // Assign stable ring slots for the remaining (orphan) docked ports
    const portsByHost = {};
    Object.values(vertices).forEach(v => {
        if (v.docked && !v.edgeAttach) (portsByHost[v.hostId] ??= []).push(v);
    });
    Object.values(portsByHost).forEach(ports => {
        ports.sort((a, b) => a.name.localeCompare(b.name));
        ports.forEach((p, i) => { p.portIndex = i; p.portCount = ports.length; });
    });

    if (state.isolatedRootId) {
        state.isolatedVertexIds = buildIsolationSet(state.isolatedRootId);
    }
    refreshLinkVisibility();
    hideDanglingTopicVertices();
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
    // Flare the docked port and open its activity-glow window
    const serviceId = `service:${data.service_name}`;
    const vertex    = state.vertices[serviceId];
    if (vertex?.type === NODE_TYPES.SERVICE) {
        vertex.flashStart  = performance.now();
        vertex.lastInvoked = performance.now();
    }

    // Pulse travels the client → server edge: the neural "firing" moment
    state.links.forEach(link => {
        if (!link.serviceIds?.has(serviceId) || !link.lineMesh.visible) return;
        const src = state.vertices[link.sourceId];
        const tgt = state.vertices[link.targetId];
        if (src && tgt) _spawnArteryParticle(src, tgt, COLORS[NODE_TYPES.SERVICE], link.lateral);
    });

    // Record call to history so the inspector can show it
    // ServiceEventInfo: REQUEST_SENT=0, REQUEST_RECEIVED=1
    const eventLabel = data.event_type === 0 ? 'REQUEST_SENT' : 'REQUEST_RECEIVED';
    recordMessageHistory({
        topic: `${data.service_name}/_service_event`,
        msg_type: eventLabel,
        timestamp: data.timestamp ?? (Date.now() / 1000),
        payload: data.payload,
        dropped_payload: data.payload === null,
        size_bytes: data.payload ? JSON.stringify(data.payload).length : 0,
    });
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
    if (topicV && topicV.mesh.visible && (now - (_particleThrottle[data.topic] ?? 0)) > 300
            && state.activeParticles.length < 40) {
        _particleThrottle[data.topic] = now;
        state.links.forEach(link => {
            if (link.topicId !== topicId || !link.isArtery) return;
            if (!link.lineMesh.visible) return; // don't fly along hidden edges
            const src = state.vertices[link.sourceId];
            // Publisher→topic direction only (avoids spawning on both legs)
            if (src?.type === NODE_TYPES.NODE && src.mesh.visible) {
                _spawnArteryParticle(src, topicV);
            }
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
    // Docked service ports don't participate in the force layout —
    // they're positioned on their host node's ring each frame.
    const keys     = Object.keys(vertices).filter(id => !vertices[id].docked);
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
        // All links are curved Line2 polylines — rebuild the arc each frame
        link.lineMesh.geometry.setPositions(_curvePositions(u.pos, v.pos, link.lateral ?? 0));
        link.lineMesh.computeLineDistances();
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
            state.topicHz[topicName].hz = 0;
            const v = state.vertices[`topic:${topicName}`];
            if (v) updateHzSprite(v, null, HZ_HEALTH.STALE); // '--', not the dead rate
            _updateTopicArteryLinks(topicName, 0, HZ_HEALTH.STALE);
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

            // ── SERVICE: edge junction (connected) or docked ring port (orphan) ───
            if (v.type === NODE_TYPES.SERVICE) {
                if (v.edgeAttach) {
                    // Topic-style junction: octahedron rides the client→server arc
                    const src = state.vertices[v.edgeAttach.sourceId];
                    const tgt = state.vertices[v.edgeAttach.targetId];
                    if (src && tgt) {
                        _curvePoint(src.pos, tgt.pos, v.edgeAttach.lateral, v.edgeAttach.t, v.pos);
                        v.mesh.position.copy(v.pos);
                        v.sprite.position.copy(v.pos);
                        v.sprite.position.y += 0.6;
                        v.sprite.scale.set(6, 1.5, 1);

                        const vis = isVertexVisible(v.id)
                                 && isVertexVisible(v.edgeAttach.sourceId)
                                 && isVertexVisible(v.edgeAttach.targetId);
                        v.mesh.visible = vis;
                        v.sprite.visible = vis; // label always on, like topics
                    }
                } else if (v.docked) {
                    const host = state.vertices[v.hostId];
                    if (host) {
                        // Slow orbit around the host node, gentle per-port bob
                        const angle = (v.portIndex / Math.max(v.portCount, 1)) * Math.PI * 2 + t * 0.12;
                        const R = 1.9;
                        v.pos.set(
                            host.pos.x + Math.cos(angle) * R,
                            host.pos.y + Math.sin(t * 1.2 + v.portIndex) * 0.12,
                            host.pos.z + Math.sin(angle) * R
                        );
                        v.mesh.position.copy(v.pos);
                        v.sprite.position.copy(v.pos);
                        v.sprite.position.y += 0.45;

                        // Ports inherit host visibility; labels only on selection
                        const vis = isVertexVisible(v.id) && isVertexVisible(v.hostId);
                        v.mesh.visible = vis;
                        const selected = state.selectedEntityId === v.id
                                      || state.selectedEntityId === v.hostId;
                        v.sprite.visible = vis && selected;
                    }
                }

                v.mesh.rotation.y += 0.012;

                // Connected services (live client) are larger, brighter octahedra;
                // edge junctions match topic-sphere prominence
                const baseScale   = v.hasClients ? 1.9 : 1.0;
                const idleOpacity = v.edgeAttach ? 0.85
                                  : v.hasClients ? 0.5
                                  : SERVICE_PORT_IDLE_OPACITY;

                const mat = v.mesh.material;
                if (v.flashStart !== null) {
                    const elapsed = nowMs - v.flashStart;
                    if (elapsed < 450) {
                        const p = 1.0 - elapsed / 450;
                        mat.opacity = idleOpacity + p * (1.0 - idleOpacity);
                        v.mesh.scale.setScalar(baseScale * (1.0 + p * 1.4));
                    } else {
                        v.mesh.scale.setScalar(baseScale);
                        v.flashStart = null;
                    }
                } else {
                    // Recently-called services keep a soft active glow for 8 s
                    const active = nowMs - (v.lastInvoked ?? 0) < 8000;
                    mat.opacity = active ? Math.max(SERVICE_PORT_ACTIVE_OPACITY, idleOpacity) : idleOpacity;
                    v.mesh.scale.setScalar(baseScale);
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
                const from = p.leg === 1 ? p.startNode.pos : p.midNode.pos;
                const to   = p.leg === 1 ? p.midNode.pos   : (p.endNode?.pos ?? p.midNode.pos);
                _curvePoint(from, to, p.lateral ?? 0, p.progress, p.mesh.position);
            }
        }
    }

    // ── Depth cue: labels fade with camera distance ───────────────────────────
    Object.values(state.vertices).forEach(v => {
        if (v.sprite?.visible) {
            const d = state.camera.position.distanceTo(v.sprite.position);
            v.sprite.material.opacity = Math.min(Math.max(1.5 - d / 40, 0.12), 1);
        }
        if (v.hzSprite?.visible) {
            const d = state.camera.position.distanceTo(v.hzSprite.position);
            v.hzSprite.material.opacity = Math.min(Math.max(1.5 - d / 40, 0.12), 1);
        }
    });

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
        link.lineMesh.material.linewidth = _hzToWidth(hz);
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

// Edge weight = bandwidth: higher publish rate → thicker artery
function _hzToWidth(hz) {
    return Math.min(2.2 + hz * 0.35, 7.0);
}

// Deterministic per-edge lateral offset in [-1, 1] so parallel edges separate
function _lateralFor(a, b) {
    const s = `${a}|${b}`;
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return (((h % 2001) + 2001) % 2001) / 1000 - 1;
}

// Quadratic-bezier arc between two points: slight sideways bulge + upward lift.
// Returns a flat [x,y,z,...] array for LineGeometry.setPositions().
const _CURVE_SEGMENTS = 10;
function _curvePositions(u, v, lateral) {
    const dx = v.x - u.x, dy = v.y - u.y, dz = v.z - u.z;
    const dist  = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const bulge = Math.min(dist * 0.18, 2.2);
    // Perpendicular in the XZ plane for the sideways component
    const px = -dz / dist, pz = dx / dist;
    const mx = (u.x + v.x) / 2 + px * lateral * bulge;
    const my = (u.y + v.y) / 2 + bulge * 0.35;
    const mz = (u.z + v.z) / 2 + pz * lateral * bulge;

    const out = [];
    for (let i = 0; i <= _CURVE_SEGMENTS; i++) {
        const t = i / _CURVE_SEGMENTS;
        const it = 1 - t;
        out.push(
            it * it * u.x + 2 * it * t * mx + t * t * v.x,
            it * it * u.y + 2 * it * t * my + t * t * v.y,
            it * it * u.z + 2 * it * t * mz + t * t * v.z,
        );
    }
    return out;
}

// Point along the same arc at parameter t — used so pulses ride the curve
function _curvePoint(u, v, lateral, t, out) {
    const dx = v.x - u.x, dy = v.y - u.y, dz = v.z - u.z;
    const dist  = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const bulge = Math.min(dist * 0.18, 2.2);
    const px = -dz / dist, pz = dx / dist;
    const mx = (u.x + v.x) / 2 + px * lateral * bulge;
    const my = (u.y + v.y) / 2 + bulge * 0.35;
    const mz = (u.z + v.z) / 2 + pz * lateral * bulge;
    const it = 1 - t;
    out.set(
        it * it * u.x + 2 * it * t * mx + t * t * v.x,
        it * it * u.y + 2 * it * t * my + t * t * v.y,
        it * it * u.z + 2 * it * t * mz + t * t * v.z,
    );
}

function _hzToOpacity(hz) {
    // Solid at baseline, brighter at high Hz
    return Math.min(0.65 + (hz / 10.0) * 0.25, 0.92);
}

// Spawn a small bright dot that travels from-vertex → to-vertex over the artery.
// Throttled per topic to avoid flooding at high Hz.
function _spawnArteryParticle(fromVertex, toVertex, color = COLORS[NODE_TYPES.TOPIC], lateral = null) {
    if (!fromVertex || !toVertex) return;
    const geom = new THREE.SphereGeometry(0.2, 8, 8);
    const mat  = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.95,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(fromVertex.pos);
    state.scene.add(mesh);
    state.activeParticles.push({
        mesh,
        startNode: fromVertex,
        midNode:   toVertex,
        endNode:   null,
        lateral:   lateral ?? _lateralFor(fromVertex.id, toVertex.id), // follow the edge arc
        leg: 1, progress: 0, speed: 0.06, paused: false,
    });
}
