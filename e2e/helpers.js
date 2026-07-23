/**
 * Shared helpers for e2e specs.
 *
 * Mirrors the readiness/determinism strategy of the retired Python suite:
 * every page loads with `?test=1` (service worker disabled) and scenarios are
 * driven through the app's debug hooks (window.setDebugTime / setDebugWeather).
 */

/** Minimal Open-Meteo / Nominatim fixtures so functional specs are hermetic. */
export const FIXTURES = {
    nominatimSearch: [
        {
            display_name: 'London, Greater London, England, United Kingdom',
            lat: '51.5074',
            lon: '-0.1278',
            address: { country_code: 'gb' }
        }
    ],
    nominatimReverse: {
        display_name: 'New York, United States',
        address: { country_code: 'us' }
    },
    openMeteoCurrent: {
        current: {
            temperature_2m: 18.5,
            apparent_temperature: 17.8,
            relative_humidity_2m: 60,
            weather_code: 1,
            cloud_cover: 25,
            wind_speed_10m: 12,
            wind_direction_10m: 200,
            visibility: 10000,
            rain: 0,
            showers: 0,
            snowfall: 0,
            pressure_msl: 1015,
            uv_index: 3
        },
        hourly: {
            time: [],
            temperature_2m: [],
            weather_code: [],
            cloud_cover: [],
            wind_speed_10m: []
        }
    },
    openMeteoArchive: {
        hourly: {
            time: [],
            temperature_2m: [],
            weather_code: [],
            cloud_cover: [],
            wind_speed_10m: []
        }
    },
    emptyJson: {}
};

/**
 * Route all external weather/geocoding endpoints to fixtures.
 * Call before page.goto so no real network traffic escapes.
 */
export async function mockExternalAPIs(page) {
    await page.route('https://nominatim.openstreetmap.org/search*', (route) =>
        route.fulfill({ contentType: 'application/json', body: JSON.stringify(FIXTURES.nominatimSearch) })
    );
    await page.route('https://nominatim.openstreetmap.org/reverse*', (route) =>
        route.fulfill({ contentType: 'application/json', body: JSON.stringify(FIXTURES.nominatimReverse) })
    );
    await page.route('https://api.open-meteo.com/v1/forecast*', (route) =>
        route.fulfill({ contentType: 'application/json', body: JSON.stringify(FIXTURES.openMeteoCurrent) })
    );
    await page.route('https://archive-api.open-meteo.com/v1/archive*', (route) =>
        route.fulfill({ contentType: 'application/json', body: JSON.stringify(FIXTURES.openMeteoArchive) })
    );
    await page.route('https://air-quality-api.open-meteo.com/**', (route) =>
        route.fulfill({ contentType: 'application/json', body: JSON.stringify(FIXTURES.emptyJson) })
    );
    await page.route('https://previous-runs-api.open-meteo.com/**', (route) =>
        route.fulfill({ contentType: 'application/json', body: JSON.stringify(FIXTURES.emptyJson) })
    );
}

/**
 * Load the app in test mode and wait until the debug hooks are ready.
 * Replicates the retired Python suite's readiness logic.
 */
export async function launchApp(page, { query = '' } = {}) {
    const separator = query ? '&' : '';
    await page.goto(`/?test=1${separator}${query}`);
    await page.waitForSelector('canvas', { timeout: 15_000 });
    await page.waitForTimeout(3000); // Let initial assets/layout settle
    await page.waitForFunction(
        () =>
            Boolean(window.aetherDebug) &&
            typeof window.setDebugTime === 'function' &&
            typeof window.setDebugWeather === 'function',
        null,
        { timeout: 90_000 }
    );
}

/**
 * Apply a time/weather scenario exactly like the Python suite did:
 * time first (weather regenerates the debug timeline around simulationTime),
 * then weather, then a settle wait for transitions and particles.
 */
export async function applyScenario(page, { hour, code, waitMs }) {
    await page.evaluate((h) => window.setDebugTime(h), hour);
    await page.evaluate((c) => window.setDebugWeather(c), code);
    await page.waitForTimeout(waitMs);
}

/**
 * Build five mock daily-forecast entries (exact port of build_forecast_days()
 * from the retired Python suite) used to drive the forecast-focused view.
 */
export function buildForecastDays() {
    const scenarios = [
        { name: 'clear', code: 0, cloud: 8, rain: 0, snow: 0, wind: 8, direction: 90, hour: 12 },
        { name: 'cloudy', code: 3, cloud: 92, rain: 0, snow: 0, wind: 14, direction: 180, hour: 12 },
        { name: 'rain', code: 65, cloud: 88, rain: 12, snow: 0, wind: 28, direction: 240, hour: 14 },
        { name: 'snow', code: 75, cloud: 82, rain: 0, snow: 5, wind: 16, direction: 30, hour: 11 },
        { name: 'high wind', code: 2, cloud: 45, rain: 0, snow: 0, wind: 42, direction: 300, hour: 16 }
    ];
    return scenarios.map((s, index) => {
        const date = `2026-06-${19 + index}`;
        const visibility = s.cloud < 80 ? 9000 : 4200;
        return {
            date,
            weatherCode: s.code,
            condition: s.name,
            tempMax: 24 - index,
            tempMin: 12 - index,
            tMax: 24 - index,
            tMin: 12 - index,
            cloudCover: s.cloud,
            visibility,
            precipSum: s.rain + s.snow,
            rainSum: s.rain,
            showersSum: 0,
            snowfallSum: s.snow,
            windSpeedMax: s.wind,
            windDir: s.direction,
            hourly: [
                {
                    time: `${date}T12:00`,
                    weatherCode: s.code,
                    cloudCover: s.cloud,
                    visibility,
                    rain: s.rain,
                    snowfall: s.snow,
                    windSpeed: s.wind,
                    windDirection: s.direction
                }
            ]
        };
    });
}

/** Hours used by the forecast-focus smoke assertions, per card index. */
export const FORECAST_VIGNETTE_HOURS = [12, 12, 14, 11, 16];
