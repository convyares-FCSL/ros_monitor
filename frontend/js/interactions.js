// --- Click / Right-Click Raycasting Interaction Handlers ---

import { state } from './state.js';
import { inspectParticle, inspectEntity } from './inspector.js';
import { hideContextMenu, showContextMenu } from './visibility.js';

export function onSceneClick(event) {
    // Only raycast if the click occurred on the 3D canvas (not on HUD overlay panels)
    if (event.target !== state.renderer.domElement) return;

    hideContextMenu();

    // Calculate mouse position in normalized device coordinates
    state.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    state.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    state.raycaster.setFromCamera(state.mouse, state.camera);

    // Filter mesh targets from our active particles list
    const particleTargets = state.activeParticles.map(p => p.mesh);
    const particleIntersects = state.raycaster.intersectObjects(particleTargets);

    if (particleIntersects.length > 0) {
        // Find matching particle
        const hitMesh = particleIntersects[0].object;
        const clickedParticle = state.activeParticles.find(p => p.mesh === hitMesh);

        if (clickedParticle) {
            inspectParticle(clickedParticle);
            return;
        }
    }

    const vertexTargets = Object.values(state.vertices).filter((vertex) => vertex.mesh.visible).map((vertex) => vertex.mesh);
    const vertexIntersects = state.raycaster.intersectObjects(vertexTargets);
    if (vertexIntersects.length > 0) {
        const hitVertexId = vertexIntersects[0].object.userData.vertexId;
        if (hitVertexId && state.vertices[hitVertexId]) {
            inspectEntity(state.vertices[hitVertexId]);
        }
    }
}

export function onSceneContextMenu(event) {
    if (!state.renderer || event.target !== state.renderer.domElement) {
        hideContextMenu();
        return;
    }

    event.preventDefault();

    if (state.rightClickMoved) {
        hideContextMenu();
        return;
    }
    state.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    state.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    state.raycaster.setFromCamera(state.mouse, state.camera);

    const vertexTargets = Object.values(state.vertices).filter((vertex) => vertex.mesh.visible).map((vertex) => vertex.mesh);
    const vertexIntersects = state.raycaster.intersectObjects(vertexTargets);
    if (vertexIntersects.length === 0) {
        hideContextMenu();
        return;
    }

    const hitVertexId = vertexIntersects[0].object.userData.vertexId;
    if (hitVertexId && state.vertices[hitVertexId]) {
        showContextMenu(hitVertexId, event.clientX, event.clientY);
    }
}

export function onPointerDown(event) {
    if (!state.renderer || event.target !== state.renderer.domElement || event.button !== 2) {
        return;
    }

    state.rightClickStart = { x: event.clientX, y: event.clientY };
    state.rightClickMoved = false;
}

export function onPointerMove(event) {
    if (!state.rightClickStart) {
        return;
    }

    const dx = event.clientX - state.rightClickStart.x;
    const dy = event.clientY - state.rightClickStart.y;
    if (Math.hypot(dx, dy) > 6) {
        state.rightClickMoved = true;
    }
}

export function onPointerUp(event) {
    if (event.button === 2) {
        setTimeout(() => {
            state.rightClickStart = null;
            state.rightClickMoved = false;
        }, 0);
    }
}
