/**
 * Lightweight planetary ephemeris.
 *
 * Uses JPL's "Keplerian Elements for Approximate Positions of the Major
 * Planets" (the 1800 AD – 2050 AD table), which is a few hundred bytes of
 * constants instead of a VSOP87 series. Accuracy is a few arcminutes for the
 * inner planets and under ~0.3° for the outer ones — comfortably inside the
 * ~1° the night sky layer needs, and far below what a star-sized sprite can
 * even express on screen.
 *
 * Everything here is pure math on plain numbers.
 *
 * @typedef {{
 *   id: string,
 *   name: string,
 *   ra: number,
 *   dec: number,
 *   magnitude: number,
 *   distanceAu: number,
 *   phaseAngleDeg: number
 * }} PlanetPosition
 */

import {
    DEG,
    OBLIQUITY_J2000,
    julianCenturies,
    normalizeAngle,
    normalizeDegreesSigned
} from './celestialCoordinates.js';

/**
 * [a (au), e, I (deg), L (deg), longitude of perihelion (deg), longitude of
 * ascending node (deg)] followed by the same six per-Julian-century rates.
 * @typedef {{name: string, elements: number[], rates: number[], magBase: number, phaseCoeffs: number[]}} PlanetElements
 */

/** @type {Record<string, PlanetElements>} */
const PLANETS = {
    mercury: {
        name: 'Mercury',
        elements: [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593],
        rates: [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
        magBase: -0.42,
        phaseCoeffs: [0.038, -0.000273, 0.000002]
    },
    venus: {
        name: 'Venus',
        elements: [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255],
        rates: [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418],
        magBase: -4.4,
        phaseCoeffs: [0.0009, 0.000239, -0.00000065]
    },
    earth: {
        name: 'Earth',
        elements: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0],
        rates: [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0],
        magBase: 0,
        phaseCoeffs: [0, 0, 0]
    },
    mars: {
        name: 'Mars',
        elements: [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
        rates: [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
        magBase: -1.52,
        phaseCoeffs: [0.016, 0, 0]
    },
    jupiter: {
        name: 'Jupiter',
        elements: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
        rates: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
        magBase: -9.4,
        phaseCoeffs: [0.005, 0, 0]
    },
    saturn: {
        name: 'Saturn',
        elements: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
        rates: [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
        // Ring tilt swings Saturn by up to ~0.8 mag; ignored, so it reads as a
        // steady ~0.5 mag object, which is right within a visual half-magnitude.
        magBase: -8.88,
        phaseCoeffs: [0, 0, 0]
    },
    uranus: {
        name: 'Uranus',
        elements: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503],
        rates: [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
        magBase: -7.19,
        phaseCoeffs: [0, 0, 0]
    },
    neptune: {
        name: 'Neptune',
        elements: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
        rates: [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
        magBase: -6.87,
        phaseCoeffs: [0, 0, 0]
    }
};

/** Planets rendered by default: the five classical naked-eye ones. */
export const NAKED_EYE_PLANETS = ['mercury', 'venus', 'mars', 'jupiter', 'saturn'];

/** Every planet this module can place, outer ones included. */
export const ALL_PLANETS = ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];

/**
 * Solve Kepler's equation by Newton iteration. Converges in 3–4 passes for
 * every planetary eccentricity (Mercury's 0.206 is the worst case here).
 * @param {number} meanAnomalyDeg
 * @param {number} eccentricity
 * @returns {number} Eccentric anomaly in degrees.
 */
function solveKepler(meanAnomalyDeg, eccentricity) {
    const eStar = (180 / Math.PI) * eccentricity;
    let eccentricAnomaly = meanAnomalyDeg + eStar * Math.sin(meanAnomalyDeg * DEG);
    for (let i = 0; i < 8; i++) {
        const deltaM = meanAnomalyDeg - (eccentricAnomaly - eStar * Math.sin(eccentricAnomaly * DEG));
        const deltaE = deltaM / (1 - eccentricity * Math.cos(eccentricAnomaly * DEG));
        eccentricAnomaly += deltaE;
        if (Math.abs(deltaE) < 1e-9) break;
    }
    return eccentricAnomaly;
}

/**
 * Heliocentric position in the J2000 ecliptic frame, in astronomical units.
 * @param {PlanetElements} planet
 * @param {number} centuries - Julian centuries since J2000.
 * @returns {{x: number, y: number, z: number}}
 */
function heliocentricEcliptic(planet, centuries) {
    const [a0, e0, i0, l0, peri0, node0] = planet.elements;
    const [da, de, di, dl, dperi, dnode] = planet.rates;

    const a = a0 + da * centuries;
    const e = e0 + de * centuries;
    const inclination = (i0 + di * centuries) * DEG;
    const meanLongitude = l0 + dl * centuries;
    const longitudeOfPerihelion = peri0 + dperi * centuries;
    const node = (node0 + dnode * centuries) * DEG;

    const argPerihelion = (longitudeOfPerihelion - (node0 + dnode * centuries)) * DEG;
    const meanAnomaly = normalizeDegreesSigned(meanLongitude - longitudeOfPerihelion);
    const eccentricAnomaly = solveKepler(meanAnomaly, e) * DEG;

    // Position in the orbital plane, perihelion along +x.
    const xOrbital = a * (Math.cos(eccentricAnomaly) - e);
    const yOrbital = a * Math.sqrt(1 - e * e) * Math.sin(eccentricAnomaly);

    const cosW = Math.cos(argPerihelion);
    const sinW = Math.sin(argPerihelion);
    const cosO = Math.cos(node);
    const sinO = Math.sin(node);
    const cosI = Math.cos(inclination);
    const sinI = Math.sin(inclination);

    return {
        x: (cosW * cosO - sinW * sinO * cosI) * xOrbital + (-sinW * cosO - cosW * sinO * cosI) * yOrbital,
        y: (cosW * sinO + sinW * cosO * cosI) * xOrbital + (-sinW * sinO + cosW * cosO * cosI) * yOrbital,
        z: sinW * sinI * xOrbital + cosW * sinI * yOrbital
    };
}

/**
 * Apparent visual magnitude from the standard Astronomical Almanac phase
 * polynomials.
 * @param {PlanetElements} planet
 * @param {number} heliocentricAu
 * @param {number} geocentricAu
 * @param {number} phaseAngleDeg
 * @returns {number}
 */
function apparentMagnitude(planet, heliocentricAu, geocentricAu, phaseAngleDeg) {
    const [c1, c2, c3] = planet.phaseCoeffs;
    const distanceTerm = 5 * Math.log10(Math.max(1e-6, heliocentricAu * geocentricAu));
    const i = phaseAngleDeg;
    return planet.magBase + distanceTerm + c1 * i + c2 * i * i + c3 * i * i * i;
}

/**
 * The Sun's geocentric equatorial position (J2000 equinox), obtained by
 * negating Earth's heliocentric vector. Not rendered — the scene gets its sun
 * from SunCalc — but it gives the night sky layer a way to cross-check the
 * ephemeris against an independent source.
 * @param {Date|number} date
 * @returns {{ra: number, dec: number, distanceAu: number}}
 */
export function getSunEquatorial(date) {
    const earth = heliocentricEcliptic(PLANETS.earth, julianCenturies(date));
    const x = -earth.x;
    const y = -earth.y;
    const z = -earth.z;

    const cosE = Math.cos(OBLIQUITY_J2000);
    const sinE = Math.sin(OBLIQUITY_J2000);
    const eqY = y * cosE - z * sinE;
    const eqZ = y * sinE + z * cosE;
    const distanceAu = Math.sqrt(x * x + eqY * eqY + eqZ * eqZ);

    return { ra: normalizeAngle(Math.atan2(eqY, x)), dec: Math.asin(eqZ / distanceAu), distanceAu };
}

/**
 * Geocentric equatorial position (J2000 equinox) for one planet.
 * @param {string} id - Key from {@link ALL_PLANETS}.
 * @param {Date|number} date
 * @returns {PlanetPosition|null} Null for an unknown id or for Earth itself.
 */
export function getPlanetPosition(id, date) {
    const planet = PLANETS[id];
    if (!planet || id === 'earth') return null;

    const centuries = julianCenturies(date);
    const body = heliocentricEcliptic(planet, centuries);
    const earth = heliocentricEcliptic(PLANETS.earth, centuries);

    const gx = body.x - earth.x;
    const gy = body.y - earth.y;
    const gz = body.z - earth.z;

    // Ecliptic → equatorial.
    const cosE = Math.cos(OBLIQUITY_J2000);
    const sinE = Math.sin(OBLIQUITY_J2000);
    const eqX = gx;
    const eqY = gy * cosE - gz * sinE;
    const eqZ = gy * sinE + gz * cosE;

    const geocentricAu = Math.sqrt(eqX * eqX + eqY * eqY + eqZ * eqZ);
    const heliocentricAu = Math.sqrt(body.x * body.x + body.y * body.y + body.z * body.z);
    const earthSunAu = Math.sqrt(earth.x * earth.x + earth.y * earth.y + earth.z * earth.z);

    // Phase angle: the Sun–planet–Earth angle, from the law of cosines.
    const cosPhase =
        (heliocentricAu * heliocentricAu + geocentricAu * geocentricAu - earthSunAu * earthSunAu) /
        (2 * heliocentricAu * geocentricAu);
    const phaseAngleDeg = (Math.acos(Math.max(-1, Math.min(1, cosPhase))) * 180) / Math.PI;

    return {
        id,
        name: planet.name,
        ra: normalizeAngle(Math.atan2(eqY, eqX)),
        dec: Math.asin(eqZ / geocentricAu),
        magnitude: apparentMagnitude(planet, heliocentricAu, geocentricAu, phaseAngleDeg),
        distanceAu: geocentricAu,
        phaseAngleDeg
    };
}

/**
 * Positions for a set of planets at one instant.
 * @param {Date|number} date
 * @param {string[]} [ids]
 * @returns {PlanetPosition[]}
 */
export function getPlanetPositions(date, ids = NAKED_EYE_PLANETS) {
    /** @type {PlanetPosition[]} */
    const positions = [];
    for (const id of ids) {
        const position = getPlanetPosition(id, date);
        if (position) positions.push(position);
    }
    return positions;
}
