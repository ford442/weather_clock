// Rendering setup: scene, renderer, camera, post-processing, orbit controls
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Configuration constants
const RENDERING_CONFIG = {
    fogColor: 0xaaaaaa,
    fogDensity: 0.0001,
    cameraNear: 0.1,
    cameraFar: 2000000,
    cameraFOV: 75,
    cameraPosition: { x: 0, y: 5, z: 8 },
    cameraLookAt: { x: 0, y: 0, z: 0 },
    clearColor: 0x000000,
    toneMappingExposure: 0.5,
    shadowMapSize: 2048,
    bloomThreshold: 0.85,
    bloomStrength: 0.5,
    bloomRadius: 0.5,
};

export function setupRendering() {
    // Scene setup
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(RENDERING_CONFIG.fogColor, RENDERING_CONFIG.fogDensity);

    // Camera setup
    const camera = new THREE.PerspectiveCamera(
        RENDERING_CONFIG.cameraFOV,
        window.innerWidth / window.innerHeight,
        RENDERING_CONFIG.cameraNear,
        RENDERING_CONFIG.cameraFar
    );
    camera.position.set(
        RENDERING_CONFIG.cameraPosition.x,
        RENDERING_CONFIG.cameraPosition.y,
        RENDERING_CONFIG.cameraPosition.z
    );
    camera.lookAt(
        RENDERING_CONFIG.cameraLookAt.x,
        RENDERING_CONFIG.cameraLookAt.y,
        RENDERING_CONFIG.cameraLookAt.z
    );

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setClearColor(RENDERING_CONFIG.clearColor);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = RENDERING_CONFIG.toneMappingExposure;
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    // Post-processing setup
    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        1.5,
        0.4,
        0.85
    );
    bloomPass.threshold = RENDERING_CONFIG.bloomThreshold;
    bloomPass.strength = RENDERING_CONFIG.bloomStrength;
    bloomPass.radius = RENDERING_CONFIG.bloomRadius;
    composer.addPass(bloomPass);

    // Handle window resize
    const handleResize = () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        composer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    // Orbit controls — lets the user drag to explore the scene
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.minDistance = 4;
    controls.maxDistance = 30;
    controls.maxPolarAngle = Math.PI / 2; // Don't go below ground
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    return { scene, camera, renderer, composer, clock: new THREE.Clock(), controls };
}

export { RENDERING_CONFIG };
