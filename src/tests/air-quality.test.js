import { describe, it, expect } from 'vitest';
import {
    getUsAqiCategory,
    getAqiHaze,
    getPollenSeverity,
    getDominantPollen,
    getAlertSeverityStyle,
    isPulseSeverity,
    getEuropeanAqiCategory,
    getPrimaryAqi,
    getUvCategory,
    getUvHarshness,
    getUvSunHarshness,
    getPollenIntensity,
    getAlertTier,
    getAlertTierTheme
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

describe('European AQI mapping', () => {
    it('maps European AQI values to the EEA bands', () => {
        expect(getEuropeanAqiCategory(10)?.label).toBe('Good');
        expect(getEuropeanAqiCategory(30)?.label).toBe('Fair');
        expect(getEuropeanAqiCategory(50)?.label).toBe('Moderate');
        expect(getEuropeanAqiCategory(70)?.label).toBe('Poor');
        expect(getEuropeanAqiCategory(95)?.label).toBe('Very Poor');
        expect(getEuropeanAqiCategory(130)?.label).toBe('Extremely Poor');
    });

    it('returns null for missing values', () => {
        expect(getEuropeanAqiCategory(null)).toBeNull();
        expect(getEuropeanAqiCategory(NaN)).toBeNull();
    });
});

describe('primary AQI selection', () => {
    const reading = { usAqi: 80, europeanAqi: 35 };

    it('leads with the US index in US-scale countries', () => {
        expect(getPrimaryAqi(reading, 'us')).toMatchObject({ scale: 'US', value: 80, label: 'Moderate' });
    });

    it('leads with the European index everywhere else', () => {
        expect(getPrimaryAqi(reading, 'fr')).toMatchObject({ scale: 'EU', value: 35, label: 'Fair' });
        expect(getPrimaryAqi(reading, null)).toMatchObject({ scale: 'EU' });
    });

    it('falls back to whichever index the API returned', () => {
        expect(getPrimaryAqi({ usAqi: 80, europeanAqi: null }, 'fr')).toMatchObject({ scale: 'US', value: 80 });
        expect(getPrimaryAqi({ usAqi: null, europeanAqi: 35 }, 'us')).toMatchObject({ scale: 'EU', value: 35 });
        expect(getPrimaryAqi({ usAqi: null, europeanAqi: null }, 'us')).toBeNull();
        expect(getPrimaryAqi(null, 'us')).toBeNull();
    });
});

describe('UV index mapping', () => {
    it('maps UV values to WHO categories', () => {
        expect(getUvCategory(1)?.label).toBe('Low');
        expect(getUvCategory(4)?.label).toBe('Moderate');
        expect(getUvCategory(6.4)?.label).toBe('High');
        expect(getUvCategory(9)?.label).toBe('Very High');
        expect(getUvCategory(12)?.label).toBe('Extreme');
        expect(getUvCategory(null)).toBeNull();
    });

    it('carries protection advice that escalates with the index', () => {
        expect(getUvCategory(1)?.advice).toMatch(/No protection/);
        expect(getUvCategory(12)?.advice).toMatch(/indoors/);
    });

    it('reports zero harshness at or below the "High" threshold and 1 at the top', () => {
        expect(getUvHarshness(0)).toBe(0);
        expect(getUvHarshness(6)).toBe(0);
        expect(getUvHarshness(8.5)).toBeCloseTo(0.5, 5);
        expect(getUvHarshness(11)).toBe(1);
        expect(getUvHarshness(14)).toBe(1);
        expect(getUvHarshness(null)).toBe(0);
    });

    it('raises the sun intensity and Mie multipliers once UV passes 6', () => {
        const mild = getUvSunHarshness(4);
        const harsh = getUvSunHarshness(9);
        expect(mild.sunIntensityMultiplier).toBe(1);
        expect(mild.mieBoost).toBe(0);
        expect(harsh.sunIntensityMultiplier).toBeGreaterThan(mild.sunIntensityMultiplier);
        expect(harsh.mieBoost).toBeGreaterThan(mild.mieBoost);
    });
});

describe('pollen intensity', () => {
    it('is zero below "Moderate" and saturates at 100 grains/m³', () => {
        expect(getPollenIntensity({ birch: 5, grass: 10 })).toBe(0);
        expect(getPollenIntensity({ birch: 60, grass: 10 })).toBeCloseTo(0.5, 5);
        expect(getPollenIntensity({ ragweed: 140 })).toBe(1);
        expect(getPollenIntensity(null)).toBe(0);
        expect(getPollenIntensity({ birch: null })).toBe(0);
    });
});

describe('alert tiers', () => {
    it('classifies watch / warning / emergency from the event and severity', () => {
        expect(getAlertTier({ event: 'Tornado Watch', severity: 'Moderate' })).toBe('watch');
        expect(getAlertTier({ event: 'Severe Thunderstorm Warning', severity: 'Moderate' })).toBe('warning');
        expect(getAlertTier({ event: 'Flood Advisory', severity: 'Severe' })).toBe('warning');
        expect(getAlertTier({ event: 'Tornado Emergency', severity: 'Severe' })).toBe('emergency');
        expect(getAlertTier({ event: 'Heat Advisory', severity: 'Extreme' })).toBe('emergency');
        expect(getAlertTier(null)).toBe('watch');
    });

    it('escalates pulse and accent boost with the tier', () => {
        const watch = getAlertTierTheme('watch');
        const warning = getAlertTierTheme('warning');
        const emergency = getAlertTierTheme('emergency');
        expect(watch.pulse).toBe(false);
        expect(warning.pulse).toBe(true);
        expect(emergency.pulseSpeed).toBeGreaterThan(warning.pulseSpeed);
        expect(emergency.accentBoost).toBeGreaterThan(warning.accentBoost);
        expect(getAlertTierTheme('nope')).toEqual(watch);
    });
});
