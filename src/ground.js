// Ground disc the sundial sits on — the surface snow/wetness/foliage react against.
import * as THREE from 'three';

export const GROUND_CONFIG = {
    radius: 3.6,
    y: -0.02,
    color: 0x4a5a3a,
    roughness: 0.9,
    metalness: 0.05
};

/**
 * @param {boolean} isWebGPU
 * @param {THREE.Texture|null} [snowMaskTexture]
 */
export function createGround(isWebGPU = false, snowMaskTexture = null) {
    const geometry = new THREE.CircleGeometry(GROUND_CONFIG.radius, 96);
    geometry.rotateX(-Math.PI / 2);

    const material = new THREE.MeshStandardMaterial({
        color: GROUND_CONFIG.color,
        roughness: GROUND_CONFIG.roughness,
        metalness: GROUND_CONFIG.metalness
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = GROUND_CONFIG.y;
    mesh.receiveShadow = true;
    mesh.castShadow = false;

    return {
        mesh,
        geometry,
        material,
        dispose() {
            geometry.dispose();
            material.dispose();
        }
    };
}
