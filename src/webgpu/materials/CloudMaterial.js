import * as THREE from 'three';
import { cloudShaderInjection } from '../../shaders.js';

export function createCloudMaterial(map) {
    const material = new THREE.MeshBasicMaterial({
        map,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    material.onBeforeCompile = cloudShaderInjection.onBeforeCompile;
    return material;
}

/**
 * Lighting uniforms for the TSL cloud material.
 *
 * Shared across every WebGPU cloud system, mirroring how the WebGL path shares
 * one `cloudShaderInjection.uniforms` block across all `onBeforeCompile` patches.
 * Created lazily so `three/tsl` is only imported on the WebGPU path.
 *
 * Typed loosely because the values are TSL uniform nodes, which carry both the
 * `.value` accessor used for updates and the node operators used to build the graph.
 *
 * @type {Record<string, any>|null}
 */
let cloudNodeUniforms = null;

/**
 * TSL port of the volumetric cloud lighting in `cloudShaderInjection`.
 *
 * Same model as the WebGL injection: forward scattering for the silver lining,
 * a faked top-down diffuse term, a weaker moon lobe, flat ambient, and a
 * world-height tint from cool blue-grey underside to warm-white top.
 *
 * The base color node is `materialColor` (material color x cloud texture), so the
 * texture and its alpha survive; per-instance puff colors are applied on top of
 * `colorNode` by `NodeMaterial.setupDiffuseColor`.
 */
export async function createCloudMaterialWebGPU(map) {
    const { MeshBasicNodeMaterial } = await import('three/webgpu');
    const { cameraPosition, dot, float, materialColor, max, mix, normalize, positionWorld, uniform, vec3, vec4 } =
        await import('three/tsl');

    if (cloudNodeUniforms === null) {
        cloudNodeUniforms = {
            uSunPosition: uniform(new THREE.Vector3(0, 100, 0)),
            uSunColor: uniform(new THREE.Color(0xffffff)),
            uMoonPosition: uniform(new THREE.Vector3(0, -100, 0)),
            uMoonColor: uniform(new THREE.Color(0x000000)),
            uAmbientColor: uniform(new THREE.Color(0xffffff)),
            uCloudColor: uniform(new THREE.Color(0xffffff))
        };
    }
    const u = cloudNodeUniforms;

    const viewDir = normalize(cameraPosition.sub(positionWorld));

    // Sun: sharp forward-scatter rim plus a soft top-down diffuse fill.
    const sunDir = normalize(u.uSunPosition.sub(positionWorld));
    const sunScat = max(0.0, dot(sunDir, viewDir)).pow(12.0).mul(1.5);
    const sunDiff = float(0.5).add(max(0.0, dot(vec3(0, 1, 0), sunDir)).mul(0.5));
    const sunLight = u.uSunColor.mul(sunDiff.mul(0.4).add(sunScat.mul(0.8)).add(0.1));

    // Moon: same shape, broader lobe, much weaker.
    const moonDir = normalize(u.uMoonPosition.sub(positionWorld));
    const moonScat = max(0.0, dot(moonDir, viewDir)).pow(8.0);
    const moonLight = u.uMoonColor.mul(float(0.1).add(moonScat.mul(0.5)));

    const totalLight = u.uAmbientColor.mul(0.6).add(sunLight).add(moonLight);

    // Clouds sit between y≈4 (stratus base) and y≈18 (cirrus top).
    const vertGrad = positionWorld.y.sub(4.0).div(14.0).clamp(0, 1);
    const heightTint = mix(vec3(0.72, 0.76, 0.88), vec3(1.02, 1.02, 1.05), vertGrad);

    const material = new MeshBasicNodeMaterial({
        map,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    material.colorNode = materialColor.mul(vec4(u.uCloudColor.mul(totalLight).mul(heightTint), 1.0));
    material.userData.cloudUniforms = u;
    return material;
}

/**
 * Copy the WebGL cloud lighting uniform values into their TSL counterparts.
 *
 * Lets `CloudSystem.update()` drive one shared uniform block per frame regardless
 * of backend. No-op when `nodeUniforms` is nullish (i.e. on the WebGL path).
 *
 * @param {Record<string, {value: THREE.Vector3|THREE.Color}>|null|undefined} nodeUniforms
 * @param {Record<string, {value: any}>} [source]
 */
export function syncCloudNodeUniforms(nodeUniforms, source = cloudShaderInjection.uniforms) {
    if (!nodeUniforms) return;
    for (const [key, target] of Object.entries(nodeUniforms)) {
        const from = source[key];
        if (from) target.value.copy(from.value);
    }
}
