// --- Entity & Packet Inspector (right-hand drawer) ---

import { state, NODE_TYPES, MAX_HISTORY_PER_TOPIC, refreshIcons } from './state.js';
import { isTopicHistoryVisible } from './visibility.js';

const LIFECYCLE_CSS = {
    unconfigured:     'lc-unconfigured',
    inactive:         'lc-inactive',
    active:           'lc-active',
    error_processing: 'lc-error',
    finalized:        'lc-error',
};

// --- Packet (particle) inspection ---
export function inspectParticle(particle) {
    state.selectedEntityId = null;
    releasePausedParticle();

    state.pausedParticle = particle;
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

    refreshIcons();
}

// --- Entity inspection ---
export function inspectEntity(vertex) {
    releasePausedParticle();
    state.selectedEntityId = vertex.id;

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

    const groupsHtml = renderEntityInspector(vertex, groups, selectedEntry);

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

    if (vertex.type === NODE_TYPES.TOPIC) {
        requestAnimationFrame(() => drawSparkline(vertex.name));
    }

    refreshIcons();
}

function renderEntityInspector(vertex, groups, selectedEntry) {
    switch (vertex.type) {
        case NODE_TYPES.NODE:
            return renderNodeInspector(vertex, groups, selectedEntry);
        case NODE_TYPES.TOPIC:
            return renderTopicInspector(vertex, groups, selectedEntry);
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
                    <i data-lucide="chevron-right" class="history-topic-chevron"></i>
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
        <section class="live-data-section">
            <div class="live-data-header">
                <i data-lucide="activity" class="section-icon text-cyan"></i>
                <h3>Live Data</h3>
                <span class="section-count">${groups.length}</span>
            </div>
            <div class="history-groups">${groupsHtml}</div>
        </section>
        ${renderDataViewer(selectedEntry)}
    `;
}

function renderNodeInspector(vertex, groups, selectedEntry) {
    const topics = state.latestGraphData?.topics || [];
    const services = state.latestGraphData?.services || [];
    const actions = state.latestGraphData?.actions || [];

    const publishers = topics.filter((topic) => topic.publishers.includes(vertex.name)).map((topic) => topic.name);
    const subscribers = topics.filter((topic) => topic.subscribers.includes(vertex.name)).map((topic) => topic.name);
    const serviceServers = services.filter((service) => service.servers.includes(vertex.name)).map((service) => service.name);
    const serviceClients = services.filter((service) => (service.clients || []).includes(vertex.name)).map((service) => service.name);
    const actionClients = actions.filter((action) => action.clients.includes(vertex.name)).map((action) => action.name);
    const actionServers = actions.filter((action) => action.servers.includes(vertex.name)).map((action) => action.name);

    const lifecycleHtml = renderLifecycleSection(vertex.name);
    const paramsHtml = renderParamsSection(vertex.name);

    return `
        ${lifecycleHtml}
        <section class="entity-info-grid">
            ${renderInfoCard('Publisher', publishers)}
            ${renderInfoCard('Subscriber', subscribers)}
            ${renderInfoCard('Service', serviceServers)}
            ${renderInfoCard('Service Client', serviceClients)}
            ${renderInfoCard('Action Client', actionClients)}
            ${renderInfoCard('Action', actionServers)}
        </section>
        ${paramsHtml}
        ${groups.length ? renderGroupedInspector(vertex, groups, selectedEntry) : `<div class="history-empty">No recent message history for this node yet.</div>`}
    `;
}

function renderTopicInspector(vertex, groups, selectedEntry) {
    const topicData = state.latestGraphData?.topics?.find((topic) => topic.name === vertex.name);
    const publishers = topicData?.publishers || [];
    const subscribers = topicData?.subscribers || [];

    return `
        <section class="entity-info-grid">
            ${renderInfoCard('Publisher', publishers)}
            ${renderInfoCard('Subscriber', subscribers)}
        </section>
        ${renderSparklineSection(vertex.name)}
        ${groups.length ? renderGroupedInspector(vertex, groups, selectedEntry) : `<div class="history-empty">No recent message history for this topic yet.</div>`}
    `;
}

function renderActionInspector(vertex, groups, selectedEntry) {
    const actionData = state.latestGraphData?.actions?.find((action) => action.name === vertex.name);
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
    const serviceData = state.latestGraphData?.services?.find((service) => service.name === vertex.name);
    const servers = serviceData?.servers || [];
    const clients = serviceData?.clients || [];
    const serviceTypes = serviceData?.types || [];

    return `
        <section class="entity-info-grid">
            ${renderInfoCard('Servers', servers)}
            ${renderInfoCard('Clients', clients)}
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

function renderLifecycleSection(nodeName) {
    const lcState = state.nodeLifecycleState[nodeName];
    if (!lcState) return '';
    const cssClass = LIFECYCLE_CSS[lcState] ?? 'lc-unconfigured';
    const label = lcState.replace('_', ' ');
    return `
        <div class="lifecycle-status-row">
            <span class="lbl">Lifecycle</span>
            <span class="lifecycle-badge ${cssClass}">${label}</span>
        </div>
    `;
}

function renderParamsSection(nodeName) {
    const params = state.nodeParams[nodeName];
    if (!params) return '';
    const rows = Object.entries(params).map(([k, v]) => `
        <div class="param-row">
            <span class="param-key">${k}</span>
            <span class="param-val">${JSON.stringify(v)}</span>
        </div>
    `).join('');
    return `
        <section class="params-section">
            <div class="params-header">
                <i data-lucide="sliders-horizontal" class="section-icon text-cyan"></i>
                <h3>Parameters</h3>
                <span class="section-count">${Object.keys(params).length}</span>
            </div>
            <div class="params-list">${rows}</div>
        </section>
    `;
}

function renderSparklineSection(topicName) {
    const hzInfo = state.topicHz[topicName];
    const hzStr = hzInfo ? `${hzInfo.hz.toFixed(1)} Hz` : '--';
    const health = hzInfo?.health ?? 'unknown';
    const safeId = topicName.replace(/[^a-zA-Z0-9-_]/g, '_');
    return `
        <section class="sparkline-section">
            <div class="sparkline-header">
                <i data-lucide="activity" class="section-icon"></i>
                <h3>Frequency</h3>
                <span class="hz-badge hz-${health}">${hzStr}</span>
            </div>
            <canvas class="sparkline-canvas" id="sparkline-${safeId}" width="320" height="60"></canvas>
            <div class="sparkline-legend"><span class="sparkline-label">30 s window</span></div>
        </section>
    `;
}

function drawSparkline(topicName) {
    const safeId = topicName.replace(/[^a-zA-Z0-9-_]/g, '_');
    const canvas = document.getElementById(`sparkline-${safeId}`);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const history = state.topicHzHistory[topicName] ?? [];
    if (history.length < 2) {
        ctx.fillStyle = '#64748b';
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Awaiting data…', W / 2, H / 2 + 4);
        return;
    }

    const hzInfo = state.topicHz[topicName];
    const health = hzInfo?.health ?? 'unknown';
    const lineColors  = { stable: '#10b981', jitter: '#f59e0b', stale: '#ef4444', unknown: '#64748b' };
    const fillColors  = { stable: 'rgba(16,185,129,0.15)', jitter: 'rgba(245,158,11,0.15)', stale: 'rgba(239,68,68,0.15)', unknown: 'rgba(100,116,139,0.15)' };
    const lineColor = lineColors[health] ?? lineColors.unknown;
    const fillColor = fillColors[health] ?? fillColors.unknown;

    const now = Date.now();
    const windowMs = 30000;
    const maxHz = Math.max(...history.map(e => e.hz), 1) * 1.15;

    // Faint grid
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
        const y = Math.round(H * i / 3) + 0.5;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Sparkline path
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.shadowColor = lineColor;
    ctx.shadowBlur = 5;
    ctx.lineJoin = 'round';
    ctx.beginPath();

    history.forEach((entry, i) => {
        const x = W * (1 - (now - entry.ts) / windowMs);
        const y = H - (entry.hz / maxHz) * (H - 8) - 4;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Fill area under curve
    ctx.shadowBlur = 0;
    const last = history[history.length - 1];
    const first = history[0];
    ctx.lineTo(W * (1 - (now - last.ts) / windowMs), H);
    ctx.lineTo(W * (1 - (now - first.ts) / windowMs), H);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();

    // Y-axis max label
    ctx.fillStyle = '#64748b';
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.shadowBlur = 0;
    ctx.fillText(`${(maxHz / 1.15).toFixed(1)} Hz`, 3, 11);
}

function renderInfoCard(title, items) {
    const count = items ? items.length : 0;
    const expanded = state.inspectorCardExpanded[title] === true;

    return `
        <details class="entity-info-card" data-card-title="${title}" ${expanded ? 'open' : ''}>
            <summary class="entity-info-summary">
                <i data-lucide="chevron-right" class="entity-info-chevron"></i>
                <span class="entity-info-title">${title}</span>
                <span class="entity-info-count">${count}</span>
            </summary>
            <div class="entity-info-list">
                ${count ? items.map((item) => `<div class="entity-info-row">${item}</div>`).join('') : '<div class="history-empty">None</div>'}
            </div>
        </details>
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
            if (!state.selectedEntityId) {
                return;
            }
            const topicName = details.dataset.topicName;
            getInspectorGroupState(state.selectedEntityId)[topicName] = details.open;
        });
    });

    document.querySelectorAll('.entity-info-card').forEach((details) => {
        details.addEventListener('toggle', () => {
            state.inspectorCardExpanded[details.dataset.cardTitle] = details.open;
        });
    });

    document.querySelectorAll('.history-entry-row').forEach((button) => {
        button.addEventListener('click', () => {
            state.selectedHistoryEntryId = Number(button.dataset.entryId);
            if (state.selectedEntityId && state.vertices[state.selectedEntityId]) {
                inspectEntity(state.vertices[state.selectedEntityId]);
            }
        });
    });
}

function resolveSelectedHistoryEntry(groups) {
    const allEntries = groups.flatMap((group) => group.entries);
    if (allEntries.length === 0) {
        state.selectedHistoryEntryId = null;
        return null;
    }

    if (state.selectedHistoryEntryId !== null) {
        const existing = allEntries.find((entry) => entry.id === state.selectedHistoryEntryId);
        if (existing) {
            return existing;
        }
    }

    state.selectedHistoryEntryId = allEntries[0].id;
    return allEntries[0];
}

function getInspectorGroupState(selectionId) {
    if (!state.inspectorGroupState[selectionId]) {
        state.inspectorGroupState[selectionId] = {};
    }
    return state.inspectorGroupState[selectionId];
}

function getEntityHistoryGroups(vertex) {
    if (!state.latestGraphData) {
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
        state.latestGraphData.topics.forEach((topic) => {
            if (topic.publishers.includes(vertex.name) || topic.subscribers.includes(vertex.name)) {
                addTopicName(topic.name);
            }
        });

        state.latestGraphData.actions.forEach((action) => {
            if (action.servers.includes(vertex.name) || action.clients.includes(vertex.name)) {
                Object.keys(state.messageHistory)
                    .filter((topicName) => topicName.startsWith(`${action.name}/_action/`))
                    .sort((a, b) => (state.topicOrderIndex[a] ?? Number.MAX_SAFE_INTEGER) - (state.topicOrderIndex[b] ?? Number.MAX_SAFE_INTEGER))
                    .forEach((topicName) => addTopicName(topicName));
            }
        });
    }

    if (vertex.type === NODE_TYPES.ACTION) {
        Object.keys(state.messageHistory)
            .filter((topicName) => topicName.startsWith(`${vertex.name}/_action/`))
            .sort((a, b) => (state.topicOrderIndex[a] ?? Number.MAX_SAFE_INTEGER) - (state.topicOrderIndex[b] ?? Number.MAX_SAFE_INTEGER))
            .forEach((topicName) => addTopicName(topicName));
    }

    const orderedTopicNames = topicNames.slice().sort((a, b) => (state.topicOrderIndex[a] ?? Number.MAX_SAFE_INTEGER) - (state.topicOrderIndex[b] ?? Number.MAX_SAFE_INTEGER));
    const groups = orderedTopicNames
        .map((topicName) => ({
            topic: topicName,
            entries: (state.messageHistory[topicName] || []).slice().reverse()
        }))
        .filter((group) => group.entries.length > 0 && isTopicHistoryVisible(group.topic));

    return groups;
}

// --- Drawer / paused-particle lifecycle ---
export function resumeTelemetry() {
    releasePausedParticle();
    state.selectedEntityId = null;
    state.selectedHistoryEntryId = null;
    document.getElementById('inspector-panel').classList.add('collapsed');
}

export function releasePausedParticle() {
    if (state.pausedParticle) {
        state.pausedParticle.paused = false;
        state.pausedParticle.mesh.scale.set(1.0, 1.0, 1.0);
        state.pausedParticle.mesh.material.wireframe = false;
        state.pausedParticle = null;
    }
}

// --- Message history recording ---
export function recordMessageHistory(data) {
    if (state.topicOrderIndex[data.topic] === undefined) {
        state.topicOrderIndex[data.topic] = state.nextTopicOrderIndex++;
    }

    if (!state.messageHistory[data.topic]) {
        state.messageHistory[data.topic] = [];
    }

    state.messageHistory[data.topic].push({
        id: ++state.historyEntrySequence,
        topic: data.topic,
        timestamp: data.timestamp,
        msg_type: data.msg_type,
        payload: data.payload,
        dropped_payload: data.dropped_payload,
        size_bytes: data.size_bytes
    });

    if (state.messageHistory[data.topic].length > MAX_HISTORY_PER_TOPIC) {
        state.messageHistory[data.topic].shift();
    }

    if (state.selectedEntityId && state.vertices[state.selectedEntityId]) {
        inspectEntity(state.vertices[state.selectedEntityId]);
    }
}
