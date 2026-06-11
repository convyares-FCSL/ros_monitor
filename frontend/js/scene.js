// --- Three.js Scene, Camera, Renderer & Mesh Factories ---

import { state, COLORS, NODE_TYPES, LIFECYCLE_COLORS } from './state.js';
import { onSceneClick, onSceneContextMenu, onPointerDown, onPointerMove, onPointerUp } from './interactions.js';

const container = document.getElementById('canvas-container');

export function initThree() {
    if (!window.THREE) {
        throw new Error('Three.js not loaded');
    }

    state.raycaster = new THREE.Raycaster();
    state.mouse = new THREE.Vector2();

    // 1. Scene
    state.scene = new THREE.Scene();
    state.scene.background = new THREE.Color(COLORS.BG_DARK);
    state.scene.fog = new THREE.FogExp2(COLORS.BG_DARK, 0.012);

    // 2. Camera
    state.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    state.camera.position.set(0, 15, 25);

    // 3. Renderer
    state.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    state.renderer.setPixelRatio(window.devicePixelRatio);
    state.renderer.setSize(window.innerWidth, window.innerHeight);
    state.renderer.shadowMap.enabled = true;
    container.appendChild(state.renderer.domElement);

    // 4. Controls
    state.controls = new THREE.OrbitControls(state.camera, state.renderer.domElement);
    state.controls.enableDamping = true;
    state.controls.dampingFactor = 0.05;
    state.controls.maxDistance = 150;
    state.controls.minDistance = 5;

    // 5. Lighting — tuned for the neural-network aesthetic
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.25);
    state.scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.6);
    keyLight.position.set(20, 40, 20);
    state.scene.add(keyLight);

    // Cool-cyan fill from below/behind to emphasise the glow
    const fillLight = new THREE.DirectionalLight(0x06b6d4, 0.5);
    fillLight.position.set(-20, -10, -20);
    state.scene.add(fillLight);

    // Warm rim light — makes cylinders pop
    const rimLight = new THREE.PointLight(0xa855f7, 0.8, 60);
    rimLight.position.set(0, 25, -10);
    state.scene.add(rimLight);

    // 6. Floor grid
    const gridHelper = new THREE.GridHelper(100, 50, 0x1e293b, 0x0f172a);
    gridHelper.position.y = -8;
    state.scene.add(gridHelper);

    // 7. Starfield
    createStarfield();

    // 8. Post-processing: bloom via EffectComposer + UnrealBloomPass (r128 bundle)
    if (THREE.EffectComposer) {
        try {
            const renderPass = new THREE.RenderPass(state.scene, state.camera);
            const bloomPass = new THREE.UnrealBloomPass(
                new THREE.Vector2(window.innerWidth, window.innerHeight),
                0.9,   // strength
                0.55,  // radius
                0.35   // luminance threshold
            );
            const outputPass = new THREE.ShaderPass(THREE.CopyShader);

            state.composer = new THREE.EffectComposer(state.renderer);
            state.composer.addPass(renderPass);
            state.composer.addPass(bloomPass);
            state.composer.addPass(outputPass);
        } catch (e) {
            console.warn('[bloom] EffectComposer setup failed, disabling bloom:', e.message);
            state.composer = null;
        }
    }

    // 9. Events
    window.addEventListener('resize', onWindowResize);
    window.addEventListener('click', onSceneClick);
    window.addEventListener('contextmenu', onSceneContextMenu);
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);
}

function createStarfield() {
    const starCount = 1500;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount * 3; i += 3) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(Math.random() * 2 - 1);
        const radius = 80 + Math.random() * 60;

        positions[i]     = radius * Math.sin(phi) * Math.cos(theta);
        positions[i + 1] = radius * Math.sin(phi) * Math.sin(theta);
        positions[i + 2] = radius * Math.cos(phi);

        const c = 0.7 + Math.random() * 0.3;
        colors[i] = c * 0.8; colors[i + 1] = c * 0.9; colors[i + 2] = c;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color',    new THREE.BufferAttribute(colors, 3));

    state.scene.add(new THREE.Points(geometry, new THREE.PointsMaterial({
        size: 0.8, vertexColors: true, transparent: true, opacity: 0.65
    })));
}

// ---------------------------------------------------------------------------
// Geometry taxonomy by functional role
// ---------------------------------------------------------------------------

/**
 * NODE  → Large prominent cylinder (infrastructure hub).
 * TOPIC → Minimal semi-transparent sphere (the artery lines ARE the visual).
 * SERVICE → Hexagonal prism (sharp, staccato structure).
 * ACTION is handled by createActionOrbital() below.
 */
export function createMeshForType(type) {
    let geom, mat;

    switch (type) {
        case NODE_TYPES.NODE:
            geom = new THREE.CylinderGeometry(1.0, 1.0, 2.0, 20);
            mat = new THREE.MeshStandardMaterial({
                color: COLORS[type],
                metalness: 0.78,
                roughness: 0.12,
                // Default emissive = unconfigured cool blue-grey; animate() drives intensity
                emissive: new THREE.Color(0x4a6fa5),
                emissiveIntensity: 0.08,
            });
            break;

        case NODE_TYPES.TOPIC:
            geom = new THREE.SphereGeometry(0.7, 14, 14);
            mat = new THREE.MeshStandardMaterial({
                color: COLORS[type],
                metalness: 0.1,
                roughness: 0.65,
                emissive: COLORS[type],
                emissiveIntensity: 0.4,
                transparent: true,
                opacity: 0.85,
                depthWrite: false,
            });
            break;

        case NODE_TYPES.SERVICE:
            // Fallback only (service with no known server) — small free diamond
            geom = new THREE.OctahedronGeometry(0.3);
            mat = new THREE.MeshBasicMaterial({
                color: COLORS[type],
                transparent: true,
                opacity: 0.4,
                depthWrite: false,
            });
            break;

        default:
            geom = new THREE.SphereGeometry(0.5, 12, 12);
            mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
            break;
    }

    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}

export const SERVICE_PORT_IDLE_OPACITY   = 0.22;
export const SERVICE_PORT_ACTIVE_OPACITY = 0.6;

/**
 * Service port: tiny diamond docked on a ring orbiting the host node.
 * Idle ports are dim surface detail; they flare to full brightness on call.
 */
export function createServicePortMesh() {
    const mesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.18),
        new THREE.MeshBasicMaterial({
            color: COLORS[NODE_TYPES.SERVICE],
            transparent: true,
            opacity: SERVICE_PORT_IDLE_OPACITY,
            depthWrite: false,
        })
    );
    mesh.castShadow = false;
    return mesh;
}

/**
 * Action Orbital: inner core sphere + outer torus ring.
 * The two meshes are independent so the core can swell while the ring
 * maintains constant world-space size as a fixed reference frame.
 *
 * Ring raycasting is disabled so only the core sphere receives click events.
 */
export function createActionOrbital() {
    const coreMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 18, 18),
        new THREE.MeshStandardMaterial({
            color: COLORS[NODE_TYPES.ACTION],
            metalness: 0.6,
            roughness: 0.25,
            emissive: COLORS[NODE_TYPES.ACTION],
            emissiveIntensity: 0.3,
        })
    );
    coreMesh.castShadow = true;

    const ringMesh = new THREE.Mesh(
        new THREE.TorusGeometry(0.92, 0.055, 8, 48),
        new THREE.MeshStandardMaterial({
            color: COLORS[NODE_TYPES.ACTION],
            metalness: 0.92,
            roughness: 0.06,
            emissive: COLORS[NODE_TYPES.ACTION],
            emissiveIntensity: 0.45,
            transparent: true,
            opacity: 0.72,
        })
    );
    ringMesh.castShadow = false;
    // The ring must not consume raycaster hits — core is the interaction target
    ringMesh.raycast = () => {};

    return { coreMesh, ringMesh };
}

// ---------------------------------------------------------------------------
// Lifecycle state colour mapping
// ---------------------------------------------------------------------------

/**
 * Set the emissive colour and base mesh colour for a node's lifecycle state.
 * The animate() loop in graph.js owns intensity modulation (pulsing, strobing).
 *
 * Official ROS 2 managed-node states:
 *   unconfigured → inactive → active → (shuttingdown) → finalized
 *   Any state can reach error_processing.
 */
export function updateNodeLifecycleColor(vertex, lifecycleState) {
    const mat = vertex.mesh.material;
    if (!mat) return;

    const LC = {
        unconfigured:     { emissive: 0x4a6fa5, base: COLORS[NODE_TYPES.NODE] },
        inactive:         { emissive: 0xf59e0b, base: COLORS[NODE_TYPES.NODE] },
        active:           { emissive: 0x06b6d4, base: COLORS[NODE_TYPES.NODE] },
        shuttingdown:     { emissive: 0xef4444, base: 0xef4444 },
        shutting_down:    { emissive: 0xef4444, base: 0xef4444 },
        error_processing: { emissive: 0xef4444, base: 0xef4444 },
        error:            { emissive: 0xef4444, base: 0xef4444 },
        finalized:        { emissive: 0x4a6fa5, base: COLORS[NODE_TYPES.NODE] },
    };

    const cfg = LC[lifecycleState] ?? LC.unconfigured;
    mat.emissive.setHex(cfg.emissive);
    mat.color.setHex(cfg.base);
    // Neutral starting intensity; animate() drives it each frame
    mat.emissiveIntensity = 0.1;
}

// ---------------------------------------------------------------------------
// Hz sprite helpers (unchanged from Phase 1)
// ---------------------------------------------------------------------------

export function createHzSprite() {
    return _buildHzSprite('--', 'unknown');
}

export function updateHzSprite(vertex, hz, health) {
    if (!vertex.hzSprite) return;
    const text = hz != null ? `${hz.toFixed(1)} Hz` : '--';
    const newMap = _hzCanvasTexture(text, health);
    if (vertex.hzSprite.material.map) vertex.hzSprite.material.map.dispose();
    vertex.hzSprite.material.map = newMap;
    vertex.hzSprite.material.needsUpdate = true;
}

function _buildHzSprite(text, health) {
    const mat = new THREE.SpriteMaterial({ map: _hzCanvasTexture(text, health), transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(3.5, 0.7, 1);
    return sprite;
}

function _hzCanvasTexture(text, health) {
    const cssColors = { stable: '#10b981', jitter: '#f59e0b', stale: '#ef4444', unknown: '#64748b' };
    const color = cssColors[health] ?? cssColors.unknown;
    const canvas = document.createElement('canvas');
    canvas.width = 160; canvas.height = 36;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 160, 36);
    ctx.font = 'bold 15px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = color;
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 4;
    ctx.fillText(text, 80, 24);
    return new THREE.CanvasTexture(canvas);
}

// ---------------------------------------------------------------------------
// Label sprite
// ---------------------------------------------------------------------------

export function createLabelSprite(text, colorHex) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 64);
    ctx.font = 'bold 20px "Outfit", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#' + colorHex.toString(16).padStart(6, '0');
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 2;
    ctx.fillText(text, 128, 30);
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(6, 1.5, 1);
    return sprite;
}

// ---------------------------------------------------------------------------
// Resize helper + camera transition
// ---------------------------------------------------------------------------

export function onWindowResize() {
    state.camera.aspect = window.innerWidth / window.innerHeight;
    state.camera.updateProjectionMatrix();
    state.renderer.setSize(window.innerWidth, window.innerHeight);
    if (state.composer) state.composer.setSize(window.innerWidth, window.innerHeight);
    // Keep Line2 shader resolution in sync so thick-line width stays accurate
    const res = new THREE.Vector2(window.innerWidth, window.innerHeight);
    state.links.forEach(link => {
        if (link.lineMesh.material.resolution) link.lineMesh.material.resolution.copy(res);
    });
}

export function gsapScrollTo(targetPos) {
    const duration = 25;
    let frame = 0;
    const startTarget = state.controls.target.clone();
    function step() {
        if (frame <= duration) {
            const ease = 1 - Math.pow(1 - frame / duration, 3);
            state.controls.target.lerpVectors(startTarget, targetPos, ease);
            frame++;
            requestAnimationFrame(step);
        }
    }
    step();
}
