import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { cloudShaderInjection } from '../shaders.js';
import * as RainMaterial from '../webgpu/materials/RainMaterial.js';
import * as SplashMaterial from '../webgpu/materials/SplashMaterial.js';
import { createCloudMaterialWebGPU, syncCloudNodeUniforms } from '../webgpu/materials/CloudMaterial.js';
import { createStarFieldMaterial, createStarFieldMaterialWebGPU } from '../webgpu/materials/StarFieldMaterial.js';
import { RainSystem } from '../effects/rain-system.js';
import { StarField } from '../effects/star-field.js';
import { STARS } from '../sky/starCatalog.js';
import { ALL_PLANETS } from '../sky/planets.js';
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

    it('keeps the 1-pixel Points path for the filler field (size folded into brightness)', async () => {
        const material = await createStarFieldMaterialWebGPU();

        expect(material.isPointsNodeMaterial).toBe(true);
        expect(material.sizeNode).toBeNull();
        expect(material.positionNode).toBeNull();
        expect(material.userData.sizedSprites).toBe(false);
    });

    it('builds a sized-sprite graph from instanced position/size/colour data', async () => {
        const count = 3;
        const instanced = {
            position: new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3),
            size: new THREE.InstancedBufferAttribute(new Float32Array([1, 5, 9]), 1),
            color: new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3)
        };
        const material = await createStarFieldMaterialWebGPU({ instanced });

        expect(material.isPointsNodeMaterial).toBe(true);
        expect(material.positionNode).toBeTruthy();
        expect(material.sizeNode).toBeTruthy();
        expect(material.colorNode).toBeTruthy();
        expect(material.opacityNode).toBeTruthy();
        // The sky is at infinity: pixel size must not shrink with the 2000-unit distance.
        expect(material.sizeAttenuation).toBe(false);
        expect(material.depthWrite).toBe(false);
        expect(material.userData.sizedSprites).toBe(true);
        expect(Object.keys(material.userData.starUniforms).sort()).toEqual(['uHorizonRadius', 'uOpacity', 'uTime']);
    });
});

describe('Star field WebGPU draw path', () => {
    const night = new THREE.Vector3(0, -15, 0);
    const makeField = async (quality = 'high') => {
        const scene = new THREE.Scene();
        const field = new StarField(scene, { faintStarCount: 64, quality });
        await field.initWebGPU();
        return { scene, field };
    };

    it('draws the catalog and planets as instanced sprites and keeps the filler as Points', async () => {
        const { field } = await makeField();

        expect(field.catalogStars).toBeInstanceOf(THREE.Sprite);
        expect(field.catalogStars.count).toBe(STARS.length);
        expect(field.catalogMaterial.sizeNode).toBeTruthy();
        expect(field.planetPoints).toBeInstanceOf(THREE.Sprite);
        expect(field.planetPoints.count).toBe(field.getPlanetPositions().length);
        expect(field.faintStars).toBeInstanceOf(THREE.Points);
        expect(field.faintMaterial.sizeNode).toBeNull();

        // Exactly one drawable per batch in the sky group — the WebGL Points are gone.
        const children = field.skyGroup.children;
        expect(children).toContain(field.catalogStars);
        expect(children).toContain(field.planetPoints);
        expect(children.filter((child) => /** @type {any} */ (child).isPoints)).toEqual([field.faintStars]);
        expect(field.mesh).toBe(field.catalogStars);
        field.dispose();
    });

    it('feeds the sprites from the same data the refreshes write', async () => {
        const { field } = await makeField();
        const positions = field.catalogGeometry.getAttribute('position');
        expect(/** @type {any} */ (positions).isInstancedBufferAttribute).toBe(true);
        expect(positions.count).toBe(STARS.length);

        const version = positions.version;
        // A century later precession has moved enough to rewrite the catalog.
        field.setObserver({ date: new Date('2126-01-01T00:00:00Z') });
        expect(positions.version).toBeGreaterThan(version);
        expect(field.catalogGeometry.getAttribute('position')).toBe(positions);
        field.dispose();
    });

    it('writes twinkle/fade through userData.starUniforms, never .uniforms', async () => {
        const { field } = await makeField();
        field.update(night);

        for (const material of [field.catalogMaterial, field.faintMaterial, field.planetMaterial]) {
            expect(/** @type {any} */ (material).uniforms).toBeUndefined();
            const { uTime, uOpacity, uHorizonRadius } = material.userData.starUniforms;
            expect(uTime.value).toBeGreaterThan(0);
            expect(uOpacity.value).toBeGreaterThan(0);
            expect(uHorizonRadius.value).toBe(field.radius);
        }
        expect(field.uniforms).toBe(field.catalogMaterial.userData.starUniforms);
        field.dispose();
    });

    it('re-budgets the filler with a draw range and never touches the sprites', async () => {
        const { field } = await makeField('high');
        const catalog = field.catalogStars;
        const faintGeometry = field.faintStars.geometry;

        field.setQuality('thumbnail');
        expect(field.faintStars.geometry).toBe(faintGeometry);
        expect(faintGeometry.drawRange.count).toBe(field.getRenderedFaintStarCount());
        expect(field.catalogStars).toBe(catalog);
        expect(field.catalogStars.count).toBe(STARS.length);
        field.dispose();
    });

    it('rebuilds a new planet set straight onto the sprite path', async () => {
        const { field } = await makeField();
        field.setPlanetSet(ALL_PLANETS);

        expect(field.planetPoints).toBeInstanceOf(THREE.Sprite);
        expect(field.planetPoints.count).toBe(ALL_PLANETS.length);
        expect(field.planetMaterial.userData.sizedSprites).toBe(true);
        expect(field.skyGroup.children.filter((child) => child === field.planetPoints)).toHaveLength(1);

        field.setPlanetsVisible(false);
        field.update(night);
        expect(field.planetPoints.visible).toBe(false);
        field.dispose();
    });

    it('is idempotent and cleans up after itself', async () => {
        const { scene, field } = await makeField();
        const catalog = field.catalogStars;
        await field.initWebGPU();
        expect(field.catalogStars).toBe(catalog);

        field.dispose();
        expect(scene.children).not.toContain(field.skyGroup);
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
