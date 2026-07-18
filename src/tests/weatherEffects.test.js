import { describe, it, expect } from 'vitest';
import { buildWeatherEffectConfig, getPrecipitationParticleBudget } from '../effects/weather-effects.js';

describe('Forecast weather effect config', () => {
    it('maps rainy forecast days to wind-aligned rain intensity', () => {
        const config = buildWeatherEffectConfig({
            weatherCode: 65,
            cloudCover: 88,
            windSpeed: 32,
            windDirection: 240,
            rain: 9,
            visibility: 4500
        });

        expect(config.precipType).toBe('rain');
        expect(config.rainIntensity).toBeGreaterThan(0.8);
        expect(config.snowIntensity).toBe(0);
        expect(config.windDir).toBe(240);
        expect(config.cloudCover).toBe(88);
    });

    it('keeps thumbnail particle budgets lower than focused view', () => {
        const focused = buildWeatherEffectConfig({ weatherCode: 71, snowfall: 3 }, 'focused');
        const thumbnail = buildWeatherEffectConfig({ weatherCode: 71, snowfall: 3 }, 'thumbnail');

        expect(focused.precipType).toBe('snow');
        expect(thumbnail.particleScale).toBeLessThan(focused.particleScale);
    });

    it('raises only the WebGPU high-tier precipitation budget by 5x', () => {
        expect(getPrecipitationParticleBudget('high', false)).toEqual({ rain: 2000, snow: 1500 });
        expect(getPrecipitationParticleBudget('high', true)).toEqual({ rain: 10000, snow: 7500 });
        expect(getPrecipitationParticleBudget('medium', true, 2)).toEqual({ rain: 1000, snow: 750 });
    });
});
