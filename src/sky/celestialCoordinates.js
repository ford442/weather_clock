/**
 * Pure celestial-coordinate math shared by the star catalog and the planet
 * ephemeris. No Three.js, no DOM — everything here is plain numbers so it can
 * be unit-tested against SunCalc without a renderer.
 *
 * Angles are radians unless a name says otherwise.
 */

export const DEG = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;
/** Hours of right ascension → radians. */
export const HOURS_TO_RAD = Math.PI / 12;
/** Mean obliquity of the ecliptic at J2000, in radians. */
export const OBLIQUITY_J2000 = 23.43928 * DEG;

const J2000_JD = 2451545.0;
const MS_PER_DAY = 86400000;
const DAYS_PER_CENTURY = 36525;

/**
 * Julian Day number for a JS Date (UTC based, which is what SunCalc uses too).
 * @param {Date|number} date
 * @returns {number}
 */
export function toJulianDay(date) {
    const ms = date instanceof Date ? date.getTime() : Number(date);
    return ms / MS_PER_DAY + 2440587.5;
}

/**
 * Julian centuries elapsed since J2000.0.
 * @param {Date|number} date
 * @returns {number}
 */
export function julianCenturies(date) {
    return (toJulianDay(date) - J2000_JD) / DAYS_PER_CENTURY;
}

/** Wrap an angle into [0, 2π). */
export function normalizeAngle(angle) {
    const wrapped = angle % (2 * Math.PI);
    return wrapped < 0 ? wrapped + 2 * Math.PI : wrapped;
}

/** Wrap degrees into [-180, 180). */
export function normalizeDegreesSigned(degrees) {
    let wrapped = degrees % 360;
    if (wrapped >= 180) wrapped -= 360;
    if (wrapped < -180) wrapped += 360;
    return wrapped;
}

/**
 * Greenwich Mean Sidereal Time (IAU 1982 series) in radians.
 * @param {Date|number} date
 * @returns {number}
 */
export function greenwichMeanSiderealTime(date) {
    const jd = toJulianDay(date);
    const d = jd - J2000_JD;
    const t = d / DAYS_PER_CENTURY;
    const degrees = 280.46061837 + 360.98564736629 * d + 0.000387933 * t * t - (t * t * t) / 38710000;
    return normalizeAngle(degrees * DEG);
}

/**
 * Local Mean Sidereal Time in radians. East longitude is positive, matching
 * both SunCalc and the browser geolocation API.
 * @param {Date|number} date
 * @param {number} longitudeDeg
 * @returns {number}
 */
export function localSiderealTime(date, longitudeDeg) {
    return normalizeAngle(greenwichMeanSiderealTime(date) + longitudeDeg * DEG);
}

/**
 * Rigorous precession of equatorial coordinates from J2000 to `date`, using the
 * IAU 1976 ζ/z/θ angles (Meeus, Astronomical Algorithms ch. 21). The rotation
 * form is used rather than the cheaper linear approximation because the latter
 * degrades near the poles — exactly where Polaris and the circumpolar figures
 * live.
 *
 * @param {number} raRad - Right ascension at J2000.
 * @param {number} decRad - Declination at J2000.
 * @param {number} centuries - Julian centuries since J2000 (see {@link julianCenturies}).
 * @returns {{ra: number, dec: number}}
 */
export function precessFromJ2000(raRad, decRad, centuries) {
    const t = centuries;
    const arcsecToRad = DEG / 3600;
    const zeta = (2306.2181 * t + 0.30188 * t * t + 0.017998 * t * t * t) * arcsecToRad;
    const z = (2306.2181 * t + 1.09468 * t * t + 0.018203 * t * t * t) * arcsecToRad;
    const theta = (2004.3109 * t - 0.42665 * t * t - 0.041833 * t * t * t) * arcsecToRad;

    const cosDec = Math.cos(decRad);
    const sinDec = Math.sin(decRad);
    const cosRaZeta = Math.cos(raRad + zeta);
    const sinRaZeta = Math.sin(raRad + zeta);

    const a = cosDec * sinRaZeta;
    const b = Math.cos(theta) * cosDec * cosRaZeta - Math.sin(theta) * sinDec;
    const c = Math.sin(theta) * cosDec * cosRaZeta + Math.cos(theta) * sinDec;

    return {
        ra: normalizeAngle(Math.atan2(a, b) + z),
        dec: Math.asin(Math.max(-1, Math.min(1, c)))
    };
}

/**
 * Unit vector in the equatorial frame (X → vernal equinox, Z → north celestial
 * pole). This frame is observer-independent, so catalog stars can be built once
 * and then rotated into the scene by {@link equatorialToSceneMatrix}.
 *
 * @param {number} raRad
 * @param {number} decRad
 * @param {number} [radius]
 * @returns {{x: number, y: number, z: number}}
 */
export function equatorialToVector(raRad, decRad, radius = 1) {
    const cosDec = Math.cos(decRad);
    return {
        x: radius * cosDec * Math.cos(raRad),
        y: radius * cosDec * Math.sin(raRad),
        z: radius * Math.sin(decRad)
    };
}

/**
 * Horizontal coordinates for an equatorial position, in SunCalc's convention:
 * azimuth 0 = South and increases toward West, so the result can be handed
 * straight to `AstronomyService.sphericalToCartesian`.
 *
 * @param {number} raRad
 * @param {number} decRad
 * @param {number} lstRad - Local sidereal time.
 * @param {number} latitudeDeg
 * @returns {{altitude: number, azimuth: number}}
 */
export function equatorialToHorizontal(raRad, decRad, lstRad, latitudeDeg) {
    const hourAngle = lstRad - raRad;
    const lat = latitudeDeg * DEG;
    const sinDec = Math.sin(decRad);
    const cosDec = Math.cos(decRad);
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);

    const altitude = Math.asin(sinDec * sinLat + cosDec * cosLat * Math.cos(hourAngle));
    const azimuth = Math.atan2(
        Math.sin(hourAngle),
        Math.cos(hourAngle) * sinLat - (cosDec === 0 ? 0 : (sinDec / cosDec) * cosLat)
    );
    return { altitude, azimuth };
}

/**
 * Row-major 3×3 rotation that maps an equatorial unit vector into the scene's
 * Cartesian frame (Y = up, Z+ = North, X+ = East) — the same frame
 * `AstronomyService.sphericalToCartesian` produces.
 *
 * Because the whole catalog shares one rotation, the star field can be a single
 * static geometry parented to a group whose matrix is refreshed each frame,
 * instead of recomputing alt/az per star.
 *
 * @param {number} lstRad - Local sidereal time.
 * @param {number} latitudeDeg
 * @returns {number[]} Nine elements, row-major.
 */
export function equatorialToSceneMatrix(lstRad, latitudeDeg) {
    const lat = latitudeDeg * DEG;
    const sinL = Math.sin(lstRad);
    const cosL = Math.cos(lstRad);
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);

    // Derived from alt/az: east = -cos(dec)sin(H), up = sin(alt), north follows.
    return [-sinL, cosL, 0, cosLat * cosL, cosLat * sinL, sinLat, -sinLat * cosL, -sinLat * sinL, cosLat];
}
