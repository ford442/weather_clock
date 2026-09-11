import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TimelineData } from '../timeline/TimelineData.js';

global.fetch = vi.fn();

beforeEach(() => {
    fetch.mockReset();
});

afterEach(() => {
    vi.useRealTimers();
});

function dateStr(daysAgo) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString().split('T')[0];
}

function buildPreviousRunsResponse({ pastDays = 3, day1Error = 1 } = {}) {
    const times = [];
    const actual = [];
    const day1 = [];

    for (let d = pastDays; d >= 1; d--) {
        const day = dateStr(d);
        for (let h = 0; h < 24; h++) {
            times.push(`${day}T${String(h).padStart(2, '0')}:00`);
            actual.push(10);
            day1.push(10 + day1Error);
        }
    }

    return {
        hourly: {
            time: times,
            temperature_2m: actual,
            temperature_2m_previous_day1: day1
        }
    };
}

function makeHistoricalDay(daysAgo) {
    return { date: dateStr(daysAgo), type: 'historical' };
}

describe('TimelineData.calculateAccuracy', () => {
    it('computes MAE, RMSE, and skill vs a persistence baseline', () => {
        const timelineData = new TimelineData();
        const actual = [10, 12, 14, 16];
        const predicted = [11, 12, 15, 15];

        const result = timelineData.calculateAccuracy(actual, predicted);

        expect(result.mae).toBeCloseTo(0.75, 2);
        expect(result.rmse).toBeCloseTo(0.87, 2);
        expect(result.skill).toBeGreaterThan(0);
        expect(result.skill).toBeLessThanOrEqual(1);
    });

    it('returns nulls for empty or mismatched-length input', () => {
        const timelineData = new TimelineData();
        expect(timelineData.calculateAccuracy([], [])).toEqual({ mae: null, rmse: null, skill: null });
        expect(timelineData.calculateAccuracy([1, 2], [1])).toEqual({ mae: null, rmse: null, skill: null });
    });

    it('does not divide by zero when actual values never vary (perfect persistence baseline)', () => {
        const timelineData = new TimelineData();
        const perfect = timelineData.calculateAccuracy([5, 5, 5], [5, 5, 5]);
        expect(perfect.skill).toBe(1);

        const imperfect = timelineData.calculateAccuracy([5, 5, 5], [6, 6, 6]);
        expect(imperfect.skill).toBe(0);
        expect(Number.isFinite(imperfect.skill)).toBe(true);
    });
});

describe('TimelineData.enrichWithAccuracy', () => {
    it('attaches accuracy metrics to historical days using Previous Runs data', async () => {
        const timelineData = new TimelineData();
        fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => buildPreviousRunsResponse({ pastDays: 2, day1Error: 1 })
        });

        const days = [makeHistoricalDay(1), makeHistoricalDay(2), { date: dateStr(-1), type: 'forecast' }];

        await timelineData.enrichWithAccuracy(days, 40.71, -74.01);

        expect(days[0].accuracy).toBeDefined();
        expect(days[0].accuracy.mae).toBe(1);
        expect(days[0].accuracy.tempScore).toBeCloseTo(1 - 1 / 6, 2);
        expect(days[1].accuracy).toBeDefined();
        expect(days[2].accuracy).toBeUndefined(); // forecast day is never enriched

        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch.mock.calls[0][0]).toContain('previous-runs-api.open-meteo.com');
    });

    it('leaves accuracy undefined when the endpoint has no data for the location', async () => {
        const timelineData = new TimelineData();
        fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ hourly: { time: [] } })
        });

        const days = [makeHistoricalDay(1)];
        await timelineData.enrichWithAccuracy(days, 0, 0);

        expect(days[0].accuracy).toBeUndefined();
    });

    it('leaves accuracy undefined when the fetch fails', async () => {
        const timelineData = new TimelineData();
        fetch.mockRejectedValueOnce(new Error('Network disconnected'));

        const days = [makeHistoricalDay(1)];
        await timelineData.enrichWithAccuracy(days, 40.71, -74.01);

        expect(days[0].accuracy).toBeUndefined();
    });

    it('leaves accuracy undefined when a day has too few comparison hours', async () => {
        const timelineData = new TimelineData();
        const response = buildPreviousRunsResponse({ pastDays: 1, day1Error: 1 });
        // Null out all but 3 hours for the single day, below the minimum sample size
        for (let i = 0; i < 21; i++) {
            response.hourly.temperature_2m_previous_day1[i] = null;
        }
        fetch.mockResolvedValueOnce({ ok: true, json: async () => response });

        const days = [makeHistoricalDay(1)];
        await timelineData.enrichWithAccuracy(days, 40.71, -74.01);

        expect(days[0].accuracy).toBeUndefined();
    });

    it('does nothing and skips the fetch when there are no historical days', async () => {
        const timelineData = new TimelineData();
        const days = [{ date: dateStr(-1), type: 'forecast' }];

        await timelineData.enrichWithAccuracy(days, 40.71, -74.01);

        expect(fetch).not.toHaveBeenCalled();
    });

    it('caches Previous Runs data and only fetches once per location within the TTL', async () => {
        const timelineData = new TimelineData();
        fetch.mockResolvedValue({
            ok: true,
            json: async () => buildPreviousRunsResponse({ pastDays: 1 })
        });

        await timelineData.enrichWithAccuracy([makeHistoricalDay(1)], 40.71, -74.01);
        await timelineData.enrichWithAccuracy([makeHistoricalDay(1)], 40.71, -74.01);

        expect(fetch).toHaveBeenCalledTimes(1);
    });
});
