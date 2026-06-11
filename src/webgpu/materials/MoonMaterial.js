import * as THREE from 'three';
import { moonVertexShader, moonFragmentShader } from '../../moonPhase.js';

export function createMoonMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: {
            uSunPosition: { value: new THREE.Vector3(0, 0, 100) }
        },
        vertexShader: moonVertexShader,
        fragmentShader: moonFragmentShader
    });
}

export async function createMoonMaterialWebGPU() {
    const { MeshStandardNodeMaterial } = await import('three/webgpu');
    const material = new MeshStandardNodeMaterial({
        color: 0xcccccc,
        roughness: 0.8,
        metalness: 0.1
    });
    // Terminator and crater TSL logic is future work
    return material;
}
