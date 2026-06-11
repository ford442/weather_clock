// Rendering setup: scene, renderer, camera, post-processing, orbit controls
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createRenderer, createPostProcessingPipeline } from './webgpu/index.js';

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

export async function setupRendering() {
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

    // Renderer setup — dual-path (WebGPU preferred, WebGL fallback)
    const canvasContainer = document.getElementById('canvas-container');
    const { renderer, isWebGPU } = await createRenderer(canvasContainer, {
        clearColor: RENDERING_CONFIG.clearColor,
        toneMappingExposure: RENDERING_CONFIG.toneMappingExposure,
        shadowMapType: THREE.PCFSoftShadowMap
    });

    // Post-processing setup — abstracts EffectComposer vs TSL PostProcessing
    const pipeline = await createPostProcessingPipeline(
        renderer,
        scene,
        camera,
        isWebGPU,
        {
            threshold: RENDERING_CONFIG.bloomThreshold,
            strength: RENDERING_CONFIG.bloomStrength,
            radius: RENDERING_CONFIG.bloomRadius
        }
    );

    // Handle window resize
    const handleResize = () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        pipeline.setSize(window.innerWidth, window.innerHeight);
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

    return { scene, camera, renderer, pipeline, clock: new THREE.Clock(), controls, isWebGPU };
}

export { RENDERING_CONFIG };
