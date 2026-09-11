import SunCalc from 'suncalc';
import {
    DAILY_FORECAST_PARAMS,
    DAILY_HOURLY_PARAMS,
    parseDailyForecast,
    getRepresentativeTimeForDay
} from './dailyForecast.js';
import {
    WeatherServiceError,
    fetchJSON,
    withRetry,
    isRetryableError,
    isOffline,
    forecastUrl,
    archiveUrl,
    previousRunsUrl,
    airQualityUrl,
    geocodeSearchUrl,
    reverseGeocodeUrl,
    alertsUrl
} from './net/openMeteoClient.js';
import { TTLCache } from './net/weatherCache.js';
import { meanAbsoluteError, meanAbsoluteErrorGated, accuracyCacheSuffix, ACCURACY_CACHE_TTL_MS } from './accuracy.js';

// localStorage is shared by the whole origin (other apps on the same host
// included), so the weather cache must stay bounded rather than growing
// forever as the user visits new locations.
const CACHE_STORAGE_PREFIX = 'weatherclock_cache_v1_';
const MAX_CACHE_ENTRIES = 24;

export { WeatherServiceError };

export class WeatherService {
    constructor({ timeoutMs = 10000, retryDelaysMs = [2000, 4000, 8000] } = {}) {
        this.latitude = null;
        this.longitude = null;
        this.location = null;
        /** @type {'metric'|'imperial'} */
        this.unit = 'imperial'; // Default to Fahrenheit
        /** @type {'metric'|'imperial'} */
        this.windUnit = 'metric'; // 'metric' = km/h, 'imperial' = mph
        this._cacheStore = new TTLCache({ storagePrefix: CACHE_STORAGE_PREFIX, maxStorageEntries: MAX_CACHE_ENTRIES });
        this.cache = this._cacheStore.memory;
        this.timeoutMs = timeoutMs;
        this.retryDelaysMs = retryDelaysMs;
        this.searchController = null;
    }

    /**
     * @param {string|URL} url
     * @param {{timeoutMs?: number, signal?: AbortSignal}} [options]
     */
    async #fetchJSON(url, { timeoutMs = this.timeoutMs, signal } = {}) {
        return fetchJSON(url, { timeoutMs, signal });
    }

    async initialize() {
        await this.getLocation();
        return await this.fetchWeather();
    }

    /** @returns {'metric'|'imperial'} */
    toggleUnit() {
        this.unit = this.unit === 'metric' ? 'imperial' : 'metric';
        return this.unit;
    }

    /**
     * @param {number} celsius
     * @returns {number}
     */
    convertTemp(celsius) {
        if (this.unit === 'metric') return celsius;
        return (celsius * 9) / 5 + 32;
    }

    /** @param {'metric'|'imperial'} unit */
    setWindUnit(unit) {
        this.windUnit = unit; // 'metric' or 'imperial'
    }

    /**
     * @param {number} kmh
     * @returns {{value: number, unit: string}}
     */
    convertWind(kmh) {
        if (this.windUnit === 'imperial') {
            return { value: Math.round(kmh * 0.621371), unit: 'mph' };
        }
        return { value: Math.round(kmh), unit: 'km/h' };
    }

    async searchLocation(query) {
        this.searchController?.abort();
        const controller = new AbortController();
        this.searchController = controller;

        try {
            return await this.#fetchJSON(geocodeSearchUrl(query, navigator.language || 'en'), {
                signal: controller.signal
            });
        } catch (error) {
            if (error.code !== 'ABORTED') console.error('Search location failed:', error);
            throw error;
        } finally {
            if (this.searchController === controller) this.searchController = null;
        }
    }

    /**
     * @param {number|string} lat
     * @param {number|string} lon
     * @param {string} name
     */
    setManualLocation(lat, lon, name) {
        this.latitude = Number(lat);
        this.longitude = Number(lon);
        this.location = name;
    }

    async getLocation() {
        return new Promise((resolve) => {
            if (!navigator.geolocation) {
                this.setDefaultLocation();
                resolve(undefined);
                return;
            }

            // 5-second timeout for geolocation
            const timeoutId = setTimeout(() => {
                console.warn('Geolocation timeout (5s), using fallback location');
                this.setDefaultLocation();
                resolve(undefined);
            }, 5000);

            navigator.geolocation.getCurrentPosition(
                async (position) => {
                    clearTimeout(timeoutId);
                    this.latitude = position.coords.latitude;
                    this.longitude = position.coords.longitude;

                    try {
                        const locationName = await this.reverseGeocode(this.latitude, this.longitude);
                        this.location = locationName;
                    } catch (error) {
                        this.location = `${this.latitude.toFixed(2)}, ${this.longitude.toFixed(2)}`;
                    }

                    resolve(undefined);
                },
                (error) => {
                    clearTimeout(timeoutId);
                    console.warn('Geolocation failed, using fallback location:', error.message);
                    this.setFallbackLocation();
                    resolve(undefined);
                }
            );
        });
    }

    setFallbackLocation() {
        this.setDefaultLocation();
    }

    setDefaultLocation() {
        this.latitude = 40.7128;
        this.longitude = -74.006;
        this.location = 'New York, USA (default)';
        this.windUnit = 'imperial'; // NYC default is US
    }

    async reverseGeocode(lat, lon) {
        try {
            const data = await this.#fetchJSON(reverseGeocodeUrl(lat, lon, navigator.language || 'en'));

            if (data.address) {
                const city = data.address.city || data.address.town || data.address.village;
                const country = data.address.country;
                // Auto-detect wind unit: mph for US, km/h everywhere else
                this.windUnit = data.address.country_code === 'us' ? 'imperial' : 'metric';
                return city ? `${city}, ${country}` : country;
            }
            return `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
        } catch (error) {
            console.error('Reverse geocoding failed:', error);
            return `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
        }
    }

    // Parse a single hourly data point including all new fields
    _parseHourlyPoint(hourly, i) {
        return {
            temp: hourly.temperature_2m[i],
            apparentTemp: hourly.apparent_temperature ? hourly.apparent_temperature[i] : hourly.temperature_2m[i],
            humidity: hourly.relative_humidity_2m ? hourly.relative_humidity_2m[i] : 0,
            uvIndex: hourly.uv_index ? hourly.uv_index[i] : 0,
            precipProb: hourly.precipitation_probability ? hourly.precipitation_probability[i] : 0,
            weatherCode: hourly.weather_code[i],
            description: this.getWeatherDescription(hourly.weather_code[i]),
            cloudCover: hourly.cloud_cover[i],
            windSpeed: hourly.wind_speed_10m[i],
            windDirection: hourly.wind_direction_10m ? hourly.wind_direction_10m[i] : 0,
            visibility: hourly.visibility ? hourly.visibility[i] : 10000,
            rain: hourly.rain ? hourly.rain[i] : 0,
            showers: hourly.showers ? hourly.showers[i] : 0,
            snowfall: hourly.snowfall ? hourly.snowfall[i] : 0,
            pressure: hourly.pressure_msl ? hourly.pressure_msl[i] : 1013.25
        };
    }

    /** @returns {Promise<WeatherData>} */
    async fetchWeather() {
        let lastError;

        try {
            return await withRetry(() => this._fetchWeatherOnce(), {
                retryDelaysMs: this.retryDelaysMs,
                onRetry: (error, attempt, delayMs) => {
                    console.warn(
                        `Weather fetch failed. Retrying in ${delayMs}ms (attempt ${attempt + 1}/${this.retryDelaysMs.length})...`
                    );
                }
            });
        } catch (error) {
            lastError = error;
        }

        console.error('Weather fetch failed, attempting cache fallback:', lastError);
        const cached = this.getFromCache(this.getCacheKey(this.latitude, this.longitude), true);
        if (cached) {
            const offline = lastError?.isOffline === true || isOffline();
            console.warn('Serving cached weather data due to fetch error');
            return {
                ...cached.data,
                isCached: true,
                isOffline: offline,
                cachedAt: cached.timestamp
            };
        }
        throw lastError;
    }

    _isRetryable(error) {
        return isRetryableError(error);
    }

    _isOffline() {
        return isOffline();
    }

    async _fetchWeatherOnce() {
        if (!this.latitude || !this.longitude) {
            throw new Error('Location not available');
        }

        const cacheKey = this.getCacheKey(this.latitude, this.longitude);

        const now = new Date();

        // Using Open-Meteo API (free, no key required)
        // Get current and forecast weather
        // Added 'visibility' to current params
        // Request past_days=1 to ensure we have historical hourly data for the "Past" zone interpolation
        // even if the current time is just after midnight.
        const currentData = await this.#fetchJSON(
            forecastUrl(this.latitude, this.longitude, {
                current:
                    'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,visibility,rain,showers,snowfall,pressure_msl,uv_index',
                hourly: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,visibility,rain,showers,snowfall,pressure_msl,uv_index,precipitation_probability',
                timezone: 'auto',
                past_days: 1
            })
        );

        // Archive API — no UV/precipProb in archive, use apparent_temp + humidity
        const pastDate = new Date(now.getTime() - 3 * 60 * 60 * 1000);
        const pastDateStr = pastDate.toISOString().split('T')[0];
        const todayStr = now.toISOString().split('T')[0];

        const historicalData = await this.#fetchJSON(
            archiveUrl(this.latitude, this.longitude, {
                start_date: pastDateStr,
                end_date: todayStr,
                hourly: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,rain,showers,snowfall,pressure_msl',
                timezone: 'auto'
            })
        );

        // Build hourly timeline
        const timeline = [];
        const hourly = currentData.hourly;
        if (hourly && hourly.time) {
            for (let i = 0; i < hourly.time.length; i++) {
                timeline.push({
                    time: new Date(hourly.time[i]),
                    ...this._parseHourlyPoint(hourly, i)
                });
            }
        }

        // Current conditions
        const cur = currentData.current;
        const current = {
            temp: cur.temperature_2m,
            feelsLike: currentData.current.apparent_temperature ?? currentData.current.temperature_2m,
            apparentTemp: cur.apparent_temperature ?? cur.temperature_2m,
            humidity: cur.relative_humidity_2m ?? 0,
            uvIndex: cur.uv_index ?? 0,
            precipProb: cur.precipitation_probability ?? 0,
            weatherCode: cur.weather_code,
            description: this.getWeatherDescription(cur.weather_code),
            cloudCover: cur.cloud_cover,
            windSpeed: cur.wind_speed_10m,
            windDirection: cur.wind_direction_10m ?? 0,
            visibility: cur.visibility,
            rain: cur.rain,
            showers: cur.showers,
            snowfall: cur.snowfall,
            pressure: cur.pressure_msl ?? 1013.25
        };

        // Past conditions (3 h ago, from archive)
        const hist = historicalData.hourly;
        const pastIdx = this.findClosestHourIndex(hist.time, pastDate);
        const past = {
            temp: hist.temperature_2m[pastIdx] ?? current.temp,
            feelsLike: historicalData.hourly.apparent_temperature
                ? (historicalData.hourly.apparent_temperature[pastIdx] ?? current.feelsLike)
                : current.feelsLike,
            apparentTemp: hist.apparent_temperature
                ? (hist.apparent_temperature[pastIdx] ?? current.apparentTemp)
                : current.apparentTemp,
            humidity: hist.relative_humidity_2m
                ? (hist.relative_humidity_2m[pastIdx] ?? current.humidity)
                : current.humidity,
            uvIndex: 0, // Not available in archive
            precipProb: 0, // Not available in archive
            weatherCode: hist.weather_code[pastIdx] ?? current.weatherCode,
            description: this.getWeatherDescription(hist.weather_code[pastIdx] ?? current.weatherCode),
            cloudCover: hist.cloud_cover[pastIdx] ?? current.cloudCover,
            windSpeed: hist.wind_speed_10m[pastIdx] ?? current.windSpeed,
            windDirection: hist.wind_direction_10m
                ? (hist.wind_direction_10m[pastIdx] ?? current.windDirection)
                : current.windDirection,
            rain: hist.rain ? (hist.rain[pastIdx] ?? 0) : 0,
            showers: hist.showers ? (hist.showers[pastIdx] ?? 0) : 0,
            snowfall: hist.snowfall ? (hist.snowfall[pastIdx] ?? 0) : 0,
            pressure: hist.pressure_msl ? (hist.pressure_msl[pastIdx] ?? current.pressure) : current.pressure
        };

        // Forecast conditions (+3 h)
        const futureDate = new Date(now.getTime() + 3 * 60 * 60 * 1000);
        const futureIdx = this.findClosestHourIndex(currentData.hourly.time, futureDate);
        const fc = currentData.hourly;
        const forecast = {
            temp: fc.temperature_2m[futureIdx] ?? current.temp,
            apparentTemp: fc.apparent_temperature
                ? (fc.apparent_temperature[futureIdx] ?? current.apparentTemp)
                : current.apparentTemp,
            feelsLike: currentData.hourly.apparent_temperature
                ? (currentData.hourly.apparent_temperature[futureIdx] ?? current.feelsLike)
                : current.feelsLike,
            humidity: fc.relative_humidity_2m
                ? (fc.relative_humidity_2m[futureIdx] ?? current.humidity)
                : current.humidity,
            uvIndex: fc.uv_index ? (fc.uv_index[futureIdx] ?? 0) : 0,
            precipProb: fc.precipitation_probability ? (fc.precipitation_probability[futureIdx] ?? 0) : 0,
            weatherCode: fc.weather_code[futureIdx] ?? current.weatherCode,
            description: this.getWeatherDescription(fc.weather_code[futureIdx] ?? current.weatherCode),
            cloudCover: fc.cloud_cover[futureIdx] ?? current.cloudCover,
            windSpeed: fc.wind_speed_10m[futureIdx] ?? current.windSpeed,
            windDirection: fc.wind_direction_10m
                ? (fc.wind_direction_10m[futureIdx] ?? current.windDirection)
                : current.windDirection,
            rain: fc.rain ? (fc.rain[futureIdx] ?? 0) : 0,
            showers: fc.showers ? (fc.showers[futureIdx] ?? 0) : 0,
            snowfall: fc.snowfall ? (fc.snowfall[futureIdx] ?? 0) : 0,
            pressure: fc.pressure_msl ? (fc.pressure_msl[futureIdx] ?? current.pressure) : current.pressure
        };

        // Sunrise/sunset via SunCalc
        const sunTimes = SunCalc.getTimes(now, this.latitude, this.longitude);

        // Advanced data
        const historicalYearAgo = await this.fetchHistoricalYearAgo(now);
        const regional = null; // Lazy loaded on Nearby tab open
        const accuracy = await this.getPredictionAccuracy();

        const result = {
            location: this.location,
            current,
            past,
            forecast,
            timeline,
            sunrise: sunTimes.sunrise,
            sunset: sunTimes.sunset,
            historicalYearAgo,
            regional,
            accuracy
        };

        this.setCache(cacheKey, result);

        return result;
    }

    async fetchHistoricalYearAgo(now) {
        const lastYear = new Date(now.getTime());
        lastYear.setFullYear(now.getFullYear() - 1);
        const dateStr = lastYear.toISOString().split('T')[0];

        try {
            const data = await this.#fetchJSON(
                archiveUrl(this.latitude, this.longitude, {
                    start_date: dateStr,
                    end_date: dateStr,
                    hourly: 'temperature_2m,weather_code,cloud_cover,wind_speed_10m',
                    timezone: 'auto'
                })
            );
            const index = this.findClosestHourIndex(data.hourly.time, lastYear);
            return {
                temp: data.hourly.temperature_2m[index],
                weatherCode: data.hourly.weather_code[index],
                description: this.getWeatherDescription(data.hourly.weather_code[index]),
                date: dateStr
            };
        } catch (e) {
            console.error('Failed to fetch historical year ago', e);
            return null;
        }
    }

    async fetchRegionalWeather() {
        const offsets = [
            { name: 'North', lat: 0.1, lon: 0 },
            { name: 'East', lat: 0, lon: 0.1 },
            { name: 'South', lat: -0.1, lon: 0 },
            { name: 'West', lat: 0, lon: -0.1 }
        ];

        const promises = offsets.map(async (offset) => {
            // Only called after the Nearby tab is opened, by which point a location fetch has run.
            const rLat = /** @type {number} */ (this.latitude) + offset.lat;
            const rLon = /** @type {number} */ (this.longitude) + offset.lon;
            try {
                const data = await this.#fetchJSON(
                    forecastUrl(rLat, rLon, { current: 'temperature_2m,weather_code', timezone: 'auto' })
                );
                return {
                    name: offset.name,
                    temp: data.current.temperature_2m,
                    weatherCode: data.current.weather_code,
                    description: this.getWeatherDescription(data.current.weather_code)
                };
            } catch (e) {
                console.error(`Failed to fetch regional weather for ${offset.name}:`, e);
                return null;
            }
        });

        const results = await Promise.all(promises);
        return results.filter((r) => r !== null);
    }

    /**
     * Fetch current air quality (PM2.5/PM10, ozone, US/European AQI, and — where the
     * Open-Meteo model has coverage — pollen) for the active location.
     * Cached the same way as `getDailyForecast` (localStorage, checked before network).
     * @returns {Promise<{pm2_5: number|null, pm10: number|null, ozone: number|null, usAqi: number|null, europeanAqi: number|null, pollen: {birch: number|null, grass: number|null, ragweed: number|null}}|null>}
     */
    async fetchAirQuality() {
        if (this.latitude == null || this.longitude == null) {
            throw new Error('Location not available');
        }

        const cacheKey = this.getCacheKey(this.latitude, this.longitude, 'air_quality');

        try {
            const cached = this.getFromCache(cacheKey);
            if (cached) return cached.data;

            const url = airQualityUrl(this.latitude, this.longitude, {
                current: 'pm10,pm2_5,ozone,us_aqi,european_aqi,birch_pollen,grass_pollen,ragweed_pollen',
                timezone: 'auto'
            });
            const data = await this.#fetchJSON(url);
            const cur = data.current || {};

            const result = {
                pm2_5: cur.pm2_5 ?? null,
                pm10: cur.pm10 ?? null,
                ozone: cur.ozone ?? null,
                usAqi: cur.us_aqi ?? null,
                europeanAqi: cur.european_aqi ?? null,
                pollen: {
                    birch: cur.birch_pollen ?? null,
                    grass: cur.grass_pollen ?? null,
                    ragweed: cur.ragweed_pollen ?? null
                }
            };

            this.setCache(cacheKey, result);
            return result;
        } catch (error) {
            console.warn('Air quality fetch failed, attempting cache fallback:', error);
            const stale = this.getFromCache(cacheKey, true);
            return stale ? stale.data : null;
        }
    }

    /**
     * Build the NWS active-alerts URL for a point. Coordinates are rounded to 4
     * decimal places (~11 m), matching NWS's own precision and keeping the cache
     * key stable across tiny GPS jitter.
     * @param {number} lat
     * @param {number} lon
     */
    buildAlertsUrl(lat, lon) {
        return alertsUrl(lat, lon);
    }

    /**
     * Fetch active severe-weather alerts from the US National Weather Service.
     * Open-Meteo has no alerts endpoint, and NWS only has US coverage — any
     * failure (including "no coverage here") is treated as "no active alerts"
     * rather than surfaced as an error, so non-US locations silently show nothing.
     * @returns {Promise<Array<{id: string, event: string, severity: string, headline: string, description: string, effective: string|null, expires: string|null}>>}
     */
    async fetchAlerts() {
        if (this.latitude == null || this.longitude == null) {
            throw new Error('Location not available');
        }

        const cacheKey = this.getCacheKey(this.latitude, this.longitude, 'alerts');

        try {
            const cached = this.getFromCache(cacheKey);
            if (cached) return cached.data;

            const url = this.buildAlertsUrl(this.latitude, this.longitude);
            const data = await this.#fetchJSON(url);
            const alerts = (data.features || []).map((feature) => ({
                id: feature.id,
                event: feature.properties?.event ?? 'Alert',
                severity: feature.properties?.severity ?? 'Unknown',
                headline: feature.properties?.headline ?? '',
                description: feature.properties?.description ?? '',
                effective: feature.properties?.effective ?? null,
                expires: feature.properties?.expires ?? null
            }));

            this.setCache(cacheKey, alerts);
            return alerts;
        } catch (error) {
            console.warn('Alerts fetch failed or unavailable for this location:', error);
            const stale = this.getFromCache(cacheKey, true);
            return stale ? stale.data : [];
        }
    }

    /**
     * Fetch a clean, normalized 10-day daily forecast for the current or provided location.
     * Results are cached with the same memory + localStorage TTL as fetchWeather.
     *
     * @param {number} lat - Latitude
     * @param {number} lon - Longitude
     * @param {number} days - Number of forecast days (default 10, max 16)
     * @returns {Promise<DailyForecastDay[]>} Normalized daily forecast array
     */
    async getDailyForecast(lat, lon, days = 10) {
        const latitude = lat ?? this.latitude;
        const longitude = lon ?? this.longitude;

        if (latitude == null || longitude == null) {
            throw new Error('Location not available');
        }

        const clampedDays = Math.max(1, Math.min(16, days));
        const cacheKey = this.getCacheKey(latitude, longitude, `daily_${clampedDays}`);

        try {
            const cached = this.getFromCache(cacheKey);
            if (cached) {
                return cached.data;
            }

            const url = forecastUrl(latitude, longitude, {
                forecast_days: clampedDays,
                daily: DAILY_FORECAST_PARAMS,
                hourly: DAILY_HOURLY_PARAMS,
                daily_units: '', // Request units metadata
                timezone: 'auto'
            });

            const data = await this.#fetchJSON(url);
            const forecast = parseDailyForecast(data, { expectedDays: clampedDays });

            if (!forecast || forecast.length === 0) {
                throw new WeatherServiceError(
                    'Daily forecast response contained no usable days',
                    200,
                    'open_meteo_daily_forecast'
                );
            }

            this.setCache(cacheKey, forecast);
            return forecast;
        } catch (error) {
            console.error('Daily forecast fetch failed, attempting cache fallback:', error);

            const stale = this.getFromCache(cacheKey, true);
            if (stale) {
                console.warn('Serving cached daily forecast due to fetch error');
                return stale.data;
            }

            throw error;
        }
    }

    /**
     * Get a representative Date for a daily forecast day (solar noon preferred).
     * @param {DailyForecastDay} day - Normalized daily forecast object
     * @param {number} lat - Latitude
     * @param {number} lon - Longitude
     * @returns {Date|null}
     */
    getDailyForecastRepresentativeTime(day, lat, lon) {
        if (!day || !day.date) return null;
        return getRepresentativeTimeForDay(day.date, lat ?? this.latitude, lon ?? this.longitude);
    }

    getCacheKey(lat, lon, type = 'weather') {
        const roundedLat = Math.round(lat * 100) / 100;
        const roundedLon = Math.round(lon * 100) / 100;
        return `weatherclock_${roundedLat}_${roundedLon}_${type}`;
    }

    getFromCache(key, allowExpired = false, ttlMs = 60 * 60 * 1000) {
        return this._cacheStore.get(key, { allowExpired, ttlMs });
    }

    setCache(key, data) {
        return this._cacheStore.set(key, data, { lat: this.latitude, lon: this.longitude });
    }

    deleteFromCache(key) {
        this._cacheStore.delete(key);
    }

    /**
     * Compute recent forecast accuracy by comparing past model runs against
     * observed temperatures, via the Open-Meteo Previous Runs API.
     *
     * `temperature_2m_previous_dayN` is a continuous hourly series where each value
     * was predicted N days before valid time; plain `temperature_2m` (current run)
     * is the best-estimate actual for past hours. A single request therefore
     * provides both the predictions and the verifying observations.
     *
     * Cached once per day per location. Returns null when the endpoint lacks data
     * for the location (e.g. remote areas) or on any failure.
     *
     * @returns {Promise<{mae: number, maeDay3: number|null, score: number, sampleSize: number, updatedAt: number}|null>}
     *   mae/maeDay3 are mean absolute errors in °C over the last 24 observed hours;
     *   score is 0–100 (100 minus 10 points per °C of day-1 MAE).
     */
    async getPredictionAccuracy() {
        const MIN_SAMPLE_SIZE = 12; // Hours of valid comparison pairs required

        const now = new Date();
        const cacheKey = this.getCacheKey(this.latitude, this.longitude, accuracyCacheSuffix('accuracy', now));

        try {
            const cached = this.getFromCache(cacheKey, false, ACCURACY_CACHE_TTL_MS);
            if (cached) return cached.data;

            const data = await this.#fetchJSON(
                previousRunsUrl(this.latitude, this.longitude, {
                    hourly: 'temperature_2m,temperature_2m_previous_day1,temperature_2m_previous_day3',
                    past_days: 2,
                    forecast_days: 0,
                    timezone: 'auto'
                })
            );

            const hourly = data?.hourly;
            const times = hourly?.time;
            const actual = hourly?.temperature_2m;
            const day1 = hourly?.temperature_2m_previous_day1;
            const day3 = hourly?.temperature_2m_previous_day3;
            if (!Array.isArray(times) || !Array.isArray(actual) || !Array.isArray(day1)) {
                return null; // Endpoint has no data for this location
            }

            // Trailing 24 fully-observed hours
            const nowMs = now.getTime();
            const observedIndices = [];
            for (let i = 0; i < times.length; i++) {
                if (new Date(times[i]).getTime() < nowMs) observedIndices.push(i);
            }
            const sample = observedIndices.slice(-24);

            const day1Stats = meanAbsoluteErrorGated(actual, day1, MIN_SAMPLE_SIZE, sample);
            if (!day1Stats) return null;
            const day3Stats = meanAbsoluteError(actual, day3, sample);

            const result = {
                mae: Math.round(day1Stats.value * 10) / 10,
                maeDay3: day3Stats ? Math.round(day3Stats.value * 10) / 10 : null,
                // 100% = perfect forecast; lose 10 points per °C of mean absolute error
                score: Math.max(0, Math.min(100, Math.round(100 - day1Stats.value * 10))),
                sampleSize: day1Stats.n,
                updatedAt: Date.now()
            };

            this.setCache(cacheKey, result);
            return result;
        } catch (e) {
            console.error('Failed to compute prediction accuracy:', e);
            const stale = this.getFromCache(cacheKey, true);
            return stale ? stale.data : null;
        }
    }

    findClosestHourIndex(timeArray, targetDate) {
        const targetTime = targetDate.getTime();
        let closestIndex = 0;
        let closestDiff = Infinity;

        for (let i = 0; i < timeArray.length; i++) {
            const diff = Math.abs(new Date(timeArray[i]).getTime() - targetTime);
            if (diff < closestDiff) {
                closestDiff = diff;
                closestIndex = i;
            }
        }

        return closestIndex;
    }

    getWeatherDescription(code) {
        const weatherCodes = {
            0: 'Clear sky',
            1: 'Mainly clear',
            2: 'Partly cloudy',
            3: 'Overcast',
            45: 'Foggy',
            48: 'Depositing rime fog',
            51: 'Light drizzle',
            53: 'Moderate drizzle',
            55: 'Dense drizzle',
            61: 'Slight rain',
            63: 'Moderate rain',
            65: 'Heavy rain',
            71: 'Slight snow',
            73: 'Moderate snow',
            75: 'Heavy snow',
            77: 'Snow grains',
            80: 'Slight rain showers',
            81: 'Moderate rain showers',
            82: 'Violent rain showers',
            85: 'Slight snow showers',
            86: 'Heavy snow showers',
            95: 'Thunderstorm',
            96: 'Thunderstorm with hail',
            99: 'Thunderstorm with heavy hail'
        };

        return weatherCodes[code] || 'Unknown';
    }
}
