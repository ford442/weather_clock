import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SCENE_LAYOUT } from '../scene-layout.js';

// Weather effect coordinator wiring pulls in canvas-backed cloud/fog/snow
// textures (cloud-resources.js), which assume a DOM `document`. Stub just
// enough of the Canvas2D surface for texture construction to succeed —
// nothing in this test renders, so the drawing calls can be no-ops.
function installFakeCanvasDocument() {
    const fakeContext = {
        clearRect() {},
        fillRect() {},
        beginPath() {},
        arc() {},
        fill() {},
        stroke() {},
        moveTo() {},
        lineTo() {},
        quadraticCurveTo() {},
        save() {},
        restore() {},
        translate() {},
        rotate() {},
        scale() {},
        createRadialGradient: () => ({ addColorStop() {} }),
        createLinearGradient: () => ({ addColorStop() {} }),
        getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
        putImageData() {}
    };
    globalThis.document = {
        createElement: (tag) => {
            if (tag !== 'canvas') return {};
            return {
                width: 0,
                height: 0,
                getContext: () => fakeContext
            };
        }
    };
}

describe('SCENE_LAYOUT', () => {
    it('is frozen at every level so it cannot drift at runtime', () => {
        expect(Object.isFrozen(SCENE_LAYOUT)).toBe(true);
        expect(Object.isFrozen(SCENE_LAYOUT.zones)).toBe(true);
        expect(Object.isFrozen(SCENE_LAYOUT.zones.past)).toBe(true);
        expect(Object.isFrozen(SCENE_LAYOUT.zones.current)).toBe(true);
        expect(Object.isFrozen(SCENE_LAYOUT.zones.future)).toBe(true);
        expect(Object.isFrozen(SCENE_LAYOUT.fog)).toBe(true);
        expect(Object.isFrozen(SCENE_LAYOUT.lightning)).toBe(true);
        expect(Object.isFrozen(SCENE_LAYOUT.ground)).toBe(true);
        expect(Object.isFrozen(SCENE_LAYOUT.camera)).toBe(true);
        expect(Object.isFrozen(SCENE_LAYOUT.sky)).toBe(true);
        expect(Object.isFrozen(SCENE_LAYOUT.starSphere)).toBe(true);
        expect(Object.isFrozen(SCENE_LAYOUT.depth)).toBe(true);
        expect(Object.isFrozen(SCENE_LAYOUT.sceneSpan)).toBe(true);
    });

    it('keeps camera far beyond the sky disc and the star sphere inside both', () => {
        expect(SCENE_LAYOUT.camera.far).toBeGreaterThan(SCENE_LAYOUT.sky.scale);
        expect(SCENE_LAYOUT.sky.scale).toBeGreaterThan(SCENE_LAYOUT.starSphere.radius);
        expect(SCENE_LAYOUT.starSphere.radius).toBeGreaterThan(SCENE_LAYOUT.ground.radius);
        expect(SCENE_LAYOUT.depth.mode).toBe('linear');
        expect(SCENE_LAYOUT.camera.near).toBeLessThan(1);
    });

    it('matches lightning spawn to the present zone and fog Z wrap to ±8', () => {
        expect(SCENE_LAYOUT.lightning).toEqual(SCENE_LAYOUT.zones.current);
        expect(SCENE_LAYOUT.fog.minZ).toBe(-8);
        expect(SCENE_LAYOUT.fog.maxZ).toBe(8);
        expect(SCENE_LAYOUT.sceneSpan).toEqual({
            minX: SCENE_LAYOUT.zones.past.minX,
            maxX: SCENE_LAYOUT.zones.future.maxX
        });
    });

    it('lays the three temporal zones edge-to-edge with no gap or overlap', () => {
        const { past, current, future } = SCENE_LAYOUT.zones;
        expect(past.maxX).toBe(current.minX);
        expect(current.maxX).toBe(future.minX);
        expect(past.minX).toBeLessThan(past.maxX);
        expect(current.minX).toBeLessThan(current.maxX);
        expect(future.minX).toBeLessThan(future.maxX);
    });

    it('restricts lightning spawns to the present (center) zone', () => {
        expect(SCENE_LAYOUT.lightning).toEqual(SCENE_LAYOUT.zones.current);
    });
});

describe('WeatherEffects coordinator zone wiring', () => {
    /** @type {typeof import('../effects/weather-effects.js').WeatherEffects} */
    let WeatherEffects;

    beforeAll(async () => {
        installFakeCanvasDocument();
        ({ WeatherEffects } = await import('../effects/weather-effects.js'));
    });

    it('hands every past/current/future particle & fog system the matching SCENE_LAYOUT zone', () => {
        const scene = new THREE.Scene();
        const sundialGroup = new THREE.Group();
        const camera = new THREE.PerspectiveCamera();

        const weatherEffects = new WeatherEffects(scene, sundialGroup, camera, 'low');
        try {
            const expectations = [
                [weatherEffects.pastRain, 'past'],
                [weatherEffects.pastSnow, 'past'],
                [weatherEffects.pastDust, 'past'],
                [weatherEffects.pastFog, 'past'],
                [weatherEffects.currRain, 'current'],
                [weatherEffects.currSnow, 'current'],
                [weatherEffects.currDust, 'current'],
                [weatherEffects.currFog, 'current'],
                [weatherEffects.futureRain, 'future'],
                [weatherEffects.futureSnow, 'future'],
                [weatherEffects.futureDust, 'future'],
                [weatherEffects.futureFog, 'future'],
                [weatherEffects.pastCumulus, 'past'],
                [weatherEffects.currCumulus, 'current'],
                [weatherEffects.futureCumulus, 'future']
            ];

            for (const [system, zoneName] of expectations) {
                expect(system.zone).toBe(SCENE_LAYOUT.zones[zoneName]);
            }
        } finally {
            weatherEffects.dispose();
        }
    });

    it('exposes SCENE_LAYOUT via getSceneLayout() for debugging', () => {
        const scene = new THREE.Scene();
        const weatherEffects = new WeatherEffects(scene, new THREE.Group(), new THREE.PerspectiveCamera(), 'low');
        try {
            expect(weatherEffects.getSceneLayout()).toBe(SCENE_LAYOUT);
        } finally {
            weatherEffects.dispose();
        }
    });

    it('spawns lightning strikes within the present-zone bounds', () => {
        const scene = new THREE.Scene();
        const weatherEffects = new WeatherEffects(scene, new THREE.Group(), new THREE.PerspectiveCamera(), 'low');
        try {
            weatherEffects.createLightning();
            const x = weatherEffects.lightningLight.position.x;
            expect(x).toBeGreaterThanOrEqual(SCENE_LAYOUT.lightning.minX);
            expect(x).toBeLessThanOrEqual(SCENE_LAYOUT.lightning.maxX);
        } finally {
            weatherEffects.dispose();
        }
    });

    it('uses SCENE_LAYOUT for particle ctor fallbacks instead of a leaked [-8, 8] span', async () => {
        const { RainSystem } = await import('../effects/rain-system.js');
        const { SnowSystem } = await import('../effects/snow-system.js');
        const { WindDustSystem } = await import('../effects/wind-dust-system.js');
        const { CloudSystem } = await import('../effects/cloud-system.js');
        const { FogEffect } = await import('../effects/fog-effect.js');
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera();
        const rain = new RainSystem(scene, undefined, 4);
        const snow = new SnowSystem(scene, undefined, 4);
        const dust = new WindDustSystem(scene, undefined, 4);
        const clouds = new CloudSystem(scene, camera, undefined, 1, 'cirrus');
        const fog = new FogEffect(scene, SCENE_LAYOUT.zones.current);
        try {
            expect(rain.zone).toBe(SCENE_LAYOUT.zones.current);
            expect(snow.zone).toBe(SCENE_LAYOUT.zones.current);
            expect(dust.zone).toBe(SCENE_LAYOUT.zones.current);
            expect(clouds.zone).toBe(SCENE_LAYOUT.sceneSpan);
            for (const { mesh } of fog.planes) {
                expect(mesh.position.z).toBeGreaterThanOrEqual(SCENE_LAYOUT.fog.minZ);
                expect(mesh.position.z).toBeLessThanOrEqual(SCENE_LAYOUT.fog.maxZ);
            }
        } finally {
            rain.dispose();
            snow.dispose();
            dust.dispose();
            clouds.dispose();
            fog.dispose();
        }
    });
});
