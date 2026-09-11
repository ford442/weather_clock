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
                [weatherEffects.futureFog, 'future']
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
});
