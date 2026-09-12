/**
 * The zodiac: where the Sun, Moon, and planets sit along the ecliptic, and
 * which of the twelve traditional signs that longitude falls in.
 *
 * This is the symbolic layer sitting on top of the astronomy in
 * `celestialCoordinates.js` and `planets.js` — it adds no new ephemeris of its
 * own except the Moon's longitude, which nothing else in the app needed yet.
 * Like its neighbours it is pure math on plain numbers: no Three.js, no DOM.
 *
 * Two conventions are supported, because they genuinely disagree:
 *  - **tropical** — signs are 30° slices measured from the vernal equinox *of
 *    date*. This is what Western astrology and the "sun sign of the month"
 *    mean, and it drifts away from the constellations with precession.
 *  - **sidereal** — the same slices shifted back by the ayanamsa so they stay
 *    tied to the stars, which is what Vedic astrology uses and what actually
 *    lines up with the constellation figures the star field draws.
 *
 * Accuracy: the Moon's longitude is good to roughly a hundredth of a degree and
 * the planets inherit `planets.js`'s few arcminutes, so a sign is only ever in
 * doubt within a few seconds of a cusp crossing.
 *
 * @typedef {'tropical'|'sidereal'} ZodiacMode
 *
 * @typedef {{
 *   id: string,
 *   name: string,
 *   glyph: string,
 *   element: 'fire'|'earth'|'air'|'water',
 *   startDeg: number
 * }} ZodiacSign
 *
 * @typedef {{
 *   id: string,
 *   name: string,
 *   longitudeDeg: number,
 *   sign: ZodiacSign,
 *   signIndex: number,
 *   degreesInSign: number
 * }} ZodiacPlacement
 */

import {
    DEG,
    RAD_TO_DEG,
    equatorialToEcliptic,
    julianCenturies,
    meanObliquity,
    precessFromJ2000
} from './celestialCoordinates.js';
import { NAKED_EYE_PLANETS, getPlanetPosition, getSunEquatorial } from './planets.js';

/** Degrees each sign spans. */
export const SIGN_WIDTH_DEG = 30;

/**
 * The twelve signs in ecliptic order, each spanning 30° from `startDeg`.
 * @type {readonly ZodiacSign[]}
 */
export const ZODIAC_SIGNS = Object.freeze(
    /** @type {readonly Omit<ZodiacSign, 'startDeg'>[]} */ ([
        { id: 'aries', name: 'Aries', glyph: '♈', element: 'fire' },
        { id: 'taurus', name: 'Taurus', glyph: '♉', element: 'earth' },
        { id: 'gemini', name: 'Gemini', glyph: '♊', element: 'air' },
        { id: 'cancer', name: 'Cancer', glyph: '♋', element: 'water' },
        { id: 'leo', name: 'Leo', glyph: '♌', element: 'fire' },
        { id: 'virgo', name: 'Virgo', glyph: '♍', element: 'earth' },
        { id: 'libra', name: 'Libra', glyph: '♎', element: 'air' },
        { id: 'scorpio', name: 'Scorpio', glyph: '♏', element: 'water' },
        { id: 'sagittarius', name: 'Sagittarius', glyph: '♐', element: 'fire' },
        { id: 'capricorn', name: 'Capricorn', glyph: '♑', element: 'earth' },
        { id: 'aquarius', name: 'Aquarius', glyph: '♒', element: 'air' },
        { id: 'pisces', name: 'Pisces', glyph: '♓', element: 'water' }
    ]).map((sign, index) => Object.freeze({ ...sign, startDeg: index * SIGN_WIDTH_DEG }))
);

/**
 * Lahiri (Chitrapaksha) ayanamsa — the tropical-to-sidereal offset. Built from
 * its J2000 value plus the IAU general precession in longitude, which keeps it
 * within about an arcminute of published tables across the app's date range.
 *
 * @param {Date|number} date
 * @returns {number} Degrees to subtract from a tropical longitude.
 */
export function getAyanamsaDeg(date) {
    const t = julianCenturies(date);
    return 23.85286 + (5029.0966 * t + 1.11113 * t * t) / 3600;
}

/** Wrap degrees into [0, 360). */
function normalizeDeg(degrees) {
    const wrapped = degrees % 360;
    return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * Which sign an ecliptic longitude falls in.
 *
 * @param {number} longitudeDeg - Tropical ecliptic longitude of date, in degrees.
 * @param {{mode?: ZodiacMode, date?: Date|number}} [options] - `sidereal` needs a
 *   `date` to resolve the ayanamsa; without one it falls back to J2000's.
 * @returns {{sign: ZodiacSign, signIndex: number, degreesInSign: number, longitudeDeg: number}}
 */
export function longitudeToSign(longitudeDeg, { mode = 'tropical', date } = {}) {
    const offset = mode === 'sidereal' ? getAyanamsaDeg(date ?? 946728000000) : 0;
    const longitude = normalizeDeg(longitudeDeg - offset);
    const signIndex = Math.floor(longitude / SIGN_WIDTH_DEG) % ZODIAC_SIGNS.length;
    return {
        sign: ZODIAC_SIGNS[signIndex],
        signIndex,
        degreesInSign: longitude - signIndex * SIGN_WIDTH_DEG,
        longitudeDeg: longitude
    };
}

/**
 * Moon's geocentric ecliptic longitude, referred to the mean equinox of date.
 *
 * A truncated ELP-2000/82 series (Meeus, *Astronomical Algorithms* ch. 47): the
 * twenty-odd largest periodic terms, which is worth roughly 0.01° — two orders
 * of magnitude finer than a sign boundary. Nutation (±17″) and the planetary
 * A1/A2 terms are dropped as invisible at this scale.
 *
 * @param {Date|number} date
 * @returns {number} Degrees in [0, 360).
 */
export function getMoonEclipticLongitudeDeg(date) {
    const t = julianCenturies(date);
    const t2 = t * t;
    const t3 = t2 * t;
    const t4 = t3 * t;

    // Mean longitude, elongation, and the anomalies the series is built on.
    const lPrime = 218.3164477 + 481267.88123421 * t - 0.0015786 * t2 + t3 / 538841 - t4 / 65194000;
    const d = 297.8501921 + 445267.1114034 * t - 0.0018819 * t2 + t3 / 545868 - t4 / 113065000;
    const m = 357.5291092 + 35999.0502909 * t - 0.0001536 * t2 + t3 / 24490000;
    const mPrime = 134.9633964 + 477198.8675055 * t + 0.0087414 * t2 + t3 / 69699 - t4 / 14712000;
    const f = 93.272095 + 483202.0175233 * t - 0.0036539 * t2 - t3 / 3526000 + t4 / 863310000;
    // Eccentricity correction on terms involving the Sun's anomaly.
    const e = 1 - 0.002516 * t - 0.0000074 * t2;

    let sum = 0;
    for (const [cd, cm, cmPrime, cf, coefficient] of MOON_LONGITUDE_TERMS) {
        const argument = (cd * d + cm * m + cmPrime * mPrime + cf * f) * DEG;
        const eccentricity = cm === 0 ? 1 : Math.pow(e, Math.abs(cm));
        sum += coefficient * eccentricity * Math.sin(argument);
    }

    return normalizeDeg(lPrime + sum / 1e6);
}

/**
 * `[D, M, M', F, coefficient in 1e-6 degrees]`, the largest terms of Meeus'
 * table 47.A in descending magnitude.
 * @type {readonly number[][]}
 */
const MOON_LONGITUDE_TERMS = Object.freeze([
    [0, 0, 1, 0, 6288774],
    [2, 0, -1, 0, 1274027],
    [2, 0, 0, 0, 658314],
    [0, 0, 2, 0, 213618],
    [0, 1, 0, 0, -185116],
    [0, 0, 0, 2, -114332],
    [2, 0, -2, 0, 58793],
    [2, -1, -1, 0, 57066],
    [2, 0, 1, 0, 53322],
    [2, -1, 0, 0, 45758],
    [0, 1, -1, 0, -40923],
    [1, 0, 0, 0, -34720],
    [0, 1, 1, 0, -30383],
    [2, 0, 0, -2, 15327],
    [0, 0, 1, 2, -12528],
    [0, 0, 1, -2, 10980],
    [4, 0, -1, 0, 10675],
    [0, 0, 3, 0, 10034],
    [4, 0, -2, 0, 8548],
    [2, 1, -1, 0, -7888],
    [2, 1, 0, 0, -6766],
    [1, 0, -1, 0, -5163],
    [1, 1, 0, 0, 4987],
    [2, -1, 1, 0, 4036],
    [2, 0, 2, 0, 3994],
    [4, 0, 0, 0, 3861],
    [2, 0, -3, 0, 3665],
    [0, 1, -2, 0, -2689]
]);

/**
 * Sun's apparent geocentric ecliptic longitude, referred to the equinox of
 * date — the number the "sun sign of the month" is defined by.
 *
 * @param {Date|number} date
 * @returns {number} Degrees in [0, 360).
 */
export function getSunEclipticLongitudeDeg(date) {
    const centuries = julianCenturies(date);
    const sun = getSunEquatorial(date);
    const { ra, dec } = precessFromJ2000(sun.ra, sun.dec, centuries);
    const { longitude } = equatorialToEcliptic(ra, dec, meanObliquity(centuries));
    return normalizeDeg(longitude * RAD_TO_DEG);
}

/**
 * Ecliptic longitude of one planet, referred to the equinox of date.
 *
 * @param {string} id - Key from `planets.js`'s `ALL_PLANETS`.
 * @param {Date|number} date
 * @returns {number|null} Degrees in [0, 360), or null for an unknown body.
 */
export function getPlanetEclipticLongitudeDeg(id, date) {
    const position = getPlanetPosition(id, date);
    if (!position) return null;
    const centuries = julianCenturies(date);
    const { ra, dec } = precessFromJ2000(position.ra, position.dec, centuries);
    const { longitude } = equatorialToEcliptic(ra, dec, meanObliquity(centuries));
    return normalizeDeg(longitude * RAD_TO_DEG);
}

/**
 * Build a placement record for one body.
 * @param {string} id
 * @param {string} name
 * @param {number} longitudeDeg
 * @param {{mode?: ZodiacMode, date?: Date|number}} options
 * @returns {ZodiacPlacement}
 */
function placement(id, name, longitudeDeg, options) {
    const { sign, signIndex, degreesInSign } = longitudeToSign(longitudeDeg, options);
    return { id, name, longitudeDeg, sign, signIndex, degreesInSign };
}

/**
 * Everything the zodiac overlay draws at one instant: where the Sun and Moon
 * sit, and where each requested planet does.
 *
 * @param {Date|number} date
 * @param {{mode?: ZodiacMode, planetIds?: string[]}} [options]
 * @returns {{mode: ZodiacMode, ayanamsaDeg: number, sun: ZodiacPlacement, moon: ZodiacPlacement, planets: ZodiacPlacement[]}}
 */
export function getZodiacState(date, { mode = 'tropical', planetIds = NAKED_EYE_PLANETS } = {}) {
    const options = { mode, date };
    /** @type {ZodiacPlacement[]} */
    const planets = [];
    for (const id of planetIds) {
        const longitude = getPlanetEclipticLongitudeDeg(id, date);
        if (longitude == null) continue;
        planets.push(placement(id, id.charAt(0).toUpperCase() + id.slice(1), longitude, options));
    }

    return {
        mode,
        ayanamsaDeg: mode === 'sidereal' ? getAyanamsaDeg(date) : 0,
        sun: placement('sun', 'Sun', getSunEclipticLongitudeDeg(date), options),
        moon: placement('moon', 'Moon', getMoonEclipticLongitudeDeg(date), options),
        planets
    };
}

/**
 * Tropical ecliptic longitude of a sign's cusp under the active convention —
 * i.e. where the overlay has to draw the boundary so it lands on the stars the
 * convention claims. In tropical mode this is just `index * 30`; in sidereal
 * mode the whole ring is pushed forward by the ayanamsa.
 *
 * @param {number} signIndex
 * @param {{mode?: ZodiacMode, date?: Date|number}} [options]
 * @returns {number} Degrees in [0, 360).
 */
export function signCuspLongitudeDeg(signIndex, { mode = 'tropical', date } = {}) {
    const offset = mode === 'sidereal' ? getAyanamsaDeg(date ?? 946728000000) : 0;
    return normalizeDeg(signIndex * SIGN_WIDTH_DEG + offset);
}

export { normalizeDeg as normalizeZodiacDegrees };
