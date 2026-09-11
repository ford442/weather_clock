import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { cloudShaderInjection } from '../shaders.js';
import * as RainMaterial from '../webgpu/materials/RainMaterial.js';
import * as SplashMaterial from '../webgpu/materials/SplashMaterial.js';
import { createCloudMaterialWebGPU, syncCloudNodeUniforms } from '../webgpu/materials/CloudMaterial.js';
import { createStarFieldMaterial, createStarFieldMaterialWebGPU } from '../webgpu/materials/StarFieldMaterial.js';
import { RainSystem } from '../effects/rain-system.js';
import { SplashSystem } from '../effects/splash-system.js';

/**
 * Guards the WebGPU architecture documented in docs/WEBGPU_ARCHITECTURE.md.
 * The TSL graphs are built here (headless) — the renderer is what compiles them,
 * so this catches malformed node expressions but not shader compilation.
 */
describe('WebGPU particle architecture', () => {
    it('keeps rain and splash materials WebGL-only', () => {
        // TSL compute (gpu-rain-system / gpu-splash-system) is the canonical WebGPU
        // particle path; these must not grow parallel WebGPU material adapters.
        expect(RainMaterial.createRainMaterialWebGPU).toBeUndefined();
        expect(SplashMaterial.createSplashMaterialWebGPU).toBeUndefined();
    });

    it('leaves the WebGL particle classes without a WebGPU swap', () => {
        expect(RainSystem.prototype.initWebGPU).toBeUndefined();
        expect(SplashSystem.prototype.initWebGPU).toBeUndefined();
    });
});

describe('Star field WebGPU material', () => {
    it('exposes the same uniform shape as the WebGL material', async () => {
        const webgl = createStarFieldMaterial();
        const webgpu = await createStarFieldMaterialWebGPU();

        expect(Object.keys(webgpu.userData.starUniforms).sort()).toEqual(Object.keys(webgl.uniforms).sort());
    });

    it('drives twinkle and fade through node uniforms', async () => {
        const material = await createStarFieldMaterialWebGPU();
        const { uTime, uOpacity } = material.userData.starUniforms;

        expect(material.opacityNode).toBeTruthy();
        uTime.value = 12.5;
        uOpacity.value = 0.75;
        expect(uTime.value).toBe(12.5);
        expect(uOpacity.value).toBe(0.75);
    });
});

describe('Cloud WebGPU material', () => {
    it('builds a lit color node and keeps the cloud texture', async () => {
        const map = new THREE.Texture();
        const material = await createCloudMaterialWebGPU(map);

        expect(material.map).toBe(map);
        expect(material.colorNode).toBeTruthy();
        expect(Object.keys(material.userData.cloudUniforms).sort()).toEqual(
            Object.keys(cloudShaderInjection.uniforms).sort()
        );
    });

    it('mirrors the WebGL lighting uniforms into the TSL block', async () => {
        const material = await createCloudMaterialWebGPU(new THREE.Texture());
        cloudShaderInjection.uniforms.uSunColor.value.setHex(0xff8800);
        cloudShaderInjection.uniforms.uSunPosition.value.set(1, 2, 3);

        syncCloudNodeUniforms(material.userData.cloudUniforms);

        expect(material.userData.cloudUniforms.uSunColor.value.getHex()).toBe(0xff8800);
        expect(material.userData.cloudUniforms.uSunPosition.value.toArray()).toEqual([1, 2, 3]);
    });

    it('is a no-op without node uniforms (WebGL path)', () => {
        expect(() => syncCloudNodeUniforms(null)).not.toThrow();
    });
});
