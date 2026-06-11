// --- Visibility, Isolation & Generic-Item Filtering ---

import {
    state,
    NODE_TYPES,
    GENERIC_SERVICE_SUFFIXES,
    GENERIC_NODE_PREFIXES,
    GENERIC_DEFAULT_TOPICS,
    GENERIC_DEFAULT_NODES,
    GENERIC_DEFAULT_NODE_PREFIXES,
    refreshIcons,
} from './state.js';
import { inspectEntity } from './inspector.js';
import { updateHUDStats, refreshSectionToggles } from './sidebar.js';

// --- Vertex id helpers ---
export function isTopicVertexId(vertexId) {
    return typeof vertexId === 'string' && vertexId.startsWith('topic:');
}

export function isServiceVertexId(vertexId) {
    return typeof vertexId === 'string' && vertexId.startsWith('service:');
}

export function isNodeVertexId(vertexId) {
    return typeof vertexId === 'string' && vertexId.startsWith('node:');
}

export function isGenericToggleable(vertexId) {
    return isTopicVertexId(vertexId) || isServiceVertexId(vertexId) || isNodeVertexId(vertexId);
}

// --- Generic ("built-in, hidden by default") classification ---
export function isDefaultGenericName(type, name) {
    if (type === NODE_TYPES.TOPIC) {
        return GENERIC_DEFAULT_TOPICS.has(name);
    }

    if (type === NODE_TYPES.NODE) {
        if (GENERIC_DEFAULT_NODES.has(name)) return true;
        // Hardcoded: ros2cli daemon nodes have a random PID/UUID suffix — match by prefix.
        const bare = name.startsWith('/') ? name.slice(1) : name;
        if (bare.startsWith('_ros2cli_daemon')) return true;
        return Array.isArray(GENERIC_DEFAULT_NODE_PREFIXES)
            && GENERIC_DEFAULT_NODE_PREFIXES.some(p => name.startsWith(p));
    }

    if (type === NODE_TYPES.SERVICE) {
        if (GENERIC_NODE_PREFIXES.some((prefix) => name.startsWith(prefix))) {
            return true;
        }
        return GENERIC_SERVICE_SUFFIXES.some((suffix) => name.endsWith(suffix));
    }

    return false;
}

function vertexTypeAndName(id) {
    const vertex = state.vertices[id];
    if (vertex) {
        return { type: vertex.type, name: vertex.name };
    }

    if (isTopicVertexId(id)) {
        return { type: NODE_TYPES.TOPIC, name: id.slice('topic:'.length) };
    }

    if (isServiceVertexId(id)) {
        return { type: NODE_TYPES.SERVICE, name: id.slice('service:'.length) };
    }

    if (isNodeVertexId(id)) {
        return { type: NODE_TYPES.NODE, name: id.slice('node:'.length) };
    }

    return null;
}

export function isDefaultGenericId(id) {
    const info = vertexTypeAndName(id);
    return info ? isDefaultGenericName(info.type, info.name) : false;
}

export function isGenericId(id) {
    if (state.genericOverrides.has(id)) {
        return state.genericOverrides.get(id);
    }
    return isDefaultGenericId(id);
}

export function toggleGenericItem(vertexId) {
    if (!isGenericToggleable(vertexId)) {
        return;
    }

    const currentlyGeneric = isGenericId(vertexId);
    state.genericOverrides.set(vertexId, !currentlyGeneric);

    if (!currentlyGeneric) {
        state.itemVisibility[vertexId] = false;
    } else {
        delete state.itemVisibility[vertexId];
    }

    if (state.isolatedRootId) {
        state.isolatedVertexIds = buildIsolationSet(state.isolatedRootId);
    }
    updateVisibilityState();
}

// --- Visibility predicates ---
export function isTypeVisible(type) {
    return state.typeVisibility[type] !== false;
}

export function isItemVisible(id) {
    if (Object.prototype.hasOwnProperty.call(state.itemVisibility, id)) {
        return state.itemVisibility[id] !== false;
    }
    return !isGenericId(id);
}

export function isEntityVisible(type, id) {
    return isTypeVisible(type) && isItemVisible(id);
}

export function isEntityDisplayed(type, id) {
    return isEntityVisible(type, id) && (!state.isolatedVertexIds || state.isolatedVertexIds.has(id));
}

export function isVertexVisible(id) {
    const vertex = state.vertices[id];
    if (!vertex) {
        return isItemVisible(id) && (!state.isolatedVertexIds || state.isolatedVertexIds.has(id));
    }

    // Dead-end topics are fully hidden in 'hide' mode ('dim' keeps them visible)
    if (vertex.deadEnd && state.deadEndMode === 'hide') return false;

    return isEntityDisplayed(vertex.type, id);
}

export function formatSectionCount(items, entityType) {
    const visibleCount = items.filter((item) => isEntityDisplayed(entityType, `${entityType}:${item.name}`)).length;
    return visibleCount === items.length ? String(items.length) : `${visibleCount}/${items.length}`;
}

export function applyVertexVisibility(vertex) {
    let visible = isVertexVisible(vertex.id);
    // Docked service ports also inherit their host node's visibility
    if (vertex.docked && vertex.hostId) {
        visible = visible && isVertexVisible(vertex.hostId);
    }
    vertex.mesh.visible = visible;
    if (vertex.hzSprite) vertex.hzSprite.visible = visible;
    // Port labels are on-demand: shown only while the port or its host is selected.
    // Edge-attached (connected) services show their label always, like topics.
    const labelOn = !vertex.docked
        || Boolean(vertex.edgeAttach)
        || state.selectedEntityId === vertex.id
        || state.selectedEntityId === vertex.hostId;
    vertex.sprite.visible = visible && labelOn;
}

export function refreshLinkVisibility() {
    state.links.forEach((link) => {
        let visible = isVertexVisible(link.sourceId) && isVertexVisible(link.targetId);
        // Service edges also require at least one of their services to be visible
        if (visible && link.serviceIds) {
            visible = [...link.serviceIds].some((sid) => isVertexVisible(sid));
        }
        link.lineMesh.visible = visible;
    });
}

// --- Dead-end filtering ---
// A topic is a dead-end *relationally*: fewer than 2 visible endpoints after the
// current filters. (/mserve_base/base_status isn't a dead-end in the ROS graph —
// the bridge subscribes — but with the bridge muted it renders as one.)
// Explicitly-shown items (eye toggled on) always override the auto-prune.
// Computed flags are consumed by isVertexVisible() ('hide' mode) and by the
// animate() fade loop ('dim' mode). Recompute on any visibility change.
export function applyDeadEndFiltering() {
    let count = 0;
    Object.values(state.vertices).forEach((v) => {
        if (v.type !== NODE_TYPES.TOPIC) return;
        const wasDeadEnd = v.deadEnd === true;
        v.deadEnd = false;

        if (!isEntityDisplayed(v.type, v.id)) return;        // already filtered out
        if (state.itemVisibility[v.id] === true) return;     // user said "show"

        let degree = 0;
        for (const l of state.links) {
            if (l.topicId !== v.id) continue;
            const otherId = l.sourceId === v.id ? l.targetId : l.sourceId;
            const other = state.vertices[otherId];
            if (other && isEntityDisplayed(other.type, otherId)) degree++;
        }

        if (degree < 2) {
            v.deadEnd = true;
            count++;
        } else if (wasDeadEnd && state.deadEndMode !== 'show') {
            // Something just started talking/listening to this topic — flare it
            v.unhideFlare = performance.now();
        }
    });

    state.deadEndCount = count;
    updateDeadEndButton();
}

export function cycleDeadEndMode() {
    const order = { hide: 'dim', dim: 'show', show: 'hide' };
    state.deadEndMode = order[state.deadEndMode] ?? 'hide';
    updateVisibilityState();
}

export function updateDeadEndButton() {
    const button = document.getElementById('btn-deadends');
    if (!button) return;
    const cfg = {
        hide: { icon: 'eye-off',  label: 'Dead-ends: Hidden' },
        dim:  { icon: 'sun-dim',  label: 'Dead-ends: Dimmed' },
        show: { icon: 'eye',      label: 'Dead-ends: Shown'  },
    }[state.deadEndMode];
    button.innerHTML = `<i data-lucide="${cfg.icon}"></i> ${cfg.label} (${state.deadEndCount})`;
    refreshIcons();
}

export function refreshParticleVisibility() {
    state.activeParticles.forEach((particle) => {
        particle.mesh.visible =
            isVertexVisible(particle.startNode.id) &&
            isVertexVisible(particle.midNode.id) &&
            (!particle.endNode || isVertexVisible(particle.endNode.id));
    });
}

export function isBaseVertexVisible(id) {
    const vertex = state.vertices[id];
    if (!vertex) {
        return isItemVisible(id);
    }

    return isEntityVisible(vertex.type, id);
}

export function isTopicHistoryVisible(topicName) {
    const topicVertexId = `topic:${topicName}`;
    if (state.vertices[topicVertexId]) {
        return isVertexVisible(topicVertexId);
    }

    if (topicName.includes('/_action/')) {
        const baseAction = topicName.split('/_action/')[0];
        const actionVertexId = `action:${baseAction}`;
        if (state.vertices[actionVertexId]) {
            return isVertexVisible(actionVertexId) && isItemVisible(topicVertexId);
        }
    }

    return isItemVisible(topicVertexId);
}

// --- Isolation ---
export function isolateFromVertex(rootId) {
    state.isolatedRootId = rootId;
    state.isolatedVertexIds = buildIsolationSet(rootId);
    updateVisibilityState();
}

export function buildIsolationSet(rootId) {
    const visibleNeighborhood = new Set([rootId]);
    const frontier = [{ id: rootId, depth: 0 }];

    // Isolating a docked service port starts the walk from its host node
    const rootVertex = state.vertices[rootId];
    if (rootVertex?.docked && rootVertex.hostId) {
        visibleNeighborhood.add(rootVertex.hostId);
        frontier.push({ id: rootVertex.hostId, depth: 0 });
    }

    while (frontier.length > 0) {
        const current = frontier.shift();
        if (current.depth >= 2) {
            continue;
        }

        state.links.forEach((link) => {
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

    // Docked ports ride along with any isolated host node
    Object.values(state.vertices).forEach((v) => {
        if (v.docked && visibleNeighborhood.has(v.hostId)) {
            visibleNeighborhood.add(v.id);
        }
    });

    return visibleNeighborhood;
}

export function clearIsolation() {
    state.isolatedVertexIds = null;
    state.isolatedRootId = null;
    updateVisibilityState();
}

// --- Type / item toggles ---
export function toggleTypeVisibility(type) {
    state.typeVisibility[type] = !state.typeVisibility[type];
    updateVisibilityState();
}

export function toggleItemVisibility(id) {
    state.itemVisibility[id] = !isItemVisible(id);
    updateVisibilityState();
}

// Bulk show/hide a group of items (e.g. all "Built-in" entries, or one of its subgroups).
// If any item in the group is currently visible, the whole group is hidden, and vice versa.
export function toggleGroupItemsVisibility(vertexIds) {
    const anyVisible = vertexIds.some((id) => isItemVisible(id));
    vertexIds.forEach((id) => {
        state.itemVisibility[id] = !anyVisible;
    });
    updateVisibilityState();
}

export function updateVisibilityState() {
    applyDeadEndFiltering(); // before link/vertex passes: they consume the flags
    Object.values(state.vertices).forEach(applyVertexVisibility);
    refreshLinkVisibility();
    refreshParticleVisibility();

    if (state.latestGraphData) {
        updateHUDStats(state.latestGraphData);
    } else {
        refreshSectionToggles();
    }

    if (state.selectedEntityId && state.vertices[state.selectedEntityId]) {
        inspectEntity(state.vertices[state.selectedEntityId]);
    }
}

// --- Context Menu ---
export function showContextMenu(vertexId, clientX, clientY) {
    const menu = document.getElementById('graph-context-menu');
    if (!menu) {
        return;
    }

    state.contextMenuTargetId = vertexId;
    menu.classList.remove('hidden');
    const maxLeft = window.innerWidth - 196;
    const maxTop = window.innerHeight - 160;
    menu.style.left = `${Math.min(clientX, maxLeft)}px`;
    menu.style.top = `${Math.min(clientY, maxTop)}px`;

    const clearIsolationButton = document.getElementById('ctx-clear-isolation');
    clearIsolationButton.style.display = state.isolatedVertexIds ? 'flex' : 'none';

    const genericButton = document.getElementById('ctx-toggle-generic');
    if (isGenericToggleable(vertexId)) {
        genericButton.style.display = 'flex';
        genericButton.innerHTML = `<i data-lucide="filter"></i> ${isGenericId(vertexId) ? 'Unmark Generic' : 'Mark Generic'}`;
    } else {
        genericButton.style.display = 'none';
    }

    refreshIcons();
}

export function hideContextMenu() {
    const menu = document.getElementById('graph-context-menu');
    if (!menu) {
        return;
    }

    menu.classList.add('hidden');
    state.contextMenuTargetId = null;
}
