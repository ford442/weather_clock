import { describe, it, expect } from 'vitest';
import {
    TEMPORAL_NARRATIVE_CONFIG,
    computeTemporalNarrative,
    temperatureTint,
    temperatureWarmth
} from '../temporal-narrative.js';

const snap = (overrides = {}) => ({ temp: 15, weatherCode: 0, cloudCover: 10, ...overrides });

describe('temperatureWarmth', () => {
    it('maps the cold and hot anchors to the ends of the ramp', () => {
        expect(temperatureWarmth(TEMPORAL_NARRATIVE_CONFIG.coldAnchorC)).toBe(0);
        expect(temperatureWarmth(TEMPORAL_NARRATIVE_CONFIG.hotAnchorC)).toBe(1);
    });

    it('clamps beyond the anchors and falls back to neutral for unknown temps', () => {
        expect(temperatureWarmth(-40)).toBe(0);
        expect(temperatureWarmth(60)).toBe(1);
        expect(temperatureWarmth(null)).toBe(0.5);
        expect(temperatureWarmth(NaN)).toBe(0.5);
    });
});

describe('temperatureTint', () => {
    it('tints cold blue and hot red', () => {
        const cold = temperatureTint(-5);
        const hot = temperatureTint(31);
        expect(cold[2]).toBeGreaterThan(cold[0]);
        expect(hot[0]).toBeGreaterThan(hot[2]);
    });

    it('is neutral white at zero strength', () => {
        expect(temperatureTint(-20, 0)).toEqual([1, 1, 1]);
    });
});

describe('computeTemporalNarrative', () => {
    it('reads a warming afternoon as a rising trend', () => {
        const narrative = computeTemporalNarrative(snap({ temp: 10 }), snap({ temp: 16 }), snap({ temp: 22 }));

        expect(narrative.tempDelta).toBe(12);
        expect(narrative.tempTrend).toBe(1);
        expect(narrative.trendDirection).toBe('rising');
        expect(narrative.future.warmth).toBeGreaterThan(narrative.past.warmth);
        expect(narrative.future.tint[0]).toBeGreaterThan(narrative.past.tint[0]);
        expect(narrative.past.tint[2]).toBeGreaterThan(narrative.future.tint[2]);
    });

    it('reads nightfall cooling as a falling trend with blue future', () => {
        const narrative = computeTemporalNarrative(snap({ temp: 20 }), snap({ temp: 15 }), snap({ temp: 9 }));

        expect(narrative.trendDirection).toBe('falling');
        expect(narrative.tempTrend).toBeLessThan(0);
        expect(narrative.future.tint[2]).toBeGreaterThan(narrative.future.tint[0]);
    });

    it('treats a flat temperature as steady', () => {
        const narrative = computeTemporalNarrative(snap({ temp: 15 }), snap({ temp: 15.2 }), snap({ temp: 15.3 }));

        expect(narrative.trendDirection).toBe('steady');
        expect(Math.abs(narrative.tempTrend)).toBeLessThan(0.1);
    });

    it('marks a departing storm as clearing and an arriving one as worsening', () => {
        const storm = snap({ weatherCode: 95, cloudCover: 95, rainIntensity: 0.9 });
        const clear = snap({ weatherCode: 0, cloudCover: 5 });

        const clearingUp = computeTemporalNarrative(storm, snap({ weatherCode: 61 }), clear);
        expect(clearingUp.clearing).toBe(true);
        expect(clearingUp.worsening).toBe(false);
        expect(clearingUp.severityTrend).toBeLessThan(0);

        const closingIn = computeTemporalNarrative(clear, snap({ weatherCode: 61 }), storm);
        expect(closingIn.worsening).toBe(true);
        expect(closingIn.severityTrend).toBeGreaterThan(0);
    });

    it('drifts every zone toward the past, fastest where the scene is changing', () => {
        const stormLeaving = computeTemporalNarrative(
            snap({ weatherCode: 95, cloudCover: 100, rainIntensity: 1, temp: 8 }),
            snap({ weatherCode: 61, cloudCover: 70, rainIntensity: 0.4, temp: 14 }),
            snap({ weatherCode: 0, cloudCover: 5, temp: 21 })
        );

        // Time flows leftward: no zone ever drifts toward the future.
        expect(stormLeaving.past.drift).toBeLessThan(0);
        expect(stormLeaving.current.drift).toBeLessThan(0);
        expect(stormLeaving.future.drift).toBeLessThan(0);
        // The past zone clears out fastest, the future eases in slowest.
        expect(stormLeaving.past.drift).toBeLessThan(stormLeaving.current.drift);
        expect(stormLeaving.future.drift).toBeGreaterThan(stormLeaving.current.drift);

        const settled = computeTemporalNarrative(snap(), snap(), snap());
        expect(settled.changeRate).toBeLessThan(stormLeaving.changeRate);
        expect(Math.abs(settled.past.drift)).toBeLessThan(Math.abs(stormLeaving.past.drift));
    });

    it('falls back to the present temperature when a zone has no data', () => {
        const narrative = computeTemporalNarrative(null, snap({ temp: 12 }), undefined);

        expect(narrative.past.temp).toBe(12);
        expect(narrative.future.temp).toBe(12);
        expect(narrative.tempDelta).toBe(0);
        expect(narrative.trendDirection).toBe('steady');
    });

    it('passes the clamped day factor through for lighting cues', () => {
        expect(computeTemporalNarrative(snap(), snap(), snap(), { dayFactor: 2 }).dayFactor).toBe(1);
        expect(computeTemporalNarrative(snap(), snap(), snap(), { dayFactor: -3 }).dayFactor).toBe(-1);
        expect(computeTemporalNarrative(snap(), snap(), snap()).dayFactor).toBe(0);
    });
});

describe('timeline trend strength', () => {
    it('stays silent for a steady day and saturates on a big swing', async () => {
        const { computeTrendStrength, TREND_STEADY_C, TREND_SATURATION_C } =
            await import('../timeline/day-column-visuals.js');

        expect(computeTrendStrength(0)).toBe(0);
        expect(computeTrendStrength(TREND_STEADY_C)).toBe(0);
        expect(computeTrendStrength(-TREND_STEADY_C)).toBe(0);
        expect(computeTrendStrength(TREND_STEADY_C + TREND_SATURATION_C)).toBe(1);
        expect(computeTrendStrength(-40)).toBe(1);
        // Symmetric: warming and cooling of equal size read equally strongly.
        expect(computeTrendStrength(3)).toBe(computeTrendStrength(-3));
        expect(computeTrendStrength(3)).toBeGreaterThan(0);
        expect(computeTrendStrength(3)).toBeLessThan(1);
    });
});
