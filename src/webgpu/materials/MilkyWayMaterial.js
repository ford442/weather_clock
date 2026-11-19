import * as THREE from 'three';
import { milkyWayFragmentShader, milkyWayVertexShader } from '../../shaders.js';

/**
 * Shared blend state for both backends. The band is light added to the sky,
 * so it blends additively and never writes depth; it still depth-tests, so the
 * ground and the sundial occlude it.
 */
const BAND_MATERIAL_STATE = Object.freeze({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false
});

/**
 * WebGL material for the Milky Way ribbon.
 * @param {THREE.Texture} map - rgb = tint, a = surface brightness.
 * @param {{intensity?: number}} [options]
 * @returns {THREE.ShaderMaterial}
 */
export function createMilkyWayMaterial(map, { intensity = 1 } = {}) {
    return new THREE.ShaderMaterial({
        uniforms: {
            uMap: { value: map },
            uOpacity: { value: 0 },
            uIntensity: { value: intensity },
            uHorizonRadius: { value: 1 }
        },
        vertexShader: milkyWayVertexShader,
        fragmentShader: milkyWayFragmentShader,
        ...BAND_MATERIAL_STATE
    });
}

/**
 * TSL port for the WebGPU backend. Same inputs, same horizon fade, same
 * additive blend; node materials take log depth from the renderer, so there is
 * no depth code here either. Drive it through `material.userData.bandUniforms`,
 * which mirrors the WebGL material's `uniforms` block.
 *
 * Synchronous so the star field can build the band straight onto the WebGPU
 * path after init without an async gap.
 *
 * @param {{webgpu: typeof import('three/webgpu'), tsl: typeof import('three/tsl')}} modules
 * @param {THREE.Texture} map
 * @param {{intensity?: number}} [options]
 * @returns {import('three/webgpu').MeshBasicNodeMaterial}
 */
export function buildMilkyWayMaterialWebGPU({ webgpu, tsl }, map, { intensity = 1 } = {}) {
    const { positionWorld, smoothstep, texture, uniform, uv } = tsl;

    const uOpacity = uniform(0);
    const uIntensity = uniform(intensity);
    const uHorizonRadius = uniform(1);

    const material = new webgpu.MeshBasicNodeMaterial({ ...BAND_MATERIAL_STATE });
    const band = texture(map, uv());
    const horizon = smoothstep(-0.03, 0.04, positionWorld.y.div(uHorizonRadius.max(1.0)));
    material.colorNode = band.rgb;
    material.opacityNode = band.a.mul(uOpacity).mul(uIntensity).mul(horizon);

    material.userData.bandUniforms = { uOpacity, uIntensity, uHorizonRadius };
    return material;
}
