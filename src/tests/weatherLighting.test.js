import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { deriveDailyAtmosphere, updateSingleWeatherLighting } from '../weatherLighting.js';

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
