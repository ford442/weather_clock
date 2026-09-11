// Pure intensity → gain/frequency mapping functions used by AmbienceEngine.
// Kept dependency-free (no AudioContext) so they can be unit tested directly.

export const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Reduced-motion preference heavily attenuates ambience rather than muting it outright. */
export const REDUCED_MOTION_ATTENUATION = 0.15;

/** @param {number} rainIntensity - 0..1 */
export function rainGainForIntensity(rainIntensity) {
    return clamp01(rainIntensity) * 0.7;
}

/** @param {number} rainIntensity - 0..1 */
export function rainFilterFrequencyForIntensity(rainIntensity) {
    return 2000 + clamp01(rainIntensity) * 3000;
}

/** @param {number} windSpeed - raw wind speed (same units as weather snapshot) */
export function windGainForSpeed(windSpeed) {
    const norm = clamp01(Math.max(0, windSpeed) / 50);
    return norm * 0.5;
}

/** @param {number} windSpeed - raw wind speed (same units as weather snapshot) */
export function windFilterFrequencyForSpeed(windSpeed) {
    const norm = clamp01(Math.max(0, windSpeed) / 50);
    return 150 + norm * 1500;
}

/** @param {number} sunElevationNorm - roughly -1 (deep night) .. 1 (noon) */
export function birdBedGainForSunAltitude(sunElevationNorm) {
    const dayFactor = sunElevationNorm ?? 0;
    const birdWindow = dayFactor > -0.05 && dayFactor < 0.4 ? 1 - Math.abs((dayFactor - 0.17) / 0.23) : 0;
    return clamp01(birdWindow) * 0.12;
}

/** @param {number} sunElevationNorm - roughly -1 (deep night) .. 1 (noon) */
export function cricketBedGainForSunAltitude(sunElevationNorm) {
    const dayFactor = sunElevationNorm ?? 0;
    const nightGate = dayFactor < -0.05 ? clamp01(-dayFactor * 4) : 0;
    return nightGate * 0.1;
}

/** @param {number} intensity - lightning flash intensity, 0..1 */
export function thunderPeakGainForIntensity(intensity) {
    return 0.4 + 0.5 * clamp01(intensity);
}
