import SunCalc from 'suncalc';

export class WeatherServiceError extends Error {
    constructor(message, status, endpoint) {
        super(message);
        this.name = 'WeatherServiceError';
        this.status = status;
        this.endpoint = endpoint;
    }
}

export class WeatherService {
    constructor() {
        this.latitude = null;
        this.longitude = null;
        this.location = null;
        this.unit = 'imperial'; // Default to Fahrenheit
        this.windUnit = 'metric'; // 'metric' = km/h, 'imperial' = mph
        this.cache = new Map();
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
        return (celsius * 9 / 5) + 32;
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
        try {
            const response = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&q=${encodeURIComponent(query)}`
            );
            if (response.ok === false) {
                throw new WeatherServiceError(
                    `Search failed with status ${response.status}`,
                    response.status,
                    'nominatim_search'
                );
            }
            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Search location failed:', error);
            throw error;
        }
    }

    setManualLocation(lat, lon, name) {
        this.latitude = parseFloat(lat);
        this.longitude = parseFloat(lon);
        this.location = name;
    }

    async getLocation() {
        return new Promise((resolve) => {
            if (!navigator.geolocation) {
                this.setDefaultLocation();
                resolve();
                return;
            }

            // 5-second timeout for geolocation
            const timeoutId = setTimeout(() => {
                console.warn('Geolocation timeout (5s), using fallback location');
                this.setDefaultLocation();
                resolve();
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

                    resolve();
                },
                (error) => {
                    clearTimeout(timeoutId);
                    console.warn('Geolocation failed, using fallback location:', error.message);
                    this.setFallbackLocation();
                    resolve();
                }
            );
        });
    }

    setFallbackLocation() {
        this.setDefaultLocation();
    }

    setDefaultLocation() {
        this.latitude = 40.7128;
        this.longitude = -74.0060;
        this.location = 'New York, USA (default)';
        this.windUnit = 'imperial'; // NYC default is US
    }

    async reverseGeocode(lat, lon) {
        try {
            const response = await fetch(
                `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`
            );
            if (response.ok === false) {
                throw new WeatherServiceError(
                    `Reverse geocoding failed with status ${response.status}`,
                    response.status,
                    'nominatim_reverse'
                );
            }
            const data = await response.json();

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
        if (!this.latitude || !this.longitude) {
            throw new Error('Location not available');
        }

        const cacheKey = this.getCacheKey(this.latitude, this.longitude);

        try {
            const now = new Date();

            // Using Open-Meteo API (free, no key required)
            // Get current and forecast weather
            // Added 'visibility' to current params
            // Request past_days=1 to ensure we have historical hourly data for the "Past" zone interpolation
            // even if the current time is just after midnight.
            const currentResponse = await fetch(
                `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(this.latitude)}&longitude=${encodeURIComponent(this.longitude)}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,visibility,rain,showers,snowfall,pressure_msl&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,visibility,rain,showers,snowfall,pressure_msl&timezone=auto&past_days=1`
            );
            if (currentResponse.ok === false) {
                throw new WeatherServiceError(
                    `Forecast API error: ${currentResponse.status} ${currentResponse.statusText}`,
                    currentResponse.status,
                    'open_meteo_forecast'
                );
            }
            const currentData = await currentResponse.json();

            // Archive API — no UV/precipProb in archive, use apparent_temp + humidity
            const pastDate = new Date(now.getTime() - 3 * 60 * 60 * 1000);
            const pastDateStr = pastDate.toISOString().split('T')[0];
            const todayStr = now.toISOString().split('T')[0];

            const historicalResponse = await fetch(
                `https://archive-api.open-meteo.com/v1/archive?latitude=${encodeURIComponent(this.latitude)}&longitude=${encodeURIComponent(this.longitude)}&start_date=${pastDateStr}&end_date=${todayStr}&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,rain,showers,snowfall,pressure_msl&timezone=auto`
            );
            if (historicalResponse.ok === false) {
                throw new WeatherServiceError(
                    `Archive API error: ${historicalResponse.status} ${historicalResponse.statusText}`,
                    historicalResponse.status,
                    'open_meteo_archive'
                );
            }
            const historicalData = await historicalResponse.json();

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
                feelsLike: historicalData.hourly.apparent_temperature ? (historicalData.hourly.apparent_temperature[pastIdx] ?? current.feelsLike) : current.feelsLike,
                apparentTemp: hist.apparent_temperature ? (hist.apparent_temperature[pastIdx] ?? current.apparentTemp) : current.apparentTemp,
                humidity: hist.relative_humidity_2m ? (hist.relative_humidity_2m[pastIdx] ?? current.humidity) : current.humidity,
                uvIndex: 0,      // Not available in archive
                precipProb: 0,   // Not available in archive
                weatherCode: hist.weather_code[pastIdx] ?? current.weatherCode,
                description: this.getWeatherDescription(hist.weather_code[pastIdx] ?? current.weatherCode),
                cloudCover: hist.cloud_cover[pastIdx] ?? current.cloudCover,
                windSpeed: hist.wind_speed_10m[pastIdx] ?? current.windSpeed,
                windDirection: hist.wind_direction_10m ? (hist.wind_direction_10m[pastIdx] ?? current.windDirection) : current.windDirection,
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
                apparentTemp: fc.apparent_temperature ? (fc.apparent_temperature[futureIdx] ?? current.apparentTemp) : current.apparentTemp,
                feelsLike: currentData.hourly.apparent_temperature ? (currentData.hourly.apparent_temperature[futureIdx] ?? current.feelsLike) : current.feelsLike,
                humidity: fc.relative_humidity_2m ? (fc.relative_humidity_2m[futureIdx] ?? current.humidity) : current.humidity,
                uvIndex: fc.uv_index ? (fc.uv_index[futureIdx] ?? 0) : 0,
                precipProb: fc.precipitation_probability ? (fc.precipitation_probability[futureIdx] ?? 0) : 0,
                weatherCode: fc.weather_code[futureIdx] ?? current.weatherCode,
                description: this.getWeatherDescription(fc.weather_code[futureIdx] ?? current.weatherCode),
                cloudCover: fc.cloud_cover[futureIdx] ?? current.cloudCover,
                windSpeed: fc.wind_speed_10m[futureIdx] ?? current.windSpeed,
                windDirection: fc.wind_direction_10m ? (fc.wind_direction_10m[futureIdx] ?? current.windDirection) : current.windDirection,
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
        } catch (error) {
            console.error('Weather fetch failed, attempting cache fallback:', error);
            const cached = this.getFromCache(this.getCacheKey(this.latitude, this.longitude), true);
            if (cached) {
                console.warn('Serving cached weather data due to fetch error');
                return {
                    ...cached.data,
                    isCached: true,
                    cachedAt: cached.timestamp
                };
            }
            throw error;
        }
    }

    async fetchHistoricalYearAgo(now) {
        const lastYear = new Date(now.getTime());
        lastYear.setFullYear(now.getFullYear() - 1);
        const dateStr = lastYear.toISOString().split('T')[0];

        try {
            const response = await fetch(
                `https://archive-api.open-meteo.com/v1/archive?latitude=${encodeURIComponent(this.latitude)}&longitude=${encodeURIComponent(this.longitude)}&start_date=${dateStr}&end_date=${dateStr}&hourly=temperature_2m,weather_code,cloud_cover,wind_speed_10m&timezone=auto`
            );
            if (response.ok === false) {
                throw new WeatherServiceError(
                    `Historical year-ago fetch failed with status ${response.status}`,
                    response.status,
                    'open_meteo_archive_year_ago'
                );
            }
            const data = await response.json();
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
                const response = await fetch(
                    `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(rLat)}&longitude=${encodeURIComponent(rLon)}&current=temperature_2m,weather_code&timezone=auto`
                );
                if (response.ok === false) {
                    throw new WeatherServiceError(
                        `Regional fetch failed for ${offset.name} with status ${response.status}`,
                        response.status,
                        `open_meteo_regional_${offset.name.toLowerCase()}`
                    );
                }
                const data = await response.json();
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
        return results.filter(r => r !== null);
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
            // Try localStorage
            try {
                const storageStr = localStorage.getItem('weatherclock_cache_v1');
                if (storageStr) {
                    const parsed = JSON.parse(storageStr);
                    if (parsed && parsed.lat !== undefined && parsed.lon !== undefined) {
                        // Check if coordinates match within ~1km precision (2 decimal places)
                        const roundedLat = Math.round(this.latitude * 100) / 100;
                        const roundedLon = Math.round(this.longitude * 100) / 100;
                        const cachedRoundedLat = Math.round(parsed.lat * 100) / 100;
                        const cachedRoundedLon = Math.round(parsed.lon * 100) / 100;
                        
                        if (roundedLat === cachedRoundedLat && roundedLon === cachedRoundedLon) {
                            cached = parsed;
                            this.cache.set(key, cached);
                        }
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
                localStorage.setItem('weatherclock_cache_v1', JSON.stringify(cacheEntry));
            } catch (e) {
                console.error('Failed to write to localStorage cache:', e);
            }
        }
    }

    deleteFromCache(key) {
        this.cache.delete(key);
        if (typeof localStorage !== 'undefined') {
            try {
                localStorage.removeItem('weatherclock_cache_v1');
            } catch (e) {
                console.error('Failed to delete from localStorage cache:', e);
            }
        }
    }

    getPredictionAccuracy(current) {
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
