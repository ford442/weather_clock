import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    WeatherServiceError,
    fetchJSON,
    withRetry,
    fetchJSONWithRetry,
    isRetryableError,
    isOffline,
    forecastUrl,
    archiveUrl,
    climateUrl,
    previousRunsUrl,
    airQualityUrl,
    geocodeSearchUrl,
    reverseGeocodeUrl,
    alertsUrl
} from '../net/openMeteoClient.js';

global.fetch = vi.fn();

beforeEach(() => {
    fetch.mockReset();
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('openMeteoClient — URL builders', () => {
    it('builds a forecast URL with latitude/longitude and extra params', () => {
        const url = forecastUrl(40.71, -74.01, { current: 'temperature_2m,weather_code', timezone: 'auto' });
        const str = url.toString();
        expect(str).toContain('https://api.open-meteo.com/v1/forecast?');
        expect(str).toContain('latitude=40.71');
        expect(str).toContain('longitude=-74.01');
        expect(str).toContain('timezone=auto');
    });

    it('omits null/undefined params', () => {
        const url = archiveUrl(1, 2, { start_date: '2024-01-01', end_date: undefined, foo: null });
        expect(url.toString()).not.toContain('end_date');
        expect(url.toString()).not.toContain('foo');
    });

    it('builds climate and previous-runs URLs against their own hosts', () => {
        expect(climateUrl(1, 2, {}).toString()).toContain('https://climate-api.open-meteo.com/v1/climate');
        expect(previousRunsUrl(1, 2, {}).toString()).toContain('https://previous-runs-api.open-meteo.com/v1/forecast');
        expect(airQualityUrl(1, 2, {}).toString()).toContain('https://air-quality-api.open-meteo.com/v1/air-quality');
    });

    it('builds geocode search/reverse URLs with encoded query text', () => {
        expect(geocodeSearchUrl('New York, NY')).toContain('q=New%20York%2C%20NY');
        expect(reverseGeocodeUrl(40.71, -74.01)).toContain('lat=40.71&lon=-74.01');
    });

    it('builds the NWS alerts URL rounded to 4 decimal places, without percent-encoding the comma', () => {
        expect(alertsUrl(40.71280001, -74.00600009)).toBe(
            'https://api.weather.gov/alerts/active?point=40.7128,-74.006'
        );
    });
});

describe('openMeteoClient — fetchJSON', () => {
    it('returns parsed JSON on success', async () => {
        fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ hello: 'world' }) });
        const data = await fetchJSON('https://example.com/api');
        expect(data).toEqual({ hello: 'world' });
    });

    it('throws a WeatherServiceError with HTTP_ERROR code on a non-ok response', async () => {
        fetch.mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' });
        await expect(fetchJSON('https://example.com/api')).rejects.toMatchObject({
            code: 'HTTP_ERROR',
            status: 404
        });
    });

    it('aborts and throws TIMEOUT after the configured timeout elapses', async () => {
        vi.useFakeTimers();
        fetch.mockImplementation((_url, options) => {
            return new Promise((_resolve, reject) => {
                options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
            });
        });

        const request = fetchJSON('https://example.com/api', { timeoutMs: 5000 });
        const rejection = expect(request).rejects.toMatchObject({ code: 'TIMEOUT', status: null });

        await vi.advanceTimersByTimeAsync(5000);
        await rejection;
        expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    });

    it('throws ABORTED when the caller-provided signal is aborted', async () => {
        const controller = new AbortController();
        fetch.mockImplementation((_url, options) => {
            return new Promise((_resolve, reject) => {
                options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
            });
        });

        const request = fetchJSON('https://example.com/api', { signal: controller.signal });
        const rejection = expect(request).rejects.toMatchObject({ code: 'ABORTED' });
        controller.abort();
        await rejection;
    });

    it('marks a network failure while offline as OFFLINE', async () => {
        vi.stubGlobal('navigator', { onLine: false });
        fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

        await expect(fetchJSON('https://example.com/api')).rejects.toMatchObject({
            code: 'OFFLINE',
            isOffline: true
        });
    });

    it('marks a network failure while online as NETWORK_ERROR', async () => {
        vi.stubGlobal('navigator', { onLine: true });
        fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

        await expect(fetchJSON('https://example.com/api')).rejects.toMatchObject({
            code: 'NETWORK_ERROR',
            isOffline: false
        });
    });
});

describe('openMeteoClient — isRetryableError', () => {
    it('retries 5xx, 408, 429, and network errors with no status', () => {
        expect(isRetryableError(new WeatherServiceError('x', 500))).toBe(true);
        expect(isRetryableError(new WeatherServiceError('x', 408))).toBe(true);
        expect(isRetryableError(new WeatherServiceError('x', 429))).toBe(true);
        expect(isRetryableError(new WeatherServiceError('x', null))).toBe(true);
    });

    it('does not retry 4xx client errors, aborts, or offline errors', () => {
        expect(isRetryableError(new WeatherServiceError('x', 400))).toBe(false);
        expect(isRetryableError(new WeatherServiceError('x', null, null, { code: 'ABORTED' }))).toBe(false);
        expect(isRetryableError(new WeatherServiceError('x', null, null, { code: 'OFFLINE' }))).toBe(false);
    });

    it('does not retry errors that are not WeatherServiceError', () => {
        expect(isRetryableError(new Error('plain'))).toBe(false);
    });
});

describe('openMeteoClient — isOffline', () => {
    it('reflects navigator.onLine', () => {
        vi.stubGlobal('navigator', { onLine: false });
        expect(isOffline()).toBe(true);
        vi.stubGlobal('navigator', { onLine: true });
        expect(isOffline()).toBe(false);
    });
});

describe('openMeteoClient — withRetry / fetchJSONWithRetry', () => {
    it('retries a failing operation according to the retryable predicate and delay schedule', async () => {
        let attempts = 0;
        const fn = vi.fn(async () => {
            attempts++;
            if (attempts < 3) throw new WeatherServiceError('fail', 500);
            return 'ok';
        });

        vi.useFakeTimers();
        const onRetry = vi.fn();
        const promise = withRetry(fn, { retryDelaysMs: [10, 20], onRetry });

        await vi.advanceTimersByTimeAsync(10);
        await vi.advanceTimersByTimeAsync(20);

        await expect(promise).resolves.toBe('ok');
        expect(fn).toHaveBeenCalledTimes(3);
        expect(onRetry).toHaveBeenCalledTimes(2);
    });

    it('stops retrying and rethrows once the delay schedule is exhausted', async () => {
        const fn = vi.fn(async () => {
            throw new WeatherServiceError('always fails', 500);
        });

        await expect(withRetry(fn, { retryDelaysMs: [] })).rejects.toMatchObject({ message: 'always fails' });
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('does not retry a non-retryable error even if delays remain', async () => {
        const fn = vi.fn(async () => {
            throw new WeatherServiceError('bad request', 400);
        });

        await expect(withRetry(fn, { retryDelaysMs: [10, 20] })).rejects.toMatchObject({ status: 400 });
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('fetchJSONWithRetry retries fetchJSON itself on a transient failure', async () => {
        fetch.mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Unavailable' });
        fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });

        vi.useFakeTimers();
        const promise = fetchJSONWithRetry('https://example.com/api', { retryDelaysMs: [5] });
        await vi.advanceTimersByTimeAsync(5);

        await expect(promise).resolves.toEqual({ ok: true });
        expect(fetch).toHaveBeenCalledTimes(2);
    });
});
