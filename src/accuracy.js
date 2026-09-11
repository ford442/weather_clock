/**
 * accuracy.js - Shared forecast-accuracy math for the clock (WeatherService)
 * and timeline (TimelineData) modes. Both compare archived model predictions
 * from Open-Meteo's Previous Runs API against observed temperatures; this
 * module holds the one implementation of "pair up two series and score them"
 * so the two call sites don't drift.
 */

/** Once per day per location - the underlying Previous Runs data only changes as new model runs land. */
export const ACCURACY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Mean absolute error between two same-indexed series, skipping any index
 * where either value isn't a finite number.
 *
 * @param {(number|null|undefined)[]} actual
 * @param {(number|null|undefined)[]} predicted
 * @param {number[]} [indices] - subset of indices to consider (defaults to all of `actual`)
 * @returns {{value: number, n: number}|null} null when no valid pairs exist
 */
export function meanAbsoluteError(actual, predicted, indices) {
    if (!Array.isArray(predicted)) return null;
    const idxs = indices ?? actual.map((_, i) => i);
    let sum = 0;
    let n = 0;
    for (const i of idxs) {
        const a = actual[i];
        const p = predicted[i];
        if (typeof a === 'number' && typeof p === 'number') {
            sum += Math.abs(a - p);
            n++;
        }
    }
    return n > 0 ? { value: sum / n, n } : null;
}

/**
 * Gate a mean-absolute-error result on a minimum sample size, folding the
 * "not enough data" case into a single null check for callers.
 *
 * @param {(number|null|undefined)[]} actual
 * @param {(number|null|undefined)[]} predicted
 * @param {number} minSampleSize
 * @param {number[]} [indices]
 * @returns {{value: number, n: number}|null}
 */
export function meanAbsoluteErrorGated(actual, predicted, minSampleSize, indices) {
    const stats = meanAbsoluteError(actual, predicted, indices);
    return stats && stats.n >= minSampleSize ? stats : null;
}

/**
 * Full per-day accuracy metrics for a matched pair of actual/predicted
 * temperature series: MAE, RMSE, and a skill score vs. a naive persistence
 * baseline (predicting `actual[0]` for every hour). Arrays must already be
 * paired and equal length (filter out nulls before calling).
 *
 * @param {number[]} actual
 * @param {number[]} predicted
 * @returns {{mae: number|null, rmse: number|null, skill: number|null}}
 */
export function calculateAccuracyMetrics(actual, predicted) {
    if (actual.length !== predicted.length || actual.length === 0) {
        return { mae: null, rmse: null, skill: null };
    }

    const n = actual.length;

    const mae = actual.reduce((sum, act, i) => sum + Math.abs(act - predicted[i]), 0) / n;
    const rmse = Math.sqrt(actual.reduce((sum, act, i) => sum + Math.pow(act - predicted[i], 2), 0) / n);

    // Skill score vs persistence (using actual[0] as reference)
    const persistenceError = actual.reduce((sum, act) => sum + Math.abs(act - actual[0]), 0) / n;
    const skill = persistenceError > 0 ? (persistenceError - mae) / persistenceError : mae === 0 ? 1 : 0;

    return {
        mae: parseFloat(mae.toFixed(2)),
        rmse: parseFloat(rmse.toFixed(2)),
        skill: parseFloat(skill.toFixed(2))
    };
}

/**
 * Build the date-stamped suffix used to key accuracy cache entries "once per
 * day per location" (paired with {@link ACCURACY_CACHE_TTL_MS} as the TTL).
 *
 * @param {string} prefix - e.g. 'accuracy'
 * @param {Date} [date]
 * @returns {string}
 */
export function accuracyCacheSuffix(prefix, date = new Date()) {
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return `${prefix}_${dateStr}`;
}
