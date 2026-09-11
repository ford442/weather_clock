import { describe, it, expect } from 'vitest';
import {
    clamp01,
    REDUCED_MOTION_ATTENUATION,
    rainGainForIntensity,
    rainFilterFrequencyForIntensity,
    windGainForSpeed,
    windFilterFrequencyForSpeed,
    birdBedGainForSunAltitude,
    cricketBedGainForSunAltitude,
    thunderPeakGainForIntensity
} from '../audio/gain-curves.js';

describe('clamp01', () => {
    it('clamps to the 0..1 range', () => {
        expect(clamp01(-5)).toBe(0);
        expect(clamp01(0.5)).toBe(0.5);
        expect(clamp01(5)).toBe(1);
    });
});

describe('rain gain/filter curves', () => {
    it('scales linearly with rain intensity', () => {
        expect(rainGainForIntensity(0)).toBe(0);
        expect(rainGainForIntensity(0.5)).toBeCloseTo(0.35);
        expect(rainGainForIntensity(1)).toBeCloseTo(0.7);
    });

    it('clamps out-of-range intensity before mapping', () => {
        expect(rainGainForIntensity(-1)).toBe(0);
        expect(rainGainForIntensity(2)).toBeCloseTo(0.7);
    });

    it('opens the bandpass filter as rain intensifies', () => {
        expect(rainFilterFrequencyForIntensity(0)).toBe(2000);
        expect(rainFilterFrequencyForIntensity(1)).toBe(5000);
    });
});

describe('wind gain/filter curves', () => {
    it('normalizes wind speed against a 50 unit ceiling', () => {
        expect(windGainForSpeed(0)).toBe(0);
        expect(windGainForSpeed(25)).toBeCloseTo(0.25);
        expect(windGainForSpeed(50)).toBeCloseTo(0.5);
    });

    it('clamps negative and above-ceiling speeds', () => {
        expect(windGainForSpeed(-10)).toBe(0);
        expect(windGainForSpeed(500)).toBeCloseTo(0.5);
    });

    it('raises the lowpass cutoff with wind speed', () => {
        expect(windFilterFrequencyForSpeed(0)).toBe(150);
        expect(windFilterFrequencyForSpeed(50)).toBe(1650);
    });
});

describe('diurnal bird/cricket bed gates', () => {
    it('peaks birdsong just after sunrise and is silent elsewhere', () => {
        expect(birdBedGainForSunAltitude(0.17)).toBeCloseTo(0.12);
        expect(birdBedGainForSunAltitude(-0.5)).toBe(0);
        expect(birdBedGainForSunAltitude(0.4)).toBeCloseTo(0);
        expect(birdBedGainForSunAltitude(1)).toBe(0);
    });

    it('gates crickets in fully to deep night, silent in daylight', () => {
        expect(cricketBedGainForSunAltitude(-1)).toBeCloseTo(0.1);
        expect(cricketBedGainForSunAltitude(0)).toBe(0);
        expect(cricketBedGainForSunAltitude(0.5)).toBe(0);
    });
});

describe('thunder peak gain', () => {
    it('maps flash intensity to a 0.4..0.9 gain range', () => {
        expect(thunderPeakGainForIntensity(0)).toBeCloseTo(0.4);
        expect(thunderPeakGainForIntensity(1)).toBeCloseTo(0.9);
        expect(thunderPeakGainForIntensity(-5)).toBeCloseTo(0.4);
        expect(thunderPeakGainForIntensity(5)).toBeCloseTo(0.9);
    });
});

describe('reduced-motion attenuation', () => {
    it('is a heavy but non-zero attenuation factor', () => {
        expect(REDUCED_MOTION_ATTENUATION).toBeGreaterThan(0);
        expect(REDUCED_MOTION_ATTENUATION).toBeLessThan(0.5);
    });
});
