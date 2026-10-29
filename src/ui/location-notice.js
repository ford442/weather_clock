import { t } from '../i18n/strings.js';

/**
 * Explain a geolocation fallback in the top bar, with the two things the user
 * can do about it. Silence here reads as "the app picked New York for me".
 * Hidden again by {@link hideLocationNotice} once a real location is in place.
 * @param {LocationStatus} status
 */
export function showLocationNotice(status) {
    const notice = document.getElementById('location-notice');
    const text = document.getElementById('location-notice-text');
    const primary = document.getElementById('location-notice-primary');
    const search = document.getElementById('location-notice-search');
    if (!notice || !text || !primary || !search || status.source !== 'fallback' || !status.reason) {
        hideLocationNotice();
        return;
    }

    text.textContent = t('locationFallbackNotice', status.name, status.reason);
    // Not asked yet -> invite the prompt. Unsupported -> a retry cannot help.
    primary.textContent = status.reason === 'prompt' ? t('locationUseMine') : t('locationRetry');
    primary.hidden = status.reason === 'unsupported';
    search.textContent = t('locationSearchCity');
    notice.hidden = false;
}

export function hideLocationNotice() {
    const notice = document.getElementById('location-notice');
    if (notice) notice.hidden = true;
}
