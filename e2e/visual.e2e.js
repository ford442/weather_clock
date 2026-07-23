import { test, expect } from '@playwright/test';
import { launchApp, applyScenario, buildForecastDays, FORECAST_VIGNETTE_HOURS } from './helpers.js';

/**
 * Visual regression — port of verification/suite/run_all.py.
 *
 * Same scenario matrix, viewport (1280×720), and SwiftShader launch flags as the
 * Python suite, so the committed baselines remain comparable. `threshold` is the
 * pixelmatch per-pixel YIQ deadband (standing in for Pillow's 0.08 RGB-distance
 * filter); `maxDiffPixelRatio` carries over each scenario's allowed mismatch.
 */
const SCENARIOS = [
    { name: 'sunny_day', hour: 12, code: 0, waitMs: 3000, maxDiffPixelRatio: 0.02 },
    { name: 'cloudy_day', hour: 12, code: 3, waitMs: 6000, maxDiffPixelRatio: 0.22 },
    { name: 'heavy_rain', hour: 12, code: 65, waitMs: 6000, maxDiffPixelRatio: 0.35 },
    { name: 'thunderstorm', hour: 12, code: 95, waitMs: 6000, maxDiffPixelRatio: 0.35 },
    { name: 'snow', hour: 12, code: 75, waitMs: 6000, maxDiffPixelRatio: 0.15 },
    { name: 'night_clear', hour: 23, code: 0, waitMs: 3000, maxDiffPixelRatio: 0.02 },
    { name: 'sunset', hour: 18.5, code: 0, waitMs: 4000, maxDiffPixelRatio: 0.02 },
    { name: 'fog', hour: 8, code: 45, waitMs: 4000, maxDiffPixelRatio: 0.4 }
];

for (const scenario of SCENARIOS) {
    test(`visual: ${scenario.name}`, async ({ page }) => {
        await launchApp(page);
        await applyScenario(page, scenario);
        // NOTE: expect(page).toHaveScreenshot() cannot be used here — its
        // stability check requires two identical consecutive screenshots, which
        // a live WebGL animation loop never produces. Compare the buffer directly.
        const screenshot = await page.screenshot();
        expect(screenshot).toMatchSnapshot(`${scenario.name}.png`, {
            maxDiffPixelRatio: scenario.maxDiffPixelRatio,
            threshold: 0.1
        });
    });
}

test.describe('app and forecast smoke checks', () => {
    test('debug hooks and core UI are ready', async ({ page }) => {
        await launchApp(page);

        const dateText = (await page.locator('#date-display').innerText()).trim();
        expect(dateText.length).toBeGreaterThanOrEqual(3);
        expect(dateText).not.toBe('--');

        const debugState = await page.evaluate(() => {
            const effects = window.aetherDebug?.weatherEffects;
            return {
                ready: Boolean(window.setDebugTime && window.setDebugWeather && effects),
                dustZones: Boolean(effects?.pastDust && effects?.currDust && effects?.futureDust),
                playButton: Boolean(document.querySelector('#scrubber-play-btn'))
            };
        });
        expect(debugState).toEqual({ ready: true, dustZones: true, playButton: true });
    });

    test('forecast focused view renders all vignettes', async ({ page }) => {
        await launchApp(page);
        await page.evaluate(() => window.setDebugWeather(0));

        const days = buildForecastDays();
        await page.evaluate(async (mockDays) => {
            const controller = window.modeController;
            if (!controller) throw new Error('ModeController is unavailable');

            window.aetherDebug.getWeatherData().dailyForecast = mockDays;
            await controller.switchMode('clock');
            await controller.switchMode('forecast');
            controller.forecastController.days = mockDays;
            controller.forecastController.focusedIndex = 0;
            controller.forecastUI.renderCards(mockDays);
            controller.forecastController.focusDay(0);
        }, days);
        await page.waitForTimeout(300);

        for (let index = 0; index < days.length; index++) {
            await page.evaluate(
                ([i, hour]) => {
                    const forecast = window.modeController.forecastController;
                    forecast.focusDay(i);
                    forecast.setVignetteHour(hour);
                },
                [index, FORECAST_VIGNETTE_HOURS[index]]
            );
            await page.waitForTimeout(150);

            const state = await page.evaluate(() => ({
                mode: window.modeController.getMode(),
                cards: document.querySelectorAll('.forecast-card').length,
                focused: document.querySelectorAll('.forecast-card.focused').length,
                atmosphere: Boolean(window.aetherDebug.sky.userData.atmosphere)
            }));
            expect(state).toEqual({ mode: 'forecast', cards: days.length, focused: 1, atmosphere: true });
        }
    });
});
