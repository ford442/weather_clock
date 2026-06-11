import * as THREE from 'three';
import { splashVertexShader, splashFragmentShader } from '../../shaders.js';

export function createSplashMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: {
            uColor: { value: new THREE.Color(0xffffff) }
        },
        vertexShader: splashVertexShader,
        fragmentShader: splashFragmentShader,
        transparent: true,
        depthWrite: false
    });
}

export async function createSplashMaterialWebGPU() {
    const { PointsNodeMaterial } = await import('three/webgpu');
    const material = new PointsNodeMaterial({
        color: 0xffffff,
        transparent: true,
        depthWrite: false,
        opacity: 1.0
    });
    // TODO: Full ripple-ring TSL logic is future work
    return material;
}
