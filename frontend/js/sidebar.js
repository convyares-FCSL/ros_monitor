// --- HUD Stats, Sidebar Lists & Section/Pause Controls ---

import { state, NODE_TYPES, refreshIcons } from './state.js';
import {
    formatSectionCount,
    isEntityDisplayed,
    isGenericId,
    isItemVisible,
    isTypeVisible,
    toggleItemVisibility,
    toggleGroupItemsVisibility,
    showContextMenu,
} from './visibility.js';
import { inspectEntity } from './inspector.js';
import { gsapScrollTo } from './scene.js';
import { handleGraphUpdate } from './graph.js';

// --- HUD Stats & Sidebar Population ---
export function updateHUDStats(data) {
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

    // Split off "generic" (built-in/noise) items into a collapsed group
    const regularItems = [];
    const genericItems = [];
    items.forEach((item) => {
        const vertexId = `${entityType}:${item.name}`;
        if (isGenericId(vertexId)) {
            genericItems.push(item);
        } else {
            regularItems.push(item);
        }
    });

    regularItems.forEach((item) => {
        list.appendChild(buildListItem(item, entityType));
    });

    if (genericItems.length > 0) {
        list.appendChild(buildGenericGroup(elementId, genericItems, entityType));
    }

    refreshIcons();
}

function buildListItem(item, entityType) {
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
        const vertex = state.vertices[vertexId];
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

    return li;
}

// Collapsible "Built-in (N)" group for generic/noise items (parameter services, /rosout, etc.),
// further bucketed into subgroups by their final path segment (e.g. all "*/list_parameters" together).
function buildGenericGroup(elementId, genericItems, entityType) {
    const li = document.createElement('li');
    li.className = 'generic-group';

    const details = document.createElement('details');
    details.className = 'generic-group-details';
    details.open = state.genericGroupExpanded[elementId] === true;

    const vertexIds = genericItems.map((item) => `${entityType}:${item.name}`);
    const summary = buildGroupSummary(`Built-in (${genericItems.length})`, vertexIds);
    details.appendChild(summary);

    const innerList = document.createElement('ul');
    innerList.className = 'generic-group-list';

    const subGroups = new Map();
    genericItems.forEach((item) => {
        const key = item.name.split('/').pop() || item.name;
        if (!subGroups.has(key)) {
            subGroups.set(key, []);
        }
        subGroups.get(key).push(item);
    });

    if (subGroups.size > 1) {
        subGroups.forEach((subItems, key) => {
            innerList.appendChild(buildGenericSubgroup(elementId, key, subItems, entityType));
        });
    } else {
        genericItems.forEach((item) => {
            innerList.appendChild(buildListItem(item, entityType));
        });
    }

    details.appendChild(innerList);

    details.addEventListener('toggle', () => {
        state.genericGroupExpanded[elementId] = details.open;
    });

    li.appendChild(details);
    return li;
}

// Nested "<final-segment> (N)" subgroup within a "Built-in" group, e.g. "list_parameters (7)".
function buildGenericSubgroup(elementId, key, items, entityType) {
    const li = document.createElement('li');
    li.className = 'generic-subgroup';

    const details = document.createElement('details');
    details.className = 'generic-group-details generic-subgroup-details';
    const expandKey = `${elementId}::${key}`;
    details.open = state.genericGroupExpanded[expandKey] === true;

    const vertexIds = items.map((item) => `${entityType}:${item.name}`);
    const summary = buildGroupSummary(`${key} (${items.length})`, vertexIds);
    details.appendChild(summary);

    const innerList = document.createElement('ul');
    innerList.className = 'generic-group-list';
    items.forEach((item) => {
        innerList.appendChild(buildListItem(item, entityType));
    });
    details.appendChild(innerList);

    details.addEventListener('toggle', () => {
        state.genericGroupExpanded[expandKey] = details.open;
    });

    li.appendChild(details);
    return li;
}

// Shared <summary> markup for a (sub)group: chevron, label/count, and a bulk show/hide toggle.
function buildGroupSummary(label, vertexIds) {
    const summary = document.createElement('summary');
    summary.className = 'generic-group-summary';

    const visible = vertexIds.some((id) => isItemVisible(id));

    summary.innerHTML = `
        <i data-lucide="chevron-right" class="generic-group-chevron"></i>
        <span class="generic-group-label">${label}</span>
        <button class="item-toggle generic-group-toggle ${visible ? '' : 'is-off'}" title="${visible ? 'Hide' : 'Show'} ${label}" aria-label="${visible ? 'Hide' : 'Show'} ${label}">
            <i data-lucide="${visible ? 'eye' : 'eye-off'}"></i>
        </button>
    `;

    summary.querySelector('.generic-group-toggle').addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleGroupItemsVisibility(vertexIds);
    });

    return summary;
}

// --- Section Toggle / Collapse Controls ---
export function refreshSectionToggles() {
    document.querySelectorAll('.section-toggle').forEach((button) => {
        const type = button.dataset.filterType;
        const visible = isTypeVisible(type);
        button.classList.toggle('is-off', !visible);
        button.title = `${visible ? 'Hide' : 'Show'} all ${type}s`;
        button.setAttribute('aria-label', button.title);
        button.innerHTML = `<i data-lucide="${visible ? 'eye' : 'eye-off'}"></i>`;
    });

    refreshIcons();
}

export function toggleSectionCollapsed(type) {
    state.sectionCollapse[type] = !state.sectionCollapse[type];
    refreshSectionCollapseButtons();
}

export function refreshSectionCollapseButtons() {
    document.querySelectorAll('.explorer-section').forEach((section) => {
        const type = section.dataset.sectionType;
        section.classList.toggle('is-collapsed', state.sectionCollapse[type] === true);
    });

    document.querySelectorAll('.section-collapse').forEach((button) => {
        const type = button.dataset.sectionType;
        const collapsed = state.sectionCollapse[type] === true;
        button.classList.toggle('is-collapsed', collapsed);
        button.title = `${collapsed ? 'Expand' : 'Collapse'} ${type}s`;
        button.setAttribute('aria-label', button.title);
        button.innerHTML = `<i data-lucide="${collapsed ? 'chevron-right' : 'chevron-down'}"></i>`;
    });

    refreshIcons();
}

// --- Pause/Resume View Controls ---
export function updatePauseButton() {
    const button = document.getElementById('btn-toggle-pause');
    if (!button) {
        return;
    }

    button.classList.toggle('paused', state.isScenePaused);
    button.innerHTML = `<i data-lucide="${state.isScenePaused ? 'play' : 'pause'}"></i> ${state.isScenePaused ? 'Resume View' : 'Pause View'}`;

    refreshIcons();
}

export function setScenePaused(paused) {
    state.isScenePaused = paused;
    updatePauseButton();

    if (!state.isScenePaused && state.pendingGraphData) {
        const nextGraphData = state.pendingGraphData;
        state.pendingGraphData = null;
        handleGraphUpdate(nextGraphData);
    }
}
