/**
 * Artificial satellites as sky bodies: TLE / OMM elements in, topocentric
 * RA/Dec, horizontal coordinates, and an apparent magnitude out. No Three.js,
 * no DOM — the same contract as `planets.js`, so the result drops onto the
 * star field's equatorial sphere through the one `equatorialToSceneMatrix`
 * rotation that already carries the catalog.
 *
 * This module (and `satellite.js` with it) is only ever reached through a
 * dynamic `import()`, so sessions that never turn the layer on never download
 * SGP4. See `vite.config.js`'s `satellites` chunk.
 *
 * Frames: SGP4 hands back TEME, whose axes sit within an arcsecond or so of the
 * true equator and equinox of date. The star field precesses its catalog to the
 * *mean* equator of date; the difference is nutation (≲ 20″), far below a pixel
 * on a 2000-unit sphere, so TEME is used as-is.
 *
 * Satellites are close enough that parallax is everything — the ISS is ~400 km
 * up, so two observers 500 km apart see it in different constellations. Every
 * RA/Dec here is therefore *topocentric*: measured from the observer, not from
 * the Earth's centre.
 */

import {
    ecfToEci,
    ecfToLookAngles,
    eciToEcf,
    geodeticToEcf,
    gstime,
    json2satrec,
    propagate,
    shadowFraction,
    sunPos,
    twoline2satrec,
    jday
} from 'satellite.js';
import { DEG, RAD_TO_DEG, normalizeAngle } from './celestialCoordinates.js';

export const SATELLITE_CONFIG = Object.freeze({
    /** NORAD catalog number of the ISS (ZARYA), which is always drawn while it is up. */
    issId: 25544,
    /** Draw only roughly naked-eye satellites. */
    magnitudeLimit: 4,
    /** Standard magnitude assumed for live catalog entries we have no figure for. */
    defaultStandardMagnitude: 3.5,
    /** Range the standard magnitude is quoted at (McCants convention). */
    standardRangeKm: 1000,
    /**
     * The ISS stays drawn even in Earth's shadow, so turning the layer on always
     * shows where it is — but only as a faint ghost, this many magnitudes
     * dimmer than it would be sunlit.
     */
    eclipsedIssPenaltyMag: 4,
    /** Mean Earth radius for the observer → satellite line-of-sight test, km. */
    earthRadiusKm: 6371
});

/**
 * Approximate standard (intrinsic) magnitudes: brightness at 1000 km range and
 * 50% illumination, rounded from the McCants / Heavens-Above values. These only
 * order and size the points — the layer is a graphical cue, not a pass
 * predictor — so a few tenths of error is immaterial.
 * @type {Readonly<Record<number, number>>}
 */
export const STANDARD_MAGNITUDES = Object.freeze({
    25544: -1.8, // ISS (ZARYA)
    48274: -1.1, // CSS (TIANHE)
    20580: 2.2, // HST
    27386: 3.7, // ENVISAT
    25860: 3.5, // OKEAN-O
    33504: 3.5, // KORONAS-FOTON
    37731: 4.0, // CZ-2C R/B
    // SL-16 (Zenit-2) upper stages: large, bright, and numerous in the visual group.
    16182: 2.0,
    19650: 2.0,
    22220: 2.0,
    22285: 2.0,
    22566: 2.0,
    22803: 2.0,
    23088: 2.0,
    23343: 2.0,
    23405: 2.0,
    24298: 2.0,
    25400: 2.0,
    25407: 2.0,
    26070: 2.0,
    28353: 2.0,
    31793: 2.0
});

/**
 * One satellite's orbital elements, ready to propagate.
 * @typedef {{
 *   id: number,
 *   name: string,
 *   satrec: import('satellite.js').SatRec,
 *   epochMs: number,
 *   standardMagnitude: number
 * }} SatelliteElements
 */

/**
 * Where a satellite is for one observer at one instant.
 * @typedef {{
 *   id: number,
 *   name: string,
 *   ra: number,
 *   dec: number,
 *   altitudeDeg: number,
 *   azimuthDeg: number,
 *   rangeKm: number,
 *   heightKm: number,
 *   magnitude: number,
 *   sunlit: boolean,
 *   aboveHorizon: boolean,
 *   isIss: boolean
 * }} SatellitePosition
 */

/**
 * @typedef {{latitude: number, longitude: number, heightKm?: number}} SatelliteObserver
 */

/**
 * A record from the committed snapshot: a name and the two TLE lines.
 * @typedef {{id?: number, name?: string, line1: string, line2: string}} TleRecord
 */

/**
 * @param {import('satellite.js').SatRec} satrec
 * @returns {number}
 */
function satrecEpochMs(satrec) {
    // `jdsatepoch` is the element-set epoch as a Julian Date.
    return (satrec.jdsatepoch - 2440587.5) * 86400000;
}

/**
 * @param {number} id
 * @param {string} name
 * @param {import('satellite.js').SatRec} satrec
 * @returns {SatelliteElements|null}
 */
function toElements(id, name, satrec) {
    if (!satrec || satrec.error) return null;
    const epochMs = satrecEpochMs(satrec);
    if (!Number.isFinite(id) || !Number.isFinite(epochMs)) return null;
    return {
        id,
        name: name || String(id),
        satrec,
        epochMs,
        standardMagnitude: STANDARD_MAGNITUDES[id] ?? SATELLITE_CONFIG.defaultStandardMagnitude
    };
}

/**
 * Parse one two-line element set. Returns null rather than throwing on a
 * malformed set, since a bad row in a live feed should cost one satellite, not
 * the layer.
 * @param {string} line1
 * @param {string} line2
 * @param {string} [name]
 * @returns {SatelliteElements|null}
 */
export function parseTle(line1, line2, name) {
    if (typeof line1 !== 'string' || typeof line2 !== 'string') return null;
    try {
        const satrec = twoline2satrec(line1.trim(), line2.trim());
        return toElements(Number(satrec.satnum), (name ?? '').trim(), satrec);
    } catch {
        return null;
    }
}

/**
 * Parse one CCSDS OMM record, the JSON shape Celestrak's `gp.php?FORMAT=json` returns.
 * @param {import('satellite.js').OMMJsonObject} omm
 * @returns {SatelliteElements|null}
 */
export function parseOmm(omm) {
    if (!omm || typeof omm !== 'object') return null;
    try {
        const satrec = json2satrec(omm);
        return toElements(Number(omm.NORAD_CAT_ID), String(omm.OBJECT_NAME ?? '').trim(), satrec);
    } catch {
        return null;
    }
}

/**
 * Parse a catalog in either shape the layer meets: the committed TLE snapshot
 * (`{line1, line2, name}`) or a Celestrak OMM JSON array. Invalid rows are
 * dropped; duplicates keep the newest epoch.
 * @param {ReadonlyArray<TleRecord|import('satellite.js').OMMJsonObject>} records
 * @returns {SatelliteElements[]}
 */
export function parseSatelliteCatalog(records) {
    if (!Array.isArray(records)) return [];
    /** @type {Map<number, SatelliteElements>} */
    const byId = new Map();
    for (const record of records) {
        const elements =
            record && 'line1' in record
                ? parseTle(record.line1, record.line2, record.name)
                : parseOmm(/** @type {import('satellite.js').OMMJsonObject} */ (record));
        if (!elements) continue;
        const existing = byId.get(elements.id);
        if (!existing || existing.epochMs < elements.epochMs) byId.set(elements.id, elements);
    }
    return [...byId.values()];
}

/**
 * Overlay a fresher catalog on an older one: satellites present in both take
 * the newer epoch, satellites in either alone are kept. Used to lay a live
 * Celestrak pull over the committed snapshot without losing the ISS if the
 * feed happens to omit it.
 * @param {SatelliteElements[]} base
 * @param {SatelliteElements[]} overlay
 * @returns {SatelliteElements[]}
 */
export function mergeSatelliteCatalogs(base, overlay) {
    /** @type {Map<number, SatelliteElements>} */
    const byId = new Map(base.map((elements) => [elements.id, elements]));
    for (const elements of overlay) {
        const existing = byId.get(elements.id);
        if (!existing || existing.epochMs <= elements.epochMs) byId.set(elements.id, elements);
    }
    return [...byId.values()];
}

/**
 * Apparent magnitude of a diffusely reflecting sphere, from its standard
 * magnitude (1000 km, phase angle 90°).
 *
 * The phase law is the Lambert sphere's F(φ) = sin φ + (π − φ) cos φ, which is
 * 1 at φ = 90° (the standard condition), π when the satellite is fully lit
 * behind the observer, and 0 when it is back-lit.
 *
 * @param {number} standardMagnitude
 * @param {number} rangeKm
 * @param {number} phaseAngleRad - Sun–satellite–observer angle.
 * @returns {number}
 */
export function satelliteApparentMagnitude(standardMagnitude, rangeKm, phaseAngleRad) {
    const phi = Math.max(0, Math.min(Math.PI, phaseAngleRad));
    const phase = Math.max(1e-4, Math.sin(phi) + (Math.PI - phi) * Math.cos(phi));
    return (
        standardMagnitude +
        5 * Math.log10(Math.max(1, rangeKm) / SATELLITE_CONFIG.standardRangeKm) -
        2.5 * Math.log10(phase)
    );
}

/**
 * @param {{x: number, y: number, z: number}} a
 * @param {{x: number, y: number, z: number}} b
 * @returns {number} Angle between the two vectors, radians.
 */
function angleBetween(a, b) {
    const dot = a.x * b.x + a.y * b.y + a.z * b.z;
    const lengths = Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z);
    if (lengths === 0) return 0;
    return Math.acos(Math.max(-1, Math.min(1, dot / lengths)));
}

/**
 * Propagate one satellite to an instant and see it from an observer.
 *
 * @param {SatelliteElements} elements
 * @param {Date|number} date
 * @param {SatelliteObserver} observer - Geodetic latitude/longitude in degrees, height in km.
 * @returns {SatellitePosition|null} Null when SGP4 cannot propagate (decayed or far-stale elements).
 */
export function propagateSatellite(elements, date, observer) {
    const when = date instanceof Date ? date : new Date(date);
    if (!Number.isFinite(when.getTime())) return null;

    let state;
    try {
        state = propagate(elements.satrec, when);
    } catch {
        return null;
    }
    const satEci = state?.position;
    if (!satEci || !Number.isFinite(satEci.x)) return null;

    const gmst = gstime(when);
    const geodetic = {
        latitude: observer.latitude * DEG,
        longitude: observer.longitude * DEG,
        height: observer.heightKm ?? 0
    };
    const observerEcf = geodeticToEcf(geodetic);
    const observerEci = ecfToEci(observerEcf, gmst);
    const look = ecfToLookAngles(geodetic, eciToEcf(satEci, gmst));

    const topo = { x: satEci.x - observerEci.x, y: satEci.y - observerEci.y, z: satEci.z - observerEci.z };
    const rangeKm = Math.hypot(topo.x, topo.y, topo.z);
    const ra = normalizeAngle(Math.atan2(topo.y, topo.x));
    const dec = Math.asin(Math.max(-1, Math.min(1, topo.z / rangeKm)));

    const sun = sunPos(jday(when)).rsun;
    const sunlit = shadowFraction(sun, satEci) < 0.5;
    // The Sun is ~23 000 Earth radii away, so its direction from the satellite
    // is its direction from Earth's centre to well under a pixel.
    const phaseAngle = angleBetween(sun, { x: -topo.x, y: -topo.y, z: -topo.z });

    const isIss = elements.id === SATELLITE_CONFIG.issId;
    let magnitude = satelliteApparentMagnitude(elements.standardMagnitude, rangeKm, phaseAngle);
    if (!sunlit) magnitude += isIss ? SATELLITE_CONFIG.eclipsedIssPenaltyMag : 99;

    const altitudeDeg = look.elevation * RAD_TO_DEG;
    return {
        id: elements.id,
        name: elements.name,
        ra,
        dec,
        altitudeDeg,
        azimuthDeg: (((look.azimuth * RAD_TO_DEG) % 360) + 360) % 360,
        rangeKm,
        heightKm: Math.hypot(satEci.x, satEci.y, satEci.z) - SATELLITE_CONFIG.earthRadiusKm,
        magnitude,
        sunlit,
        aboveHorizon: altitudeDeg > 0,
        isIss
    };
}

/**
 * Whether a solved position belongs on the drawn sky: above the horizon, and
 * either bright enough to see or the ISS.
 * @param {SatellitePosition} position
 * @param {number} [magnitudeLimit]
 * @returns {boolean}
 */
export function isSatelliteDrawable(position, magnitudeLimit = SATELLITE_CONFIG.magnitudeLimit) {
    if (!position.aboveHorizon) return false;
    return position.isIss || (position.sunlit && position.magnitude <= magnitudeLimit);
}

/**
 * Every drawable satellite for an observer at an instant, brightest first.
 *
 * @param {SatelliteElements[]} catalog
 * @param {Date|number} date
 * @param {SatelliteObserver} observer
 * @param {{magnitudeLimit?: number, includeHidden?: boolean}} [options] -
 *   `includeHidden` keeps below-horizon / too-faint satellites, for debugging.
 * @returns {SatellitePosition[]}
 */
export function getSatellitePositions(catalog, date, observer, options = {}) {
    const limit = options.magnitudeLimit ?? SATELLITE_CONFIG.magnitudeLimit;
    /** @type {SatellitePosition[]} */
    const positions = [];
    for (const elements of catalog) {
        const position = propagateSatellite(elements, date, observer);
        if (!position) continue;
        if (options.includeHidden || isSatelliteDrawable(position, limit)) positions.push(position);
    }
    positions.sort((a, b) => a.magnitude - b.magnitude);
    return positions;
}
