// Lighting setup: sun, moon, and ambient lights
import * as THREE from 'three';

const LIGHTS_CONFIG = {
    ambientColor: 0xffffff,
    ambientIntensity: 0.4,
    sunColor: 0xffffff,
    sunIntensity: 0.8,
    sunShadowMapSize: 2048,
    sunShadowCameraSize: 10,
    sunShadowBias: -0.0005,
    moonColor: 0x8899cc,
    moonIntensity: 0.5,
    moonShadowMapSize: 1024,
    moonShadowCameraSize: 10,
};

export function setupLights(scene, quality = 'high') {
    // Ambient light
    const ambientLight = new THREE.AmbientLight(
        LIGHTS_CONFIG.ambientColor,
        LIGHTS_CONFIG.ambientIntensity
    );
    scene.add(ambientLight);

    const shadowMapSize = quality === 'low' ? 1024 : 2048;
    const moonShadowSize = quality === 'low' ? 512 : 1024;

    // Sun light (directional light)
    const sunLight = new THREE.DirectionalLight(
        LIGHTS_CONFIG.sunColor,
        LIGHTS_CONFIG.sunIntensity
    );
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = shadowMapSize;
    sunLight.shadow.mapSize.height = shadowMapSize;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 50;
    sunLight.shadow.camera.left = -LIGHTS_CONFIG.sunShadowCameraSize;
    sunLight.shadow.camera.right = LIGHTS_CONFIG.sunShadowCameraSize;
    sunLight.shadow.camera.top = LIGHTS_CONFIG.sunShadowCameraSize;
    sunLight.shadow.camera.bottom = -LIGHTS_CONFIG.sunShadowCameraSize;
    sunLight.shadow.bias = LIGHTS_CONFIG.sunShadowBias;
    scene.add(sunLight);

    // Moon light (directional light)
    const moonLight = new THREE.DirectionalLight(
        LIGHTS_CONFIG.moonColor,
        LIGHTS_CONFIG.moonIntensity
    );
    moonLight.castShadow = true;
    moonLight.shadow.mapSize.width = moonShadowSize;
    moonLight.shadow.mapSize.height = moonShadowSize;
    moonLight.shadow.camera.near = 0.5;
    moonLight.shadow.camera.far = 50;
    moonLight.shadow.camera.left = -LIGHTS_CONFIG.moonShadowCameraSize;
    moonLight.shadow.camera.right = LIGHTS_CONFIG.moonShadowCameraSize;
    moonLight.shadow.camera.top = LIGHTS_CONFIG.moonShadowCameraSize;
    moonLight.shadow.camera.bottom = -LIGHTS_CONFIG.moonShadowCameraSize;
    scene.add(moonLight);

    return { ambientLight, sunLight, moonLight };
}

export { LIGHTS_CONFIG };
