import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for src/atmosphereTheme.js — the CSS-custom-property mappings.
 *
 * The module writes to document.documentElement.style and keeps module-level
 * lerp state, so each test re-imports it fresh (vi.resetModules) and drives it
 * to convergence (LERP_FACTOR 0.05 ⇒ ~200 calls reach the target).
 */

function makeScene(sunY) {
    return {
        traverse(cb) {
            if (sunY !== undefined) {
                cb({ isMesh: true, material: { uniforms: { sunPosition: { value: { y: sunY } } } } });
            }
        }
    };
}

async function loadTheme() {
    vi.resetModules();
    return await import('../atmosphereTheme.js');
}

function converge(mod, scene, weatherData, iterations = 200) {
    for (let i = 0; i < iterations; i++) {
        mod.updateAtmosphereTheme(null, scene, weatherData);
    }
}

function lastCssValues() {
    const calls = document.documentElement.style.setProperty.mock.calls;
    const map = {};
    for (const [name, value] of calls) map[name] = value;
    return map;
}

describe('atmosphereTheme', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function stubDocument() {
        vi.stubGlobal('document', {
            documentElement: { style: { setProperty: vi.fn() } }
        });
    }

    it.each([
        [-5, '46, 92, 138'], // arctic
        [10, '90, 172, 184'], // cool
        [20, '126, 184, 218'], // neutral
        [28, '232, 168, 56'], // warm
        [35, '212, 114, 106'] // hot
    ])('maps %i°C to the expected accent triplet', async (temp, expectedAccent) => {
        stubDocument();
        const mod = await loadTheme();
        converge(mod, makeScene(0.5), { current: { temp, cloudCover: 0, severity: 0 } });

        const css = lastCssValues();
        expect(css['--accent']).toBe(expectedAccent);
        expect(css['--glow']).toBe(`rgba(${expectedAccent}, 0.4)`);
    });

    it('uses sky blue during the day and deep indigo at night', async () => {
        stubDocument();
        const day = await loadTheme();
        converge(day, makeScene(0.5), { current: { temp: 20, cloudCover: 0, severity: 0 } });
        expect(lastCssValues()['--sky-dominant']).toBe('rgba(100, 180, 255, 0.6)');

        const night = await loadTheme();
        converge(night, makeScene(-0.5), { current: { temp: 20, cloudCover: 0, severity: 0 } });
        expect(lastCssValues()['--sky-dominant']).toBe('rgba(5, 8, 25, 0.6)');
    });

    it('desaturates the sky toward grey as cloud cover rises', async () => {
        stubDocument();
        const mod = await loadTheme();
        // grey = 535/3 ≈ 178.3; channels move 70% of the way there at 100% cover
        converge(mod, makeScene(0.5), { current: { temp: 20, cloudCover: 100, severity: 0 } });
        expect(lastCssValues()['--sky-dominant']).toBe('rgba(155, 179, 201, 0.6)');
    });

    it('darkens the sky with weather severity', async () => {
        stubDocument();
        const mod = await loadTheme();
        // severity 100 ⇒ ×0.6 on the day color
        converge(mod, makeScene(0.5), { current: { temp: 20, cloudCover: 0, severity: 100 } });
        expect(lastCssValues()['--sky-dominant']).toBe('rgba(60, 108, 153, 0.6)');
    });

    it('falls back to neutral defaults when weather data is missing', async () => {
        stubDocument();
        const mod = await loadTheme();
        converge(mod, makeScene(), null);
        const css = lastCssValues();
        expect(css['--accent']).toBe('126, 184, 218'); // default 20°C ⇒ neutral
        expect(css['--sky-dominant']).toBe('rgba(100, 180, 255, 0.6)'); // default sunY 0.5 ⇒ day
    });

    it('pulses the accent brighter for Severe/Extreme alerts', async () => {
        stubDocument();
        // Pin performance.now at a pulse peak: sin(now * 0.004) === 1 ⇒ boost ×1.35
        vi.stubGlobal('performance', { now: () => Math.PI / 2 / 0.004 });
        const scene = makeScene(0.5);
        const base = { current: { temp: 20, cloudCover: 0, severity: 0 } };

        const plain = await loadTheme();
        for (let i = 0; i < 20; i++) plain.updateAtmosphereTheme(null, scene, base);
        const plainAccent = lastCssValues()['--accent'];
        const [plainR] = plainAccent.split(',').map((v) => parseInt(v, 10));

        const alerted = await loadTheme();
        const withAlert = { ...base, alerts: [{ severity: 'Extreme' }] };
        for (let i = 0; i < 20; i++) alerted.updateAtmosphereTheme(null, scene, withAlert);
        const alertAccent = lastCssValues()['--accent'];
        const [alertR] = alertAccent.split(',').map((v) => parseInt(v, 10));

        expect(alertR).toBeGreaterThan(plainR);
    });
});
