import { describe, it, expect } from 'vitest';
import {
    meanAbsoluteError,
    meanAbsoluteErrorGated,
    calculateAccuracyMetrics,
    accuracyCacheSuffix,
    ACCURACY_CACHE_TTL_MS
} from '../accuracy.js';

describe('meanAbsoluteError', () => {
    it('averages absolute differences over all indices by default', () => {
        const result = meanAbsoluteError([10, 12, 14], [11, 12, 15]);
        expect(result.n).toBe(3);
        expect(result.value).toBeCloseTo(2 / 3, 5);
    });

    it('skips non-numeric pairs rather than throwing', () => {
        const result = meanAbsoluteError([10, null, 14, undefined], [11, 12, null, 5]);
        expect(result).toEqual({ value: 1, n: 1 });
    });

    it('restricts comparison to the provided indices', () => {
        const actual = [10, 20, 30, 40];
        const predicted = [10, 25, 30, 100];
        expect(meanAbsoluteError(actual, predicted, [0, 2])).toEqual({ value: 0, n: 2 });
    });

    it('returns null when there are no valid pairs', () => {
        expect(meanAbsoluteError([null, undefined], [null, undefined])).toBeNull();
        expect(meanAbsoluteError([1, 2], [])).toBeNull();
    });

    it('returns null when predicted is not an array (endpoint lacks that series)', () => {
        expect(meanAbsoluteError([1, 2, 3], undefined)).toBeNull();
    });
});

describe('meanAbsoluteErrorGated', () => {
    it('returns the stats when the sample size meets the minimum', () => {
        const actual = [1, 2, 3, 4];
        const predicted = [1, 2, 3, 5];
        expect(meanAbsoluteErrorGated(actual, predicted, 4)).toEqual({ value: 0.25, n: 4 });
    });

    it('returns null when the sample size is below the minimum', () => {
        const actual = [1, 2, 3];
        const predicted = [1, 2, 3];
        expect(meanAbsoluteErrorGated(actual, predicted, 4)).toBeNull();
    });
});

describe('calculateAccuracyMetrics', () => {
    it('computes MAE, RMSE, and skill vs a persistence baseline', () => {
        const result = calculateAccuracyMetrics([10, 12, 14, 16], [11, 12, 15, 15]);
        expect(result.mae).toBeCloseTo(0.75, 2);
        expect(result.rmse).toBeCloseTo(0.87, 2);
        expect(result.skill).toBeGreaterThan(0);
        expect(result.skill).toBeLessThanOrEqual(1);
    });

    it('returns nulls for empty or mismatched-length input', () => {
        expect(calculateAccuracyMetrics([], [])).toEqual({ mae: null, rmse: null, skill: null });
        expect(calculateAccuracyMetrics([1, 2], [1])).toEqual({ mae: null, rmse: null, skill: null });
    });

    it('does not divide by zero when actual values never vary', () => {
        expect(calculateAccuracyMetrics([5, 5, 5], [5, 5, 5]).skill).toBe(1);
        expect(calculateAccuracyMetrics([5, 5, 5], [6, 6, 6]).skill).toBe(0);
    });
});

describe('accuracyCacheSuffix', () => {
    it('builds a date-stamped suffix from the given prefix', () => {
        const date = new Date(2026, 8, 11); // Sept 11, 2026 (local)
        expect(accuracyCacheSuffix('accuracy', date)).toBe('accuracy_2026-09-11');
    });

    it('zero-pads single-digit months and days', () => {
        const date = new Date(2026, 0, 5); // Jan 5, 2026
        expect(accuracyCacheSuffix('accuracy', date)).toBe('accuracy_2026-01-05');
    });
});

describe('ACCURACY_CACHE_TTL_MS', () => {
    it('is once per day', () => {
        expect(ACCURACY_CACHE_TTL_MS).toBe(24 * 60 * 60 * 1000);
    });
});
