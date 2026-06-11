// Rendering setup: scene, renderer, camera, post-processing, orbit controls
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createRenderer, createPostProcessingPipeline } from './webgpu/index.js';

// Quality configuration
export const QUALITY_CONFIG = {
    low: {
        pixelRatioCap: 1.0,
        disableBloom: true,
        bloomStrengthMultiplier: 0.0,
        shadowMapSize: 1024,
        particleDivisor: 3
    },
    medium: {
        pixelRatioCap: 1.5,
        disableBloom: false,
        bloomStrengthMultiplier: 0.5,
        shadowMapSize: 2048,
        particleDivisor: 2
    },
    high: {
        pixelRatioCap: 999.0, // Uncapped
        disableBloom: false,
        bloomStrengthMultiplier: 1.0,
        shadowMapSize: 2048,
        particleDivisor: 1
    }
};

export function getQualityTier() {
    if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem('weatherclock_quality');
        if (saved && ['high', 'medium', 'low'].includes(saved)) {
            return saved;
        }
    }

    // Auto-detect based on hardware specs and touch
    let cores = 4;
    let memory = 4;
    let hasTouch = false;

    if (typeof navigator !== 'undefined') {
        cores = navigator.hardwareConcurrency || 4;
        memory = navigator.deviceMemory || 4;
        hasTouch = navigator.maxTouchPoints > 0 || ('ontouchstart' in window);
    }

    // If it's a mobile device/touch or lower hardware:
    if (hasTouch || cores < 4 || memory < 4) {
        if (cores <= 4 || memory < 3) {
            return 'low';
        }
        return 'medium';
    }

    return 'high';
}

export function setQualityTier(tier) {
    if (typeof localStorage !== 'undefined') {
        localStorage.setItem('weatherclock_quality', tier);
    }
}

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
    const quality = getQualityTier();
    const config = QUALITY_CONFIG[quality];

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

    // Set pixel ratio capped by config
    const dpr = window.devicePixelRatio || 1;
    const cappedDpr = Math.min(dpr, config.pixelRatioCap);
    renderer.setPixelRatio(cappedDpr);

    // Post-processing setup — abstracts EffectComposer vs TSL PostProcessing
    const pipeline = await createPostProcessingPipeline(
        renderer,
        scene,
        camera,
        isWebGPU,
        {
            threshold: RENDERING_CONFIG.bloomThreshold,
            strength: config.disableBloom ? 0 : RENDERING_CONFIG.bloomStrength * config.bloomStrengthMultiplier,
            radius: RENDERING_CONFIG.bloomRadius,
            disableBloom: config.disableBloom
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
