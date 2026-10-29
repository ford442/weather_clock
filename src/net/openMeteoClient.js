/**
 * openMeteoClient.js - Shared HTTP client for Open-Meteo (and related) endpoints.
 *
 * Consolidates what used to be duplicated between src/weather.js and
 * src/timeline/TimelineData.js: a timeout/retry/abort-aware fetch wrapper and
 * the URL builders for every endpoint family both modules talk to.
 */

export class WeatherServiceError extends Error {
    /**
     * @param {string} message
     * @param {number|null} [status]
     * @param {string|null} [endpoint]
     * @param {{code?: string, isOffline?: boolean, retryAfterMs?: number|null, cause?: unknown}} [options]
     */
    constructor(message, status = null, endpoint = null, options = {}) {
        super(message);
        this.name = 'WeatherServiceError';
        this.status = status;
        this.endpoint = endpoint;
        this.code = options.code ?? null;
        this.isOffline = options.isOffline ?? false;
        /** @type {number|null} How long a RATE_LIMITED caller should wait before trying again. */
        this.retryAfterMs = options.retryAfterMs ?? null;
        if (options.cause) this.cause = options.cause;
    }
}

const OPEN_METEO_FORECAST = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const OPEN_METEO_CLIMATE = 'https://climate-api.open-meteo.com/v1/climate';
const OPEN_METEO_PREVIOUS_RUNS = 'https://previous-runs-api.open-meteo.com/v1/forecast';
const OPEN_METEO_AIR_QUALITY = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const NOMINATIM_SEARCH = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse';
const NWS_ALERTS = 'https://api.weather.gov/alerts/active';

/**
 * HTTP 429 handling. Open-Meteo's limits are per IP across every `*.open-meteo.com`
 * host, so one 429 pauses all of them (see {@link getRateLimitRemainingMs}).
 */
export const RATE_LIMIT_CONFIG = {
    /** Pause used when a 429 carries no usable Retry-After (browsers can't read it cross-origin unless exposed). */
    defaultPauseMs: 60 * 1000,
    /** Floor, so `Retry-After: 0` can't turn the breaker into a hot loop. */
    minPauseMs: 1000,
    /** Ceiling, so a daily-quota Retry-After can't wedge the page for hours. */
    maxPauseMs: 10 * 60 * 1000,
    /** {@link withRetry} sleeps through a rate-limit window at most this long; longer ones fail fast. */
    maxInlineWaitMs: 15 * 1000
};

/** Epoch ms until which Open-Meteo requests are refused locally (0 = not paused). */
let openMeteoPausedUntil = 0;

/** @type {Map<string, {promise: Promise<any>, followers: number}>} */
const inFlightRequests = new Map();

/** @param {string} urlString */
function isOpenMeteoUrl(urlString) {
    try {
        const host = new URL(urlString).hostname;
        return host === 'open-meteo.com' || host.endsWith('.open-meteo.com');
    } catch {
        return false;
    }
}

/**
 * Parse a `Retry-After` header value, either delta-seconds or an HTTP date.
 * @param {string|null|undefined} value
 * @param {number} [now]
 * @returns {number|null} Milliseconds to wait, or null when absent/unparseable.
 */
export function parseRetryAfter(value, now = Date.now()) {
    const text = value?.trim();
    if (!text) return null;
    if (/^\d+$/.test(text)) return Number(text) * 1000;
    // HTTP dates always contain letters; this keeps Date.parse from accepting junk like "1.5".
    if (!/[a-z]/i.test(text)) return null;
    const date = Date.parse(text);
    return Number.isNaN(date) ? null : Math.max(0, date - now);
}

/**
 * Milliseconds left in the current Open-Meteo rate-limit pause (0 when clear).
 * @param {number} [now]
 */
export function getRateLimitRemainingMs(now = Date.now()) {
    return Math.max(0, openMeteoPausedUntil - now);
}

/** Clear the Open-Meteo pause. Exposed for tests and for an explicit user retry. */
export function resetRateLimit() {
    openMeteoPausedUntil = 0;
}

/**
 * True for a 429, whether it came from the server or from the local breaker.
 * @param {unknown} error
 * @returns {error is WeatherServiceError}
 */
export function isRateLimitedError(error) {
    return error instanceof WeatherServiceError && (error.code === 'RATE_LIMITED' || error.status === 429);
}

/**
 * True when the weather API (not Nominatim/NWS) is the one rate-limiting us, i.e.
 * when the Open-Meteo breaker is, or just was, the reason a request failed.
 * @param {unknown} error
 * @returns {error is WeatherServiceError}
 */
export function isWeatherRateLimited(error) {
    return isRateLimitedError(error) && isOpenMeteoUrl(error.endpoint ?? '');
}

/**
 * @param {string} urlString
 * @param {number} retryAfterMs
 */
function rateLimitedError(urlString, retryAfterMs) {
    return new WeatherServiceError(
        `Weather service is rate-limited; retry in ${Math.ceil(retryAfterMs / 1000)}s`,
        429,
        urlString,
        { code: 'RATE_LIMITED', retryAfterMs }
    );
}

/**
 * @param {string} base
 * @param {number|string} lat
 * @param {number|string} lon
 * @param {Record<string, string|number|undefined|null>} [params]
 * @returns {URL}
 */
function buildLatLonUrl(base, lat, lon, params = {}) {
    const url = new URL(base);
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lon));
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;
        url.searchParams.set(key, String(value));
    }
    return url;
}

/** Open-Meteo `/v1/forecast` (current + hourly + daily forecast). */
export function forecastUrl(lat, lon, params) {
    return buildLatLonUrl(OPEN_METEO_FORECAST, lat, lon, params);
}

/** Open-Meteo Archive API (past observations). */
export function archiveUrl(lat, lon, params) {
    return buildLatLonUrl(OPEN_METEO_ARCHIVE, lat, lon, params);
}

/** Open-Meteo Climate API (30-year normals). */
export function climateUrl(lat, lon, params) {
    return buildLatLonUrl(OPEN_METEO_CLIMATE, lat, lon, params);
}

/** Open-Meteo Previous Runs API (archived model runs, used for accuracy scoring). */
export function previousRunsUrl(lat, lon, params) {
    return buildLatLonUrl(OPEN_METEO_PREVIOUS_RUNS, lat, lon, params);
}

/** Open-Meteo Air Quality API. */
export function airQualityUrl(lat, lon, params) {
    return buildLatLonUrl(OPEN_METEO_AIR_QUALITY, lat, lon, params);
}

/**
 * Nominatim free-text location search. Kept as manual encoding (rather than
 * URLSearchParams) so the query string matches what earlier versions sent.
 * @param {string} query
 * @param {string} [lang]
 */
export function geocodeSearchUrl(query, lang = 'en') {
    return `${NOMINATIM_SEARCH}?format=json&addressdetails=1&accept-language=${encodeURIComponent(lang)}&q=${encodeURIComponent(query)}`;
}

/**
 * Nominatim reverse geocoding.
 * @param {number} lat
 * @param {number} lon
 * @param {string} [lang]
 */
export function reverseGeocodeUrl(lat, lon, lang = 'en') {
    return `${NOMINATIM_REVERSE}?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&accept-language=${encodeURIComponent(lang)}`;
}

/**
 * NWS active-alerts URL for a point. Coordinates are rounded to 4 decimal
 * places (~11 m), matching NWS's own precision and keeping cache keys stable
 * across tiny GPS jitter.
 * @param {number} lat
 * @param {number} lon
 */
export function alertsUrl(lat, lon) {
    const roundedLat = Math.round(lat * 10000) / 10000;
    const roundedLon = Math.round(lon * 10000) / 10000;
    return `${NWS_ALERTS}?point=${roundedLat},${roundedLon}`;
}

/**
 * Turn a 429 response into a RATE_LIMITED error and, for Open-Meteo, pause every
 * Open-Meteo request until the window passes.
 * @param {string} urlString
 * @param {Response} response
 */
function rateLimitFromResponse(urlString, response) {
    const { defaultPauseMs, minPauseMs, maxPauseMs } = RATE_LIMIT_CONFIG;
    const requestedMs = parseRetryAfter(response.headers?.get?.('Retry-After')) ?? defaultPauseMs;
    const retryAfterMs = Math.min(Math.max(requestedMs, minPauseMs), maxPauseMs);
    if (isOpenMeteoUrl(urlString)) {
        openMeteoPausedUntil = Math.max(openMeteoPausedUntil, Date.now() + retryAfterMs);
    }
    return rateLimitedError(urlString, retryAfterMs);
}

/**
 * One network round trip: the timeout/abort/error-normalizing half of {@link fetchJSON}.
 * @param {string} urlString
 * @param {{timeoutMs?: number, signal?: AbortSignal}} options
 */
async function requestJSON(urlString, { timeoutMs = 10000, signal } = {}) {
    const controller = new AbortController();
    let timedOut = false;

    const forwardAbort = () => controller.abort(signal?.reason);
    if (signal?.aborted) {
        forwardAbort();
    } else {
        signal?.addEventListener('abort', forwardAbort, { once: true });
    }

    const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);

    try {
        const response = await fetch(urlString, { signal: controller.signal });
        if (response.ok === false) {
            if (response.status === 429) throw rateLimitFromResponse(urlString, response);
            throw new WeatherServiceError(
                `Request failed with status ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
                response.status,
                urlString,
                { code: 'HTTP_ERROR' }
            );
        }
        return await response.json();
    } catch (error) {
        if (error instanceof WeatherServiceError) throw error;

        if (timedOut) {
            throw new WeatherServiceError(`Request timed out after ${timeoutMs}ms`, null, urlString, {
                code: 'TIMEOUT',
                cause: error
            });
        }

        if (signal?.aborted) {
            throw new WeatherServiceError('Request cancelled', null, urlString, {
                code: 'ABORTED',
                cause: error
            });
        }

        const offline = isOffline();
        throw new WeatherServiceError(offline ? 'Device is offline' : 'Network request failed', null, urlString, {
            code: offline ? 'OFFLINE' : 'NETWORK_ERROR',
            isOffline: offline
        });
    } finally {
        clearTimeout(timeoutId);
        signal?.removeEventListener('abort', forwardAbort);
    }
}

/**
 * Fetch and parse JSON with a hard timeout and abort support. Any failure —
 * HTTP error status, timeout, cancellation, or network/offline error — is
 * normalized to a {@link WeatherServiceError}.
 *
 * Two guards keep a burst of callers from hammering a rate-limited API:
 * - After a 429 from Open-Meteo, every Open-Meteo request fails immediately
 *   with `RATE_LIMITED` (no network) until the Retry-After window has passed.
 * - Concurrent calls for the same URL share one request. Each caller gets its
 *   own copy of the parsed JSON, so one can mutate it safely. Calls that pass
 *   their own `signal` are never shared, because cancelling one caller must
 *   not cancel the others.
 *
 * @param {string|URL} url
 * @param {{timeoutMs?: number, signal?: AbortSignal}} [options]
 * @returns {Promise<any>}
 */
export async function fetchJSON(url, options = {}) {
    const urlString = String(url);

    if (isOpenMeteoUrl(urlString)) {
        const remainingMs = getRateLimitRemainingMs();
        if (remainingMs > 0) throw rateLimitedError(urlString, remainingMs);
    }

    if (options.signal) return requestJSON(urlString, options);

    const shared = inFlightRequests.get(urlString);
    if (shared) {
        shared.followers++;
        return structuredClone(await shared.promise);
    }

    const entry = {
        followers: 0,
        promise: requestJSON(urlString, options).finally(() => inFlightRequests.delete(urlString))
    };
    inFlightRequests.set(urlString, entry);

    const data = await entry.promise;
    // The settled promise's value is shared with every follower, so nobody gets it directly.
    return entry.followers > 0 ? structuredClone(data) : data;
}

export function isOffline() {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * Default retry predicate for the fixed backoff schedule: retry
 * transient/server errors, never retry an intentional cancellation or a
 * confirmed offline device. A 429 is deliberately excluded — climbing the
 * schedule while rate-limited only adds requests; {@link withRetry} gives it
 * a single Retry-After backoff instead.
 * @param {unknown} error
 */
export function isRetryableError(error) {
    if (isRateLimitedError(error)) return false;
    if (!(error instanceof WeatherServiceError)) return false;
    if (error.code === 'ABORTED' || error.code === 'OFFLINE') return false;
    if (error.status == null) return true;
    return error.status === 408 || error.status >= 500;
}

/**
 * Retry an arbitrary async operation using a fixed backoff schedule. Used both
 * for single HTTP calls (via {@link fetchJSONWithRetry}) and for composite
 * operations that issue several requests per attempt (e.g. WeatherService's
 * current+historical fetch).
 *
 * A rate-limited (429) failure ignores the schedule: it waits the server's
 * Retry-After once, then gives up if that fails too. If the wait is longer than
 * `maxRateLimitWaitMs` it gives up straight away, so the caller can surface the
 * `RATE_LIMITED` error (and its `retryAfterMs`) instead of hanging.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{retryDelaysMs?: number[], isRetryable?: (error: unknown) => boolean, onRetry?: (error: unknown, attempt: number, delayMs: number) => void, maxRateLimitWaitMs?: number}} [options]
 * @returns {Promise<T>}
 */
export async function withRetry(
    fn,
    {
        retryDelaysMs = [],
        isRetryable = isRetryableError,
        onRetry,
        maxRateLimitWaitMs = RATE_LIMIT_CONFIG.maxInlineWaitMs
    } = {}
) {
    let lastError;
    let rateLimitRetried = false;

    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            let delayMs = retryDelaysMs[attempt];
            if (delayMs === undefined) break;

            if (isRateLimitedError(error)) {
                const waitMs = error.retryAfterMs ?? RATE_LIMIT_CONFIG.defaultPauseMs;
                if (rateLimitRetried || waitMs > maxRateLimitWaitMs) break;
                rateLimitRetried = true;
                delayMs = waitMs;
            } else if (!isRetryable(error)) {
                break;
            }

            onRetry?.(error, attempt, delayMs);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }

    throw lastError;
}

/**
 * {@link fetchJSON} wrapped in {@link withRetry} for a single URL.
 * @param {string|URL} url
 * @param {{timeoutMs?: number, signal?: AbortSignal, retryDelaysMs?: number[], isRetryable?: (error: unknown) => boolean, onRetry?: (error: unknown, attempt: number, delayMs: number) => void, maxRateLimitWaitMs?: number}} [options]
 */
export async function fetchJSONWithRetry(url, options = {}) {
    const { retryDelaysMs, isRetryable, onRetry, maxRateLimitWaitMs, ...fetchOptions } = options;
    return withRetry(() => fetchJSON(url, fetchOptions), { retryDelaysMs, isRetryable, onRetry, maxRateLimitWaitMs });
}
