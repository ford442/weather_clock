import { test, expect } from '@playwright/test';
import { launchApp, mockExternalAPIs, buildForecastDays } from './helpers.js';

/**
 * Functional e2e specs — cheap behavior checks beyond screenshots.
 * All specs run hermetically: external APIs are routed to fixtures.
 */
test.describe('functional', () => {
    test.beforeEach(async ({ page }) => {
        await mockExternalAPIs(page);
    });

    test('T key cycles modes and updates ?mode=', async ({ page }) => {
        await launchApp(page);

        // Seed a daily forecast so entering forecast mode has data to render.
        await page.evaluate((days) => {
            window.aetherDebug.getWeatherData().dailyForecast = days;
        }, buildForecastDays());

        const modeToggle = page.locator('#mode-toggle');
        await expect(modeToggle).toHaveAttribute('title', 'Switch to Timeline View (T)');

        await page.keyboard.press('t');
        await expect(page).toHaveURL(/[?&]mode=timeline/);
        await expect(page.locator('#timeline-ui-container')).toHaveClass(/visible/);
        await expect(modeToggle).toHaveAttribute('title', 'Switch to 10-Day Forecast (T)');

        await page.keyboard.press('t');
        await expect(page).toHaveURL(/[?&]mode=forecast/);
        await expect(modeToggle).toHaveAttribute('title', 'Switch to Clock View (T)');

        await page.keyboard.press('t');
        await expect(page).not.toHaveURL(/[?&]mode=/);
        await expect(modeToggle).toHaveAttribute('title', 'Switch to Timeline View (T)');

        // The on-screen button follows the same cycle.
        await modeToggle.click();
        await expect(page).toHaveURL(/[?&]mode=timeline/);
    });

    test('unit toggle persists across reload', async ({ page }) => {
        await launchApp(page);

        const toggle = page.locator('#unit-toggle');
        const initialUnit = await toggle.getAttribute('data-unit');
        const expectedUnit = initialUnit === 'metric' ? 'imperial' : 'metric';

        await toggle.click();
        await expect(toggle).toHaveAttribute('data-unit', expectedUnit);
        await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), 'weatherclock_unit')).toBe(expectedUnit);

        await page.reload();
        await page.waitForFunction(() => Boolean(window.aetherDebug), null, { timeout: 90_000 });
        await expect(toggle).toHaveAttribute('data-unit', expectedUnit);
    });

    test('search flow selects mocked Nominatim result', async ({ page }) => {
        await launchApp(page);

        await page.locator('#search-btn').click(); // Expands the search container
        const input = page.locator('#location-search');
        await input.fill('London');
        await input.press('Enter');

        await expect(page.locator('#location')).toHaveText('London', { timeout: 30_000 });
        const stored = await page.evaluate(() => ({
            lat: localStorage.getItem('weatherclock_lat'),
            lon: localStorage.getItem('weatherclock_lon'),
            location: localStorage.getItem('weatherclock_location')
        }));
        expect(stored.lat).toBe('51.5074');
        expect(stored.lon).toBe('-0.1278');
        expect(stored.location).toBe('London');
    });

    test('search with no results shows error toast', async ({ page }) => {
        await page.unroute('https://nominatim.openstreetmap.org/search*');
        await page.route('https://nominatim.openstreetmap.org/search*', (route) =>
            route.fulfill({ contentType: 'application/json', body: '[]' })
        );
        await launchApp(page);

        await page.locator('#search-btn').click();
        const input = page.locator('#location-search');
        await input.fill('Nowheresville');
        await input.press('Enter');

        await expect(page.locator('.toast-error, #toast-container .toast').first()).toBeVisible({
            timeout: 15_000
        });
    });

    test('quality preference persists across reload', async ({ page }) => {
        // Note: there is no quality-selector UI in the DOM; quality persists via
        // localStorage (weatherclock_quality) and is reflected in the stats badge.
        await page.addInitScript(() => localStorage.setItem('weatherclock_quality', 'low'));
        await launchApp(page);

        await expect(page.locator('#quality-stats-badge')).toHaveText('TIER: LOW');

        // The badge becomes visible together with the FPS stats on backtick.
        await page.keyboard.press('`');
        await expect(page.locator('#quality-stats-badge')).toBeVisible();
    });
});
