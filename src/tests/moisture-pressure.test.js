import { describe, it, expect } from 'vitest';
import { getHumidityHaze, getPressureAnomaly, STANDARD_PRESSURE_HPA } from '../moisture-pressure.js';

describe('humidity haze', () => {
    it('is zero at or below 60% and ramps to 1 by 100%', () => {
        expect(getHumidityHaze(40)).toBe(0);
        expect(getHumidityHaze(60)).toBe(0);
        expect(getHumidityHaze(100)).toBe(1);
        expect(getHumidityHaze(80)).toBeCloseTo(0.5, 5);
    });

    it('handles missing values', () => {
        expect(getHumidityHaze(null)).toBe(0);
        expect(getHumidityHaze(undefined)).toBe(0);
        expect(getHumidityHaze(NaN)).toBe(0);
    });
});

describe('pressure anomaly', () => {
    it('is zero at standard sea-level pressure', () => {
        expect(getPressureAnomaly(STANDARD_PRESSURE_HPA)).toBe(0);
    });

    it('is negative below standard and positive above it, saturating at ±1', () => {
        expect(getPressureAnomaly(STANDARD_PRESSURE_HPA - 20)).toBeCloseTo(-0.5, 5);
        expect(getPressureAnomaly(STANDARD_PRESSURE_HPA + 20)).toBeCloseTo(0.5, 5);
        expect(getPressureAnomaly(950)).toBe(-1);
        expect(getPressureAnomaly(1060)).toBe(1);
    });

    it('handles missing values', () => {
        expect(getPressureAnomaly(null)).toBe(0);
        expect(getPressureAnomaly(undefined)).toBe(0);
        expect(getPressureAnomaly(NaN)).toBe(0);
    });
});
