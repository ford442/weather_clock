// Physical models for the delicate contrast between sunlight and moonlight.
//
// Pure math — no Three.js, no DOM — so the whole model is trivially unit
// testable and shared identically by clock mode, the forecast vignettes and
// the timeline scrubber (all three funnel through weatherLighting.js).
//
// Three real effects are modelled here, each deliberately kept as a small
// continuous modulation rather than a dramatic swing:
//
//  1. Earth's orbital eccentricity. The Earth–Sun distance varies ~±1.7%
//     between perihelion (early January) and aphelion (early July), which is
//     ~±3.4% of irradiance by the inverse-square law.
//  2. The Moon's non-Lambertian phase curve. A half moon is ~1/11th as bright
//     as a full moon, not 1/2 — the regolith back-scatters, producing a sharp
//     "opposition surge" within a few degrees of full. Allen's lunar brightness
//     law captures this. The ±5.5% lunar distance swing (super/micromoon) adds
//     another ~±11% of brightness on top.
//  3. Atmospheric extinction. Both bodies dim and redden as they sink toward
//     the horizon, continuously, which is what makes the day/night handover
//     read as a fade rather than a switch.

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
/** J2000.0 — 2000-01-01 12:00 UTC — the epoch for the solar orbital elements below. */
const J2000_EPOCH_MS = Date.UTC(2000, 0, 1, 12);

export const CELESTIAL_CONFIG = {
    /** Mean lunar distance (km); normalizes the super/micromoon brightness swing. */
    moonMeanDistanceKm: 385000.56,
    /** Clear-sky visual extinction at the zenith, magnitudes per airmass. */
    zenithExtinctionMag: 0.21,
    /** Linear term of Allen's lunar brightness law, magnitudes per degree of phase angle. */
    moonPhaseMagPerDeg: 0.026,
    /** Quartic term of the same law — the non-Lambertian opposition surge. */
    moonPhaseMagQuartic: 4e-9,
    /**
     * Tone-mapping exponent applied to the physical lunar phase curve. The raw
     * 11:1 full-to-half ratio is real but reads as an unlit scene on a half
     * moon; compressing it keeps the phase nuance visible without going black.
     */
    moonPerceptualExponent: 0.45,
    /** Altitude (degrees) below which a body is treated as fully extinguished. */
    horizonCutoffDeg: -2,
    /** Airmass at which horizon reddening saturates (~8° altitude). */
    reddeningSaturationAirmass: 7
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const toMillis = (date) => {
    if (date instanceof Date) return date.getTime();
    if (date == null) return NaN;
    return new Date(/** @type {any} */ (date)).getTime();
};

/**
 * Altitude above the horizon, in radians, for a scene-space celestial position.
 * The scene places sun/moon on a fixed-radius sphere, so altitude is recoverable
 * from the vector alone and callers need not thread SunCalc's spherical output
 * through every layer.
 * @param {{x?: number, y?: number, z?: number}|null|undefined} position
 * @returns {number} Altitude in radians, 0 when the position is degenerate.
 */
export function getAltitudeRadFromPosition(position) {
    if (!position) return 0;
    const x = position.x ?? 0;
    const y = position.y ?? 0;
    const z = position.z ?? 0;
    const length = Math.hypot(x, y, z);
    if (length === 0) return 0;
    return Math.asin(clamp(y / length, -1, 1));
}

/**
 * Earth–Sun distance in astronomical units. SunCalc does not expose this, so it
 * comes from the standard low-precision solar elements (USNO): good to ~1e-4 AU,
 * far finer than the ±1.7% swing we are rendering.
 * @param {Date|string|number} [date]
 * @returns {number} Distance in AU, ~0.9833 at perihelion to ~1.0167 at aphelion.
 */
export function getEarthSunDistanceAu(date = new Date()) {
    const ms = toMillis(date);
    if (!Number.isFinite(ms)) return 1;
    const daysSinceEpoch = (ms - J2000_EPOCH_MS) / 86400000;
    const meanAnomaly = (357.529 + 0.98560028 * daysSinceEpoch) * DEG_TO_RAD;
    return 1.00014 - 0.01671 * Math.cos(meanAnomaly) - 0.00014 * Math.cos(2 * meanAnomaly);
}

/**
 * Solar irradiance relative to its annual mean, by the inverse-square law.
 * @param {Date|string|number} [date]
 * @returns {number} ~1.034 at perihelion, ~0.967 at aphelion.
 */
export function getSolarIrradianceFactor(date = new Date()) {
    const distance = getEarthSunDistanceAu(date);
    if (!(distance > 0)) return 1;
    return 1 / (distance * distance);
}

/**
 * Relative optical air mass (Kasten & Young 1989), 1 at the zenith.
 * @param {number} altitudeRad
 * @returns {number} Air mass, or Infinity at/below the horizon cutoff.
 */
export function getAirmass(altitudeRad) {
    const altitudeDeg = (Number(altitudeRad) || 0) * RAD_TO_DEG;
    if (altitudeDeg <= CELESTIAL_CONFIG.horizonCutoffDeg) return Infinity;
    const denominator = Math.sin(altitudeDeg * DEG_TO_RAD) + 0.50572 * Math.pow(altitudeDeg + 6.07995, -1.6364);
    if (!(denominator > 0)) return Infinity;
    return 1 / denominator;
}

/**
 * Fraction of light surviving the atmosphere, normalized to 1 at the zenith.
 * Falls continuously to 0 at the horizon, which is what gives the moonrise and
 * moonset fades their softness.
 * @param {number} altitudeRad
 * @param {number} [extinctionMag] Zenith extinction in magnitudes per airmass.
 * @returns {number} 0..1
 */
export function getAtmosphericTransmission(altitudeRad, extinctionMag = CELESTIAL_CONFIG.zenithExtinctionMag) {
    const airmass = getAirmass(altitudeRad);
    if (!Number.isFinite(airmass)) return 0;
    return clamp(Math.pow(10, -0.4 * extinctionMag * (airmass - 1)), 0, 1);
}

/**
 * How far along the horizon-reddening ramp a body is, from its path length
 * through the atmosphere. 0 at the zenith, 1 by roughly 8° altitude.
 * @param {number} altitudeRad
 * @returns {number} 0..1
 */
export function getHorizonReddening(altitudeRad) {
    const airmass = getAirmass(altitudeRad);
    if (!Number.isFinite(airmass)) return 1;
    return clamp((airmass - 1) / (CELESTIAL_CONFIG.reddeningSaturationAirmass - 1), 0, 1);
}

/**
 * Sun–Moon–observer phase angle from the illuminated fraction.
 * @param {number|null|undefined} illuminatedFraction SunCalc's moonIllumination.fraction.
 * @returns {number} Degrees: 0 at full moon, 90 at the quarters, 180 at new.
 */
export function getMoonPhaseAngleDeg(illuminatedFraction) {
    const fraction = clamp(Number(illuminatedFraction) || 0, 0, 1);
    return Math.acos(clamp(2 * fraction - 1, -1, 1)) * RAD_TO_DEG;
}

/**
 * Integrated disk brightness relative to a full moon, from Allen's lunar
 * brightness law (m = -12.73 + 0.026|a| + 4e-9 a^4). This is the whole point of
 * the phase model: it reproduces the ~11:1 full-to-half ratio that a naive
 * `illuminatedFraction` multiplier misses entirely.
 * @param {number} phaseAngleDeg
 * @returns {number} 1 at full moon, ~0.09 at a quarter, ~0 at new.
 */
export function getMoonOppositionSurge(phaseAngleDeg) {
    const angle = clamp(Number(phaseAngleDeg) || 0, 0, 180);
    const deltaMagnitudes =
        CELESTIAL_CONFIG.moonPhaseMagPerDeg * angle + CELESTIAL_CONFIG.moonPhaseMagQuartic * Math.pow(angle, 4);
    return clamp(Math.pow(10, -0.4 * deltaMagnitudes), 0, 1);
}

/**
 * Brightness scale from the Moon's current distance (inverse square).
 * @param {number|null|undefined} distanceKm SunCalc's moonPosition.distance.
 * @returns {number} ~1.11 at perigee, ~0.90 at apogee, 1 when unknown.
 */
export function getMoonDistanceFactor(distanceKm) {
    const distance = Number(distanceKm);
    if (!Number.isFinite(distance) || distance <= 0) return 1;
    const ratio = CELESTIAL_CONFIG.moonMeanDistanceKm / distance;
    return clamp(ratio * ratio, 0.8, 1.25);
}

/**
 * Full moonlight model for one instant: how bright the moon is, how its light
 * should be tinted, and how much ashen earthshine fills its dark limb.
 * @param {{fraction?: number, phase?: number, angle?: number}|null|undefined} moonIllumination
 *   SunCalc's getMoonIllumination() result.
 * @param {{altitudeRad?: number, distanceKm?: number|null}} [options]
 * @returns {MoonlightModel}
 */
export function getMoonlightModel(moonIllumination, options = {}) {
    const illuminatedFraction = clamp(Number(moonIllumination?.fraction ?? 0.5) || 0, 0, 1);
    const phaseAngleDeg = getMoonPhaseAngleDeg(illuminatedFraction);
    const synodicPhase = clamp(Number(moonIllumination?.phase ?? 0.5) || 0, 0, 1);
    const altitudeRad = Number(options.altitudeRad) || 0;

    const oppositionSurge = getMoonOppositionSurge(phaseAngleDeg);
    const distanceFactor = getMoonDistanceFactor(options.distanceKm);
    const apparentSizeFactor = Math.sqrt(distanceFactor);
    const airmass = getAirmass(altitudeRad);
    const transmission = getAtmosphericTransmission(altitudeRad);
    const horizonReddening = getHorizonReddening(altitudeRad);

    const physicalIntensityFactor = oppositionSurge * distanceFactor * transmission;
    const intensityFactor =
        Math.pow(oppositionSurge, CELESTIAL_CONFIG.moonPerceptualExponent) * distanceFactor * transmission;

    // Earthshine is sunlight bounced off the Earth onto the Moon's night side.
    // It peaks near new moon, when the Earth is full as seen from the Moon and
    // the dark limb fills most of the disk.
    const earthshine = clamp(1 - illuminatedFraction, 0, 1);

    // Purkinje shift: at the scotopic light levels of a crescent, human vision
    // loses red sensitivity and moonlight reads distinctly blue. A bright full
    // moon crosses into mesopic vision and reads close to neutral.
    const coolShift = clamp(1 - Math.pow(clamp(oppositionSurge * distanceFactor, 0, 1), 0.4), 0, 1);

    return {
        illuminatedFraction,
        phaseAngleDeg,
        synodicPhase,
        waxing: synodicPhase < 0.5,
        altitudeRad,
        oppositionSurge,
        distanceFactor,
        apparentSizeFactor,
        airmass: Number.isFinite(airmass) ? airmass : Infinity,
        transmission,
        horizonReddening,
        earthshine,
        coolShift,
        physicalIntensityFactor,
        intensityFactor
    };
}

/**
 * Sunlight model for one instant. Only the orbital-distance term feeds
 * intensity: the existing day-factor ramp and sunset tint in weatherLighting.js
 * already carry the altitude falloff, so applying extinction to intensity here
 * too would double-count it. `transmission`/`horizonReddening` are exposed for
 * colour work only.
 * @param {Date|string|number} [date]
 * @param {number} [altitudeRad]
 * @returns {SunlightModel}
 */
export function getSunlightModel(date = new Date(), altitudeRad = 0) {
    const distanceAu = getEarthSunDistanceAu(date);
    const irradianceFactor = getSolarIrradianceFactor(date);
    const altitude = Number(altitudeRad) || 0;
    return {
        distanceAu,
        irradianceFactor,
        altitudeRad: altitude,
        transmission: getAtmosphericTransmission(altitude),
        horizonReddening: getHorizonReddening(altitude),
        intensityFactor: irradianceFactor
    };
}
