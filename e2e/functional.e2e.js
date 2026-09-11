import { test, expect } from '@playwright/test';
import {
    launchApp,
    mockExternalAPIs,
    mockHealthData,
    mockSearchResult,
    searchForLocation,
    buildForecastDays
} from './helpers.js';

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

    test('?forceWebGL=1 pins the renderer to the WebGL particle path', async ({ page }) => {
        await launchApp(page, { query: 'forceWebGL=1' });

        // CI runs SwiftShader (WebGL only), so this guards the flag's plumbing rather
        // than the backend switch itself — on WebGPU-capable hardware it also proves
        // the fallback is reachable for side-by-side comparison.
        const particles = await page.evaluate(() => window.aetherDebug.getPerformanceMetrics().particles);
        expect(particles.backend).toBe('cpu');
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

    test('health drawer and chips render mocked AQI / UV / pollen', async ({ page }) => {
        await mockHealthData(page, { current: { uv_index: 9 } });
        await mockSearchResult(page, {
            displayName: 'New York, United States',
            lat: '40.7128',
            lon: '-74.006',
            countryCode: 'us'
        });
        await launchApp(page);
        // Searching re-runs the weather + air-quality load for the selected place.
        await searchForLocation(page, 'New York');
        await expect(page.locator('#location')).toHaveText('New York', { timeout: 30_000 });

        // Chips: a US location leads with the US index.
        const aqiChip = page.locator('#current-aqi');
        await expect(aqiChip).toBeVisible({ timeout: 30_000 });
        await expect(aqiChip).toHaveText('AQI 82');
        await expect(aqiChip).toHaveAttribute('title', 'US AQI: Moderate');

        const pollenChip = page.locator('#current-pollen');
        await expect(pollenChip).toBeVisible();
        await expect(pollenChip).toHaveText('Pollen: High');

        await expect(page.locator('#current-uv')).toHaveText('UV 9');

        // Health tab of the advanced drawer.
        await page.locator('#panel-advanced .tab-btn[data-tab="health"]').click();
        await expect(page.locator('#tab-health')).toHaveClass(/active/);

        await expect(page.locator('#health-uv-value')).toHaveText('9');
        await expect(page.locator('#health-uv-label')).toContainText('Very High');

        await expect(page.locator('#health-aqi-us-value')).toHaveText('82');
        await expect(page.locator('#health-aqi-us-label')).toHaveText('Moderate');
        await expect(page.locator('#health-aqi-eu-value')).toHaveText('38');
        await expect(page.locator('#health-aqi-eu-label')).toHaveText('Fair');
        await expect(page.locator('#health-aqi-us')).toHaveClass(/primary-scale/);
        await expect(page.locator('#health-aqi-eu')).not.toHaveClass(/primary-scale/);

        await expect(page.locator('#health-pm25')).toContainText('12.3');
        await expect(page.locator('#health-pm10')).toContainText('24.5');
        await expect(page.locator('#health-ozone')).toContainText('68');

        const rows = page.locator('#health-pollen-list .pollen-row');
        await expect(rows).toHaveCount(3);
        await expect(rows.filter({ hasText: 'Grass' }).locator('.pollen-row-value')).toHaveText('High');

        // The pollen motes fade in for the high grass-pollen reading (55 grains/m³).
        await expect
            .poll(
                () =>
                    page.evaluate(() => {
                        const pollen = window.aetherDebug.weatherEffects.currPollen;
                        return pollen ? pollen.mesh.visible && pollen.mesh.material.opacity : null;
                    }),
                { timeout: 20_000 }
            )
            .toBeTruthy();
    });

    test('European AQI leads outside US-scale countries', async ({ page }) => {
        await mockHealthData(page);
        await launchApp(page);

        // The default Nominatim fixture is London (country_code "gb").
        await searchForLocation(page, 'London');
        await expect(page.locator('#location')).toHaveText('London', { timeout: 30_000 });

        await expect(page.locator('#current-aqi')).toHaveText('EU AQI 38', { timeout: 30_000 });
        await expect(page.locator('#current-aqi')).toHaveAttribute('title', 'European AQI: Fair');

        await page.locator('#panel-advanced .tab-btn[data-tab="health"]').click();
        await expect(page.locator('#health-aqi-eu')).toHaveClass(/primary-scale/);
        await expect(page.locator('#health-aqi-us')).not.toHaveClass(/primary-scale/);
    });
});
