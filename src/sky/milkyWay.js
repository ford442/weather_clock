/**
 * Galactic-coordinate math behind the Milky Way band. Pure numbers — no
 * Three.js, no DOM — so the pole, the centre, and the band's plane can be
 * unit-tested against published values without a renderer.
 *
 * The galactic frame is fixed against the stars: it is defined at J2000 by the
 * IAU (1958, restated for FK5/J2000 by Liu, Zhu & Zhang 2011) and carried to the
 * equinox of date by the same IAU 1976 precession the star catalog uses, so the
 * band and the catalog can never drift apart.
 *
 * Angles are radians unless a name says otherwise.
 */

import { DEG, normalizeAngle, precessFromJ2000 } from './celestialCoordinates.js';

/**
 * North galactic pole, J2000: RA 12h 51m 26.28s, Dec +27° 07′ 41.7″.
 * @type {Readonly<{ra: number, dec: number}>}
 */
export const GALACTIC_NORTH_POLE_J2000 = Object.freeze({ ra: 192.85948 * DEG, dec: 27.12825 * DEG });

/**
 * Galactic longitude of the north celestial pole, J2000. Together with the pole
 * this fixes the frame's rotation about its own axis, and puts l = 0 on the
 * galactic centre.
 */
export const GALACTIC_LONGITUDE_OF_NCP = 122.93192 * DEG;

/**
 * How wide the drawn band is, in galactic latitude either side of the plane.
 * The bulge reaches ~±15°; the rest is room for the glow to taper to nothing.
 */
export const MILKY_WAY_HALF_WIDTH_DEG = 24;

/**
 * Galactic (l, b) → equatorial J2000 (Meeus/Duffett-Smith rotation).
 * @param {number} longitudeRad - Galactic longitude l.
 * @param {number} latitudeRad - Galactic latitude b.
 * @returns {{ra: number, dec: number}}
 */
export function galacticToEquatorialJ2000(longitudeRad, latitudeRad) {
    const { ra: raPole, dec: decPole } = GALACTIC_NORTH_POLE_J2000;
    const sinB = Math.sin(latitudeRad);
    const cosB = Math.cos(latitudeRad);
    const sinDp = Math.sin(decPole);
    const cosDp = Math.cos(decPole);
    const delta = GALACTIC_LONGITUDE_OF_NCP - longitudeRad;

    const sinDec = sinB * sinDp + cosB * cosDp * Math.cos(delta);
    const ra = raPole + Math.atan2(cosB * Math.sin(delta), sinB * cosDp - cosB * sinDp * Math.cos(delta));
    return { ra: normalizeAngle(ra), dec: Math.asin(Math.max(-1, Math.min(1, sinDec))) };
}

/**
 * Galactic (l, b) → equatorial coordinates of date: the J2000 rotation, then
 * the catalog's precession. This is the function the band is laid out with.
 * @param {number} longitudeRad
 * @param {number} latitudeRad
 * @param {number} centuries - Julian centuries since J2000 (see `julianCenturies`).
 * @returns {{ra: number, dec: number}}
 */
export function galacticToEquatorial(longitudeRad, latitudeRad, centuries) {
    const j2000 = galacticToEquatorialJ2000(longitudeRad, latitudeRad);
    return centuries === 0 ? j2000 : precessFromJ2000(j2000.ra, j2000.dec, centuries);
}

/**
 * The galactic frame's two anchors in equatorial coordinates of date.
 * @param {number} centuries
 * @returns {{pole: {ra: number, dec: number}, centre: {ra: number, dec: number}}}
 */
export function getGalacticFrame(centuries) {
    return {
        pole: galacticToEquatorial(0, Math.PI / 2, centuries),
        centre: galacticToEquatorial(0, 0, centuries)
    };
}

/**
 * Wrap a longitude in degrees into (-180, 180], so the centre is 0 and the
 * anticentre is ±180.
 * @param {number} degrees
 * @returns {number}
 */
function signedDegrees(degrees) {
    const wrapped = ((((degrees + 180) % 360) + 360) % 360) - 180;
    return wrapped === -180 ? 180 : wrapped;
}

/**
 * @param {number} x
 * @param {number} sigma
 * @returns {number}
 */
const gaussian = (x, sigma) => Math.exp(-(x * x) / (2 * sigma * sigma));

/**
 * Stylised naked-eye surface brightness of the Milky Way, 0…1, at galactic
 * (l, b) in degrees. Not a photometric model — a smooth picture of what a dark
 * site shows: a disk that is brightest and thickest toward the centre in
 * Sagittarius and thins toward the anticentre in Auriga, the bulge around the
 * centre, the Cygnus star cloud, and the Great Rift's dust lane splitting the
 * band from Cygnus down to Ophiuchus.
 *
 * @param {number} longitudeDeg
 * @param {number} latitudeDeg
 * @returns {number}
 */
export function milkyWayBrightness(longitudeDeg, latitudeDeg) {
    const l = signedDegrees(longitudeDeg);
    const b = latitudeDeg;
    const centreWeight = gaussian(l, 45);

    // Disk: thicker and brighter toward the centre.
    const thickness = 3.5 + 5.5 * centreWeight;
    const disk = (0.3 + 0.55 * centreWeight + 0.2 * gaussian(l - 78, 14)) * gaussian(b, thickness);
    // Bulge: a round glow sitting just south of the plane, as seen from the Sun.
    const bulge = 0.65 * gaussian(Math.hypot(l, (b + 2.5) * 1.3), 9);

    // Great Rift: a dark lane just north of the plane from Cygnus to Ophiuchus.
    const riftExtent = l > 0 && l < 90 ? Math.sin((l / 90) * Math.PI) : 0;
    const rift = 1 - 0.6 * riftExtent * gaussian(b - 1.5, 2.2);

    return Math.max(0, Math.min(1, (disk + bulge) * rift));
}
