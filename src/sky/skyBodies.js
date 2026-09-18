/**
 * One flat description of everything the sky layer is currently drawing: the
 * Sun, the Moon, each rendered planet, and how big the star catalog behind them
 * is. It exists so `aetherDebug.getSkyBodies()` can answer "is the sky right?"
 * in a single call, and so that question stays answerable from a unit test —
 * nothing here touches Three.js, the DOM, or the renderer.
 *
 * Angles come out in degrees, with azimuth in the compass convention
 * (0 = North, 90 = East) rather than SunCalc's south-based one, because the
 * point of this payload is to be compared against a planetarium by eye.
 *
 * @typedef {{
 *   id: string,
 *   name: string,
 *   altitudeDeg: number,
 *   azimuthDeg: number,
 *   aboveHorizon: boolean
 * }} SkyBodyBase
 *
 * @typedef {SkyBodyBase & {distanceAu: number, irradianceFactor: number}} SunBody
 * @typedef {SkyBodyBase & {
 *   illuminatedFraction: number,
 *   synodicPhase: number,
 *   distanceKm: number|null
 * }} MoonBody
 * @typedef {SkyBodyBase & {magnitude: number, distanceAu: number}} PlanetBody
 *
 * @typedef {{
 *   date: string,
 *   observer: {latitude: number, longitude: number},
 *   backend: string,
 *   catalog: {stars: number, renderedFaintStars: number, constellations: number, quality: string},
 *   sun: SunBody,
 *   moon: MoonBody,
 *   planets: PlanetBody[]
 * }} SkyBodiesReport
 */

import { RAD_TO_DEG, equatorialToHorizontal, localSiderealTime } from './celestialCoordinates.js';

/** Wrap degrees into [0, 360). */
function normalizeCompass(degrees) {
    const wrapped = degrees % 360;
    return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * Altitude/compass-azimuth for a scene-space position (Y up, Z+ North, X+ East).
 * The scene already places the Sun and Moon on a fixed-radius sphere, so their
 * vectors carry the full horizontal coordinate and no second ephemeris call is
 * needed to report where they are.
 * @param {{x?: number, y?: number, z?: number}|null|undefined} position
 * @returns {{altitudeDeg: number, azimuthDeg: number}}
 */
export function positionToHorizontalDeg(position) {
    const x = position?.x ?? 0;
    const y = position?.y ?? 0;
    const z = position?.z ?? 0;
    const length = Math.hypot(x, y, z);
    if (length === 0) return { altitudeDeg: 0, azimuthDeg: 0 };
    const altitudeDeg = Math.asin(Math.max(-1, Math.min(1, y / length))) * RAD_TO_DEG;
    return { altitudeDeg, azimuthDeg: normalizeCompass(Math.atan2(x, z) * RAD_TO_DEG) };
}

/**
 * Compass azimuth/altitude for an equatorial position, for the planets — whose
 * RA/Dec is all the ephemeris hands back.
 * @param {number} raRad
 * @param {number} decRad
 * @param {Date|number} date
 * @param {number} latitude
 * @param {number} longitude
 * @returns {{altitudeDeg: number, azimuthDeg: number}}
 */
export function equatorialToHorizontalDeg(raRad, decRad, date, latitude, longitude) {
    const lst = localSiderealTime(date, longitude);
    const { altitude, azimuth } = equatorialToHorizontal(raRad, decRad, lst, latitude);
    // SunCalc's azimuth is 0 at South and grows westward; the compass one is
    // exactly half a turn from it.
    return { altitudeDeg: altitude * RAD_TO_DEG, azimuthDeg: normalizeCompass(azimuth * RAD_TO_DEG + 180) };
}

/**
 * Build the debug report.
 *
 * @param {{
 *   date: Date|number|string,
 *   latitude: number,
 *   longitude: number,
 *   astro: AstroSnapshot,
 *   planets?: import('./planets.js').PlanetPosition[],
 *   catalog?: {stars?: number, renderedFaintStars?: number, constellations?: number, quality?: string},
 *   backend?: string
 * }} input
 * @returns {SkyBodiesReport}
 */
export function describeSkyBodies({ date, latitude, longitude, astro, planets = [], catalog = {}, backend = 'js' }) {
    const when = date instanceof Date ? date : new Date(date);
    const sunHorizontal = positionToHorizontalDeg(astro?.sunPosition);
    const moonHorizontal = positionToHorizontalDeg(astro?.moonPosition);

    return {
        date: Number.isFinite(when.getTime()) ? when.toISOString() : new Date(0).toISOString(),
        observer: { latitude, longitude },
        backend,
        catalog: {
            stars: catalog.stars ?? 0,
            renderedFaintStars: catalog.renderedFaintStars ?? 0,
            constellations: catalog.constellations ?? 0,
            quality: catalog.quality ?? 'unknown'
        },
        sun: {
            id: 'sun',
            name: 'Sun',
            ...sunHorizontal,
            aboveHorizon: sunHorizontal.altitudeDeg > 0,
            distanceAu: astro?.sunlight?.distanceAu ?? 1,
            irradianceFactor: astro?.sunlight?.irradianceFactor ?? 1
        },
        moon: {
            id: 'moon',
            name: 'Moon',
            ...moonHorizontal,
            aboveHorizon: moonHorizontal.altitudeDeg > 0,
            illuminatedFraction: astro?.moonIllumination?.fraction ?? 0,
            synodicPhase: astro?.moonIllumination?.phase ?? 0,
            distanceKm: astro?.moonDistanceKm ?? null
        },
        planets: planets.map((planet) => {
            const horizontal = equatorialToHorizontalDeg(planet.ra, planet.dec, when, latitude, longitude);
            return {
                id: planet.id,
                name: planet.name,
                ...horizontal,
                aboveHorizon: horizontal.altitudeDeg > 0,
                magnitude: planet.magnitude,
                distanceAu: planet.distanceAu
            };
        })
    };
}
