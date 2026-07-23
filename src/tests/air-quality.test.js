import { describe, it, expect } from 'vitest';
import {
    getUsAqiCategory,
    getAqiHaze,
    getPollenSeverity,
    getDominantPollen,
    getAlertSeverityStyle,
    isPulseSeverity
} from '../air-quality.js';

describe('air-quality mapping', () => {
    it('maps US AQI values to the correct EPA category', () => {
        expect(getUsAqiCategory(20)?.label).toBe('Good');
        expect(getUsAqiCategory(75)?.label).toBe('Moderate');
        expect(getUsAqiCategory(125)?.label).toBe('Unhealthy (Sensitive)');
        expect(getUsAqiCategory(175)?.label).toBe('Unhealthy');
        expect(getUsAqiCategory(250)?.label).toBe('Very Unhealthy');
        expect(getUsAqiCategory(400)?.label).toBe('Hazardous');
    });

    it('returns null for missing AQI', () => {
        expect(getUsAqiCategory(null)).toBeNull();
        expect(getUsAqiCategory(undefined)).toBeNull();
        expect(getUsAqiCategory(NaN)).toBeNull();
    });

    it('produces a 0..1 severity that increases with AQI', () => {
        const low = getUsAqiCategory(20).severity01;
        const high = getUsAqiCategory(250).severity01;
        expect(low).toBeLessThan(high);
        expect(high).toBeLessThanOrEqual(1);
    });

    it('computes zero haze at/below "Good" and ramps toward 1 by "Unhealthy"', () => {
        expect(getAqiHaze(30)).toBe(0);
        expect(getAqiHaze(50)).toBe(0);
        expect(getAqiHaze(200)).toBe(1);
        expect(getAqiHaze(125)).toBeCloseTo(0.5, 5);
        expect(getAqiHaze(null)).toBe(0);
    });

    it('maps pollen grain counts to severity tiers', () => {
        expect(getPollenSeverity(5)?.label).toBe('Low');
        expect(getPollenSeverity(20)?.label).toBe('Moderate');
        expect(getPollenSeverity(50)?.label).toBe('High');
        expect(getPollenSeverity(100)?.label).toBe('Very High');
        expect(getPollenSeverity(null)).toBeNull();
    });

    it('picks the highest pollen reading as the dominant one', () => {
        const dominant = getDominantPollen({ birch: 5, grass: 60, ragweed: 20 });
        expect(dominant.type).toBe('grass');
        expect(dominant.value).toBe(60);
        expect(dominant.label).toBe('High');
    });

    it('returns null dominant pollen when there is no data', () => {
        expect(getDominantPollen(null)).toBeNull();
        expect(getDominantPollen({ birch: null, grass: null })).toBeNull();
    });

    it('flags Severe/Extreme alerts for pulsing, not Moderate/Minor', () => {
        expect(isPulseSeverity('Extreme')).toBe(true);
        expect(isPulseSeverity('Severe')).toBe(true);
        expect(isPulseSeverity('Moderate')).toBe(false);
        expect(isPulseSeverity('Minor')).toBe(false);
        expect(isPulseSeverity(undefined)).toBe(false);
    });

    it('gives Extreme/Severe alerts the pulse style flag', () => {
        expect(getAlertSeverityStyle('Extreme').pulse).toBe(true);
        expect(getAlertSeverityStyle('Severe').pulse).toBe(true);
        expect(getAlertSeverityStyle('Moderate').pulse).toBe(false);
        expect(getAlertSeverityStyle('Unknown').pulse).toBe(false);
    });
});
