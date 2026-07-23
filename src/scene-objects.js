// Scene objects: sky, sundial, moon, weather effects
import { Sky } from 'three/addons/objects/Sky.js';
import { createSundial } from './sundial.js';
import { calculateMoonPhase, createMoon } from './moonPhase.js';
import { WeatherEffects } from './effects/weather-effects.js';
import { GroundEffects } from './effects/ground-effects.js';
import { createGround } from './ground.js';
import { getQualityTier } from './rendering.js';

const SKY_CONFIG = {
    scale: 450000,
    turbidity: 10,
    rayleigh: 3,
    mieCoefficient: 0.005,
    mieDirectionalG: 0.7
};

export function setupSky() {
    const sky = new Sky();
    sky.scale.setScalar(SKY_CONFIG.scale);
    sky.renderOrder = -1;

    const skyUniforms = sky.material.uniforms;
    skyUniforms['turbidity'].value = SKY_CONFIG.turbidity;
    skyUniforms['rayleigh'].value = SKY_CONFIG.rayleigh;
    skyUniforms['mieCoefficient'].value = SKY_CONFIG.mieCoefficient;
    skyUniforms['mieDirectionalG'].value = SKY_CONFIG.mieDirectionalG;

    // Disable fog on sky material
    sky.material.depthWrite = false;
    sky.material.fog = false;
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

export async function setupWeatherEffects(scene, sundial, camera, isWebGPU = false, renderer = null) {
    const quality = getQualityTier();
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

export { SKY_CONFIG };
