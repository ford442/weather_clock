import { t, formatTime, formatDate } from '../i18n/strings.js';

/**
 * What the weather UI is telling the user about the data it shows. One state at
 * a time, so there is one indicator rather than a header, a description and a
 * toast each saying something different.
 *
 * - `loading`: nothing to show yet; the description line says so.
 * - `ready`: live data is on screen; no notice.
 * - `stale`: cached data is on screen and the live update failed.
 * - `error`: there is no data at all.
 *
 * `retrying` means more attempts are already running, so the Retry button is
 * hidden rather than starting a second fetch beside them.
 * @typedef {{kind: 'loading'} | {kind: 'ready'} | {kind: 'stale', cachedAt: number, place?: string|null, retrying?: boolean} | {kind: 'error', retrying?: boolean}} WeatherStatus
 */

/**
 * "3:42 PM" for today, "Tue, Nov 11 3:42 PM" otherwise, so an old snapshot
 * never passes for a recent one.
 * @param {number} cachedAt epoch ms
 * @param {Date} [now]
 * @returns {string}
 */
export function formatCachedAt(cachedAt, now = new Date()) {
    const at = new Date(cachedAt);
    if (at.toDateString() === now.toDateString()) return formatTime(at);
    return `${formatDate(at)} ${formatTime(at)}`;
}

/**
 * The banner for a status: its text, or null when no banner is shown.
 * @param {WeatherStatus} status
 * @returns {{text: string, showRetry: boolean}|null}
 */
export function describeWeatherNotice(status) {
    if (status.kind !== 'stale' && status.kind !== 'error') return null;
    const base =
        status.kind === 'stale'
            ? t('weatherStaleBanner', formatCachedAt(status.cachedAt), status.place ?? null)
            : t('weatherUnavailableBanner');
    return {
        text: status.retrying ? `${base} ${t('weatherRetrying')}` : base,
        showRetry: !status.retrying
    };
}

/**
 * Reflect a {@link WeatherStatus} in the page: the banner, the Retry button,
 * the temperature description while there is no data, and `body[data-weather-state]`
 * (which photo capture reads to avoid captioning a placeholder).
 * @param {WeatherStatus} status
 */
export function setWeatherStatus(status) {
    document.body.dataset.weatherState = status.kind;

    const notice = document.getElementById('weather-notice');
    const text = document.getElementById('weather-notice-text');
    const retry = document.getElementById('weather-notice-retry');
    const banner = describeWeatherNotice(status);
    if (notice && text && retry) {
        notice.hidden = !banner;
        notice.dataset.kind = status.kind;
        if (banner) {
            text.textContent = banner.text;
            retry.textContent = t('weatherRetry');
            retry.hidden = !banner.showRetry;
        }
    }

    // Only the no-data states own the description line; once data is on screen
    // updateWeatherDisplay() does.
    const description = document.getElementById('current-description');
    if (status.kind === 'loading' && description) description.textContent = t('weatherLoading');
    if (status.kind === 'error') {
        if (description) description.textContent = t('weatherUnavailable');
        const summary = document.getElementById('scene-summary');
        if (summary) summary.textContent = t('weatherUnavailable');
    }
}
