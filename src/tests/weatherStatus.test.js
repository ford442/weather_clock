import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { describeWeatherNotice, formatCachedAt, setWeatherStatus } from '../ui/weather-status.js';
import { activateAdvancedTab, getAdvancedTabAvailability, setAdvancedTabAvailability } from '../ui/chrome.js';

// ── A just-enough DOM: elements by id, classList, dataset, attributes ───────────
function makeEl(id, { dataset = {}, className = '' } = {}) {
    const classes = new Set(className.split(' ').filter(Boolean));
    const attrs = {};
    return {
        id,
        dataset,
        hidden: false,
        disabled: false,
        title: '',
        textContent: '',
        attrs,
        classList: {
            add: (c) => classes.add(c),
            remove: (c) => classes.delete(c),
            contains: (c) => classes.has(c),
            toggle(c, force) {
                const on = force ?? !classes.has(c);
                if (on) classes.add(c);
                else classes.delete(c);
                return on;
            }
        },
        setAttribute: (name, value) => {
            attrs[name] = value;
        },
        removeAttribute: (name) => {
            delete attrs[name];
        }
    };
}

let elements;
function installDom(extra = {}) {
    elements = {};
    for (const id of [
        'weather-notice',
        'weather-notice-text',
        'weather-notice-retry',
        'current-description',
        'scene-summary',
        'advanced-empty'
    ]) {
        elements[id] = makeEl(id);
    }
    elements['weather-notice'].hidden = true;
    Object.assign(elements, extra);
    vi.stubGlobal('document', {
        body: { dataset: {} },
        getElementById: (id) => elements[id] ?? null
    });
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('formatCachedAt', () => {
    const now = new Date(2026, 10, 13, 18, 0);

    it('shows just the time for today and the date too for any other day', () => {
        const today = formatCachedAt(new Date(2026, 10, 13, 9, 5).getTime(), now);
        const older = formatCachedAt(new Date(2026, 10, 11, 9, 5).getTime(), now);

        expect(today).toMatch(/9:05/);
        expect(today).not.toMatch(/Nov|11\/11/);
        expect(older).toMatch(/9:05/);
        expect(older.length).toBeGreaterThan(today.length); // carries the day as well
    });
});

describe('describeWeatherNotice', () => {
    const cachedAt = new Date(2026, 10, 13, 15, 42).getTime();

    it('shows nothing while loading or when the data is live', () => {
        expect(describeWeatherNotice({ kind: 'loading' })).toBeNull();
        expect(describeWeatherNotice({ kind: 'ready' })).toBeNull();
    });

    it('says when cached data is from and that the live update failed, with Retry', () => {
        const notice = describeWeatherNotice({ kind: 'stale', cachedAt });
        expect(notice.text).toMatch(/Showing cached data from .*3:42.*\. Live update failed\./);
        expect(notice.showRetry).toBe(true);
    });

    it('names the place when the cached data is for somewhere else', () => {
        const notice = describeWeatherNotice({ kind: 'stale', cachedAt, place: 'London' });
        expect(notice.text).toMatch(/cached data for London from/);
    });

    it('hides Retry and says so while attempts are still running', () => {
        const stale = describeWeatherNotice({ kind: 'stale', cachedAt, retrying: true });
        const error = describeWeatherNotice({ kind: 'error', retrying: true });

        expect(stale).toMatchObject({ showRetry: false });
        expect(stale.text).toMatch(/Live update failed\. Retrying…$/);
        expect(error).toEqual({ text: 'Could not load weather data. Retrying…', showRetry: false });
        expect(describeWeatherNotice({ kind: 'error' })).toEqual({
            text: 'Could not load weather data.',
            showRetry: true
        });
    });
});

describe('setWeatherStatus', () => {
    beforeEach(() => installDom());

    it('loading: the description line is the one indicator, with no banner', () => {
        setWeatherStatus({ kind: 'loading' });

        expect(document.body.dataset.weatherState).toBe('loading');
        expect(elements['current-description'].textContent).toBe('Loading weather…');
        expect(elements['weather-notice'].hidden).toBe(true);
    });

    it('error: banner with Retry, and the no-data text for sighted and screen-reader users', () => {
        setWeatherStatus({ kind: 'error' });

        expect(elements['weather-notice'].hidden).toBe(false);
        expect(elements['weather-notice'].dataset.kind).toBe('error');
        expect(elements['weather-notice-text'].textContent).toBe('Could not load weather data.');
        expect(elements['weather-notice-retry'].hidden).toBe(false);
        expect(elements['current-description'].textContent).toBe('Weather data unavailable');
        expect(elements['scene-summary'].textContent).toBe('Weather data unavailable');
    });

    it('stale: leaves the description to the weather panels, which hold real data', () => {
        elements['current-description'].textContent = 'Light rain';
        setWeatherStatus({ kind: 'stale', cachedAt: Date.now() });

        expect(elements['current-description'].textContent).toBe('Light rain');
        expect(elements['weather-notice'].hidden).toBe(false);
        expect(elements['weather-notice'].dataset.kind).toBe('stale');
    });

    it('retrying hides the Retry button; ready hides the banner again', () => {
        setWeatherStatus({ kind: 'error', retrying: true });
        expect(elements['weather-notice-retry'].hidden).toBe(true);

        setWeatherStatus({ kind: 'error' });
        expect(elements['weather-notice-retry'].hidden).toBe(false);

        setWeatherStatus({ kind: 'ready' });
        expect(elements['weather-notice'].hidden).toBe(true);
        expect(document.body.dataset.weatherState).toBe('ready');
    });
});

describe('getAdvancedTabAvailability', () => {
    const loaded = {
        current: { temp: 1 },
        historicalYearAgo: { temp: 2 },
        accuracy: { mae: 1 }
    };

    it('has every tab off until there is a weather payload', () => {
        const none = { history: false, accuracy: false, nearby: false, health: false };
        expect(getAdvancedTabAvailability(null)).toEqual(none);
        expect(getAdvancedTabAvailability(undefined, { healthReady: true })).toEqual(none);
        expect(getAdvancedTabAvailability({}, { healthReady: true })).toEqual(none);
    });

    it('opens each tab only when its own data is there', () => {
        expect(getAdvancedTabAvailability(loaded)).toEqual({
            history: true,
            accuracy: true,
            nearby: true,
            health: false // air quality has not been attempted yet
        });
        expect(getAdvancedTabAvailability({ current: {}, historicalYearAgo: null, accuracy: null })).toMatchObject({
            history: false,
            accuracy: false,
            nearby: true
        });
    });

    it('opens Health once the air-quality attempt is over, found or not', () => {
        expect(getAdvancedTabAvailability(loaded, { healthReady: true }).health).toBe(true);
    });
});

describe('setAdvancedTabAvailability', () => {
    let panel;
    let tabs;
    let contents;

    beforeEach(() => {
        installDom();
        tabs = ['history', 'accuracy', 'nearby', 'health'].map((tab, i) => {
            const btn = makeEl('', { dataset: { tab }, className: i === 0 ? 'tab-btn active' : 'tab-btn' });
            btn.disabled = true; // the markup ships them disabled
            return btn;
        });
        contents = tabs.map((btn, i) =>
            makeEl(`tab-${btn.dataset.tab}`, { className: i === 0 ? 'tab-content active' : 'tab-content' })
        );
        panel = makeEl('panel-advanced', { className: 'advanced-drawer no-data' });
        panel.querySelectorAll = (selector) => (selector === '.tab-btn' ? tabs : contents);
        elements['panel-advanced'] = panel;
    });

    const activeTab = () => tabs.find((b) => b.classList.contains('active'))?.dataset.tab;

    it('disables and enables with aria-disabled and a reason, per tab', () => {
        setAdvancedTabAvailability({ history: true, accuracy: false, nearby: true, health: false });

        expect(tabs.map((b) => b.disabled)).toEqual([false, true, false, true]);
        expect(tabs.map((b) => b.attrs['aria-disabled'])).toEqual(['false', 'true', 'false', 'true']);
        expect(tabs[0].title).toBe('');
        expect(tabs[1].title).toBe('Available once weather data has loaded');
        expect(panel.classList.contains('no-data')).toBe(false);
    });

    it('shows the placeholder, not a panel of `--`, when no tab has data', () => {
        panel.classList.remove('no-data');
        setAdvancedTabAvailability({});

        expect(tabs.every((b) => b.disabled)).toBe(true);
        expect(panel.classList.contains('no-data')).toBe(true);
        expect(elements['advanced-empty'].textContent).toBe('Weather details appear here once data has loaded.');
    });

    it('moves off the open tab when it becomes unavailable', () => {
        expect(activeTab()).toBe('history');

        setAdvancedTabAvailability({ history: false, accuracy: false, nearby: true, health: true });

        expect(activeTab()).toBe('nearby');
        expect(contents.find((c) => c.classList.contains('active')).id).toBe('tab-nearby');
    });

    it('leaves the open tab alone while it stays available', () => {
        setAdvancedTabAvailability({ history: true, accuracy: true, nearby: true, health: true });
        activateAdvancedTab('health');
        setAdvancedTabAvailability({ history: true, accuracy: true, nearby: true, health: true });

        expect(activeTab()).toBe('health');
    });

    it('activateAdvancedTab refuses a disabled tab', () => {
        setAdvancedTabAvailability({ history: true, accuracy: false, nearby: true, health: true });

        expect(activateAdvancedTab('accuracy')).toBe(false);
        expect(activeTab()).toBe('history');
        expect(activateAdvancedTab('nearby')).toBe(true);
        expect(activeTab()).toBe('nearby');
    });
});
