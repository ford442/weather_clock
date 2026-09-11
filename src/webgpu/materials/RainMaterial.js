import * as THREE from 'three';
import { rainVertexShader, rainFragmentShader } from '../../shaders.js';

/**
 * WebGL-only rain material.
 *
 * There is deliberately no WebGPU/TSL counterpart here: under WebGPU, rain is
 * simulated and drawn entirely by `src/effects/gpu-rain-system.js` (TSL compute
 * nodes + a node material it owns), and `RainSystem` is never constructed.
 * See `docs/WEBGPU_ARCHITECTURE.md`.
 */
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
