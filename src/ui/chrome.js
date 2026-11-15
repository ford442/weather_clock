/**
 * Clock-mode chrome that used to live as a classic script in index.html:
 * advanced-drawer tabs/expand, DOM binding checks, and drawer helpers.
 * Left/right drawer expand still goes through ModeController via event-listeners.js.
 */

import { t } from '../i18n/strings.js';

const REQUIRED_ELEMENT_IDS = [
    'panel-left',
    'panel-right',
    'panel-advanced',
    'center-overlay',
    'timeline-scrubber',
    'canvas-container',
    'top-bar'
];

const Z_INDEX_ELEMENT_IDS = [
    'canvas-container',
    'center-overlay',
    'bottom-mini-bar',
    'panel-advanced',
    'panel-left',
    'panel-right',
    'timeline-scrubber',
    'top-bar'
];

/**
 * @param {string} tab Tab id matching `[data-tab]` / `#tab-{id}`
 * @returns {boolean} Whether the advanced drawer was found and updated; false
 *   too when that tab is disabled (its data has not loaded)
 */
export function activateAdvancedTab(tab) {
    const panel = document.getElementById('panel-advanced');
    if (!panel || !tab) return false;

    const buttons = /** @type {HTMLButtonElement[]} */ ([...panel.querySelectorAll('.tab-btn')]);
    if (buttons.some((btn) => btn.dataset.tab === tab && btn.disabled)) return false;

    buttons.forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    panel.querySelectorAll('.tab-content').forEach((content) => {
        content.classList.toggle('active', content.id === `tab-${tab}`);
    });
    return true;
}

/**
 * Which advanced-drawer tabs have data behind them, so the others can be
 * disabled rather than opening onto a panel of `--`.
 *
 * `healthReady` is separate because air quality loads after the weather
 * payload does: the Health tab opens once that attempt has finished, whether it
 * found data or not (UV, from the weather itself, is still worth showing).
 * @param {WeatherData|null|undefined} data
 * @param {{healthReady?: boolean}} [options]
 * @returns {Record<'history'|'accuracy'|'nearby'|'health', boolean>}
 */
export function getAdvancedTabAvailability(data, { healthReady = false } = {}) {
    if (!data?.current) return { history: false, accuracy: false, nearby: false, health: false };
    return {
        history: data.historicalYearAgo != null,
        accuracy: data.accuracy != null,
        // Fetched lazily when the tab opens; it only needs a located weather payload.
        nearby: true,
        health: healthReady
    };
}

/**
 * Enable/disable the advanced-drawer tabs (`disabled` + `aria-disabled`), move
 * off a tab that just became unavailable, and swap in a placeholder when none
 * is available.
 * @param {Record<string, boolean>} availability tab id -> has data
 */
export function setAdvancedTabAvailability(availability) {
    const panel = document.getElementById('panel-advanced');
    if (!panel) return;

    const buttons = /** @type {HTMLButtonElement[]} */ ([...panel.querySelectorAll('.tab-btn')]);
    for (const btn of buttons) {
        const enabled = availability[btn.dataset.tab ?? ''] === true;
        btn.disabled = !enabled;
        btn.setAttribute('aria-disabled', String(!enabled));
        if (enabled) btn.removeAttribute('title');
        else btn.title = t('advancedTabUnavailable');
    }

    const firstEnabled = buttons.find((btn) => !btn.disabled);
    panel.classList.toggle('no-data', !firstEnabled);
    const empty = document.getElementById('advanced-empty');
    if (empty) empty.textContent = t('advancedPanelEmpty');

    const active = buttons.find((btn) => btn.classList.contains('active'));
    if (active?.disabled && firstEnabled?.dataset.tab) activateAdvancedTab(firstEnabled.dataset.tab);
}

export function setupAdvancedTabs() {
    const panel = document.getElementById('panel-advanced');
    if (!panel) return;

    panel.querySelectorAll('.tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            const tab = /** @type {HTMLElement} */ (btn).dataset.tab;
            if (tab) activateAdvancedTab(tab);
        });
    });
}

export function setupAdvancedDrawer() {
    const advDrawer = document.getElementById('panel-advanced');
    const dragHandle = advDrawer?.querySelector('.drawer-handle-grip');
    if (!advDrawer || !dragHandle) return;

    dragHandle.addEventListener('click', () => {
        advDrawer.classList.toggle('expanded');
    });
}

/** Bind tab switching and the advanced-drawer grip. */
export function setupUiChrome() {
    setupAdvancedTabs();
    setupAdvancedDrawer();
}

/**
 * @param {string} side `left`, `right`, `advanced`, or a full panel id suffix
 */
export function toggleDrawer(side) {
    if (!side) return;
    const panel = document.getElementById(`panel-${side}`);
    panel?.classList.toggle('expanded');
}

/**
 * @returns {{elements: Record<string, boolean>, issues: string[]}}
 */
export function validateDomBindings() {
    /** @type {{elements: Record<string, boolean>, issues: string[]}} */
    const results = { elements: {}, issues: [] };
    REQUIRED_ELEMENT_IDS.forEach((id) => {
        const el = document.getElementById(id);
        results.elements[id] = !!el;
        if (!el) results.issues.push(`Missing element: #${id}`);
    });
    console.log('DOM Binding Validation:', results);
    return results;
}

/**
 * @returns {Record<string, string>}
 */
export function verifyZIndexStack() {
    /** @type {Record<string, string>} */
    const zIndices = {};
    Z_INDEX_ELEMENT_IDS.forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
            zIndices[id] = window.getComputedStyle(el).zIndex || 'auto';
        }
    });
    console.log('Z-Index Stacking:', zIndices);
    return zIndices;
}
