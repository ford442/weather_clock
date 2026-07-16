// Rendering setup: scene, renderer, camera, post-processing, orbit controls
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createRenderer, createPostProcessingPipeline, requestWebGLFallback } from './webgpu/index.js';

// Quality configuration
/** @type {Record<QualityTier, {pixelRatioCap: number, disableBloom: boolean, bloomStrengthMultiplier: number, shadowMapSize: number, moonShadowMapSize: number, particleDivisor: number}>} */
export const QUALITY_CONFIG = {
    low: {
        pixelRatioCap: 1.0,
        disableBloom: true,
        bloomStrengthMultiplier: 0.0,
        shadowMapSize: 1024,
        moonShadowMapSize: 512,
        particleDivisor: 3
    },
    medium: {
        pixelRatioCap: 1.5,
        disableBloom: false,
        bloomStrengthMultiplier: 0.5,
        shadowMapSize: 2048,
        moonShadowMapSize: 1024,
        particleDivisor: 2
    },
    high: {
        pixelRatioCap: 2.0,
        disableBloom: false,
        bloomStrengthMultiplier: 1.0,
        shadowMapSize: 2048,
        moonShadowMapSize: 1024,
        particleDivisor: 1
    }
};

/** @returns {QualityTier} */
export function getQualityTier() {
    if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem('weatherclock_quality');
        if (saved && ['high', 'medium', 'low'].includes(saved)) {
            return /** @type {QualityTier} */ (saved);
        }
    }

    // Auto-detect based on hardware specs and touch
    let cores = 4;
    let memory = 4;
    let hasTouch = false;

    if (typeof navigator !== 'undefined') {
        cores = navigator.hardwareConcurrency || 4;
        memory = navigator.deviceMemory || 4;
        hasTouch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
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

/** @param {QualityTier} tier */
export function setQualityTier(tier) {
    if (!QUALITY_CONFIG[tier]) {
        throw new Error(`Unknown quality tier: ${tier}`);
    }
    if (typeof localStorage !== 'undefined') {
        localStorage.setItem('weatherclock_quality', tier);
    }
}

function resizeShadowMap(light, size) {
    if (!light?.shadow || light.shadow.mapSize.width === size) return;

    light.shadow.mapSize.set(size, size);
    light.shadow.map?.dispose?.();
    light.shadow.map = null;
    light.shadow.needsUpdate = true;
}

/** Apply every runtime-safe part of a quality tier without recreating the app. */
export async function applyQualityTier(tier, scene3d) {
    const config = QUALITY_CONFIG[tier];
    if (!config) {
        throw new Error(`Unknown quality tier: ${tier}`);
    }

    const { renderer, pipeline, sunLight, moonLight, weatherEffects } = scene3d;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const pixelRatio = Math.min(dpr, config.pixelRatioCap);
    renderer.setPixelRatio(pixelRatio);
    pipeline.setPixelRatio?.(pixelRatio);
    pipeline.setSize(window.innerWidth, window.innerHeight);
    pipeline.setBloom?.({
        enabled: !config.disableBloom,
        threshold: RENDERING_CONFIG.bloomThreshold,
        strength: RENDERING_CONFIG.bloomStrength * config.bloomStrengthMultiplier,
        radius: RENDERING_CONFIG.bloomRadius
    });

    resizeShadowMap(sunLight, config.shadowMapSize);
    resizeShadowMap(moonLight, config.moonShadowMapSize);
    await weatherEffects.setQuality?.(tier, config.particleDivisor);
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
    bloomRadius: 0.5
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
    camera.lookAt(RENDERING_CONFIG.cameraLookAt.x, RENDERING_CONFIG.cameraLookAt.y, RENDERING_CONFIG.cameraLookAt.z);

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
    const pipeline = await createPostProcessingPipeline(renderer, scene, camera, isWebGPU, {
        threshold: RENDERING_CONFIG.bloomThreshold,
        strength: config.disableBloom ? 0 : RENDERING_CONFIG.bloomStrength * config.bloomStrengthMultiplier,
        radius: RENDERING_CONFIG.bloomRadius,
        disableBloom: config.disableBloom
    });

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

/**
 * Coordinate renderer loss with the central animation loop.
 * Three.js rebuilds WebGL resources before our restore listener runs; the
 * resize calls below then recreate post-processing targets at the active DPR.
 */
/**
 * @param {Object} scene3d
 * @param {import('./animation.js').AnimationController} animationController
 * @param {{showToast?: (message: string, type?: 'error'|'info'|'success'|'warning', durationMs?: number) => void}} [options]
 */
export function setupRendererRecovery(scene3d, animationController, { showToast = () => {} } = {}) {
    const { renderer, pipeline, isWebGPU } = scene3d;
    let disposed = false;
    let contextLost = false;

    const failRecovery = (message, error) => {
        console.error(message, error);
        showToast('Graphics recovery failed. Reload the page to continue.', 'error', 8000);
    };

    const handleContextLost = (event) => {
        event.preventDefault();
        contextLost = true;
        animationController.suspend('graphics-context');
        console.warn('[Rendering] WebGL context lost; waiting for restoration.');
    };

    const handleContextRestored = () => {
        if (!contextLost || disposed) return;
        try {
            renderer.resetState?.();
            renderer.setSize(window.innerWidth, window.innerHeight);
            pipeline.setSize(window.innerWidth, window.innerHeight);
            contextLost = false;
            animationController.resume('graphics-context');
            console.info('[Rendering] WebGL context restored.');
        } catch (error) {
            failRecovery('[Rendering] WebGL context restoration failed:', error);
        }
    };

    if (!isWebGPU) {
        renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
        renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);
    } else {
        const deviceLost = renderer.backend?.device?.lost;
        if (deviceLost?.then) {
            deviceLost
                .then((info) => {
                    if (disposed) return;
                    animationController.suspend('graphics-context');
                    console.warn('[Rendering] WebGPU device lost; reinitializing with WebGL:', info);
                    showToast('Graphics device reset. Recovering with WebGL…', 'warning', 5000);
                    try {
                        requestWebGLFallback();
                    } catch (error) {
                        failRecovery('[Rendering] WebGPU fallback reinitialization failed:', error);
                    }
                })
                .catch((error) => {
                    if (!disposed) failRecovery('[Rendering] WebGPU device-loss handler failed:', error);
                });
        } else {
            console.warn('[Rendering] WebGPU device loss promise is unavailable.');
        }
    }

    return () => {
        disposed = true;
        renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
        renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);
    };
}

export { RENDERING_CONFIG };
