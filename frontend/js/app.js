// --- Application Bootstrap & UI Event Wiring ---

import { state, logger, showRuntimeBanner, refreshIcons, updateConnStatus } from './state.js';
import { initThree, gsapScrollTo } from './scene.js';
import { animate } from './graph.js';
import { initWebSocket } from './websocket.js';
import { startLocalSimulation, stopLocalSimulation } from './simulation.js';
import {
    toggleTypeVisibility,
    isolateFromVertex,
    clearIsolation,
    toggleGenericItem,
    updateVisibilityState,
    hideContextMenu,
} from './visibility.js';
import {
    refreshSectionToggles,
    refreshSectionCollapseButtons,
    toggleSectionCollapsed,
    updatePauseButton,
    setScenePaused,
} from './sidebar.js';
import { resumeTelemetry } from './inspector.js';

// --- UI Controls Event Listeners ---
function setupUIEventListeners() {
    // 1. Sidebar Toggle
    const sidebar = document.getElementById('sidebar-panel');
    const toggleBtn = document.getElementById('toggle-sidebar');
    toggleBtn.addEventListener('click', () => {
        const collapsed = sidebar.classList.toggle('collapsed');
        toggleBtn.classList.toggle('collapsed', collapsed);
        const icon = toggleBtn.querySelector('i');
        icon.setAttribute('data-lucide', collapsed ? 'chevron-right' : 'chevron-left');
        refreshIcons();
    });

    // 2. Recenter Camera
    document.getElementById('btn-recenter').addEventListener('click', () => {
        gsapScrollTo(new THREE.Vector3(0, 0, 0));
        // Reset zoom
        state.camera.position.set(0, 15, 25);
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
        state.isSimulationMode = !state.isSimulationMode;
        if (state.isSimulationMode) {
            toggleSimBtn.classList.add('simulating');
            toggleSimBtn.innerHTML = '<i data-lucide="square"></i> Stop Simulation';
            updateConnStatus('simulating', 'SIMULATING');
            // If websocket is disconnected, we can force mock generation locally
            startLocalSimulation();
        } else {
            toggleSimBtn.classList.remove('simulating');
            toggleSimBtn.innerHTML = '<i data-lucide="play"></i> Toggle Simulation';
            const isOpen = state.socket && state.socket.readyState === WebSocket.OPEN;
            updateConnStatus(isOpen ? 'connected' : 'disconnected', isOpen ? 'CONNECTED' : 'DISCONNECTED');
            stopLocalSimulation();
        }
        refreshIcons();
    });

    document.getElementById('btn-toggle-pause').addEventListener('click', () => {
        setScenePaused(!state.isScenePaused);
    });

    document.getElementById('ctx-hide-item').addEventListener('click', () => {
        if (state.contextMenuTargetId) {
            state.itemVisibility[state.contextMenuTargetId] = false;
            updateVisibilityState();
            hideContextMenu();
        }
    });

    document.getElementById('ctx-isolate-item').addEventListener('click', () => {
        if (state.contextMenuTargetId) {
            isolateFromVertex(state.contextMenuTargetId);
            hideContextMenu();
        }
    });

    document.getElementById('ctx-toggle-generic').addEventListener('click', () => {
        if (state.contextMenuTargetId) {
            toggleGenericItem(state.contextMenuTargetId);
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

    refreshIcons();
});
