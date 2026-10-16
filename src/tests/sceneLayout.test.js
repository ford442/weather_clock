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
        expect(Object.isFrozen(SCENE_LAYOUT.volume)).toBe(true);
    });

    it('defines one weather volume that shares fog Z and brackets every spawn height', () => {
        const { volume, fog } = SCENE_LAYOUT;
        expect(volume.minZ).toBe(fog.minZ);
        expect(volume.maxZ).toBe(fog.maxZ);
        expect(volume.minZ).toBeLessThan(volume.maxZ);
        expect(volume.minY).toBeLessThan(volume.resetY);
        expect(volume.resetY).toBeLessThan(volume.maxY);
        expect(volume.dustMaxY).toBeGreaterThan(0);
        expect(volume.dustMaxY).toBeLessThan(volume.maxY);
        expect(volume.lightningY).toBeGreaterThan(volume.minY);
        expect(volume.lightningY).toBeLessThanOrEqual(volume.maxY);
        // The camera sits outside the slab looking in; the slab never swallows it.
        expect(SCENE_LAYOUT.camera.position.z).toBeGreaterThanOrEqual(volume.maxZ);
    });

    it('keeps camera far beyond the sky disc and the star sphere inside both', () => {
        expect(SCENE_LAYOUT.camera.far).toBeGreaterThan(SCENE_LAYOUT.sky.scale);
        expect(SCENE_LAYOUT.sky.scale).toBeGreaterThan(SCENE_LAYOUT.starSphere.radius);
        expect(SCENE_LAYOUT.starSphere.radius).toBeGreaterThan(SCENE_LAYOUT.ground.radius);
        expect(SCENE_LAYOUT.depth.mode).toBe('logarithmic');
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

    it('hands every precipitation system the weather volume and spawns inside it', async () => {
        const scene = new THREE.Scene();
        const weatherEffects = new WeatherEffects(scene, new THREE.Group(), new THREE.PerspectiveCamera(), 'high');
        try {
            const { volume } = SCENE_LAYOUT;
            const systems = [
                weatherEffects.pastRain,
                weatherEffects.pastSnow,
                weatherEffects.pastDust,
                weatherEffects.currRain,
                weatherEffects.currSnow,
                weatherEffects.currDust,
                weatherEffects.futureRain,
                weatherEffects.futureSnow,
                weatherEffects.futureDust
            ];
            if (weatherEffects.currPollen) systems.push(weatherEffects.currPollen);
            for (const system of systems) {
                expect(system.volume).toBe(volume);
                const positions = system.mesh.geometry.attributes.position.array;
                for (let i = 0; i < positions.length; i += 3) {
                    expect(positions[i]).toBeGreaterThanOrEqual(system.zone.minX);
                    expect(positions[i]).toBeLessThanOrEqual(system.zone.maxX);
                    expect(positions[i + 1]).toBeGreaterThanOrEqual(volume.minY);
                    expect(positions[i + 1]).toBeLessThanOrEqual(volume.maxY + 1);
                    expect(positions[i + 2]).toBeGreaterThanOrEqual(volume.minZ);
                    expect(positions[i + 2]).toBeLessThanOrEqual(volume.maxZ);
                }
            }
        } finally {
            weatherEffects.dispose();
        }
    }, 20000); // builds the full WeatherEffects coordinator; slow under parallel suite load

    it('spawns lightning at the volume height and inside its Z span', () => {
        const weatherEffects = new WeatherEffects(
            new THREE.Scene(),
            new THREE.Group(),
            new THREE.PerspectiveCamera(),
            'low'
        );
        try {
            for (let i = 0; i < 20; i++) {
                weatherEffects.flashIntensity = 0;
                weatherEffects.createLightning();
                // Forcing repeat strikes would orphan the hide timer; clear it each time.
                clearTimeout(weatherEffects.lightningTimeoutId ?? undefined);
                const { y, z } = weatherEffects.lightningLight.position;
                expect(y).toBe(SCENE_LAYOUT.volume.lightningY);
                expect(z).toBeGreaterThanOrEqual(SCENE_LAYOUT.volume.minZ);
                expect(z).toBeLessThanOrEqual(SCENE_LAYOUT.volume.maxZ);
            }
        } finally {
            weatherEffects.dispose();
        }
    });

    it('keeps CPU rain, snow, and dust inside their zone and the volume under a long +Z gale', async () => {
        const { RainSystem } = await import('../effects/rain-system.js');
        const { SnowSystem } = await import('../effects/snow-system.js');
        const { WindDustSystem } = await import('../effects/wind-dust-system.js');
        const scene = new THREE.Scene();
        const zone = SCENE_LAYOUT.zones.future;
        const { volume } = SCENE_LAYOUT;
        const rain = new RainSystem(scene, zone, 200);
        const snow = new SnowSystem(scene, zone, 200);
        const dust = new WindDustSystem(scene, zone, 200);
        try {
            // windDir 0 = from the north → blows toward -Z; 180 = toward +Z. Push both
            // ways at gale speed with a large, time-warp-sized frame step.
            for (const windDir of [180, 0, 135]) {
                for (let frame = 0; frame < 600; frame++) {
                    rain.update(0.05, 80, windDir, 3, null, null, null, null);
                    snow.update(0.05, 80, windDir, 3, null);
                    dust.update(0.05, 80, windDir, 0, null);
                }
                for (const [system, stride, head] of [
                    [rain, 6, 3],
                    [snow, 3, 0],
                    [dust, 3, 0]
                ]) {
                    const positions = system.mesh.geometry.attributes.position.array;
                    const live = system.mesh.geometry.drawRange.count;
                    const count = Number.isFinite(live) ? Math.min(live, positions.length / stride) : 0;
                    expect(count).toBeGreaterThan(0);
                    for (let i = 0; i < count; i++) {
                        const x = positions[i * stride + head];
                        const z = positions[i * stride + head + 2];
                        expect(x).toBeGreaterThanOrEqual(zone.minX);
                        expect(x).toBeLessThanOrEqual(zone.maxX);
                        expect(z).toBeGreaterThanOrEqual(volume.minZ);
                        expect(z).toBeLessThanOrEqual(volume.maxZ);
                    }
                }
            }
        } finally {
            rain.dispose();
            snow.dispose();
            dust.dispose();
        }
    });
});
