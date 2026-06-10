// --- Three.js Scene, Camera, Renderer & Mesh Factories ---

import { state, COLORS, NODE_TYPES } from './state.js';
import { onSceneClick, onSceneContextMenu, onPointerDown, onPointerMove, onPointerUp } from './interactions.js';

const container = document.getElementById('canvas-container');

export function initThree() {
    if (!window.THREE) {
        throw new Error('Three.js not loaded');
    }

    state.raycaster = new THREE.Raycaster();
    state.mouse = new THREE.Vector2();

    // 1. Scene Setup
    state.scene = new THREE.Scene();
    state.scene.background = new THREE.Color(COLORS.BG_DARK);
    state.scene.fog = new THREE.FogExp2(COLORS.BG_DARK, 0.015);

    // 2. Camera Setup
    state.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    state.camera.position.set(0, 15, 25);

    // 3. Renderer Setup
    state.renderer = new THREE.WebGLRenderer({ antialias: true });
    state.renderer.setPixelRatio(window.devicePixelRatio);
    state.renderer.setSize(window.innerWidth, window.innerHeight);
    state.renderer.shadowMap.enabled = true;
    container.appendChild(state.renderer.domElement);

    // 4. Controls Setup
    state.controls = new THREE.OrbitControls(state.camera, state.renderer.domElement);
    state.controls.enableDamping = true;
    state.controls.dampingFactor = 0.05;
    state.controls.maxDistance = 150;
    state.controls.minDistance = 5;

    // 5. Lighting Setup
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.35);
    state.scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.7);
    dirLight1.position.set(20, 40, 20);
    state.scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x06b6d4, 0.4);
    dirLight2.position.set(-20, -10, -20);
    state.scene.add(dirLight2);

    // 6. Floor Grid (anchors the scene visually)
    const gridHelper = new THREE.GridHelper(100, 50, 0x1e293b, 0x0f172a);
    gridHelper.position.y = -8;
    state.scene.add(gridHelper);

    // 7. Immersive Space Starfield
    createStarfield();

    // 8. Event Listeners
    window.addEventListener('resize', onWindowResize);
    window.addEventListener('click', onSceneClick);
    window.addEventListener('contextmenu', onSceneContextMenu);
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);
}

// Create a starfield background
function createStarfield() {
    const starCount = 1500;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount * 3; i += 3) {
        // Distribute in a shell far away
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(Math.random() * 2 - 1);
        const radius = 80 + Math.random() * 60;

        positions[i] = radius * Math.sin(phi) * Math.cos(theta);
        positions[i + 1] = radius * Math.sin(phi) * Math.sin(theta);
        positions[i + 2] = radius * Math.cos(phi);

        // Add subtle blue-ish/white colors
        const colorVal = 0.7 + Math.random() * 0.3;
        colors[i] = colorVal * 0.8;
        colors[i + 1] = colorVal * 0.9;
        colors[i + 2] = colorVal;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
        size: 0.8,
        vertexColors: true,
        transparent: true,
        opacity: 0.7
    });

    const starfield = new THREE.Points(geometry, material);
    state.scene.add(starfield);
}

// Create geometrical representation based on graph category
export function createMeshForType(type) {
    let geom, mat;

    switch (type) {
        case NODE_TYPES.NODE:
            // Cylinder for Nodes
            geom = new THREE.CylinderGeometry(0.8, 0.8, 1.6, 16);
            mat = new THREE.MeshStandardMaterial({
                color: COLORS[type],
                metalness: 0.7,
                roughness: 0.2,
                emissive: COLORS[type],
                emissiveIntensity: 0.15
            });
            break;

        case NODE_TYPES.TOPIC:
            // Spheres for Topics
            geom = new THREE.SphereGeometry(0.5, 16, 16);
            mat = new THREE.MeshStandardMaterial({
                color: COLORS[type],
                metalness: 0.1,
                roughness: 0.5,
                emissive: COLORS[type],
                emissiveIntensity: 0.2
            });
            break;

        case NODE_TYPES.SERVICE:
            // Cubes for Services
            geom = new THREE.BoxGeometry(0.8, 0.8, 0.8);
            mat = new THREE.MeshStandardMaterial({
                color: COLORS[type],
                metalness: 0.4,
                roughness: 0.3,
                emissive: COLORS[type],
                emissiveIntensity: 0.25
            });
            break;

        case NODE_TYPES.ACTION:
            // Purple Icosahedron for Action Clusters
            geom = new THREE.IcosahedronGeometry(0.7, 1);
            mat = new THREE.MeshStandardMaterial({
                color: COLORS[type],
                metalness: 0.8,
                roughness: 0.15,
                emissive: COLORS[type],
                emissiveIntensity: 0.3
            });
            break;
    }

    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}

// Generate canvas texture sprite for sharp text labels
export function createLabelSprite(text, colorHex) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    // Transparent background
    ctx.clearRect(0, 0, 256, 64);

    // Draw Text with clean fonts
    ctx.font = 'bold 20px "Outfit", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#' + colorHex.toString(16).padStart(6, '0');

    // Drop shadow text
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 2;
    ctx.fillText(text, 128, 30);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(material);

    // Scaling
    sprite.scale.set(6, 1.5, 1);
    return sprite;
}

// Handle window resizing
export function onWindowResize() {
    state.camera.aspect = window.innerWidth / window.innerHeight;
    state.camera.updateProjectionMatrix();
    state.renderer.setSize(window.innerWidth, window.innerHeight);
}

// Smooth camera target transition
export function gsapScrollTo(targetPos) {
    const duration = 25; // animation frames
    let frame = 0;

    const startTarget = state.controls.target.clone();

    function step() {
        if (frame <= duration) {
            const t = frame / duration;
            // Smooth ease Out
            const ease = 1 - Math.pow(1 - t, 3);

            state.controls.target.lerpVectors(startTarget, targetPos, ease);
            frame++;
            requestAnimationFrame(step);
        }
    }
    step();
}
