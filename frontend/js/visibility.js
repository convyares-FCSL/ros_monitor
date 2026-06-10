// --- Visibility, Isolation & Generic-Item Filtering ---

import {
    state,
    NODE_TYPES,
    GENERIC_SERVICE_SUFFIXES,
    GENERIC_NODE_PREFIXES,
    GENERIC_DEFAULT_TOPICS,
    GENERIC_DEFAULT_NODES,
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
        return GENERIC_DEFAULT_NODES.has(name);
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

    return isEntityDisplayed(vertex.type, id);
}

export function formatSectionCount(items, entityType) {
    const visibleCount = items.filter((item) => isEntityDisplayed(entityType, `${entityType}:${item.name}`)).length;
    return visibleCount === items.length ? String(items.length) : `${visibleCount}/${items.length}`;
}

export function applyVertexVisibility(vertex) {
    const visible = isEntityDisplayed(vertex.type, vertex.id);
    vertex.mesh.visible = visible;
    vertex.sprite.visible = visible;
}

export function refreshLinkVisibility() {
    state.links.forEach((link) => {
        link.lineMesh.visible = isVertexVisible(link.sourceId) && isVertexVisible(link.targetId);
    });
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
