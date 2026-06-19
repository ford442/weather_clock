import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { deriveDailyAtmosphere } from '../weatherLighting.js';

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
