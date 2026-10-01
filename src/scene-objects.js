// Scene objects: sky, sundial, moon, weather effects
import * as THREE from 'three';
import { createSundial } from './sundial.js';
import { calculateMoonPhase, createMoon } from './moonPhase.js';
import { WeatherEffects } from './effects/weather-effects.js';
import { GroundEffects } from './effects/ground-effects.js';
import { createGround } from './ground.js';
import { getQualityTier } from './rendering.js';
import { SCENE_LAYOUT } from './scene-layout.js';

import { createSkyMaterial, createSkyMaterialWebGPU } from './webgpu/materials/SkyMaterial.js';

/**
 * Build the atmosphere dome: an inside-out unit box scaled to
 * `SCENE_LAYOUT.sky.scale`, carrying the in-repo dual-backend Preetham
 * material (see `webgpu/materials/SkyMaterial.js`). The material never touches
 * depth, so the sky can sit under a logarithmic depth buffer and bloom.
 *
 * @param {boolean} [isWebGPU]
 * @returns {Promise<THREE.Mesh & {material: THREE.Material & {uniforms: Record<string, {value: any}>}}>}
 */
export async function setupSky(isWebGPU = false) {
    const material = isWebGPU ? await createSkyMaterialWebGPU() : createSkyMaterial();
    const sky = /** @type {THREE.Mesh & {material: THREE.Material & {uniforms: Record<string, {value: any}>}}} */ (
        new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material)
    );
    sky.name = 'AetherSky';
    sky.scale.setScalar(SCENE_LAYOUT.sky.scale);
    // Drawn before everything else; depth test/write are off on the material.
    sky.renderOrder = -1;
    sky.frustumCulled = false;
    return sky;
}

export function setupSundial() {
    const sundial = createSundial();
    return sundial;
}

export function setupMoon() {
    const moonPhaseData = calculateMoonPhase();
    const moonGroup = createMoon(moonPhaseData.phase);
    return { moonGroup, moonPhaseData };
}

/**
 * Build the weather-effect stack for the active backend.
 *
 * Particle systems are the one place the two backends diverge structurally:
 *  - WebGL: `RainSystem` / `SnowSystem` / `SplashSystem` step particles on the CPU
 *    (native kernels) and draw them with `ShaderMaterial`s.
 *  - WebGPU: `GPURainSystem` / `GPUSnowSystem` / `GPUSplashSystem` own both the TSL
 *    compute kernels and their node materials. The WebGL classes above are never
 *    constructed in this mode, and have no WebGPU code path of their own.
 *
 * Everything else (clouds, stars, ground, sundial) is one class per feature that
 * swaps its material in `initWebGPU()`. See `docs/WEBGPU_ARCHITECTURE.md`.
 */
export async function setupWeatherEffects(scene, sundial, camera, isWebGPU = false, renderer = null) {
    const quality = getQualityTier();
    /** @type {{RainSystem: new (...args: any[]) => any, SnowSystem: new (...args: any[]) => any, SplashSystem: new (...args: any[]) => any}|null} */
    let gpuClasses = null;
    if (isWebGPU) {
        const [{ GPURainSystem }, { GPUSnowSystem }, { GPUSplashSystem }] = await Promise.all([
            import('./effects/gpu-rain-system.js'),
            import('./effects/gpu-snow-system.js'),
            import('./effects/gpu-splash-system.js')
        ]);
        gpuClasses = { RainSystem: GPURainSystem, SnowSystem: GPUSnowSystem, SplashSystem: GPUSplashSystem };
    }
    const effects = new WeatherEffects(scene, sundial.group, camera, quality, { isWebGPU, renderer, gpuClasses });
    if (isWebGPU) {
        await effects.initWebGPU();
    }
    return effects;
}

export function setupGround(isWebGPU = false) {
    return createGround(isWebGPU);
}

/**
 * @param {import('three').Scene} scene
 * @param {ReturnType<typeof createGround>} ground
 * @param {ReturnType<typeof createSundial>} sundial
 * @param {import('three').Camera} camera
 * @param {import('three').WebGLRenderer|import('three/webgpu').WebGPURenderer} renderer
 * @param {boolean} isWebGPU
 */
export async function setupGroundEffects(scene, ground, sundial, camera, renderer, isWebGPU = false) {
    const groundEffects = new GroundEffects(scene, ground, sundial, camera, renderer, isWebGPU);
    await groundEffects.init();
    return groundEffects;
}

export function addToScene(scene, { sky, sundial, moonGroup, ground }) {
    scene.add(sky);
    scene.add(sundial.group);
    scene.add(moonGroup);
    if (ground) scene.add(ground.mesh);
}

export { SKY_MATERIAL_CONFIG as SKY_CONFIG } from './webgpu/materials/SkyMaterial.js';
