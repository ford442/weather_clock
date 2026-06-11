import * as THREE from 'three';
import { starFieldVertexShader, starFieldFragmentShader } from '../../shaders.js';

export function createStarFieldMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uOpacity: { value: 0.0 }
        },
        vertexShader: starFieldVertexShader,
        fragmentShader: starFieldFragmentShader,
        transparent: true,
        depthWrite: false,
        fog: false
    });
}

export async function createStarFieldMaterialWebGPU() {
    const { PointsNodeMaterial } = await import('three/webgpu');
    const material = new PointsNodeMaterial({
        color: 0xffffff,
        transparent: true,
        depthWrite: false,
        opacity: 0.0,
        fog: false
    });
    // Twinkle TSL logic is future work
    return material;
}
