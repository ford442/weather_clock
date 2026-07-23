import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyQualityTier, getQualityTier, QUALITY_CONFIG, setQualityTier } from '../rendering.js';

function makeShadowLight(initialSize) {
    const mapSize = {
        width: initialSize,
        height: initialSize,
        set: vi.fn((width, height) => {
            mapSize.width = width;
            mapSize.height = height;
        })
    };
    return {
        shadow: {
            mapSize,
            map: { dispose: vi.fn() },
            needsUpdate: false
        }
    };
}

describe('live rendering quality', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('applies the low tier without reloading the page', async () => {
        vi.stubGlobal('window', { devicePixelRatio: 2, innerWidth: 1280, innerHeight: 720 });
        const renderer = { setPixelRatio: vi.fn() };
        const pipeline = { setSize: vi.fn(), setPixelRatio: vi.fn(), setBloom: vi.fn() };
        const sunLight = makeShadowLight(2048);
        const moonLight = makeShadowLight(1024);
        const weatherEffects = { setQuality: vi.fn().mockResolvedValue(undefined) };

        await applyQualityTier('low', {
            renderer,
            pipeline,
            sunLight,
            moonLight,
            weatherEffects
        });

        expect(renderer.setPixelRatio).toHaveBeenCalledWith(1);
        expect(pipeline.setPixelRatio).toHaveBeenCalledWith(1);
        expect(pipeline.setSize).toHaveBeenCalledWith(1280, 720);
        expect(pipeline.setBloom).toHaveBeenCalledWith(
            expect.objectContaining({
                enabled: false,
                strength: 0
            })
        );
        expect(sunLight.shadow.mapSize.set).toHaveBeenCalledWith(1024, 1024);
        expect(sunLight.shadow.needsUpdate).toBe(true);
        expect(moonLight.shadow.mapSize.set).toHaveBeenCalledWith(512, 512);
        expect(moonLight.shadow.needsUpdate).toBe(true);
        expect(weatherEffects.setQuality).toHaveBeenCalledWith('low', 3);
    });

    it('rejects unknown quality tiers instead of persisting them', () => {
        expect(() => setQualityTier('ultra')).toThrow('Unknown quality tier: ultra');
    });

    it('caps the high tier at 2x device pixel ratio', async () => {
        expect(QUALITY_CONFIG.high.pixelRatioCap).toBe(2);

        vi.stubGlobal('window', { devicePixelRatio: 3, innerWidth: 390, innerHeight: 844 });
        const renderer = { setPixelRatio: vi.fn() };
        const pipeline = { setSize: vi.fn(), setPixelRatio: vi.fn(), setBloom: vi.fn() };

        await applyQualityTier('high', {
            renderer,
            pipeline,
            sunLight: makeShadowLight(2048),
            moonLight: makeShadowLight(1024),
            weatherEffects: { setQuality: vi.fn().mockResolvedValue(undefined) }
        });

        expect(renderer.setPixelRatio).toHaveBeenCalledWith(2);
        expect(pipeline.setPixelRatio).toHaveBeenCalledWith(2);
    });
});

describe('getQualityTier device heuristics', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function stubEnvironment({ saved = null, cores = 8, memory = 8, maxTouchPoints = 0 } = {}) {
        vi.stubGlobal('localStorage', {
            getItem: vi.fn((key) => (key === 'weatherclock_quality' ? saved : null)),
            setItem: vi.fn(),
            removeItem: vi.fn()
        });
        vi.stubGlobal('navigator', { hardwareConcurrency: cores, deviceMemory: memory, maxTouchPoints });
        vi.stubGlobal('window', {}); // no 'ontouchstart'
    }

    it('returns the saved tier when one is persisted', () => {
        stubEnvironment({ saved: 'low', cores: 16, memory: 32 });
        expect(getQualityTier()).toBe('low');
    });

    it('ignores invalid persisted values and falls back to auto-detection', () => {
        stubEnvironment({ saved: 'ultra', cores: 8, memory: 8 });
        expect(getQualityTier()).toBe('high');
    });

    it('returns high for capable desktops without touch', () => {
        stubEnvironment({ cores: 8, memory: 8 });
        expect(getQualityTier()).toBe('high');
    });

    it('returns low for touch devices with few cores', () => {
        stubEnvironment({ cores: 4, memory: 4, maxTouchPoints: 5 });
        expect(getQualityTier()).toBe('low');
    });

    it('returns medium for touch devices with capable hardware', () => {
        stubEnvironment({ cores: 8, memory: 8, maxTouchPoints: 5 });
        expect(getQualityTier()).toBe('medium');
    });

    it('returns low when cores are below 4 even without touch', () => {
        stubEnvironment({ cores: 2, memory: 8 });
        expect(getQualityTier()).toBe('low');
    });

    it('returns low when device memory is below 3 GB', () => {
        stubEnvironment({ cores: 8, memory: 2 });
        expect(getQualityTier()).toBe('low');
    });

    it('returns medium for mid-range hardware just under the thresholds', () => {
        stubEnvironment({ cores: 6, memory: 3 });
        expect(getQualityTier()).toBe('medium');
    });

    it('falls back to high when hardware specs are unavailable', () => {
        vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn() });
        vi.stubGlobal('navigator', {}); // no hardwareConcurrency/deviceMemory ⇒ defaults 4/4
        vi.stubGlobal('window', {});
        expect(getQualityTier()).toBe('high');
    });
});
