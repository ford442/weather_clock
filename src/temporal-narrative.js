// Temporal narrative: the shared "past → present → future" visual grammar.
//
// The scene is split into three time zones (see scene-layout.js). This module turns
// the three weather snapshots that feed those zones into the small set of numbers the
// graphics use to tell the story without words:
//
//  - time flows leftward, so departing weather drifts out through the past zone and
//    incoming weather slides in from the future zone (`drift`),
//  - temperature reads as colour — cold is blue, warm is red (`tint`, `warmth`),
//  - a rising / falling / steady trend has a signed magnitude the shaders can animate
//    (`tempTrend`, `trendDirection`),
//  - conditions clearing or worsening has its own signed magnitude (`severityTrend`).
//
// Kept pure and free of Three.js so it can be unit-tested and reused by both the
// clock-mode scene (effects/) and timeline mode.

import { getSeverity } from './weatherLighting.js';

export const TEMPORAL_NARRATIVE_CONFIG = Object.freeze({
    /** °C between the past and future snapshots that saturates the trend to ±1. */
    tempSpanC: 8,
    /** Below this |Δ°C| the trend reads as "steady" rather than rising/falling. */
    steadyThresholdC: 0.6,
    /** Temperature anchors for the blue→red colour ramp. */
    coldAnchorC: -6,
    hotAnchorC: 32,
    /** World units/second of baseline leftward "time current" applied to clouds. */
    baseDrift: 0.03,
    /** Extra leftward drift per unit of weather change (storms leaving in a hurry). */
    changeDrift: 0.16,
    /** The past zone pushes weather out faster than the future zone brings it in. */
    pastDriftMultiplier: 1.45,
    futureDriftMultiplier: 0.8,
    /** Colour ramp endpoints, linear RGB triples. */
    coolTint: Object.freeze([0.44, 0.64, 1.0]),
    neutralTint: Object.freeze([1.0, 1.0, 1.0]),
    warmTint: Object.freeze([1.0, 0.58, 0.34]),
    /** How far a zone's tint is allowed to pull away from neutral white. */
    tintStrength: 0.55
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Normalised warmth of a temperature on the scene's cold→hot ramp.
 * @param {number|null|undefined} temp - Temperature in °C.
 * @returns {number} 0 (cold) … 1 (hot); 0.5 when the temperature is unknown.
 */
export function temperatureWarmth(temp) {
    if (typeof temp !== 'number' || !Number.isFinite(temp)) return 0.5;
    const { coldAnchorC, hotAnchorC } = TEMPORAL_NARRATIVE_CONFIG;
    return clamp((temp - coldAnchorC) / (hotAnchorC - coldAnchorC), 0, 1);
}

/**
 * Blue-vs-red tint for a temperature, as a linear RGB triple centred on white.
 * @param {number|null|undefined} temp - Temperature in °C.
 * @param {number} [strength] - 0 = white, 1 = full ramp colour.
 * @returns {[number, number, number]}
 */
export function temperatureTint(temp, strength = TEMPORAL_NARRATIVE_CONFIG.tintStrength) {
    const { coolTint, neutralTint, warmTint } = TEMPORAL_NARRATIVE_CONFIG;
    const warmth = temperatureWarmth(temp);
    const from = warmth < 0.5 ? coolTint : neutralTint;
    const to = warmth < 0.5 ? neutralTint : warmTint;
    const t = warmth < 0.5 ? warmth * 2 : (warmth - 0.5) * 2;
    /** @type {[number, number, number]} */
    const tint = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
        const ramped = from[i] + (to[i] - from[i]) * t;
        tint[i] = 1 + (ramped - 1) * clamp(strength, 0, 1);
    }
    return tint;
}

/**
 * Severity of a snapshot: its own `severity` when interpolation already supplied one,
 * otherwise derived from the WMO code.
 * @param {WeatherSnapshot|null|undefined} snap
 * @returns {number} 0 (calm) … ~1 (storm)
 */
function snapshotSeverity(snap) {
    if (!snap) return 0;
    if (typeof snap.severity === 'number' && Number.isFinite(snap.severity)) return snap.severity;
    return getSeverity(snap.weatherCode || 0);
}

/**
 * Overall "how much weather" a snapshot carries — precipitation, cloud, and severity
 * combined. Used to measure how fast the scene is changing, which sets the drift speed.
 * @param {WeatherSnapshot|null|undefined} snap
 * @returns {number} 0 … ~1
 */
function snapshotWeight(snap) {
    if (!snap) return 0;
    const precip = Math.max(snap.rainIntensity || 0, snap.snowIntensity || 0);
    const fog = snap.fogIntensity || 0;
    const cloud = clamp((snap.cloudCover || 0) / 100, 0, 1);
    return clamp(snapshotSeverity(snap) * 0.5 + precip * 0.3 + fog * 0.1 + cloud * 0.1, 0, 1);
}

/**
 * @typedef {Object} TemporalZoneNarrative
 * @property {number} temp - Temperature in °C (NaN-safe: falls back to the present).
 * @property {number} warmth - 0 (cold) … 1 (hot).
 * @property {[number, number, number]} tint - Blue↔red multiplier for this zone's visuals.
 * @property {number} severity - 0 (calm) … ~1 (storm).
 * @property {number} drift - World units/second along X; negative = drifting toward the past.
 * @property {number} light - Relative lighting weight for the zone, 0…1.
 */

/**
 * @typedef {Object} TemporalNarrative
 * @property {TemporalZoneNarrative} past
 * @property {TemporalZoneNarrative} current
 * @property {TemporalZoneNarrative} future
 * @property {number} tempDelta - Future minus past temperature, in °C.
 * @property {number} tempTrend - `tempDelta` normalised to -1 … 1.
 * @property {'rising'|'falling'|'steady'} trendDirection
 * @property {number} severityTrend - -1 (clearing) … 1 (worsening).
 * @property {boolean} clearing
 * @property {boolean} worsening
 * @property {number} changeRate - 0 … 1, how much the scene differs past-to-future.
 * @property {number} dayFactor - -1 (night) … 1 (noon), pass-through for lighting cues.
 */

/**
 * Build the narrative numbers shared by every past/present/future visual.
 * @param {WeatherSnapshot|null|undefined} past
 * @param {WeatherSnapshot|null|undefined} current
 * @param {WeatherSnapshot|null|undefined} forecast
 * @param {{dayFactor?: number}} [options] - `dayFactor` is the normalised sun altitude (-1…1).
 * @returns {TemporalNarrative}
 */
export function computeTemporalNarrative(past, current, forecast, options = {}) {
    const cfg = TEMPORAL_NARRATIVE_CONFIG;
    const dayFactor = clamp(options.dayFactor ?? 0, -1, 1);

    const currentTemp = typeof current?.temp === 'number' && Number.isFinite(current.temp) ? current.temp : NaN;
    const pick = (temp) => (typeof temp === 'number' && Number.isFinite(temp) ? temp : currentTemp);
    const pastTemp = pick(past?.temp);
    const futureTemp = pick(forecast?.temp);

    const tempDelta = Number.isFinite(futureTemp) && Number.isFinite(pastTemp) ? futureTemp - pastTemp : 0;
    const tempTrend = clamp(tempDelta / cfg.tempSpanC, -1, 1);
    /** @type {'rising'|'falling'|'steady'} */
    let trendDirection = 'steady';
    if (tempDelta > cfg.steadyThresholdC) trendDirection = 'rising';
    else if (tempDelta < -cfg.steadyThresholdC) trendDirection = 'falling';

    const pastSeverity = snapshotSeverity(past);
    const currentSeverity = snapshotSeverity(current);
    const futureSeverity = snapshotSeverity(forecast);
    const severityTrend = clamp(futureSeverity - pastSeverity, -1, 1);

    const changeRate = clamp(
        Math.abs(snapshotWeight(forecast) - snapshotWeight(past)) + Math.abs(tempTrend) * 0.35,
        0,
        1
    );

    // Time flows leftward: everything drifts toward the past, faster while the scene
    // is changing, so a departing storm visibly clears out through the left zone.
    const baseDrift = -(cfg.baseDrift + cfg.changeDrift * changeRate);

    /**
     * @param {number} temp
     * @param {number} severity
     * @param {number} driftMultiplier
     * @param {number} light
     * @returns {TemporalZoneNarrative}
     */
    const zone = (temp, severity, driftMultiplier, light) => ({
        temp: Number.isFinite(temp) ? temp : 0,
        warmth: temperatureWarmth(temp),
        tint: temperatureTint(temp),
        severity,
        drift: baseDrift * driftMultiplier,
        light
    });

    return {
        past: zone(pastTemp, pastSeverity, cfg.pastDriftMultiplier, 0.2),
        current: zone(currentTemp, currentSeverity, 1, 0.5),
        future: zone(futureTemp, futureSeverity, cfg.futureDriftMultiplier, 0.3),
        tempDelta,
        tempTrend,
        trendDirection,
        severityTrend,
        clearing: severityTrend < -0.08,
        worsening: severityTrend > 0.08,
        changeRate,
        dayFactor
    };
}
