import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createSkyMaterial, SKY_MATERIAL_CONFIG } from '../webgpu/materials/SkyMaterial.js';
import { setupSky } from '../scene-objects.js';
import { SCENE_LAYOUT } from '../scene-layout.js';

describe('SkyMaterial (in-repo Preetham atmosphere)', () => {
    it('exposes the AtmosphereUniforms names weatherLighting.js writes', () => {
        const material = createSkyMaterial();
        for (const name of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG', 'sunPosition', 'up']) {
            expect(material.uniforms[name]).toBeDefined();
        }
        expect(material.uniforms.maxRadiance.value).toBe(SKY_MATERIAL_CONFIG.maxRadiance);
    });

    it('never touches depth, so it can share a logarithmic depth buffer', () => {
        const material = createSkyMaterial();
        expect(material.depthWrite).toBe(false);
        expect(material.depthTest).toBe(false);
        expect(material.fog).toBe(false);
        expect(material.side).toBe(THREE.BackSide);
        expect(material.vertexShader).not.toMatch(/gl_Position\.z\s*=/);
        expect(material.fragmentShader).not.toMatch(/gl_FragDepth/);
    });

    it('caps radiance so the solar disc cannot flood bloom', () => {
        expect(createSkyMaterial().fragmentShader).toMatch(/min\(retColor, vec3\(maxRadiance\)\)/);
    });

    it('setupSky builds the dome at SCENE_LAYOUT.sky.scale, drawn first', async () => {
        const sky = await setupSky(false);
        expect(sky.scale.x).toBe(SCENE_LAYOUT.sky.scale);
        expect(sky.renderOrder).toBe(-1);
        expect(sky.frustumCulled).toBe(false);
        expect(sky.material.uniforms.turbidity.value).toBe(SKY_MATERIAL_CONFIG.turbidity);
    });
});
