// Scene objects: sky, sundial, moon, weather effects
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { createSundial } from './sundial.js';
import { calculateMoonPhase, createMoon } from './moonPhase.js';
import { WeatherEffects } from './weatherEffects.js';

const SKY_CONFIG = {
    scale: 450000,
    turbidity: 10,
    rayleigh: 3,
    mieCoefficient: 0.005,
    mieDirectionalG: 0.7,
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

export function setupWeatherEffects(scene, sundial, camera) {
    return new WeatherEffects(scene, sundial.group, camera);
}

export function addToScene(scene, { sky, sundial, moonGroup }) {
    scene.add(sky);
    scene.add(sundial.group);
    scene.add(moonGroup);
}

export { SKY_CONFIG };
