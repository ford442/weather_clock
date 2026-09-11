// Pure mapping helpers for humidity/pressure → scene + timeline visuals.
// No fetch, no DOM, no Three.js — mirrors the air-quality.js pattern so fog,
// cloud, and timeline code all read these two fields the same way.

/** Standard sea-level pressure (hPa), the neutral point for the anomaly below. */
export const STANDARD_PRESSURE_HPA = 1013.25;

/**
 * Normalized 0..1 "muggy haze" contribution from relative humidity.
 * 0 at/below 60% (dry air reads clear), ramps to 1 by 100% (saturated air).
 * @param {number|null|undefined} humidity Relative humidity, 0-100%.
 */
export function getHumidityHaze(humidity) {
    if (humidity == null || Number.isNaN(humidity)) return 0;
    return Math.max(0, Math.min(1, (humidity - 60) / 40));
}

/**
 * Normalized -1..1 deviation from standard sea-level pressure.
 * Negative = low pressure (unsettled/stormy), positive = high pressure
 * (fair/settled). Saturates at a ±40 hPa swing, roughly a deep low to a
 * strong ridge.
 * @param {number|null|undefined} pressure Mean sea-level pressure, hPa.
 */
export function getPressureAnomaly(pressure) {
    if (pressure == null || Number.isNaN(pressure)) return 0;
    return Math.max(-1, Math.min(1, (pressure - STANDARD_PRESSURE_HPA) / 40));
}
