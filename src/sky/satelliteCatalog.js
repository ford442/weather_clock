/**
 * Where the satellite layer's orbital elements come from.
 *
 * A committed TLE snapshot ships with the lazy `satellites` chunk, so the layer
 * always has something to draw — offline, in tests, and when the live feed is
 * unreachable. A live Celestrak pull is laid over it when it succeeds. Celestrak
 * needs no key; the service worker caches the response for ~6 h (see
 * `vite.config.js`), which also keeps us inside their polite-use limits.
 *
 * Elements age gracefully: SGP4 drifts a few km a day for the ISS, so a stale
 * snapshot still puts it on a believable track, just not at the right minute.
 * `epochAgeDays` is reported through `aetherDebug.getSkyBodies()` so that
 * staleness is visible rather than silent.
 */

import snapshot from './data/satellite-snapshot.json';
import { mergeSatelliteCatalogs, parseSatelliteCatalog } from './satellites.js';

export const SATELLITE_CATALOG_CONFIG = Object.freeze({
    /** Celestrak's ~150 brightest objects, as CCSDS OMM JSON. */
    liveUrl: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=json',
    timeoutMs: 8000,
    /** Re-pull at most this often per session; matches the service-worker TTL. */
    refreshMs: 6 * 60 * 60 * 1000
});

/**
 * @typedef {{
 *   satellites: import('./satellites.js').SatelliteElements[],
 *   source: 'snapshot'|'live',
 *   newestEpochMs: number
 * }} SatelliteCatalog
 */

/**
 * @param {import('./satellites.js').SatelliteElements[]} satellites
 * @returns {number}
 */
function newestEpoch(satellites) {
    return satellites.reduce((newest, elements) => Math.max(newest, elements.epochMs), Number.NEGATIVE_INFINITY);
}

/**
 * The committed snapshot, parsed. Synchronous and network-free.
 * @returns {SatelliteCatalog}
 */
export function getSnapshotCatalog() {
    const satellites = parseSatelliteCatalog(snapshot.satellites);
    return { satellites, source: 'snapshot', newestEpochMs: newestEpoch(satellites) };
}

/**
 * Lay a live Celestrak pull over the snapshot. Resolves to the snapshot alone
 * on any failure — CORS, offline, timeout, or a malformed body — and never
 * throws, because the layer must keep drawing either way.
 *
 * @param {{fetchImpl?: typeof fetch, url?: string, timeoutMs?: number}} [options]
 * @returns {Promise<SatelliteCatalog>}
 */
export async function loadLiveCatalog({
    fetchImpl = globalThis.fetch,
    url = SATELLITE_CATALOG_CONFIG.liveUrl,
    timeoutMs = SATELLITE_CATALOG_CONFIG.timeoutMs
} = {}) {
    const base = getSnapshotCatalog();
    if (typeof fetchImpl !== 'function') return base;

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
        const response = await fetchImpl(url, controller ? { signal: controller.signal } : undefined);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const live = parseSatelliteCatalog(await response.json());
        if (!live.length) throw new Error('empty catalog');
        const satellites = mergeSatelliteCatalogs(base.satellites, live);
        return { satellites, source: 'live', newestEpochMs: newestEpoch(satellites) };
    } catch (error) {
        console.warn('Satellite elements: live refresh failed, using the bundled snapshot.', error);
        return base;
    } finally {
        if (timer) clearTimeout(timer);
    }
}
