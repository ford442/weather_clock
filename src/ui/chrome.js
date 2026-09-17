/**
 * Clock-mode chrome that used to live as a classic script in index.html:
 * advanced-drawer tabs/expand, DOM binding checks, and drawer helpers.
 * Left/right drawer expand still goes through ModeController via event-listeners.js.
 */

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
 * @returns {boolean} Whether the advanced drawer was found and updated
 */
export function activateAdvancedTab(tab) {
    const panel = document.getElementById('panel-advanced');
    if (!panel || !tab) return false;

    panel.querySelectorAll('.tab-btn').forEach((btn) => {
        btn.classList.toggle('active', /** @type {HTMLElement} */ (btn).dataset.tab === tab);
    });
    panel.querySelectorAll('.tab-content').forEach((content) => {
        content.classList.toggle('active', content.id === `tab-${tab}`);
    });
    return true;
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
