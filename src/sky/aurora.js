// Aurora visibility from the planetary K-index. Pure: no Three.js, no DOM.
//
// Kp comes from NOAA SWPC's 1-minute estimated planetary K-index:
//
//   https://services.swpc.noaa.gov/json/planetary_k_index_1m.json
//
// HTTPS, no key, `Access-Control-Allow-Origin: *`. It is a JSON array of
// `{ time_tag: "2026-11-19T15:21:00", kp_index: 2, estimated_kp: 1.67, kp: "2M" }`,
// oldest first, with `time_tag` in UTC without a zone suffix. Only the newest
// row is used. The latest sample is cached in memory, never in localStorage:
// offline, the curtain is hidden rather than drawn from a stale index.

import { fetchJSON } from '../net/openMeteoClient.js';

export const KP_ENDPOINT = 'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json';

export const AURORA_CONFIG = Object.freeze({
    /**
     * Graphical floors, not a forecast product: the smallest Kp that grows a
     * curtain at a given |latitude|. Checked poleward first.
     */
    kpFloors: Object.freeze([
        Object.freeze({ minAbsLatitude: 55, minKp: 3 }),
        Object.freeze({ minAbsLatitude: 45, minKp: 5 }),
        Object.freeze({ minAbsLatitude: 0, minKp: 7 })
    ]),
    /** Intensity at the floor, rising linearly to 1 at `fullKpAboveFloor` above it. */
    floorIntensity: 0.35,
    fullKpAboveFloor: 3,
    /** Below this the curtain is treated as not visible. */
    minVisibleIntensity: 0.02,
    /**
     * A sample only drives the sky within this window of its own time, so a
     * time-warped night or a forecast day does not borrow tonight's storm.
     */
    sampleValidityMs: 3 * 60 * 60 * 1000,
    /** Wall-clock refresh cadence: tens of minutes, never per frame. */
    refreshMs: 30 * 60 * 1000,
    timeoutMs: 10000
});

/**
 * @typedef {object} AuroraInputs
 * @property {number} latitudeDeg - Observer latitude, degrees (+N).
 * @property {number|null|undefined} kp - Planetary K-index 0…9, or null when unknown.
 * @property {number} cloudCover - Cloud cover fraction 0…1.
 */

/**
 * @typedef {object} AuroraVisibility
 * @property {boolean} visible
 * @property {number} intensity - 0…1, Kp above the floor × clear sky.
 * @property {number} bearing - Compass azimuth (degrees) toward the geomagnetic
 *   pole, approximated by the geographic one: 0 north of the equator, 180 south.
 * @property {number} kpFloor - The floor that applied at this latitude.
 */

/**
 * Smallest Kp that grows a curtain at this latitude.
 * @param {number} latitudeDeg
 * @returns {number}
 */
export function auroraKpFloor(latitudeDeg) {
    const absLatitude = Math.abs(latitudeDeg);
    for (const { minAbsLatitude, minKp } of AURORA_CONFIG.kpFloors) {
        if (absLatitude >= minAbsLatitude) return minKp;
    }
    return Infinity;
}

/**
 * Whether a curtain shows, how strongly, and which way to look.
 * @param {AuroraInputs} inputs
 * @returns {AuroraVisibility}
 */
export function auroraVisibility({ latitudeDeg, kp, cloudCover }) {
    const latitude = Number.isFinite(latitudeDeg) ? latitudeDeg : 0;
    const bearing = latitude >= 0 ? 0 : 180;
    const kpFloor = auroraKpFloor(latitude);
    if (kp == null || !Number.isFinite(kp) || kp < kpFloor) {
        return { visible: false, intensity: 0, bearing, kpFloor };
    }
    const { floorIntensity, fullKpAboveFloor, minVisibleIntensity } = AURORA_CONFIG;
    const rise = Math.min(1, (kp - kpFloor) / fullKpAboveFloor);
    const activity = floorIntensity + (1 - floorIntensity) * rise;
    const clear = 1 - Math.max(0, Math.min(1, Number.isFinite(cloudCover) ? cloudCover : 0));
    const intensity = activity * clear;
    const visible = intensity > minVisibleIntensity;
    return { visible, intensity: visible ? intensity : 0, bearing, kpFloor };
}

/**
 * @typedef {object} KpSample
 * @property {number} kp
 * @property {number} time - Sample time, epoch ms (UTC).
 */

/**
 * Newest usable row of the SWPC 1-minute file. Prefers the fractional
 * `estimated_kp` over the integer `kp_index`.
 * @param {unknown} payload
 * @returns {KpSample|null}
 */
export function parseKpPayload(payload) {
    if (!Array.isArray(payload)) return null;
    for (let i = payload.length - 1; i >= 0; i--) {
        const row = payload[i];
        if (!row || typeof row !== 'object') continue;
        const kp = Number.isFinite(row.estimated_kp) ? row.estimated_kp : row.kp_index;
        if (!Number.isFinite(kp)) continue;
        const tag = String(row.time_tag ?? '');
        const time = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(tag) ? tag : `${tag}Z`);
        if (!Number.isFinite(time)) continue;
        return { kp: Math.max(0, Math.min(9, kp)), time };
    }
    return null;
}

/**
 * Whether a sample may drive the sky at `date`.
 * @param {KpSample|null} sample
 * @param {Date|number} date
 * @returns {boolean}
 */
export function kpSampleApplies(sample, date) {
    if (!sample) return false;
    const when = date instanceof Date ? date.getTime() : date;
    return Number.isFinite(when) && Math.abs(when - sample.time) <= AURORA_CONFIG.sampleValidityMs;
}

/**
 * One fetch of the latest Kp. Never rejects: any failure (offline, timeout,
 * HTTP error, CORS, malformed body) resolves to null, which hides the curtain.
 * Shares the Open-Meteo client's timeout/abort handling.
 * @param {{fetchJSONImpl?: (url: string, options?: {timeoutMs?: number, signal?: AbortSignal}) => Promise<unknown>, signal?: AbortSignal}} [options]
 * @returns {Promise<KpSample|null>}
 */
export async function fetchLatestKp({ fetchJSONImpl = fetchJSON, signal } = {}) {
    try {
        return parseKpPayload(await fetchJSONImpl(KP_ENDPOINT, { timeoutMs: AURORA_CONFIG.timeoutMs, signal }));
    } catch (error) {
        console.warn('Aurora: Kp unavailable', /** @type {Error} */ (error)?.message ?? error);
        return null;
    }
}

/**
 * Fetch Kp now and then every `refreshMs`, handing each result (a sample, or
 * null after a failure) to `onSample`. One attempt per tick, no retry loop.
 * The first fetch is not awaited, so it can never hold up the weather boot.
 * @param {(sample: KpSample|null) => void} onSample
 * @param {{refreshMs?: number, fetchJSONImpl?: (url: string, options?: {timeoutMs?: number, signal?: AbortSignal}) => Promise<unknown>}} [options]
 * @returns {() => void} Stops the feed and cancels a fetch in flight.
 */
export function startKpFeed(onSample, { refreshMs = AURORA_CONFIG.refreshMs, fetchJSONImpl } = {}) {
    const controller = new AbortController();
    let inFlight = false;
    const tick = async () => {
        if (inFlight || controller.signal.aborted) return;
        inFlight = true;
        const sample = await fetchLatestKp({ fetchJSONImpl, signal: controller.signal });
        inFlight = false;
        if (!controller.signal.aborted) onSample(sample);
    };
    void tick();
    // A data refresh on the wall clock, not render logic.
    const timer = setInterval(tick, refreshMs);
    return () => {
        clearInterval(timer);
        controller.abort();
    };
}
