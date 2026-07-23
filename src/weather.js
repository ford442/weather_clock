import SunCalc from 'suncalc';
import {
    DAILY_FORECAST_PARAMS,
    DAILY_HOURLY_PARAMS,
    parseDailyForecast,
    getRepresentativeTimeForDay
} from './dailyForecast.js';

export class WeatherServiceError extends Error {
    constructor(message, status = null, endpoint = null, options = {}) {
        super(message);
        this.name = 'WeatherServiceError';
        this.status = status;
        this.endpoint = endpoint;
        this.code = options.code ?? null;
        this.isOffline = options.isOffline ?? false;
        if (options.cause) this.cause = options.cause;
    }
}

export class WeatherService {
    constructor({ timeoutMs = 10000, retryDelaysMs = [2000, 4000, 8000] } = {}) {
        this.latitude = null;
        this.longitude = null;
        this.location = null;
        this.unit = 'imperial'; // Default to Fahrenheit
        this.windUnit = 'metric'; // 'metric' = km/h, 'imperial' = mph
        this.cache = new Map();
        this.timeoutMs = timeoutMs;
        this.retryDelaysMs = retryDelaysMs;
        this.searchController = null;
    }

    /**
     * @param {string} url
     * @param {{timeoutMs?: number, signal?: AbortSignal}} [options]
     */
    async #fetchJSON(url, { timeoutMs = this.timeoutMs, signal } = {}) {
        const controller = new AbortController();
        let timedOut = false;

        const forwardAbort = () => controller.abort(signal?.reason);
        if (signal?.aborted) {
            forwardAbort();
        } else {
            signal?.addEventListener('abort', forwardAbort, { once: true });
        }

        const timeoutId = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, timeoutMs);

        try {
            const response = await fetch(url, { signal: controller.signal });
            if (response.ok === false) {
                throw new WeatherServiceError(
                    `Request failed with status ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
                    response.status,
                    url,
                    { code: 'HTTP_ERROR' }
                );
            }
            return await response.json();
        } catch (error) {
            if (error instanceof WeatherServiceError) throw error;

            if (timedOut) {
                throw new WeatherServiceError(`Request timed out after ${timeoutMs}ms`, null, url, {
                    code: 'TIMEOUT',
                    cause: error
                });
            }

            if (signal?.aborted) {
                throw new WeatherServiceError('Request cancelled', null, url, {
                    code: 'ABORTED',
                    cause: error
                });
            }

            const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
            throw new WeatherServiceError(isOffline ? 'Device is offline' : 'Network request failed', null, url, {
                code: isOffline ? 'OFFLINE' : 'NETWORK_ERROR',
                isOffline,
                cause: error
            });
        } finally {
            clearTimeout(timeoutId);
            signal?.removeEventListener('abort', forwardAbort);
        }
    }

    async initialize() {
        await this.getLocation();
        return await this.fetchWeather();
    }

    toggleUnit() {
        this.unit = this.unit === 'metric' ? 'imperial' : 'metric';
        return this.unit;
    }

    convertTemp(celsius) {
        if (this.unit === 'metric') return celsius;
        return (celsius * 9) / 5 + 32;
    }

    setWindUnit(unit) {
        this.windUnit = unit; // 'metric' or 'imperial'
    }

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
            return await this.#fetchJSON(
                `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&q=${encodeURIComponent(query)}`,
                { signal: controller.signal }
            );
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
            const data = await this.#fetchJSON(
                `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`
            );

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

    async fetchWeather() {
        let lastError;

        for (let attempt = 0; attempt <= this.retryDelaysMs.length; attempt++) {
            try {
                return await this._fetchWeatherOnce();
            } catch (error) {
                lastError = error;
                const retryDelay = this.retryDelaysMs[attempt];
                if (retryDelay === undefined || !this._isRetryable(error)) break;

                console.warn(
                    `Weather fetch failed. Retrying in ${retryDelay}ms (attempt ${attempt + 1}/${this.retryDelaysMs.length})...`
                );
                await new Promise((resolve) => setTimeout(resolve, retryDelay));
            }
        }

        console.error('Weather fetch failed, attempting cache fallback:', lastError);
        const cached = this.getFromCache(this.getCacheKey(this.latitude, this.longitude), true);
        if (cached) {
            const isOffline = lastError?.isOffline === true || this._isOffline();
            console.warn('Serving cached weather data due to fetch error');
            return {
                ...cached.data,
                isCached: true,
                isOffline,
                cachedAt: cached.timestamp
            };
        }
        throw lastError;
    }

    _isRetryable(error) {
        if (!(error instanceof WeatherServiceError)) return false;
        if (error.code === 'ABORTED' || error.code === 'OFFLINE') return false;
        if (error?.status == null) return true;
        return error.status === 408 || error.status === 429 || error.status >= 500;
    }

    _isOffline() {
        return typeof navigator !== 'undefined' && navigator.onLine === false;
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
            `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(this.latitude)}&longitude=${encodeURIComponent(this.longitude)}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,visibility,rain,showers,snowfall,pressure_msl,uv_index&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,visibility,rain,showers,snowfall,pressure_msl,uv_index,precipitation_probability&timezone=auto&past_days=1`
        );

        // Archive API — no UV/precipProb in archive, use apparent_temp + humidity
        const pastDate = new Date(now.getTime() - 3 * 60 * 60 * 1000);
        const pastDateStr = pastDate.toISOString().split('T')[0];
        const todayStr = now.toISOString().split('T')[0];

        const historicalData = await this.#fetchJSON(
            `https://archive-api.open-meteo.com/v1/archive?latitude=${encodeURIComponent(this.latitude)}&longitude=${encodeURIComponent(this.longitude)}&start_date=${pastDateStr}&end_date=${todayStr}&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,rain,showers,snowfall,pressure_msl&timezone=auto`
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
                `https://archive-api.open-meteo.com/v1/archive?latitude=${encodeURIComponent(this.latitude)}&longitude=${encodeURIComponent(this.longitude)}&start_date=${dateStr}&end_date=${dateStr}&hourly=temperature_2m,weather_code,cloud_cover,wind_speed_10m&timezone=auto`
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
            const rLat = this.latitude + offset.lat;
            const rLon = this.longitude + offset.lon;
            try {
                const data = await this.#fetchJSON(
                    `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(rLat)}&longitude=${encodeURIComponent(rLon)}&current=temperature_2m,weather_code&timezone=auto`
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

            const params = 'pm10,pm2_5,ozone,us_aqi,european_aqi,birch_pollen,grass_pollen,ragweed_pollen';
            const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${encodeURIComponent(this.latitude)}&longitude=${encodeURIComponent(this.longitude)}&current=${params}&timezone=auto`;
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
        const roundedLat = Math.round(lat * 10000) / 10000;
        const roundedLon = Math.round(lon * 10000) / 10000;
        return `https://api.weather.gov/alerts/active?point=${roundedLat},${roundedLon}`;
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

            const url = new URL('https://api.open-meteo.com/v1/forecast');
            url.searchParams.append('latitude', String(latitude));
            url.searchParams.append('longitude', String(longitude));
            url.searchParams.append('forecast_days', String(clampedDays));
            url.searchParams.append('daily', DAILY_FORECAST_PARAMS);
            url.searchParams.append('hourly', DAILY_HOURLY_PARAMS);
            url.searchParams.append('daily_units', ''); // Request units metadata
            url.searchParams.append('timezone', 'auto');

            const data = await this.#fetchJSON(url.toString());
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
     * @returns {Date}
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
        // Try memory first
        let cached = this.cache.get(key);

        if (!cached && typeof localStorage !== 'undefined') {
            // Try localStorage using a key-scoped entry so multiple cache types
            // (weather, daily, etc.) can coexist for the same location.
            try {
                const storageStr = localStorage.getItem(`weatherclock_cache_v1_${key}`);
                if (storageStr) {
                    cached = JSON.parse(storageStr);
                    if (cached) {
                        this.cache.set(key, cached);
                    }
                }
            } catch (e) {
                console.error('Failed to read from localStorage cache:', e);
            }
        }

        if (!cached) return null;

        const now = Date.now();
        const isExpired = now - cached.timestamp > ttlMs;

        if (isExpired && !allowExpired) {
            this.deleteFromCache(key);
            return null;
        }

        return cached;
    }

    setCache(key, data) {
        const cacheEntry = {
            data,
            timestamp: Date.now(),
            lat: this.latitude,
            lon: this.longitude
        };
        this.cache.set(key, cacheEntry);

        if (typeof localStorage !== 'undefined') {
            try {
                localStorage.setItem(`weatherclock_cache_v1_${key}`, JSON.stringify(cacheEntry));
            } catch (e) {
                console.error('Failed to write to localStorage cache:', e);
            }
        }
    }

    deleteFromCache(key) {
        this.cache.delete(key);
        if (typeof localStorage !== 'undefined') {
            try {
                localStorage.removeItem(`weatherclock_cache_v1_${key}`);
            } catch (e) {
                console.error('Failed to delete from localStorage cache:', e);
            }
        }
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
        const ACCURACY_CACHE_TTL = 24 * 60 * 60 * 1000; // Once per day per location
        const MIN_SAMPLE_SIZE = 12; // Hours of valid comparison pairs required

        const now = new Date();
        const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const cacheKey = this.getCacheKey(this.latitude, this.longitude, `accuracy_${dateStr}`);

        try {
            const cached = this.getFromCache(cacheKey, false, ACCURACY_CACHE_TTL);
            if (cached) return cached.data;

            const data = await this.#fetchJSON(
                `https://previous-runs-api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(this.latitude)}&longitude=${encodeURIComponent(this.longitude)}&hourly=temperature_2m,temperature_2m_previous_day1,temperature_2m_previous_day3&past_days=2&forecast_days=0&timezone=auto`
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

            const computeMae = (predicted) => {
                let sum = 0;
                let n = 0;
                for (const i of sample) {
                    const a = actual[i];
                    const p = Array.isArray(predicted) ? predicted[i] : null;
                    if (typeof a === 'number' && typeof p === 'number') {
                        sum += Math.abs(a - p);
                        n++;
                    }
                }
                return n > 0 ? { value: sum / n, n } : null;
            };

            const day1Stats = computeMae(day1);
            if (!day1Stats || day1Stats.n < MIN_SAMPLE_SIZE) return null;
            const day3Stats = computeMae(day3);

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
