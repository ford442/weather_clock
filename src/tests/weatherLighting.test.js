import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { deriveDailyAtmosphere, getDayFactor, updateSingleWeatherLighting } from '../weatherLighting.js';
import { getMoonlightModel, getSunlightModel } from '../celestialLighting.js';

describe('Daily atmosphere lighting', () => {
    it('derives brighter blue sky controls for clear summer than cloudy winter', () => {
        const summerAstro = { sunPosition: new THREE.Vector3(0, 18, 4) };
        const winterAstro = { sunPosition: new THREE.Vector3(0, 5, 4) };

        const clearSummer = deriveDailyAtmosphere(
            { weatherCode: 0, cloudCover: 5, visibility: 14000, severity: 0 },
            summerAstro,
            { date: new Date('2026-06-21T12:00:00'), lat: 40.7128 }
        );
        const cloudyWinter = deriveDailyAtmosphere(
            { weatherCode: 3, cloudCover: 95, visibility: 3500, severity: 30 },
            winterAstro,
            { date: new Date('2026-12-21T12:00:00'), lat: 40.7128 }
        );

        expect(clearSummer.rayleigh).toBeGreaterThan(cloudyWinter.rayleigh);
        expect(clearSummer.sunIntensityMultiplier).toBeGreaterThan(cloudyWinter.sunIntensityMultiplier);
        expect(cloudyWinter.turbidity).toBeGreaterThan(clearSummer.turbidity);
        expect(cloudyWinter.shadowRadius).toBeGreaterThan(clearSummer.shadowRadius);
    });

    it('increases haze and fog response for low visibility storm days', () => {
        const storm = deriveDailyAtmosphere(
            { weatherCode: 95, cloudCover: 90, visibility: 1200, severity: 100 },
            { sunPosition: new THREE.Vector3(0, 8, 4) },
            { date: new Date('2026-08-12T18:00:00'), lat: 40.7128 }
        );

        expect(storm.mieCoefficient).toBeGreaterThan(0.04);
        expect(storm.fogDensityMultiplier).toBeGreaterThan(2);
        expect(storm.sunIntensityMultiplier).toBeLessThan(0.5);
    });
});

describe('UV-driven sun harshness', () => {
    function makeRig() {
        const scene = new THREE.Scene();
        scene.fog = new THREE.FogExp2(0x000000, 0.001);
        const sunLight = new THREE.DirectionalLight(0xffffff, 1);
        sunLight.position.set(0, 20, 0);
        const moonLight = new THREE.DirectionalLight(0xffffff, 0);
        moonLight.position.set(0, -20, 0);
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
        const sky = {
            material: {
                uniforms: {
                    sunPosition: { value: new THREE.Vector3() },
                    turbidity: { value: 2 },
                    rayleigh: { value: 3 },
                    mieCoefficient: { value: 0.005 },
                    mieDirectionalG: { value: 0.7 }
                }
            },
            userData: {}
        };
        return { scene, sunLight, moonLight, ambientLight, sky };
    }

    /** Run the applicator to convergence so the smoothed intensities settle. */
    function converge(snap) {
        const rig = makeRig();
        for (let i = 0; i < 400; i++) {
            updateSingleWeatherLighting(rig.scene, rig.sunLight, rig.moonLight, rig.ambientLight, rig.sky, snap, null);
        }
        return { sunIntensity: rig.sunLight.intensity, mie: rig.sky.material.uniforms.mieCoefficient.value };
    }

    const clearDay = { cloudCover: 0, weatherCode: 0, windSpeed: 0, visibility: 20000, severity: 0 };

    it('brightens the sun and thickens Mie scattering once UV passes 6', () => {
        const mild = converge({ ...clearDay, uvIndex: 4 });
        const harsh = converge({ ...clearDay, uvIndex: 10 });

        expect(harsh.sunIntensity).toBeGreaterThan(mild.sunIntensity);
        expect(harsh.mie).toBeGreaterThan(mild.mie);
    });

    it('leaves the sun unchanged below the UV 6 threshold', () => {
        const none = converge({ ...clearDay, uvIndex: 0 });
        const stillMild = converge({ ...clearDay, uvIndex: 6 });

        // The module keeps smoothing state between runs, so allow a little residual
        // drift: what matters is that UV 6 does not lift the sun the way UV 10 does.
        const drift = Math.abs(stillMild.sunIntensity - none.sunIntensity) / none.sunIntensity;
        expect(drift).toBeLessThan(0.01);
        expect(stillMild.mie).toBeCloseTo(none.mie, 6);
    });
});

describe('Physically-modulated sun and moon lighting', () => {
    /**
     * @param {{sunY?: number, moonY?: number}} [positions]
     */
    function makeNightRig({ sunY = -20, moonY = 20 } = {}) {
        const scene = new THREE.Scene();
        scene.fog = new THREE.FogExp2(0x000000, 0.001);
        const sunLight = new THREE.DirectionalLight(0xffffff, 1);
        sunLight.position.set(0, sunY, 0);
        const moonLight = new THREE.DirectionalLight(0xffffff, 0);
        moonLight.position.set(0, moonY, 0);
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
        const sky = {
            material: {
                uniforms: {
                    sunPosition: { value: new THREE.Vector3() },
                    turbidity: { value: 2 },
                    rayleigh: { value: 3 },
                    mieCoefficient: { value: 0.005 },
                    mieDirectionalG: { value: 0.7 }
                }
            },
            userData: {}
        };
        return { scene, sunLight, moonLight, ambientLight, sky };
    }

    /** The applicator smooths toward its targets, so run it to convergence. */
    function converge(snap, astroData, positions) {
        const rig = makeNightRig(positions);
        for (let i = 0; i < 600; i++) {
            updateSingleWeatherLighting(
                rig.scene,
                rig.sunLight,
                rig.moonLight,
                rig.ambientLight,
                rig.sky,
                snap,
                astroData
            );
        }
        return {
            sunIntensity: rig.sunLight.intensity,
            moonIntensity: rig.moonLight.intensity,
            moonColor: rig.moonLight.color.clone()
        };
    }

    const clearNight = { cloudCover: 0, weatherCode: 0, windSpeed: 0, visibility: 20000, severity: 0 };
    const clearDay = { cloudCover: 0, weatherCode: 0, windSpeed: 0, visibility: 20000, severity: 0 };

    /**
     * @param {number} fraction
     * @param {number} altitudeDeg
     * @param {number} [distanceKm]
     */
    const nightAstro = (fraction, altitudeDeg, distanceKm) => ({
        sunPosition: new THREE.Vector3(0, -20, 0),
        moonIllumination: { fraction, phase: 0.5, angle: 0 },
        moonlight: getMoonlightModel(
            { fraction, phase: 0.5 },
            { altitudeRad: (altitudeDeg * Math.PI) / 180, distanceKm }
        )
    });

    it('brightens the sun at perihelion relative to aphelion', () => {
        const sunAstro = (date) => ({
            sunPosition: new THREE.Vector3(0, 20, 0),
            sunlight: getSunlightModel(date, Math.PI / 3)
        });

        const perihelion = converge(clearDay, sunAstro(new Date('2026-01-03T12:00:00Z')), { sunY: 20, moonY: -20 });
        const aphelion = converge(clearDay, sunAstro(new Date('2026-07-05T12:00:00Z')), { sunY: 20, moonY: -20 });

        expect(perihelion.sunIntensity).toBeGreaterThan(aphelion.sunIntensity);
        // Subtle by design: the whole annual swing is a few percent, not a jump.
        const swing = perihelion.sunIntensity / aphelion.sunIntensity;
        expect(swing).toBeGreaterThan(1.02);
        expect(swing).toBeLessThan(1.08);
    });

    it('makes a full moon far brighter than a half moon, beyond the 2:1 a fraction would give', () => {
        const full = converge(clearNight, nightAstro(1, 80));
        const half = converge(clearNight, nightAstro(0.5, 80));

        expect(full.moonIntensity).toBeGreaterThan(half.moonIntensity);
        expect(full.moonIntensity / half.moonIntensity).toBeGreaterThan(2.2);
    });

    it('fades moonlight out as the moon sinks toward the horizon', () => {
        const high = converge(clearNight, nightAstro(1, 70), { moonY: 19 });
        const low = converge(clearNight, nightAstro(1, 6), { moonY: 2 });
        const set = converge(clearNight, nightAstro(1, -8), { moonY: -3 });

        expect(high.moonIntensity).toBeGreaterThan(low.moonIntensity);
        expect(low.moonIntensity).toBeGreaterThan(set.moonIntensity);
        expect(set.moonIntensity).toBeLessThan(0.01);
    });

    it('lifts a supermoon above a micromoon at the same phase and altitude', () => {
        const supermoon = converge(clearNight, nightAstro(1, 80, 356500));
        const micromoon = converge(clearNight, nightAstro(1, 80, 406700));

        expect(supermoon.moonIntensity).toBeGreaterThan(micromoon.moonIntensity);
        expect(supermoon.moonIntensity / micromoon.moonIntensity).toBeGreaterThan(1.15);
    });

    it('tints a dim crescent blue and a low moon amber', () => {
        const full = converge(clearNight, nightAstro(1, 80));
        const crescent = converge(clearNight, nightAstro(0.08, 80));
        const lowFull = converge(clearNight, nightAstro(1, 5), { moonY: 1.7 });

        // Purkinje shift: the crescent's light is relatively bluer.
        expect(crescent.moonColor.b - crescent.moonColor.r).toBeGreaterThan(full.moonColor.b - full.moonColor.r);
        // Extinction: the low moon's light is relatively redder.
        expect(lowFull.moonColor.r - lowFull.moonColor.b).toBeGreaterThan(full.moonColor.r - full.moonColor.b);
    });
});

describe('Day/night handover', () => {
    it('is continuous and monotonic across the whole twilight band', () => {
        expect(getDayFactor(-10)).toBe(0);
        expect(getDayFactor(10)).toBe(1);
        expect(getDayFactor(0)).toBeCloseTo(0.5, 5);

        let previous = 0;
        for (let sunY = -7; sunY <= 7; sunY += 0.25) {
            const factor = getDayFactor(sunY);
            expect(factor).toBeGreaterThanOrEqual(previous);
            previous = factor;
        }
        expect(previous).toBe(1);
    });

    it('eases in and out rather than ramping linearly', () => {
        // A smoothstep's slope is near zero at the twilight edges and steepest at
        // the midpoint; a linear ramp's slope would be identical everywhere.
        const edgeSlope = getDayFactor(-5.5) - getDayFactor(-6);
        const midSlope = getDayFactor(0.25) - getDayFactor(-0.25);
        expect(midSlope).toBeGreaterThan(edgeSlope * 4);
    });
});
