import * as THREE from 'three';
import { splashVertexShader, splashFragmentShader } from '../../shaders.js';

/**
 * WebGL-only splash material.
 *
 * There is deliberately no WebGPU/TSL counterpart here: under WebGPU, splashes
 * are simulated and drawn entirely by `src/effects/gpu-splash-system.js` (TSL
 * compute nodes + a node material it owns), and `SplashSystem` is never
 * constructed. See `docs/WEBGPU_ARCHITECTURE.md`.
 */
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
