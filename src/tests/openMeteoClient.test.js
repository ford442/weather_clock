import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    WeatherServiceError,
    fetchJSON,
    withRetry,
    fetchJSONWithRetry,
    isRetryableError,
    isRateLimitedError,
    isWeatherRateLimited,
    parseRetryAfter,
    getRateLimitRemainingMs,
    resetRateLimit,
    RATE_LIMIT_CONFIG,
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
    resetRateLimit();
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
    it('retries 5xx, 408, and network errors with no status', () => {
        expect(isRetryableError(new WeatherServiceError('x', 500))).toBe(true);
        expect(isRetryableError(new WeatherServiceError('x', 408))).toBe(true);
        expect(isRetryableError(new WeatherServiceError('x', null))).toBe(true);
    });

    it('does not put a 429 on the fixed backoff schedule (withRetry gives it one Retry-After wait instead)', () => {
        expect(isRetryableError(new WeatherServiceError('x', 429))).toBe(false);
        expect(isRetryableError(new WeatherServiceError('x', 429, null, { code: 'RATE_LIMITED' }))).toBe(false);
        // No status would otherwise read as a retryable network error.
        expect(isRetryableError(new WeatherServiceError('x', null, null, { code: 'RATE_LIMITED' }))).toBe(false);
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

function tooManyRequests(retryAfter) {
    return {
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: { get: (name) => (name.toLowerCase() === 'retry-after' ? (retryAfter ?? null) : null) }
    };
}

describe('openMeteoClient — parseRetryAfter', () => {
    it('reads delta-seconds', () => {
        expect(parseRetryAfter('30')).toBe(30000);
        expect(parseRetryAfter(' 0 ')).toBe(0);
    });

    it('reads an HTTP date relative to now', () => {
        const now = Date.parse('2026-01-01T00:00:00Z');
        expect(parseRetryAfter('Thu, 01 Jan 2026 00:01:30 GMT', now)).toBe(90000);
    });

    it('treats a date already in the past as zero', () => {
        const now = Date.parse('2026-01-01T00:00:00Z');
        expect(parseRetryAfter('Wed, 31 Dec 2025 23:00:00 GMT', now)).toBe(0);
    });

    it('returns null when absent or unparseable', () => {
        expect(parseRetryAfter(null)).toBeNull();
        expect(parseRetryAfter(undefined)).toBeNull();
        expect(parseRetryAfter('')).toBeNull();
        expect(parseRetryAfter('soon')).toBeNull();
        expect(parseRetryAfter('1.5')).toBeNull();
    });
});

describe('openMeteoClient — rate limiting', () => {
    it('turns a 429 into RATE_LIMITED carrying the Retry-After delay', async () => {
        fetch.mockResolvedValueOnce(tooManyRequests('12'));

        const error = await fetchJSON(forecastUrl(1, 2)).catch((e) => e);

        expect(error).toBeInstanceOf(WeatherServiceError);
        expect(error).toMatchObject({ code: 'RATE_LIMITED', status: 429, retryAfterMs: 12000 });
        expect(isRateLimitedError(error)).toBe(true);
        expect(isWeatherRateLimited(error)).toBe(true);
    });

    it('falls back to the default pause when Retry-After is missing (browsers cannot read it cross-origin)', async () => {
        fetch.mockResolvedValueOnce({ ok: false, status: 429, statusText: 'Too Many Requests' });

        await expect(fetchJSON(forecastUrl(1, 2))).rejects.toMatchObject({
            code: 'RATE_LIMITED',
            retryAfterMs: RATE_LIMIT_CONFIG.defaultPauseMs
        });
    });

    it('clamps an absurdly short or long Retry-After', async () => {
        fetch.mockResolvedValueOnce(tooManyRequests('0'));
        await expect(fetchJSON(forecastUrl(1, 2))).rejects.toMatchObject({
            retryAfterMs: RATE_LIMIT_CONFIG.minPauseMs
        });

        resetRateLimit();
        fetch.mockResolvedValueOnce(tooManyRequests('86400'));
        await expect(fetchJSON(forecastUrl(1, 2))).rejects.toMatchObject({
            retryAfterMs: RATE_LIMIT_CONFIG.maxPauseMs
        });
    });

    it('pauses every Open-Meteo host after one 429, without touching the network', async () => {
        fetch.mockResolvedValueOnce(tooManyRequests('30'));
        await expect(fetchJSON(forecastUrl(1, 2))).rejects.toMatchObject({ code: 'RATE_LIMITED' });
        expect(fetch).toHaveBeenCalledTimes(1);

        for (const url of [
            forecastUrl(1, 2),
            archiveUrl(1, 2),
            climateUrl(1, 2),
            previousRunsUrl(1, 2),
            airQualityUrl(1, 2)
        ]) {
            await expect(fetchJSON(url)).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
        }
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(getRateLimitRemainingMs()).toBeGreaterThan(0);
    });

    it('reports the time left in the pause on blocked calls', async () => {
        vi.useFakeTimers();
        fetch.mockResolvedValueOnce(tooManyRequests('30'));
        await expect(fetchJSON(forecastUrl(1, 2))).rejects.toMatchObject({ retryAfterMs: 30000 });

        await vi.advanceTimersByTimeAsync(10000);
        await expect(fetchJSON(archiveUrl(1, 2))).rejects.toMatchObject({ retryAfterMs: 20000 });
    });

    it('lets requests through again once the Retry-After window has passed', async () => {
        vi.useFakeTimers();
        fetch.mockResolvedValueOnce(tooManyRequests('30'));
        await expect(fetchJSON(forecastUrl(1, 2))).rejects.toMatchObject({ code: 'RATE_LIMITED' });

        await vi.advanceTimersByTimeAsync(30000);
        expect(getRateLimitRemainingMs()).toBe(0);

        fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
        await expect(fetchJSON(forecastUrl(1, 2))).resolves.toEqual({ ok: true });
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('does not let a 429 from another service pause Open-Meteo, or the reverse', async () => {
        fetch.mockResolvedValueOnce(tooManyRequests('30'));
        const error = await fetchJSON(geocodeSearchUrl('Paris')).catch((e) => e);
        expect(error).toMatchObject({ code: 'RATE_LIMITED' });
        expect(isWeatherRateLimited(error)).toBe(false);
        expect(getRateLimitRemainingMs()).toBe(0);

        fetch.mockResolvedValueOnce(tooManyRequests('30'));
        await expect(fetchJSON(forecastUrl(1, 2))).rejects.toMatchObject({ code: 'RATE_LIMITED' });

        fetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
        await expect(fetchJSON(geocodeSearchUrl('Paris'))).resolves.toEqual([]);
    });

    it('still reports other HTTP errors as HTTP_ERROR without pausing', async () => {
        fetch.mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Unavailable' });
        await expect(fetchJSON(forecastUrl(1, 2))).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 503 });
        expect(getRateLimitRemainingMs()).toBe(0);
    });
});

describe('openMeteoClient — in-flight request sharing', () => {
    it('shares one request between concurrent callers of the same URL', async () => {
        let resolveFetch;
        fetch.mockImplementationOnce(
            () => new Promise((resolve) => (resolveFetch = () => resolve({ ok: true, json: async () => ({ n: 1 }) })))
        );
        const url = forecastUrl(1, 2);

        const results = Promise.all([fetchJSON(url), fetchJSON(url), fetchJSON(String(url))]);
        resolveFetch();

        await expect(results).resolves.toEqual([{ n: 1 }, { n: 1 }, { n: 1 }]);
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('gives each caller its own copy of the data', async () => {
        fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ hourly: { temp: [1, 2] } }) });
        const url = forecastUrl(1, 2);

        const [a, b] = await Promise.all([fetchJSON(url), fetchJSON(url)]);
        a.hourly.temp.push(99);

        expect(b.hourly.temp).toEqual([1, 2]);
        expect(a).not.toBe(b);
    });

    it('does not share different URLs', async () => {
        fetch.mockResolvedValue({ ok: true, json: async () => ({}) });

        await Promise.all([fetchJSON(forecastUrl(1, 2)), fetchJSON(forecastUrl(3, 4))]);

        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('does not share calls that bring their own AbortSignal', async () => {
        fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
        const url = forecastUrl(1, 2);

        await Promise.all([fetchJSON(url, { signal: new AbortController().signal }), fetchJSON(url)]);

        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('makes a new request once the previous one has settled', async () => {
        fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
        const url = forecastUrl(1, 2);

        await fetchJSON(url);
        await fetchJSON(url);

        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('rejects every sharing caller when the shared request fails, and recovers afterwards', async () => {
        fetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Server Error' });
        const url = forecastUrl(1, 2);

        const settled = await Promise.allSettled([fetchJSON(url), fetchJSON(url)]);
        expect(settled.map((r) => r.status)).toEqual(['rejected', 'rejected']);
        expect(fetch).toHaveBeenCalledTimes(1);

        fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
        await expect(fetchJSON(url)).resolves.toEqual({ ok: true });
    });

    it('counts a rate-limited shared request as a single 429', async () => {
        fetch.mockResolvedValueOnce(tooManyRequests('30'));
        const url = forecastUrl(1, 2);

        const settled = await Promise.allSettled([fetchJSON(url), fetchJSON(url), fetchJSON(url)]);

        expect(settled.every((r) => r.status === 'rejected' && r.reason.code === 'RATE_LIMITED')).toBe(true);
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});

describe('openMeteoClient — withRetry on a rate limit', () => {
    it('waits the Retry-After once instead of following the backoff schedule, then succeeds', async () => {
        vi.useFakeTimers();
        const fn = vi
            .fn()
            .mockRejectedValueOnce(
                new WeatherServiceError('slow down', 429, null, { code: 'RATE_LIMITED', retryAfterMs: 5000 })
            )
            .mockResolvedValueOnce('ok');
        const onRetry = vi.fn();

        const promise = withRetry(fn, { retryDelaysMs: [2000, 4000, 8000], onRetry });
        await vi.advanceTimersByTimeAsync(4999);
        expect(fn).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);

        await expect(promise).resolves.toBe('ok');
        expect(fn).toHaveBeenCalledTimes(2);
        expect(onRetry).toHaveBeenCalledWith(expect.anything(), 0, 5000);
    });

    it('fails after a single backoff when the retry is rate-limited again', async () => {
        vi.useFakeTimers();
        const fn = vi.fn(async () => {
            throw new WeatherServiceError('slow down', 429, null, { code: 'RATE_LIMITED', retryAfterMs: 1000 });
        });

        const promise = withRetry(fn, { retryDelaysMs: [2000, 4000, 8000] });
        const rejection = expect(promise).rejects.toMatchObject({ code: 'RATE_LIMITED' });
        await vi.advanceTimersByTimeAsync(60000);

        await rejection;
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('fails immediately, with retryAfterMs intact, when the wait is longer than maxRateLimitWaitMs', async () => {
        const fn = vi.fn(async () => {
            throw new WeatherServiceError('slow down', 429, null, { code: 'RATE_LIMITED', retryAfterMs: 60000 });
        });

        await expect(withRetry(fn, { retryDelaysMs: [2000, 4000, 8000] })).rejects.toMatchObject({
            code: 'RATE_LIMITED',
            retryAfterMs: 60000
        });
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('still retries other transient errors on the schedule after the one rate-limit wait', async () => {
        vi.useFakeTimers();
        const fn = vi
            .fn()
            .mockRejectedValueOnce(
                new WeatherServiceError('slow down', 429, null, { code: 'RATE_LIMITED', retryAfterMs: 1000 })
            )
            .mockRejectedValueOnce(new WeatherServiceError('boom', 503))
            .mockResolvedValueOnce('ok');

        const promise = withRetry(fn, { retryDelaysMs: [2000, 4000, 8000] });
        await vi.advanceTimersByTimeAsync(1000);
        await vi.advanceTimersByTimeAsync(4000);

        await expect(promise).resolves.toBe('ok');
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('does not retry a rate limit when no retry schedule is configured', async () => {
        const fn = vi.fn(async () => {
            throw new WeatherServiceError('slow down', 429, null, { code: 'RATE_LIMITED', retryAfterMs: 1000 });
        });

        await expect(withRetry(fn)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('sends only two requests through fetchJSONWithRetry before giving up on repeated 429s', async () => {
        vi.useFakeTimers();
        fetch.mockResolvedValue(tooManyRequests('2'));

        const promise = fetchJSONWithRetry(forecastUrl(1, 2), { retryDelaysMs: [2000, 4000, 8000] });
        const rejection = expect(promise).rejects.toMatchObject({ code: 'RATE_LIMITED' });
        await vi.advanceTimersByTimeAsync(60000);

        await rejection;
        // First request trips the breaker; after the 2 s wait the window has passed so one more goes out.
        expect(fetch).toHaveBeenCalledTimes(2);
    });
});
