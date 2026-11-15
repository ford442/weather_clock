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

        // The on-screen button follows the same cycle (ModeShell click, not index.html).
        await modeToggle.click();
        await expect(page).toHaveURL(/[?&]mode=timeline/);
    });

    test('advanced tabs and drawer grip work without the classic index.html script', async ({ page }) => {
        await launchApp(page);

        const api = await page.evaluate(() => ({
            hasValidateAll: typeof window.aetherDebug?.validateAll,
            stubGone: typeof window.DOMBindingValidator === 'undefined' && typeof window.ZIndexManager === 'undefined'
        }));
        expect(api.hasValidateAll).toBe('function');
        expect(api.stubGone).toBe(true);

        await page.locator('#panel-advanced .drawer-handle-grip').click();
        await expect(page.locator('#panel-advanced')).toHaveClass(/expanded/);

        await page.locator('#panel-advanced .tab-btn[data-tab="health"]').click();
        await expect(page.locator('#tab-health')).toHaveClass(/active/);
        await expect(page.locator('#tab-history')).not.toHaveClass(/active/);

        await page.evaluate(() => window.aetherDebug.toggleDrawer('left'));
        await expect(page.locator('#panel-left')).toHaveClass(/expanded/);
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

/**
 * Open-Meteo goes down. Registered after mockExternalAPIs, so it takes
 * precedence; a 400 is not retryable, which keeps the spec fast.
 * @returns {{restore: () => Promise<void>}}
 */
async function failOpenMeteo(page) {
    const handler = (route) => route.fulfill({ status: 400, body: 'unavailable' });
    await page.route(/open-meteo\.com/, handler);
    return { restore: () => page.unroute(/open-meteo\.com/, handler) };
}

test.describe('weather failure handling', () => {
    test.beforeEach(async ({ page }) => {
        await mockExternalAPIs(page);
    });

    test('a failed load shows one error state, disables the detail tabs, and Retry recovers', async ({ page }) => {
        const outage = await failOpenMeteo(page);
        await launchApp(page);

        const notice = page.locator('#weather-notice');
        await expect(notice).toBeVisible();
        await expect(page.locator('#weather-notice-text')).toHaveText('Could not load weather data.');
        await expect(page.locator('#weather-notice-retry')).toBeVisible();

        // One indicator, now an error: neither a "Loading…" header nor a spinner left behind.
        await expect(page.locator('#current-description')).toHaveText('Weather data unavailable');
        await expect(page.locator('#location')).not.toHaveText(/loading/i);
        await expect(page.locator('body')).toHaveAttribute('data-weather-state', 'error');

        // Nothing to look at yet, so the tabs say so rather than opening onto `--`.
        for (const tab of ['history', 'accuracy', 'nearby', 'health']) {
            const button = page.locator(`#panel-advanced .tab-btn[data-tab="${tab}"]`);
            await expect(button).toBeDisabled();
            await expect(button).toHaveAttribute('aria-disabled', 'true');
        }
        await page.locator('#panel-advanced .tab-btn[data-tab="health"]').click({ force: true });
        await expect(page.locator('#panel-advanced')).toHaveClass(/no-data/);
        await expect(page.locator('#panel-advanced .tab-btn.active')).toHaveAttribute('data-tab', 'history');

        await outage.restore();
        await page.locator('#weather-notice-retry').click();

        await expect(notice).toBeHidden({ timeout: 30_000 });
        await expect(page.locator('body')).toHaveAttribute('data-weather-state', 'ready');
        // Each tab opens with its own data: nearby and health do; accuracy has none in the fixtures.
        await expect(page.locator('#panel-advanced .tab-btn[data-tab="nearby"]')).toBeEnabled();
        await expect(page.locator('#panel-advanced .tab-btn[data-tab="health"]')).toBeEnabled({ timeout: 30_000 });
        await expect(page.locator('#panel-advanced .tab-btn[data-tab="accuracy"]')).toBeDisabled();
        await expect(page.locator('#panel-advanced')).not.toHaveClass(/no-data/);
    });

    test('a failed update keeps the last good weather on screen, labelled, with Retry', async ({ page }) => {
        await launchApp(page); // loads fine, so a last-known-good snapshot is stored
        await expect(page.locator('body')).toHaveAttribute('data-weather-state', 'ready');
        const placeName = await page.locator('#location').textContent();

        const outage = await failOpenMeteo(page);
        await searchForLocation(page, 'London'); // a place that has never loaded

        // The snapshot of the previous place is shown, and the banner says whose it is and when.
        const text = page.locator('#weather-notice-text');
        await expect(text).toHaveText(/^Showing cached data for .+ from .+\. Live update failed\.$/, {
            timeout: 30_000
        });
        await expect(text).toContainText(placeName.trim());
        await expect(page.locator('#location')).toHaveText(placeName);
        await expect(page.locator('body')).toHaveAttribute('data-weather-state', 'stale');
        await expect(page.locator('#weather-notice-retry')).toBeVisible();

        await outage.restore();
        await page.locator('#weather-notice-retry').click();

        await expect(page.locator('#weather-notice')).toBeHidden({ timeout: 30_000 });
        await expect(page.locator('#location')).toHaveText('London');
    });

    test('a timeline that cannot load stays on the clock with a toast and no uncaught error', async ({ page }) => {
        const pageErrors = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        await launchApp(page);

        const outage = await failOpenMeteo(page);
        await page.keyboard.press('t');

        await expect(page.locator('#toast-container .toast-error', { hasText: /timeline/i })).toBeVisible({
            timeout: 30_000
        });
        await expect
            .poll(() => page.evaluate(() => window.modeController.isTransitioning), { timeout: 30_000 })
            .toBe(false);
        expect(await page.evaluate(() => window.modeController.currentMode)).toBe('clock');
        await expect(page).not.toHaveURL(/[?&]mode=/);
        await expect(page.locator('#panel-left')).not.toHaveClass(/hidden/);
        expect(pageErrors).toEqual([]);

        // The failed attempt left nothing behind that would open the timeline empty.
        await outage.restore();
        await page.keyboard.press('t');
        await expect(page).toHaveURL(/[?&]mode=timeline/, { timeout: 30_000 });
        await expect(page.locator('#timeline-ui-container')).toHaveClass(/visible/, { timeout: 30_000 });
    });

    test('a weather request that fails outside any handled path becomes a toast, not an uncaught error', async ({
        page
    }) => {
        const pageErrors = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        await launchApp(page);
        await failOpenMeteo(page);

        // A real WeatherServiceError rejection that nothing awaits or catches.
        await page.evaluate(() => {
            window.modeController.weatherService.getDailyForecast(1, 2, 3);
        });

        await expect(page.locator('#toast-container .toast-error')).toContainText(/weather/i, { timeout: 15_000 });
        expect(pageErrors).toEqual([]);
    });
});
