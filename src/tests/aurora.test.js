import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import * as webgpu from 'three/webgpu';
import * as tsl from 'three/tsl';
import {
    AURORA_CONFIG,
    KP_ENDPOINT,
    auroraKpFloor,
    auroraVisibility,
    fetchLatestKp,
    kpSampleApplies,
    parseKpPayload,
    startKpFeed
} from '../sky/aurora.js';
import { AuroraCurtain, buildAuroraGeometry } from '../effects/aurora.js';
import { StarField } from '../effects/star-field.js';
import { auroraFragmentShader, auroraVertexShader } from '../shaders.js';

const REYKJAVIK = 64.1466;
const PARIS = 48.8566;
const NYC = 40.7128;
const NIGHT = new THREE.Vector3(0, -15, 0);
const DAY = new THREE.Vector3(0, 15, 0);

describe('aurora predicate', () => {
    it('shows Reykjavík at Kp 4', () => {
        const result = auroraVisibility({ latitudeDeg: REYKJAVIK, kp: 4, cloudCover: 0 });
        expect(result.visible).toBe(true);
        expect(result.intensity).toBeGreaterThan(0);
        expect(result.bearing).toBe(0);
    });

    it('hides Paris at Kp 4 and shows it at Kp 8', () => {
        expect(auroraVisibility({ latitudeDeg: PARIS, kp: 4, cloudCover: 0 }).visible).toBe(false);
        expect(auroraVisibility({ latitudeDeg: PARIS, kp: 8, cloudCover: 0 }).visible).toBe(true);
    });

    it('hides every site under full cloud', () => {
        for (const latitudeDeg of [REYKJAVIK, PARIS, NYC, -70, 0]) {
            const result = auroraVisibility({ latitudeDeg, kp: 9, cloudCover: 1 });
            expect(result.visible).toBe(false);
            expect(result.intensity).toBe(0);
        }
    });

    it('uses the configured floors and faces the nearer pole', () => {
        expect(auroraKpFloor(60)).toBe(3);
        expect(auroraKpFloor(-60)).toBe(3);
        expect(auroraKpFloor(50)).toBe(5);
        expect(auroraKpFloor(30)).toBe(7);
        expect(auroraVisibility({ latitudeDeg: -64, kp: 4, cloudCover: 0 }).bearing).toBe(180);
    });

    it('rises with Kp above the floor and falls with cloud', () => {
        const at = (kp, cloudCover = 0) => auroraVisibility({ latitudeDeg: REYKJAVIK, kp, cloudCover }).intensity;
        expect(at(3)).toBeCloseTo(AURORA_CONFIG.floorIntensity, 6);
        expect(at(5)).toBeGreaterThan(at(4));
        expect(at(9)).toBe(1);
        expect(at(9, 0.5)).toBeCloseTo(0.5, 6);
    });

    it('treats an unknown Kp as no aurora', () => {
        expect(auroraVisibility({ latitudeDeg: 80, kp: null, cloudCover: 0 }).visible).toBe(false);
        expect(auroraVisibility({ latitudeDeg: 80, kp: Number.NaN, cloudCover: 0 }).visible).toBe(false);
    });
});

describe('Kp feed', () => {
    afterEach(() => vi.useRealTimers());

    it('parses the newest row of the SWPC 1-minute file as UTC', () => {
        const sample = parseKpPayload([
            { time_tag: '2026-11-19T15:20:00', kp_index: 1, estimated_kp: 1.0, kp: '1Z' },
            { time_tag: '2026-11-19T15:21:00', kp_index: 2, estimated_kp: 1.67, kp: '2M' }
        ]);
        expect(sample).toEqual({ kp: 1.67, time: Date.UTC(2026, 10, 19, 15, 21) });
        expect(parseKpPayload([{ time_tag: '2026-11-19T15:21:00', kp_index: 4 }])?.kp).toBe(4);
        expect(parseKpPayload({ error: 'nope' })).toBeNull();
        expect(parseKpPayload([{ time_tag: 'garbage', estimated_kp: 3 }])).toBeNull();
    });

    it('only lets a sample drive nights near its own time', () => {
        const sample = { kp: 6, time: Date.UTC(2026, 10, 19, 22) };
        expect(kpSampleApplies(sample, new Date(sample.time + 60 * 60 * 1000))).toBe(true);
        expect(kpSampleApplies(sample, sample.time + 2 * AURORA_CONFIG.sampleValidityMs)).toBe(false);
        expect(kpSampleApplies(null, sample.time)).toBe(false);
    });

    it('resolves to null instead of rejecting when the endpoint is offline', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const fetchJSONImpl = vi.fn().mockRejectedValue(new Error('Device is offline'));
        await expect(fetchLatestKp({ fetchJSONImpl })).resolves.toBeNull();
        expect(fetchJSONImpl).toHaveBeenCalledWith(KP_ENDPOINT, expect.objectContaining({ timeoutMs: 10000 }));
        warn.mockRestore();
    });

    it('fetches once per refresh, not in a retry loop, and stops cleanly', async () => {
        vi.useFakeTimers();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const fetchJSONImpl = vi.fn().mockRejectedValue(new Error('offline'));
        const onSample = vi.fn();
        const stop = startKpFeed(onSample, { fetchJSONImpl, refreshMs: 1000 });
        await vi.advanceTimersByTimeAsync(0);
        expect(fetchJSONImpl).toHaveBeenCalledTimes(1);
        expect(onSample).toHaveBeenLastCalledWith(null);
        await vi.advanceTimersByTimeAsync(999);
        expect(fetchJSONImpl).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetchJSONImpl).toHaveBeenCalledTimes(2);
        stop();
        await vi.advanceTimersByTimeAsync(5000);
        expect(fetchJSONImpl).toHaveBeenCalledTimes(2);
        warn.mockRestore();
    });
});

/**
 * A star field for a clear night at `latitude`, observed at `date`.
 * @param {number} latitude
 * @param {{quality?: EffectQuality, cloudCover?: number}} [options]
 */
function nightSky(latitude, { quality = 'high', cloudCover = 0 } = {}) {
    const scene = new THREE.Scene();
    const field = new StarField(scene, { quality, liveSatelliteElements: false });
    field.setObserver({ date: new Date('2026-11-19T23:00:00Z'), latitude, longitude: 0, cloudCover });
    return { scene, field };
}

describe('aurora curtain in the star field', () => {
    it('builds nothing on a mid-latitude night without Kp', () => {
        const { scene, field } = nightSky(NYC);
        field.update(NIGHT);
        expect(field.aurora).toBeNull();
        expect(scene.getObjectByName('aurora')).toBeUndefined();
        expect(field.getAuroraState()).toMatchObject({ built: false, visible: false, opacity: 0, source: null });
        field.dispose();
    });

    it('builds nothing below the floor', () => {
        const { field } = nightSky(PARIS);
        field.setAuroraActivity({ kp: 4, time: field.observerDate.getTime() });
        field.update(NIGHT);
        expect(field.aurora).toBeNull();
        field.dispose();
    });

    it('draws north of the scene, outside the equatorial sky group, when Kp clears the floor', () => {
        const { scene, field } = nightSky(REYKJAVIK);
        field.setAuroraActivity({ kp: 5, time: field.observerDate.getTime() });
        field.update(NIGHT);
        const mesh = /** @type {THREE.Mesh} */ (scene.getObjectByName('aurora'));
        expect(mesh).toBeDefined();
        expect(mesh.parent).toBe(scene);
        expect(mesh.visible).toBe(true);
        const center = new THREE.Vector3();
        mesh.geometry.computeBoundingBox();
        mesh.geometry.boundingBox?.getCenter(center);
        center.applyEuler(mesh.rotation);
        expect(center.z).toBeGreaterThan(0);
        expect(field.getAuroraState()).toMatchObject({ source: 'swpc', built: true, visible: true, bearing: 0 });
        field.dispose();
        expect(scene.getObjectByName('aurora')).toBeUndefined();
    });

    it('faces south in the southern hemisphere', () => {
        const { scene, field } = nightSky(-69);
        field.setAuroraKpOverride(6);
        field.update(NIGHT);
        const mesh = /** @type {THREE.Mesh} */ (scene.getObjectByName('aurora'));
        mesh.updateMatrixWorld();
        const position = mesh.geometry.getAttribute('position');
        const sample = new THREE.Vector3().fromBufferAttribute(position, 0).applyMatrix4(mesh.matrixWorld);
        expect(sample.z).toBeLessThan(0);
        field.dispose();
    });

    it('fades out in daylight and under cloud, and ignores a sample far from the observed night', () => {
        const { field } = nightSky(REYKJAVIK);
        field.setAuroraActivity({ kp: 7, time: field.observerDate.getTime() });
        field.update(NIGHT);
        expect(field.getAuroraState().opacity).toBeGreaterThan(0);
        field.update(DAY);
        expect(field.getAuroraState()).toMatchObject({ visible: false, opacity: 0 });

        field.setObserver({ cloudCover: 100 });
        field.update(NIGHT);
        expect(field.getAuroraState().opacity).toBe(0);

        field.setObserver({ cloudCover: 0, date: new Date(field.observerDate.getTime() + 2 * 86400000) });
        field.update(NIGHT);
        expect(field.getAuroraState()).toMatchObject({ source: null, opacity: 0 });
        field.dispose();
    });

    it('is off on the low tier', () => {
        const { field } = nightSky(REYKJAVIK, { quality: 'low' });
        field.setAuroraKpOverride(9);
        field.update(NIGHT);
        expect(field.aurora).toBeNull();
        expect(field.getAuroraState()).toMatchObject({ enabled: false, opacity: 0 });
        field.dispose();
    });

    it('lets the debug override force a mid-latitude curtain, and clears it with null', () => {
        const { field } = nightSky(NYC);
        field.setAuroraKpOverride(9);
        field.update(NIGHT);
        expect(field.getAuroraState()).toMatchObject({ source: 'debug', visible: true, backend: 'webgl' });
        field.setAuroraKpOverride(null);
        field.update(NIGHT);
        expect(field.getAuroraState()).toMatchObject({ source: null, visible: false });
        field.dispose();
    });

    it('holds the traveling wave still under reduced motion', () => {
        const scene = new THREE.Scene();
        const curtain = new AuroraCurtain(scene);
        curtain.update({ opacity: 1, bearing: 0, now: 0 });
        curtain.update({ opacity: 1, bearing: 0, now: 50 });
        const moving = curtain.time;
        expect(moving).toBeGreaterThan(0);
        curtain.update({ opacity: 1, bearing: 0, reducedMotion: true, now: 100 });
        curtain.update({ opacity: 1, bearing: 0, reducedMotion: true, now: 150 });
        expect(curtain.time).toBe(moving);
        expect(/** @type {THREE.ShaderMaterial} */ (curtain.material).uniforms.uTime.value).toBe(moving);
        curtain.dispose();
    });
});

describe('aurora materials', () => {
    it('draws additively on WebGL with log depth and no depth writes of its own', () => {
        const curtain = new AuroraCurtain(new THREE.Scene());
        const material = /** @type {THREE.ShaderMaterial} */ (curtain.material);
        expect(material.blending).toBe(THREE.AdditiveBlending);
        expect(material.depthWrite).toBe(false);
        expect(auroraVertexShader).toContain('USE_LOGARITHMIC_DEPTH_BUFFER');
        expect(auroraFragmentShader).toContain('logdepthbuf');
        expect(auroraFragmentShader).not.toContain('gl_FragDepth');
        curtain.dispose();
    });

    it('swaps to a TSL material on WebGPU and keeps it on a late build', async () => {
        const curtain = new AuroraCurtain(new THREE.Scene());
        curtain.initWebGPU({ webgpu, tsl });
        expect(curtain.getState().backend).toBe('webgpu');
        expect(curtain.material).toBeInstanceOf(webgpu.MeshBasicNodeMaterial);
        expect(curtain.material.blending).toBe(THREE.AdditiveBlending);
        expect(curtain.material.depthWrite).toBe(false);
        curtain.update({ opacity: 0.5, bearing: 180, now: 0 });
        expect(curtain.material.userData.auroraUniforms.uOpacity.value).toBeGreaterThan(0);
        curtain.dispose();

        const { field } = nightSky(REYKJAVIK);
        await field.initWebGPU();
        field.setAuroraKpOverride(6);
        field.update(NIGHT);
        expect(field.getAuroraState()).toMatchObject({ backend: 'webgpu', visible: true });
        field.dispose();
    });

    it('lays out one indexed mesh of a few ribbons above the horizon', () => {
        const geometry = buildAuroraGeometry(1000);
        const position = geometry.getAttribute('position');
        let minY = Infinity;
        for (let i = 0; i < position.count; i++) minY = Math.min(minY, position.getY(i));
        expect(minY).toBeGreaterThan(0);
        expect(geometry.getAttribute('aSeed').count).toBe(position.count);
        expect(geometry.getIndex()?.count).toBeGreaterThan(0);
        geometry.dispose();
    });
});
