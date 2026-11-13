/**
 * lastKnownGood.js - the most recent weather payload that loaded successfully,
 * kept for *any* location.
 *
 * The per-location TTL cache in `weather.js` can only help when the failing
 * request is for a place that was already fetched. This snapshot is the
 * backstop behind it: a new search that fails, a first load after the saved
 * location's cache entry was pruned, or a cold start offline still has
 * something honest to show (labelled with when it was fetched) instead of a
 * screen of `--`.
 *
 * Stored as one localStorage entry. Every access is wrapped: private mode,
 * disabled storage, and quota errors all degrade to "no snapshot".
 */

export const LAST_GOOD_STORAGE_KEY = 'weatherclock_last_good';

// The hourly timeline only spans yesterday through the next week, so a
// snapshot older than this no longer describes the present in any useful way.
export const LAST_GOOD_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * @typedef {Object} LastKnownGood
 * @property {number} savedAt epoch ms the payload was fetched
 * @property {number|null} lat
 * @property {number|null} lon
 * @property {string|null} location display name at the time
 * @property {string|null} countryCode
 * @property {WeatherData} data payload, with Dates already revived
 */

/**
 * @param {unknown} value
 * @returns {any} a Date for anything date-like; null/undefined pass through
 */
function toDate(value) {
    if (value == null || value instanceof Date) return value;
    return new Date(/** @type {string|number} */ (value));
}

/**
 * Turn the `Date` fields of a weather payload back into `Date`s. A payload that
 * went through `JSON.stringify` (localStorage) comes back with ISO strings, and
 * the weather pipeline calls `.getTime()` on `timeline[].time`. Safe to call on
 * a payload that is already revived.
 * @template {{sunrise?: any, sunset?: any, timeline?: any}} T
 * @param {T} data
 * @returns {T}
 */
export function reviveWeatherDates(data) {
    if (!data || typeof data !== 'object') return data;
    return {
        ...data,
        sunrise: toDate(data.sunrise),
        sunset: toDate(data.sunset),
        timeline: Array.isArray(data.timeline)
            ? data.timeline.map((/** @type {any} */ point) => ({ ...point, time: toDate(point.time) }))
            : data.timeline
    };
}

/**
 * @param {WeatherData} data
 * @param {{lat: number|null, lon: number|null, location: string|null, countryCode: string|null}} where
 * @param {number} [now]
 * @returns {boolean} whether it was written
 */
export function saveLastKnownGood(data, where, now = Date.now()) {
    if (typeof localStorage === 'undefined') return false;
    try {
        localStorage.setItem(LAST_GOOD_STORAGE_KEY, JSON.stringify({ savedAt: now, ...where, data }));
        return true;
    } catch (error) {
        // Quota or disabled storage: the in-memory/TTL cache still works.
        console.warn('Could not store last-known-good weather snapshot:', error);
        return false;
    }
}

/**
 * @param {number} [now]
 * @returns {LastKnownGood|null} null when absent, malformed, unreadable, or too old
 */
export function loadLastKnownGood(now = Date.now()) {
    try {
        const raw = localStorage.getItem(LAST_GOOD_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (typeof parsed?.savedAt !== 'number' || !parsed.data?.current || !Array.isArray(parsed.data.timeline)) {
            return null;
        }
        if (now - parsed.savedAt > LAST_GOOD_MAX_AGE_MS) return null;
        return {
            savedAt: parsed.savedAt,
            lat: parsed.lat ?? null,
            lon: parsed.lon ?? null,
            location: parsed.location ?? null,
            countryCode: parsed.countryCode ?? null,
            data: reviveWeatherDates(parsed.data)
        };
    } catch {
        return null;
    }
}
