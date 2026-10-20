import * as THREE from 'three';
import { starFieldVertexShader, starFieldFragmentShader } from '../../shaders.js';

export function createStarFieldMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uOpacity: { value: 0.0 },
            uHorizonRadius: { value: 1.0 }
        },
        vertexShader: starFieldVertexShader,
        fragmentShader: starFieldFragmentShader,
        transparent: true,
        depthWrite: false,
        fog: false
    });
}

/**
 * The `three/webgpu` + `three/tsl` exports the star-field node materials need,
 * loaded once and cached. Keeping them in hand lets {@link buildStarFieldMaterialWebGPU}
 * stay synchronous, so the star field can rebuild a sprite batch (e.g. a new
 * planet set) without an async gap in which a WebGL material would reach the
 * WebGPU renderer.
 *
 * @typedef {{webgpu: typeof import('three/webgpu'), tsl: typeof import('three/tsl')}} StarFieldNodeModules
 */

/** @type {Promise<StarFieldNodeModules>|null} */
let nodeModulesPromise = null;

/** @returns {Promise<StarFieldNodeModules>} */
export function loadStarFieldNodeModules() {
    nodeModulesPromise ??= Promise.all([import('three/webgpu'), import('three/tsl')]).then(([webgpu, tsl]) => ({
        webgpu,
        tsl
    }));
    return nodeModulesPromise;
}

/**
 * Per-instance data for the sized-sprite path. The attributes are the very
 * objects the star field updates, so precession and planet refreshes reach the
 * GPU through the ordinary `needsUpdate` flag.
 *
 * @typedef {object} StarSpriteAttributes
 * @property {THREE.InstancedBufferAttribute} position - Star centre, equatorial frame (vec3).
 * @property {THREE.InstancedBufferAttribute} size - Diameter in device pixels, as `magnitudeToPointSize` (float).
 * @property {THREE.InstancedBufferAttribute} color - B–V tint × brightness (vec3).
 */

/**
 * TSL port of the star-field material for the WebGPU backend.
 *
 * Parity notes vs. the WebGL shader pair above:
 *  - Twinkle uses the same position hash and the same `0.7 + 0.3 * sin(t * 2 + hash * 100)`
 *    curve, so both backends shimmer at the same rate and depth.
 *  - Both fade stars out through the horizon using world-space Y over
 *    `uHorizonRadius`, so the half of the catalog that is underfoot never shines
 *    up through the ground.
 *  - Star colour comes from the same `aColor` data the WebGL path reads.
 *
 * It builds one of two draw paths, because Three's WebGPU backend renders
 * `THREE.Points` as 1-pixel primitives and ignores `sizeNode` there:
 *  - **Sized sprites** (pass `instanced`): for an instanced `THREE.Sprite` with
 *    `count` = star count. Position, size and colour arrive through
 *    `instancedBufferAttribute`, `sizeNode` sets the quad's pixel size, and the
 *    sprite UV shapes the same soft disc as the WebGL `gl_PointCoord` path. Used
 *    for the catalog and the planets, so Sirius and Venus have area.
 *  - **1-pixel points** (no `instanced`): for `THREE.Points`. Size cannot drive
 *    the footprint, so it is folded into brightness instead, and there is no disc
 *    to shape. Used for the filler field, which is meant to read as dust.
 *
 * Drive it through `material.userData.starUniforms`, which mirrors the shape of the
 * WebGL material's `uniforms` block.
 *
 * @param {StarFieldNodeModules} modules - From {@link loadStarFieldNodeModules}.
 * @param {{instanced?: StarSpriteAttributes}} [options]
 * @returns {import('three/webgpu').PointsNodeMaterial}
 */
export function buildStarFieldMaterialWebGPU({ webgpu, tsl }, { instanced } = {}) {
    const {
        attribute,
        float,
        instancedBufferAttribute,
        positionLocal,
        positionWorld,
        screenDPR,
        sin,
        smoothstep,
        uniform,
        uv
    } = tsl;

    const uTime = uniform(0);
    const uOpacity = uniform(0);
    const uHorizonRadius = uniform(1);

    const material = new webgpu.PointsNodeMaterial({
        transparent: true,
        depthWrite: false,
        fog: false
    });
    // Blended, not coverage-based: alpha-to-coverage would quantise the twinkle.
    material.alphaToCoverage = false;

    // On the sprite path `positionNode` assigns the star centre to `positionLocal`,
    // so the hash and horizon below see the star, not the quad corner — the same
    // inputs the Points path gets from its geometry.
    const hash = sin(positionLocal.x.mul(12.9898).add(positionLocal.y.mul(78.233)).add(positionLocal.z.mul(45.164)));
    const twinkle = float(0.7).add(sin(uTime.mul(2.0).add(hash.mul(100.0))).mul(0.3));
    const horizon = smoothstep(-0.03, 0.04, positionWorld.y.div(uHorizonRadius.max(1.0)));
    const fade = uOpacity.mul(twinkle).mul(horizon);

    if (instanced) {
        material.positionNode = instancedBufferAttribute(instanced.position);
        // `gl_PointSize` is in device pixels and PointsNodeMaterial multiplies
        // `sizeNode` by the DPR, so divide it back out to keep both backends'
        // stars the same size on screen. The sky is at infinity: no attenuation.
        material.sizeNode = instancedBufferAttribute(instanced.size).div(screenDPR);
        material.sizeAttenuation = false;
        material.colorNode = instancedBufferAttribute(instanced.color);
        // Soft disc, as the WebGL fragment shader: 1 at the centre, 0 at the rim.
        const strength = float(1.0).sub(uv().sub(0.5).length().mul(2.0)).max(0.0).pow(1.5);
        material.opacityNode = fade.mul(strength);
    } else {
        // Geometry sizes run ~1–9; map that onto a 0.35–1.0 brightness range.
        const brightness = attribute('size', 'float').div(9.0).clamp(0.35, 1.0);
        material.colorNode = attribute('aColor', 'vec3');
        material.opacityNode = fade.mul(brightness);
    }

    material.userData.starUniforms = { uTime, uOpacity, uHorizonRadius };
    material.userData.sizedSprites = !!instanced;
    return material;
}

/**
 * Async convenience wrapper around {@link buildStarFieldMaterialWebGPU}.
 * @param {{instanced?: StarSpriteAttributes}} [options]
 */
export async function createStarFieldMaterialWebGPU(options) {
    return buildStarFieldMaterialWebGPU(await loadStarFieldNodeModules(), options);
}
