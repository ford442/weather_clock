import * as THREE from 'three';
import { rainVertexShader, rainFragmentShader } from '../../shaders.js';

export function createRainMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: {
            uColor: { value: new THREE.Color(0x88ccff) },
            uOpacity: { value: 0.0 }
        },
        vertexShader: rainVertexShader,
        fragmentShader: rainFragmentShader,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide
    });
}

export async function createRainMaterialWebGPU() {
    const { LineBasicNodeMaterial } = await import('three/webgpu');
    const material = new LineBasicNodeMaterial({
        color: 0x88ccff,
        transparent: true,
        depthWrite: false,
        opacity: 0.0
    });
    // TODO: Full distance-fade TSL logic is future work
    return material;
}
