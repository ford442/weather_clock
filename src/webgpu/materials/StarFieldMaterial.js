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

/**
 * TSL port of the star-field material for the WebGPU backend.
 *
 * Parity notes vs. the WebGL shader pair above:
 *  - Twinkle uses the same position hash and the same `0.7 + 0.3 * sin(t * 2 + hash * 100)`
 *    curve, so both backends shimmer at the same rate and depth.
 *  - The per-star `size` attribute cannot drive point size here: Three's WebGPU backend
 *    renders `THREE.Points` as 1-pixel point primitives and ignores `sizeNode`
 *    (see PointsNodeMaterial docs). Star size is folded into brightness instead, so
 *    larger stars still read as brighter ones.
 *  - For the same reason there is no `gl_PointCoord`-style soft disc: a 1-pixel point
 *    has no sprite UV to shape.
 *
 * Drive it through `material.userData.starUniforms`, which mirrors the shape of the
 * WebGL material's `uniforms` block (`{ uTime: { value }, uOpacity: { value } }`).
 */
export async function createStarFieldMaterialWebGPU() {
    const { PointsNodeMaterial } = await import('three/webgpu');
    const { attribute, float, positionLocal, sin, uniform, vec3 } = await import('three/tsl');

    const uTime = uniform(0);
    const uOpacity = uniform(0);

    const hash = sin(positionLocal.x.mul(12.9898).add(positionLocal.y.mul(78.233)).add(positionLocal.z.mul(45.164)));
    const twinkle = float(0.7).add(sin(uTime.mul(2.0).add(hash.mul(100.0))).mul(0.3));

    // Geometry sizes run 0.5–2.0; map that onto a 0.35–1.0 brightness range.
    const brightness = attribute('size', 'float').div(2.0).clamp(0.35, 1.0);

    const material = new PointsNodeMaterial({
        transparent: true,
        depthWrite: false,
        fog: false
    });
    // Blended, not coverage-based: alpha-to-coverage would quantise the twinkle.
    material.alphaToCoverage = false;
    material.colorNode = vec3(1, 1, 1);
    material.opacityNode = uOpacity.mul(twinkle).mul(brightness);
    material.userData.starUniforms = { uTime, uOpacity };
    return material;
}
