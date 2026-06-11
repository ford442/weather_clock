import * as THREE from 'three';
import { cloudShaderInjection } from '../../shaders.js';

export function createCloudMaterial(map) {
    const material = new THREE.MeshBasicMaterial({
        map,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    material.onBeforeCompile = cloudShaderInjection.onBeforeCompile;
    return material;
}

export async function createCloudMaterialWebGPU(map) {
    const { MeshBasicNodeMaterial } = await import('three/webgpu');
    const material = new MeshBasicNodeMaterial({
        map,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    // TODO: Add volumetric lighting TSL logic here in future work
    return material;
}
