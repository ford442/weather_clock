// Pure, renderer-agnostic ground-weather accumulator.
// Integrates snow coverage and ground wetness over *simulated* time so
// scrubbing/time-warp behave correctly. No THREE.js dependency — unit-testable
// in isolation.

const ACCUM_RATE_PER_MS = 1 / (90 * 1000); // full coverage after ~90s of sim-time at intensity 1
const MELT_RATE_PER_MS_PER_DEGREE = 1 / (240 * 1000); // ~4 min per °C above freezing to fully melt
const WETNESS_HOLD_MS = 30 * 60 * 1000; // 30 sim-minutes
const RAIN_THRESHOLD = 0.05;
const JUMP_THRESHOLD_MS = WETNESS_HOLD_MS;
const STEADY_STATE_DEPTH_SCALE = 0.85;

/** @returns {{lastSimTimeMs: number|null, snowDepth: number, wetnessRemaining: number}} */
export function createAccumulatorState() {
    return {
        lastSimTimeMs: null,
        snowDepth: 0,
        wetnessRemaining: 0
    };
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * Advance the accumulator to `simTimeMs`, given the currently active weather.
 * Mutates and returns `state` for convenience.
 *
 * @param {{lastSimTimeMs: number|null, snowDepth: number, wetnessRemaining: number}} state
 * @param {{temp?: number, rainIntensity?: number, snowIntensity?: number}} weather
 * @param {number} simTimeMs
 */
export function integrate(state, weather, simTimeMs) {
    const temp = weather?.temp ?? 15;
    const rainIntensity = weather?.rainIntensity ?? 0;
    const snowIntensity = weather?.snowIntensity ?? 0;

    const deltaMs = state.lastSimTimeMs === null ? null : simTimeMs - state.lastSimTimeMs;

    if (deltaMs === null || Math.abs(deltaMs) > JUMP_THRESHOLD_MS) {
        // First frame, or a discontinuous jump (timeline scrub / large time-warp step):
        // recompute a plausible steady-state instead of integrating through unknown history.
        state.snowDepth = temp <= 0 && snowIntensity > 0 ? clamp(snowIntensity * STEADY_STATE_DEPTH_SCALE, 0, 1) : 0;
        state.wetnessRemaining = rainIntensity > RAIN_THRESHOLD ? WETNESS_HOLD_MS : 0;
    } else {
        if (temp <= 0) {
            state.snowDepth = clamp(state.snowDepth + snowIntensity * ACCUM_RATE_PER_MS * deltaMs, 0, 1);
        } else {
            const meltRate = MELT_RATE_PER_MS_PER_DEGREE * temp;
            state.snowDepth = clamp(state.snowDepth - meltRate * deltaMs, 0, 1);
        }

        if (rainIntensity > RAIN_THRESHOLD) {
            state.wetnessRemaining = WETNESS_HOLD_MS;
        } else {
            state.wetnessRemaining = clamp(state.wetnessRemaining - deltaMs, 0, WETNESS_HOLD_MS);
        }
    }

    state.lastSimTimeMs = simTimeMs;
    return state;
}

export function getSnowCoverage(state) {
    return state.snowDepth;
}

export function getWetness01(state) {
    return state.wetnessRemaining / WETNESS_HOLD_MS;
}

export const ACCUMULATOR_CONSTANTS = {
    ACCUM_RATE_PER_MS,
    MELT_RATE_PER_MS_PER_DEGREE,
    WETNESS_HOLD_MS,
    RAIN_THRESHOLD,
    JUMP_THRESHOLD_MS,
    STEADY_STATE_DEPTH_SCALE
};
