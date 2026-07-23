import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for src/timeline/AnomalyCalculator.js — z-scores and WMO events.
 *
 * The module self-runs runTests() at import time when `window` is undefined,
 * so tests stub a global window before dynamically importing it.
 */

let AnomalyCalculator;

beforeEach(async () => {
    vi.stubGlobal('window', {});
    vi.resetModules();
    ({ AnomalyCalculator } = await import('../timeline/AnomalyCalculator.js'));
});

afterEach(() => {
    vi.unstubAllGlobals();
});

/** 366-entry climatology: every day has mean 15°C, stdDev 2°C. */
function makeClimatology(overrides = {}) {
    return Array.from({ length: 366 }, (_, i) => overrides[i + 1] ?? { mean: 15, stdDev: 2 });
}

describe('AnomalyCalculator', () => {
    it('rejects non-array climatology data', () => {
        expect(() => new AnomalyCalculator(null)).toThrow('Climatology data must be provided as an array');
        expect(() => new AnomalyCalculator('nope')).toThrow('Climatology data must be provided as an array');
    });

    it('computes z-scores as (observed - mean) / stdDev', () => {
        const calc = new AnomalyCalculator(makeClimatology());
        const date = new Date(2026, 5, 15); // June 15
        expect(calc.calculateZScore(date, 19)).toBe(2); // (19-15)/2
        expect(calc.calculateZScore(date, 15)).toBe(0);
        expect(calc.calculateZScore(date, 11)).toBe(-2);
    });

    it('computes anomalies as (observed - mean)', () => {
        const calc = new AnomalyCalculator(makeClimatology());
        expect(calc.calculateAnomaly(new Date(2026, 5, 15), 18.5)).toBe(3.5);
    });

    it('returns 0 (with a warning) for zero standard deviation', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const probe = new AnomalyCalculator(makeClimatology());
        const date = new Date(2026, 5, 15);
        const dayOfYear = probe.getDayOfYear(date); // DST-safe: ask the implementation
        const calc = new AnomalyCalculator(makeClimatology({ [dayOfYear]: { mean: 15, stdDev: 0 } }));
        expect(calc.calculateZScore(date, 99)).toBe(0);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('throws when climatology is missing for the day of year', () => {
        const calc = new AnomalyCalculator([{ mean: 15, stdDev: 2 }]); // only day 1
        expect(() => calc.calculateZScore(new Date(2026, 5, 15), 20)).toThrow(
            /No climatology data available for day of year/
        );
    });

    it('throws on invalid dates', () => {
        const calc = new AnomalyCalculator(makeClimatology());
        expect(() => calc.getDayOfYear('not-a-date')).toThrow('Invalid date');
    });

    it('computes day-of-year with leap-year handling', () => {
        const calc = new AnomalyCalculator(makeClimatology());
        expect(calc.getDayOfYear(new Date(2024, 0, 1))).toBe(1); // Jan 1
        expect(calc.getDayOfYear(new Date(2024, 1, 29))).toBe(60); // Feb 29, leap year
        expect(calc.getDayOfYear(new Date(2023, 11, 31))).toBe(365); // Dec 31, non-leap
        expect(calc.getDayOfYear(new Date(2024, 11, 31))).toBe(366); // Dec 31, leap
    });

    it('classifies z-scores at the documented boundaries', () => {
        const calc = new AnomalyCalculator(makeClimatology());
        expect(calc.classifyZScore(2.5)).toBe('significantly_above_normal');
        expect(calc.classifyZScore(2.0)).toBe('above_normal'); // boundary is exclusive
        expect(calc.classifyZScore(1.5)).toBe('above_normal');
        expect(calc.classifyZScore(1.0)).toBe('near_normal'); // boundary is exclusive
        expect(calc.classifyZScore(0)).toBe('near_normal');
        expect(calc.classifyZScore(-1.0)).toBe('near_normal');
        expect(calc.classifyZScore(-1.5)).toBe('below_normal');
        expect(calc.classifyZScore(-2.0)).toBe('below_normal'); // boundary is inclusive
        expect(calc.classifyZScore(-2.5)).toBe('significantly_below_normal');
    });

    it('enriches days via processDays', () => {
        const calc = new AnomalyCalculator(makeClimatology());
        const [processed] = calc.processDays([{ date: new Date(2026, 5, 15), temperature: 19 }]);
        expect(processed.zScore).toBe(2);
        expect(processed.anomaly).toBe(4);
        expect(processed.classification).toBe('above_normal');
    });

    it('finds consecutive sequences and enforces the minimum length', () => {
        const calc = new AnomalyCalculator(makeClimatology());
        const days = [
            { date: '2026-06-01', zScore: 2 },
            { date: '2026-06-02', zScore: 2.5 },
            { date: '2026-06-03', zScore: 1.8 },
            // gap
            { date: '2026-06-10', zScore: 2.2 },
            { date: '2026-06-11', zScore: 1.9 }
        ];

        expect(calc.findConsecutiveSequences(days, 3)).toHaveLength(1);
        expect(calc.findConsecutiveSequences(days, 2)).toHaveLength(2);
        expect(calc.findConsecutiveSequences(days, 4)).toHaveLength(0);
        expect(calc.findConsecutiveSequences([], 1)).toEqual([]);
        expect(calc.findConsecutiveSequences(null, 1)).toEqual([]);

        const [event] = calc.findConsecutiveSequences(days, 3);
        expect(event.duration).toBe(3);
        expect(event.maxZScore).toBe(2.5);
        expect(event.minZScore).toBe(1.8);
        expect(event.avgZScore).toBeCloseTo((2 + 2.5 + 1.8) / 3);
    });

    it('detects heat waves per the WMO guideline (5+ days above +1.5σ)', () => {
        const calc = new AnomalyCalculator(makeClimatology());
        const hot = (d) => ({ date: `2026-07-${String(d).padStart(2, '0')}`, zScore: 2 });
        const days = [1, 2, 3, 4, 5].map(hot);

        expect(calc.detectHeatWave(days)).toHaveLength(1); // exactly 5 days ⇒ detected
        expect(calc.detectHeatWave(days.slice(0, 4))).toHaveLength(0); // 4 days ⇒ too short
        expect(
            calc.detectHeatWave([...days, { date: '2026-07-06', zScore: 1.0 }]) // 6th day below threshold
        ).toHaveLength(1);
    });

    it('detects cold snaps (2+ days below -1.5σ)', () => {
        const calc = new AnomalyCalculator(makeClimatology());
        const days = [
            { date: '2026-01-10', zScore: -2 },
            { date: '2026-01-11', zScore: -1.7 }
        ];
        expect(calc.detectColdSnap(days)).toHaveLength(1);
        expect(calc.detectColdSnap(days.slice(0, 1))).toHaveLength(0);
    });
});
