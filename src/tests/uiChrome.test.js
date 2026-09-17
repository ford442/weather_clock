import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { activateAdvancedTab, toggleDrawer, validateDomBindings } from '../ui/chrome.js';

function classList() {
    const set = new Set();
    return {
        add: (name) => set.add(name),
        remove: (name) => set.delete(name),
        contains: (name) => set.has(name),
        toggle: (name, force) => {
            if (force === true) set.add(name);
            else if (force === false) set.delete(name);
            else if (set.has(name)) set.delete(name);
            else set.add(name);
            return set.has(name);
        }
    };
}

function makeEl(id, dataset = {}) {
    return {
        id,
        dataset,
        classList: classList(),
        querySelectorAll: () => [],
        addEventListener: () => {}
    };
}

describe('ui chrome helpers', () => {
    /** @type {ReturnType<typeof makeEl>} */
    let panel;
    /** @type {ReturnType<typeof makeEl>} */
    let historyBtn;
    /** @type {ReturnType<typeof makeEl>} */
    let healthBtn;
    /** @type {ReturnType<typeof makeEl>} */
    let historyTab;
    /** @type {ReturnType<typeof makeEl>} */
    let healthTab;
    /** @type {ReturnType<typeof makeEl>} */
    let leftDrawer;

    beforeEach(() => {
        panel = makeEl('panel-advanced');
        historyBtn = makeEl('', { tab: 'history' });
        healthBtn = makeEl('', { tab: 'health' });
        historyTab = makeEl('tab-history');
        healthTab = makeEl('tab-health');
        leftDrawer = makeEl('panel-left');
        historyBtn.classList.add('active');
        historyTab.classList.add('active');
        panel.querySelectorAll = (sel) => {
            if (sel === '.tab-btn') return [historyBtn, healthBtn];
            if (sel === '.tab-content') return [historyTab, healthTab];
            return [];
        };

        const byId = {
            'panel-advanced': panel,
            'panel-left': leftDrawer,
            'panel-right': makeEl('panel-right'),
            'center-overlay': makeEl('center-overlay'),
            'timeline-scrubber': makeEl('timeline-scrubber'),
            'canvas-container': makeEl('canvas-container'),
            'top-bar': makeEl('top-bar')
        };

        vi.stubGlobal('document', {
            getElementById: (id) => byId[id] ?? null
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('activates the requested advanced tab and deactivates siblings', () => {
        expect(activateAdvancedTab('health')).toBe(true);
        expect(healthBtn.classList.contains('active')).toBe(true);
        expect(historyBtn.classList.contains('active')).toBe(false);
        expect(healthTab.classList.contains('active')).toBe(true);
        expect(historyTab.classList.contains('active')).toBe(false);
    });

    it('toggles a named drawer', () => {
        toggleDrawer('left');
        expect(leftDrawer.classList.contains('expanded')).toBe(true);
        toggleDrawer('left');
        expect(leftDrawer.classList.contains('expanded')).toBe(false);
    });

    it('reports missing required elements', () => {
        vi.stubGlobal('document', { getElementById: () => null });
        const result = validateDomBindings();
        expect(result.issues.length).toBeGreaterThan(0);
        expect(result.elements['top-bar']).toBe(false);
    });
});
