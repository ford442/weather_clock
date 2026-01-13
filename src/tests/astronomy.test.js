import { describe, it, expect, vi } from 'vitest';
import { AstronomyService } from '../astronomy.js';
import * as THREE from 'three';

describe('AstronomyService', () => {
    it('should calculate sun and moon positions', () => {
        const service = new AstronomyService();
        const date = new Date('2023-10-27T12:00:00Z'); // Noon
        const lat = 40.7128;
        const lon = -74.0060;

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
        const lon = -74.0060;

        const result = service.update(date, lat, lon, 20);

        // Sun should be high up
        expect(result.sunPosition.y).toBeGreaterThan(0);
    });

    it('should calculate correct sun position for midnight (below horizon)', () => {
        const service = new AstronomyService();
        const date = new Date('2023-06-21T05:00:00Z'); // Midnightish
        const lat = 40.7128;
        const lon = -74.0060;

        const result = service.update(date, lat, lon, 20);

        // Sun should be below horizon
        expect(result.sunPosition.y).toBeLessThan(0);
    });
});
