import { describe, it, expect } from 'vitest';
import { AstronomyService } from '../astronomy.js';
import * as THREE from 'three';

describe('AstronomyService', () => {
    it('should calculate sun and moon positions', () => {
        const service = new AstronomyService();
        const date = new Date('2023-10-27T12:00:00Z'); // Noon
        const lat = 40.7128;
        const lon = -74.006;

        const result = service.update(date, lat, lon, 20);

        expect(result).toHaveProperty('sunPosition');
        expect(result).toHaveProperty('moonPosition');
        expect(result).toHaveProperty('moonIllumination');

        expect(result.sunPosition).toBeInstanceOf(THREE.Vector3);
        expect(result.moonPosition).toBeInstanceOf(THREE.Vector3);
        expect(result.moonIllumination).toHaveProperty('fraction');
    });

    it('should calculate correct sun position for noon (roughly south/up)', () => {
        const service = new AstronomyService();
        // Solar noon in NY is roughly 12:00 EST (17:00 UTC) depending on equation of time,
        // but let's just check it's above horizon.
        const date = new Date('2023-06-21T17:00:00Z'); // Summer Solstice Noonish
        const lat = 40.7128;
        const lon = -74.006;

        const result = service.update(date, lat, lon, 20);

        // Sun should be high up
        expect(result.sunPosition.y).toBeGreaterThan(0);
    });

    it('should calculate correct sun position for midnight (below horizon)', () => {
        const service = new AstronomyService();
        const date = new Date('2023-06-21T05:00:00Z'); // Midnightish
        const lat = 40.7128;
        const lon = -74.006;

        const result = service.update(date, lat, lon, 20);

        // Sun should be below horizon
        expect(result.sunPosition.y).toBeLessThan(0);
    });

    it('should expose the sunlight and moonlight models alongside the positions', () => {
        const service = new AstronomyService();
        const result = service.update(new Date('2026-01-03T02:00:00Z'), 40.7128, -74.006, 20);

        // Earth–Sun distance is computed from orbital elements (SunCalc has no such field).
        expect(result.sunlight.distanceAu).toBeGreaterThan(0.98);
        expect(result.sunlight.distanceAu).toBeLessThan(1.02);
        expect(result.sunlight.irradianceFactor).toBeGreaterThan(1); // early January = perihelion
        expect(result.sunAltitude).toBeCloseTo(Math.asin(result.sunPosition.y / 20), 6);

        // SunCalc does report the Earth–Moon distance, which drives the super/micromoon swing.
        expect(result.moonDistanceKm).toBeGreaterThan(350000);
        expect(result.moonDistanceKm).toBeLessThan(410000);
        expect(result.moonlight.illuminatedFraction).toBeCloseTo(result.moonIllumination.fraction, 6);
        expect(result.moonlight.intensityFactor).toBeGreaterThanOrEqual(0);
        expect(result.moonlight.intensityFactor).toBeLessThanOrEqual(1.3);
    });

    it('should clone the lighting models so forecast snapshots stay independent', () => {
        const service = new AstronomyService();
        const first = service.getPositionsForDate('2026-06-21T23:00:00Z', 40.7128, -74.006, 20);
        const second = service.getPositionsForDate('2026-07-06T23:00:00Z', 40.7128, -74.006, 20);

        expect(first.moonlight).not.toBe(second.moonlight);
        expect(first.sunlight.irradianceFactor).not.toBeCloseTo(second.sunlight.irradianceFactor, 6);
        expect(first.sunPosition).not.toBe(second.sunPosition);
    });

    it('should calculate future-day positions at a requested local hour', () => {
        const service = new AstronomyService();
        const result = service.getPositionsForDateAtHour('2026-06-21', 12, 40.7128, -74.006, 20);

        expect(result.sunPosition).toBeInstanceOf(THREE.Vector3);
        expect(result.moonPosition).toBeInstanceOf(THREE.Vector3);
        expect(result.sunPosition.y).toBeGreaterThan(0);
    });
});
