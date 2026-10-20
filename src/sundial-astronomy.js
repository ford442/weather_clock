// Sundial astronomy: the equation of time, apparent solar time, and the
// geometry of a horizontal dial whose style is parallel to Earth's axis.
//
// Pure math — no Three.js, no DOM — the same shape as celestialLighting.js,
// so the 3D sundial in sundial.js and its unit tests share one formula.
//
// Frame. "Dial coordinates" are measured on the face plane: `e` = east
// (scene +X), `n` = north (scene +Z), `y` = height above the face (scene +Y).
// That is exactly the mapping AstronomyService uses to place the Sun, so a
// shadow computed here lands where the shadow map draws it.
//
// Three facts carry the whole design:
//
//  1. A style parallel to Earth's axis casts a shadow whose direction depends
//     only on the Sun's hour angle, never on its declination. That is what
//     makes the hour lines fixed for a given latitude.
//  2. On a horizontal face those lines obey tan θ = sin φ · tan h (θ measured
//     from the meridian, h the hour angle, φ the latitude).
//  3. The shadow reads apparent solar time. Clocks keep mean time; the
//     difference is the equation of time (±16 min over a year), and the
//     longitude offset from the time zone comes on top of that.

import { DEG, julianCenturies, meanObliquity, normalizeAngle } from './sky/celestialCoordinates.js';

/** Minutes of time per radian of hour angle (1440 min = 2π). */
const MINUTES_PER_RADIAN = 720 / Math.PI;
const MS_PER_HOUR = 3600000;
const EPSILON = 1e-9;

export const SUNDIAL_ASTRONOMY_CONFIG = Object.freeze({
    /** Obliquity used to decide which hour lines the summer Sun can reach. */
    obliquityDeg: 23.44
});

/**
 * @typedef {Object} DialPoint
 * @property {number} e East offset on the face (scene X).
 * @property {number} n North offset on the face (scene Z).
 */

/**
 * @typedef {Object} DialPoint3
 * @property {number} e
 * @property {number} n
 * @property {number} y Height above the face.
 */

/**
 * @typedef {Object} SolarTimeTerms
 * @property {number} equationOfTimeMin Apparent minus mean solar time, in minutes.
 * @property {number} declinationRad The Sun's apparent declination.
 */

/**
 * @typedef {Object} GnomonOptions
 * @property {number} rootOffset Distance of the plate's lower end from the dial centre, toward the equator.
 * @property {number} plateReach Furthest the plate may run horizontally from that end.
 * @property {number} maxStyleHeight Tallest the style may stand above the face.
 * @property {number} minStyleHeight Below this natural height the style is raised (low latitudes).
 * @property {number} minPlateWeb Minimum horizontal plate body, so a vertical style still stands on something.
 */

/**
 * @typedef {Object} GnomonLayout
 * @property {number} latitudeDeg
 * @property {1|-1} poleSign +1 when the style climbs toward the north celestial pole (+Z), −1 toward the south pole (−Z).
 * @property {number} styleAngleRad Inclination of the style above the face — always |latitude|.
 * @property {DialPoint3} styleStart Lower (equatorward) end of the style edge.
 * @property {DialPoint3} styleEnd Upper (poleward) end of the style edge.
 * @property {{n: number, y: number}[]} profile Convex plate outline in the meridian plane (e = 0).
 * @property {DialPoint|null} root Where the style line meets the face; null when it is parallel to it (the equator).
 */

/**
 * @typedef {Object} HourLineOptions
 * @property {number} radius Hour lines end on this circle around the dial centre.
 * @property {number} rootGap Hour lines start this far from the root, so they don't pile up under the plate.
 * @property {number} [edgeOffset] East offset of the casting edge: −½ plate thickness in the morning, +½ after noon.
 */

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const toMillis = (date) => (date instanceof Date ? date.getTime() : Number(date));

/** Wrap hours into [0, 24). */
const wrapHours = (hours) => ((hours % 24) + 24) % 24;

/**
 * The Sun's apparent declination and the equation of time, from NOAA's
 * low-precision solar position (Meeus ch. 25) and Smart's series for the
 * equation of time (Meeus eq. 28.3). Good to a couple of seconds of time for
 * centuries either side of J2000 — far finer than a shadow edge can show.
 * @param {Date|number} date
 * @returns {SolarTimeTerms}
 */
export function getSolarTimeTerms(date) {
    const t = julianCenturies(date);
    const meanLongitude = normalizeAngle((280.46646 + t * (36000.76983 + t * 0.0003032)) * DEG);
    const meanAnomaly = (357.52911 + t * (35999.05029 - 0.0001537 * t)) * DEG;
    const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
    const equationOfCenter =
        (Math.sin(meanAnomaly) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
            Math.sin(2 * meanAnomaly) * (0.019993 - 0.000101 * t) +
            Math.sin(3 * meanAnomaly) * 0.000289) *
        DEG;
    const omega = (125.04 - 1934.136 * t) * DEG;
    const apparentLongitude = meanLongitude + equationOfCenter - (0.00569 + 0.00478 * Math.sin(omega)) * DEG;
    const obliquity = meanObliquity(t) + 0.00256 * DEG * Math.cos(omega);

    const y = Math.tan(obliquity / 2) ** 2;
    const e = eccentricity;
    const l0 = meanLongitude;
    const m = meanAnomaly;
    const equationOfTimeRad =
        y * Math.sin(2 * l0) -
        2 * e * Math.sin(m) +
        4 * e * y * Math.sin(m) * Math.cos(2 * l0) -
        0.5 * y * y * Math.sin(4 * l0) -
        1.25 * e * e * Math.sin(2 * m);

    return {
        equationOfTimeMin: equationOfTimeRad * MINUTES_PER_RADIAN,
        declinationRad: Math.asin(Math.sin(obliquity) * Math.sin(apparentLongitude))
    };
}

/**
 * Equation of time: apparent minus mean solar time. Positive means a sundial
 * runs ahead of a mean-time clock (early November, ~+16.4 min); negative means
 * it lags (mid-February, ~−14.2 min).
 * @param {Date|number} date
 * @returns {number} Minutes.
 */
export function equationOfTime(date) {
    return getSolarTimeTerms(date).equationOfTimeMin;
}

/**
 * Local mean solar time: UTC shifted by longitude alone (4 minutes per degree).
 * What a clock would read if every town kept its own noon.
 * @param {Date|number} date
 * @param {number} longitudeDeg East positive.
 * @returns {number} Hours in [0, 24).
 */
export function localMeanSolarTime(date, longitudeDeg) {
    return wrapHours(toMillis(date) / MS_PER_HOUR + longitudeDeg / 15);
}

/**
 * Local apparent solar time — what the shadow of a correctly set sundial reads.
 * @param {Date|number} date
 * @param {number} longitudeDeg East positive.
 * @param {number} [equationOfTimeMin] Pass it when already computed for this instant.
 * @returns {number} Hours in [0, 24); 12 at the Sun's meridian transit.
 */
export function apparentSolarTime(date, longitudeDeg, equationOfTimeMin = equationOfTime(date)) {
    return wrapHours(localMeanSolarTime(date, longitudeDeg) + equationOfTimeMin / 60);
}

/**
 * Solar time in hours → hour angle.
 * @param {number} hours
 * @returns {number} Radians in [−π, π): 0 at noon, positive in the afternoon (Sun west of the meridian).
 */
export function hoursToHourAngle(hours) {
    return (wrapHours(hours) - 12) * (Math.PI / 12);
}

/**
 * Hour angle → solar time in hours.
 * @param {number} hourAngleRad
 * @returns {number} Hours in [0, 24).
 */
export function hourAngleToHours(hourAngleRad) {
    return wrapHours(12 + (hourAngleRad * 12) / Math.PI);
}

/**
 * Hour angle → minutes of time; handy for expressing a shadow error as a clock error.
 * @param {number} hourAngleRad
 * @returns {number}
 */
export function hourAngleToMinutes(hourAngleRad) {
    return hourAngleRad * MINUTES_PER_RADIAN;
}

/**
 * Altitude of the Sun from the same low-precision series, so the sundial can
 * decide day from night on its own when no AstronomyService snapshot is handy.
 * @param {Date|number} date
 * @param {number} latitudeDeg
 * @param {number} longitudeDeg
 * @returns {number} Radians.
 */
export function solarAltitude(date, latitudeDeg, longitudeDeg) {
    const { equationOfTimeMin, declinationRad } = getSolarTimeTerms(date);
    const hourAngle = hoursToHourAngle(apparentSolarTime(date, longitudeDeg, equationOfTimeMin));
    const lat = latitudeDeg * DEG;
    const sinAltitude =
        Math.sin(lat) * Math.sin(declinationRad) + Math.cos(lat) * Math.cos(declinationRad) * Math.cos(hourAngle);
    return Math.asin(clamp(sinAltitude, -1, 1));
}

/**
 * The largest hour angle at which the Sun can stand above the horizon at this
 * latitude — sunset on the summer solstice. Hour lines beyond it would never
 * see a shadow, so the dial does not draw them.
 * @param {number} latitudeDeg
 * @param {number} [obliquityRad]
 * @returns {number} Radians in [0, π]; π inside the polar circles (midnight sun).
 */
export function maxSunlitHourAngle(latitudeDeg, obliquityRad = SUNDIAL_ASTRONOMY_CONFIG.obliquityDeg * DEG) {
    const cosine = -Math.tan(Math.abs(clamp(latitudeDeg, -90, 90)) * DEG) * Math.tan(obliquityRad);
    if (!Number.isFinite(cosine) || cosine <= -1) return Math.PI;
    if (cosine >= 1) return 0;
    return Math.acos(cosine);
}

/**
 * Lay out a horizontal dial's gnomon for a latitude. The style (the plate's
 * top edge) lies in the meridian plane and climbs toward the elevated pole at
 * an angle equal to |latitude|: flat at the equator, vertical at the poles.
 *
 * Away from the tropics the style starts on the face and the hour lines fan
 * out from that root. Near the equator a style rooted on the face would be too
 * low to throw a shadow, so it is lifted on the plate instead — its root moves
 * off the plate (eventually off the face) and the hour lines straighten into
 * the parallel lines of an equatorial horizontal dial.
 * @param {number} latitudeDeg
 * @param {GnomonOptions} options
 * @returns {GnomonLayout}
 */
export function layoutGnomon(latitudeDeg, options) {
    const latitude = clamp(latitudeDeg, -90, 90);
    const poleSign = latitude < 0 ? -1 : 1;
    const angle = Math.abs(latitude) * DEG;
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    const { rootOffset, plateReach, maxStyleHeight, minStyleHeight, minPlateWeb } = options;

    // Work in s = distance toward the elevated pole; n = poleSign · s.
    const startS = -rootOffset;
    const naturalHeight = cos > EPSILON ? (plateReach * sin) / cos : Infinity;
    let startY = 0;
    let length;
    if (naturalHeight >= minStyleHeight) {
        // sin > 0 here: naturalHeight ≥ minStyleHeight > 0 needs a non-zero angle.
        const reachLength = cos > EPSILON ? plateReach / cos : Infinity;
        length = Math.min(reachLength, maxStyleHeight / sin);
    } else {
        startY = minStyleHeight - naturalHeight;
        length = plateReach / cos;
    }
    const endS = startS + length * cos;
    const endY = startY + length * sin;
    const backS = Math.max(endS, startS + minPlateWeb);

    const profileS = [{ s: startS, y: 0 }];
    if (startY > EPSILON) profileS.push({ s: startS, y: startY });
    profileS.push({ s: endS, y: endY }, { s: backS, y: 0 });

    return {
        latitudeDeg: latitude,
        poleSign,
        styleAngleRad: angle,
        styleStart: { e: 0, n: poleSign * startS, y: startY },
        styleEnd: { e: 0, n: poleSign * endS, y: endY },
        profile: profileS.map(({ s, y }) => ({ n: poleSign * s, y })),
        root: sin > EPSILON ? { e: 0, n: poleSign * (startS - (startY * cos) / sin) } : null
    };
}

/**
 * Unit direction, on the face, in which the style's shadow points at hour
 * angle h: the horizontal-dial formula tan θ = sin φ · tan h, oriented away
 * from the Sun (north of the root at noon in the northern hemisphere, south of
 * it in the southern; east in the afternoon everywhere).
 * @param {number} latitudeDeg
 * @param {number} hourAngleRad
 * @returns {DialPoint|null} null when the shadow line is at infinity (the equator with the Sun on the horizon).
 */
export function hourLineDirection(latitudeDeg, hourAngleRad) {
    const sign = latitudeDeg < 0 ? -1 : 1;
    const e = Math.abs(Math.sin(latitudeDeg * DEG)) * Math.sin(hourAngleRad);
    const n = sign * Math.cos(hourAngleRad);
    const length = Math.hypot(e, n);
    if (length < EPSILON) return null;
    return { e: e / length, n: n / length };
}

/**
 * Read a shadow: the hour angle at which the style's shadow points along
 * `direction`. The inverse of {@link hourLineDirection}.
 * @param {number} latitudeDeg
 * @param {DialPoint} direction Need not be normalised.
 * @returns {number} Radians in (−π, π]; NaN at the equator, where every hour line is parallel.
 */
export function hourAngleFromShadowDirection(latitudeDeg, direction) {
    const sinLatitude = Math.abs(Math.sin(latitudeDeg * DEG));
    if (sinLatitude < EPSILON) return NaN;
    const sign = latitudeDeg < 0 ? -1 : 1;
    return Math.atan2(direction.e / sinLatitude, sign * direction.n);
}

/**
 * The stretch of face on which the style's shadow falls at hour angle h — one
 * hour line, from just past the root out to `radius`.
 *
 * Every hour line is the trace on the face of the plane holding the style and
 * the Sun; for a style through (e₀, n₀, y₀) that plane meets the face along
 *   cos h · e − sin φ · sin h · n = sin h · (cos φ · y₀ − sin φ · n₀) + cos h · e₀,
 * which passes through the root and reduces to e = e₀ + y₀ · tan h at the
 * equator. `edgeOffset` shifts the casting edge to one face of the plate, so
 * morning and afternoon lines are drawn for the edge that actually bounds the
 * shadow and the noon line splits in two, as on a real dial.
 * @param {GnomonLayout} gnomon
 * @param {number} hourAngleRad
 * @param {HourLineOptions} options
 * @returns {{start: DialPoint, end: DialPoint}|null} null when the line misses the face.
 */
export function hourLineSegment(gnomon, hourAngleRad, { radius, rootGap, edgeOffset = 0 }) {
    const direction = hourLineDirection(gnomon.latitudeDeg, hourAngleRad);
    if (!direction) return null;

    if (gnomon.root) {
        const rootE = gnomon.root.e + edgeOffset;
        const rootN = gnomon.root.n;
        // Ray root + t·direction against the circle |p| = radius.
        const b = rootE * direction.e + rootN * direction.n;
        const c = rootE * rootE + rootN * rootN - radius * radius;
        const discriminant = b * b - c;
        if (discriminant <= 0) return null;
        const root = Math.sqrt(discriminant);
        const tStart = Math.max(-b - root, rootGap);
        const tEnd = -b + root;
        if (tEnd - tStart < EPSILON) return null;
        return {
            start: { e: rootE + direction.e * tStart, n: rootN + direction.n * tStart },
            end: { e: rootE + direction.e * tEnd, n: rootN + direction.n * tEnd }
        };
    }

    // Style parallel to the face: hour lines are parallel chords.
    const lineE = edgeOffset + gnomon.styleStart.y * Math.tan(hourAngleRad);
    if (Math.abs(lineE) >= radius) return null;
    const half = Math.sqrt(radius * radius - lineE * lineE);
    return {
        start: { e: lineE, n: -half * direction.n },
        end: { e: lineE, n: half * direction.n }
    };
}
