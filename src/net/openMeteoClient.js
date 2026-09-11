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
     * @param {{code?: string, isOffline?: boolean, cause?: unknown}} [options]
     */
    constructor(message, status = null, endpoint = null, options = {}) {
        super(message);
        this.name = 'WeatherServiceError';
        this.status = status;
        this.endpoint = endpoint;
        this.code = options.code ?? null;
        this.isOffline = options.isOffline ?? false;
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
 * Fetch and parse JSON with a hard timeout and abort support. Any failure —
 * HTTP error status, timeout, cancellation, or network/offline error — is
 * normalized to a {@link WeatherServiceError}.
 *
 * @param {string|URL} url
 * @param {{timeoutMs?: number, signal?: AbortSignal}} [options]
 */
export async function fetchJSON(url, { timeoutMs = 10000, signal } = {}) {
    const urlString = String(url);
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

export function isOffline() {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * Default retry predicate: retry transient/server errors, never retry an
 * intentional cancellation or a confirmed offline device.
 * @param {unknown} error
 */
export function isRetryableError(error) {
    if (!(error instanceof WeatherServiceError)) return false;
    if (error.code === 'ABORTED' || error.code === 'OFFLINE') return false;
    if (error.status == null) return true;
    return error.status === 408 || error.status === 429 || error.status >= 500;
}

/**
 * Retry an arbitrary async operation using a fixed backoff schedule. Used both
 * for single HTTP calls (via {@link fetchJSONWithRetry}) and for composite
 * operations that issue several requests per attempt (e.g. WeatherService's
 * current+historical fetch).
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{retryDelaysMs?: number[], isRetryable?: (error: unknown) => boolean, onRetry?: (error: unknown, attempt: number, delayMs: number) => void}} [options]
 * @returns {Promise<T>}
 */
export async function withRetry(fn, { retryDelaysMs = [], isRetryable = isRetryableError, onRetry } = {}) {
    let lastError;

    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            const delayMs = retryDelaysMs[attempt];
            if (delayMs === undefined || !isRetryable(error)) break;

            onRetry?.(error, attempt, delayMs);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }

    throw lastError;
}

/**
 * {@link fetchJSON} wrapped in {@link withRetry} for a single URL.
 * @param {string|URL} url
 * @param {{timeoutMs?: number, signal?: AbortSignal, retryDelaysMs?: number[], isRetryable?: (error: unknown) => boolean, onRetry?: (error: unknown, attempt: number, delayMs: number) => void}} [options]
 */
export async function fetchJSONWithRetry(url, options = {}) {
    const { retryDelaysMs, isRetryable, onRetry, ...fetchOptions } = options;
    return withRetry(() => fetchJSON(url, fetchOptions), { retryDelaysMs, isRetryable, onRetry });
}
