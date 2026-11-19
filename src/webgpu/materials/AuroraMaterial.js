import * as THREE from 'three';
import { auroraFragmentShader, auroraVertexShader } from '../../shaders.js';

/**
 * Shared blend state for both backends. An aurora is emitted light, so it adds
 * to the sky and never writes depth; it still depth-tests, so the ground and
 * the sundial occlude it.
 */
const AURORA_MATERIAL_STATE = Object.freeze({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false
});

/**
 * WebGL material for the aurora curtain.
 * @returns {THREE.ShaderMaterial}
 */
export function createAuroraMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: {
            uOpacity: { value: 0 },
            uTime: { value: 0 },
            uHorizonRadius: { value: 1 }
        },
        vertexShader: auroraVertexShader,
        fragmentShader: auroraFragmentShader,
        ...AURORA_MATERIAL_STATE
    });
}

/**
 * TSL port for the WebGPU backend: the same rays, hem, colour ramp, horizon
 * fade, and additive blend. Node materials take log depth from the renderer.
 * Drive it through `material.userData.auroraUniforms`, which mirrors the WebGL
 * material's `uniforms` block. Synchronous, like the Milky Way's.
 *
 * @param {{webgpu: typeof import('three/webgpu'), tsl: typeof import('three/tsl')}} modules
 * @returns {import('three/webgpu').MeshBasicNodeMaterial}
 */
export function buildAuroraMaterialWebGPU({ webgpu, tsl }) {
    const { attribute, mix, positionWorld, sin, smoothstep, uniform, uv, vec3 } = tsl;

    const uOpacity = uniform(0);
    const uTime = uniform(0);
    const uHorizonRadius = uniform(1);

    const coords = uv();
    const u = coords.x;
    const v = coords.y;
    const seed = attribute('aSeed', 'float');

    const rays = sin(u.mul(83.0).add(seed.mul(13.0)).add(uTime.mul(0.55)))
        .mul(sin(u.mul(31.0).sub(uTime.mul(0.23)).add(seed.mul(5.0))))
        .mul(0.5)
        .add(0.5)
        .clamp(0.0, 1.0)
        .mul(0.55)
        .add(0.45);
    const hem = smoothstep(0.0, 0.07, v).mul(v.oneMinus().pow(1.7));
    const ends = smoothstep(0.0, 0.18, u).mul(smoothstep(0.0, 0.18, u.oneMinus()));
    const horizon = smoothstep(-0.03, 0.04, positionWorld.y.div(uHorizonRadius.max(1.0)));

    const material = new webgpu.MeshBasicNodeMaterial({ ...AURORA_MATERIAL_STATE });
    material.colorNode = mix(vec3(0.22, 1.0, 0.52), vec3(0.78, 0.22, 0.52), smoothstep(0.35, 0.95, v));
    material.opacityNode = uOpacity.mul(hem).mul(ends).mul(rays).mul(horizon);

    material.userData.auroraUniforms = { uOpacity, uTime, uHorizonRadius };
    return material;
}
