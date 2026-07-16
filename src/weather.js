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
            `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(this.latitude)}&longitude=${encodeURIComponent(this.longitude)}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,visibility,rain,showers,snowfall,pressure_msl&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,visibility,rain,showers,snowfall,pressure_msl&timezone=auto&past_days=1`
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
        const accuracy = this.getPredictionAccuracy(current);

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

    getFromCache(key, allowExpired = false) {
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
        const isExpired = now - cached.timestamp > 60 * 60 * 1000; // 1 hour TTL

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

    getPredictionAccuracy(_current) {
        // Forecast accuracy requires archived forecast runs (Previous Runs API).
        // This is not yet implemented. Returning null signals "no data" to the UI.
        return null;
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
