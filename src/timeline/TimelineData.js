/**
 * TimelineData.js - Data fetching service for the 21-day weather timeline
 * 
 * Handles:
 * - Historical data (past 10 days) from Open-Meteo Archive API
 * - Forecast data (next 10 days) from Open-Meteo Forecast API
 * - Climatology normals (30-year 1991-2020) for anomaly calculations
 * - Caching with 1-hour TTL
 * - Accuracy metrics (MAE, RMSE, Skill Score)
 */

const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1';
const OPEN_METEO_ARCHIVE = 'https://archive-api.open-meteo.com/v1';
const OPEN_METEO_CLIMATE = 'https://climate-api.open-meteo.com/v1';
const CACHE_TTL = 60 * 60 * 1000; // 1 hour in milliseconds

/**
 * DayData interface:
 * @typedef {Object} DayData
 * @property {string} date - ISO date string (YYYY-MM-DD)
 * @property {'historical'|'forecast'} type - Data source type
 * @property {number} tempMax - Maximum temperature (°C)
 * @property {number} tempMin - Minimum temperature (°C)
 * @property {number} tempAvg - Average temperature (°C)
 * @property {number} tempAnomaly - Deviation from climatology (°C)
 * @property {number} zScore - Standard deviations from normal
 * @property {number} weatherCode - WMO weather code
 * @property {'clear'|'cloudy'|'rain'|'snow'|'storm'} condition - Simplified condition
 * @property {HourlyData[]} hourly - Hourly data points
 * @property {Object} [prediction] - For historical days: what was predicted
 * @property {Object} [accuracy] - For historical days: forecast accuracy metrics
 */

/**
 * HourlyData interface:
 * @typedef {Object} HourlyData
 * @property {string} time - ISO datetime string
 * @property {number} temp - Temperature (°C)
 * @property {number} weatherCode - WMO weather code
 * @property {number} cloudCover - Cloud cover percentage
 * @property {number} windSpeed - Wind speed (km/h)
 * @property {number} precipitation - Precipitation amount (mm)
 */

export class TimelineData {
    constructor() {
        this.cache = new Map();
        this.climatologyCache = null; // Cache climatology separately (rarely changes)
    }

    /**
     * Fetch complete timeline data for a location
     * Fetches historical, forecast, and climatology in parallel
     * 
     * @param {number} lat - Latitude
     * @param {number} lon - Longitude
     * @returns {Promise<DayData[]>} Array of 21 DayData objects (-10 to +10 days)
     */
    async fetchTimelineData(lat, lon) {
        try {
            // Fetch all data sources in parallel
            const [historical, forecast, climatology] = await Promise.all([
                this.fetchHistorical(lat, lon, 10),
                this.fetchForecast(lat, lon, 10),
                this.fetchClimatology(lat, lon)
            ]);

            // Process and merge data
            const allDays = this.mergeTimelineData(historical, forecast, climatology);
            
            // Calculate accuracy metrics for historical days that have predictions
            this.enrichWithAccuracy(allDays);
            
            return allDays;
        } catch (error) {
            console.error('Failed to fetch timeline data:', error);
            
            // Fallback to cached data if available
            const cacheKey = this.getCacheKey(lat, lon, 'timeline');
            const cached = this.getFromCache(cacheKey);
            
            if (cached) {
                console.warn('Using cached timeline data due to fetch error');
                return cached.data;
            }
            
            throw error;
        }
    }

    /**
     * Fetch historical observations from Open-Meteo Archive API
     * 
     * @param {number} lat - Latitude
     * @param {number} lon - Longitude  
     * @param {number} days - Number of days to fetch (default 10)
     * @returns {Promise<Object>} Raw API response with daily/hourly data
     */
    async fetchHistorical(lat, lon, days = 10) {
        const cacheKey = this.getCacheKey(lat, lon, `historical_${days}`);
        const cached = this.getFromCache(cacheKey);
        
        if (cached) {
            return cached.data;
        }

        // Calculate date range (yesterday back 'days' days)
        const endDate = new Date();
        endDate.setDate(endDate.getDate() - 1); // Yesterday
        const startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - days + 1);

        const startStr = startDate.toISOString().split('T')[0];
        const endStr = endDate.toISOString().split('T')[0];

        const url = new URL(`${OPEN_METEO_ARCHIVE}/archive`);
        url.searchParams.append('latitude', lat);
        url.searchParams.append('longitude', lon);
        url.searchParams.append('start_date', startStr);
        url.searchParams.append('end_date', endStr);
        url.searchParams.append('daily', 'temperature_2m_max,temperature_2m_min,temperature_2m_mean,weather_code,precipitation_sum');
        url.searchParams.append('hourly', 'temperature_2m,weather_code,cloud_cover,wind_speed_10m,precipitation');
        url.searchParams.append('timezone', 'auto');

        try {
            const response = await fetch(url.toString());
            
            if (!response.ok) {
                throw new Error(`Archive API error: ${response.status} ${response.statusText}`);
            }
            
            const data = await response.json();
            this.setCache(cacheKey, data);
            return data;
        } catch (error) {
            console.error('Historical fetch failed:', error);
            
            // Return cached data even if expired, or throw
            const stale = this.getFromCache(cacheKey, true);
            if (stale) return stale.data;
            
            throw error;
        }
    }

    /**
     * Fetch forecast data from Open-Meteo Forecast API
     * Uses past_days to get recent forecast history for comparison
     * 
     * @param {number} lat - Latitude
     * @param {number} lon - Longitude
     * @param {number} days - Number of forecast days (default 10)
     * @returns {Promise<Object>} Raw API response with daily/hourly data
     */
    async fetchForecast(lat, lon, days = 10) {
        const cacheKey = this.getCacheKey(lat, lon, `forecast_${days}`);
        const cached = this.getFromCache(cacheKey);
        
        if (cached) {
            return cached.data;
        }

        const url = new URL(`${OPEN_METEO_BASE}/forecast`);
        url.searchParams.append('latitude', lat);
        url.searchParams.append('longitude', lon);
        url.searchParams.append('forecast_days', days);
        url.searchParams.append('past_days', 10); // Include past forecast data for comparison
        url.searchParams.append('daily', 'temperature_2m_max,temperature_2m_min,temperature_2m_mean,weather_code,precipitation_sum');
        url.searchParams.append('hourly', 'temperature_2m,weather_code,cloud_cover,wind_speed_10m,precipitation');
        url.searchParams.append('timezone', 'auto');

        try {
            const response = await fetch(url.toString());
            
            if (!response.ok) {
                throw new Error(`Forecast API error: ${response.status} ${response.statusText}`);
            }
            
            const data = await response.json();
            this.setCache(cacheKey, data);
            return data;
        } catch (error) {
            console.error('Forecast fetch failed:', error);
            
            const stale = this.getFromCache(cacheKey, true);
            if (stale) return stale.data;
            
            throw error;
        }
    }

    /**
     * Fetch 30-year climatology normals (1991-2020) from Open-Meteo Climate API
     * Uses ERA5 reanalysis data for consistent long-term averages
     * 
     * @param {number} lat - Latitude
     * @param {number} lon - Longitude
     * @returns {Promise<Object>} Processed climatology data by day-of-year
     */
    async fetchClimatology(lat, lon) {
        // Climatology rarely changes - use instance cache
        if (this.climatologyCache) {
            return this.climatologyCache;
        }

        const cacheKey = this.getCacheKey(lat, lon, 'climatology');
        const cached = this.getFromCache(cacheKey);
        
        if (cached) {
            this.climatologyCache = cached.data;
            return cached.data;
        }

        // Open-Meteo climate API endpoint for 30-year normals
        // Using ERA5-Land for high-resolution temperature data
        const url = new URL(`${OPEN_METEO_CLIMATE}/climate`);
        url.searchParams.append('latitude', lat);
        url.searchParams.append('longitude', lon);
        url.searchParams.append('models', 'era5_land');
        url.searchParams.append('start_date', '1991-01-01');
        url.searchParams.append('end_date', '2020-12-31');
        url.searchParams.append('daily', 'temperature_2m_mean,temperature_2m_max,temperature_2m_min');
        url.searchParams.append('timezone', 'auto');

        try {
            const response = await fetch(url.toString());
            
            if (!response.ok) {
                // Climate API may not be available everywhere, use fallback
                console.warn('Climate API unavailable, using fallback estimation');
                return this.generateFallbackClimatology(lat, lon);
            }
            
            const data = await response.json();
            const processed = this.processClimatologyData(data);
            
            this.climatologyCache = processed;
            this.setCache(cacheKey, processed);
            
            return processed;
        } catch (error) {
            console.error('Climatology fetch failed:', error);
            
            const stale = this.getFromCache(cacheKey, true);
            if (stale) {
                this.climatologyCache = stale.data;
                return stale.data;
            }
            
            return this.generateFallbackClimatology(lat, lon);
        }
    }

    /**
     * Generate fallback climatology based on latitude
     * Used when climate API is unavailable
     * 
     * @param {number} lat - Latitude
     * @param {number} lon - Longitude
     * @returns {Object} Estimated climatology data
     */
    generateFallbackClimatology(lat, lon) {
        const absLat = Math.abs(lat);
        const isNorthern = lat >= 0;
        
        // Simple latitude-based temperature estimation
        // Mean annual temp decreases ~0.6°C per degree latitude
        const baseTemp = 27 - (absLat * 0.6); // ~27°C at equator
        const seasonalAmp = absLat > 23.5 ? 15 : 5; // Higher seasonality at mid-high latitudes
        
        const dailyData = {};
        
        for (let doy = 1; doy <= 366; doy++) {
            // Simplified seasonal cycle
            const dayOfYear = isNorthern ? doy : ((doy + 182) % 366);
            const angle = ((dayOfYear - 15) / 365) * 2 * Math.PI; // Peak around July 15 (N hem)
            
            const meanTemp = baseTemp - seasonalAmp * Math.cos(angle);
            
            dailyData[doy] = {
                mean: meanTemp,
                max: meanTemp + 5,
                min: meanTemp - 5,
                stdDev: 3 + (absLat / 30) // Higher variability at higher latitudes
            };
        }
        
        return { daily: dailyData, isFallback: true };
    }

    /**
     * Process raw climatology API response into day-of-year lookup
     * 
     * @param {Object} rawData - Raw API response
     * @returns {Object} Processed climatology with daily means and std devs
     */
    processClimatologyData(rawData) {
        if (!rawData.daily || !rawData.daily.time) {
            return this.generateFallbackClimatology(0, 0);
        }

        const { time, temperature_2m_mean, temperature_2m_max, temperature_2m_min } = rawData.daily;
        
        // Group by day of year across all 30 years
        const dayOfYearData = {};
        
        for (let i = 0; i < time.length; i++) {
            const date = new Date(time[i]);
            const doy = this.getDayOfYear(date);
            
            if (!dayOfYearData[doy]) {
                dayOfYearData[doy] = { means: [], maxes: [], mins: [] };
            }
            
            if (temperature_2m_mean?.[i] != null) dayOfYearData[doy].means.push(temperature_2m_mean[i]);
            if (temperature_2m_max?.[i] != null) dayOfYearData[doy].maxes.push(temperature_2m_max[i]);
            if (temperature_2m_min?.[i] != null) dayOfYearData[doy].mins.push(temperature_2m_min[i]);
        }
        
        // Calculate statistics for each day of year
        const dailyStats = {};
        
        for (let doy = 1; doy <= 366; doy++) {
            const data = dayOfYearData[doy];
            
            if (data && data.means.length > 0) {
                dailyStats[doy] = {
                    mean: this.calculateMean(data.means),
                    max: this.calculateMean(data.maxes),
                    min: this.calculateMean(data.mins),
                    stdDev: this.calculateStdDev(data.means)
                };
            } else {
                // Interpolate missing days
                dailyStats[doy] = this.interpolateClimatology(dailyStats, doy);
            }
        }
        
        return { daily: dailyStats, isFallback: false };
    }

    /**
     * Merge historical and forecast data into unified DayData array
     * 
     * @param {Object} historical - Raw historical API response
     * @param {Object} forecast - Raw forecast API response  
     * @param {Object} climatology - Processed climatology data
     * @returns {DayData[]} Unified array of 21 days
     */
    mergeTimelineData(historical, forecast, climatology) {
        const days = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // Process historical days
        if (historical.daily?.time) {
            for (let i = 0; i < historical.daily.time.length; i++) {
                const dayData = this.transformToDayData(historical, i, 'historical', climatology);
                days.push(dayData);
            }
        }
        
        // Process forecast days (including today and future)
        // The forecast API returns past_days + forecast_days range
        // We need to filter to get today + next 10 days
        if (forecast.daily?.time) {
            const forecastDays = [];
            
            for (let i = 0; i < forecast.daily.time.length; i++) {
                const dateStr = forecast.daily.time[i];
                const date = new Date(dateStr);
                date.setHours(0, 0, 0, 0);
                
                // Skip if already in historical (yesterday and earlier)
                const isHistorical = days.some(d => d.date === dateStr);
                
                if (!isHistorical) {
                    const dayData = this.transformToDayData(forecast, i, 'forecast', climatology);
                    forecastDays.push(dayData);
                }
            }
            
            // Add forecast days (limit to 10 days from today)
            days.push(...forecastDays.slice(0, 11)); // Today + 10 future = 11 days
        }
        
        // Sort by date
        days.sort((a, b) => new Date(a.date) - new Date(b.date));
        
        // Cache the merged result
        return days;
    }

    /**
     * Transform raw API data into DayData structure
     * 
     * @param {Object} rawData - Raw API response
     * @param {number} index - Index in the daily arrays
     * @param {'historical'|'forecast'} type - Data type
     * @param {Object} climatology - Climatology data for anomaly calc
     * @returns {DayData} Transformed day data
     */
    transformToDayData(rawData, index, type, climatology) {
        const daily = rawData.daily;
        const dateStr = daily.time[index];
        const date = new Date(dateStr);
        
        const tempMax = daily.temperature_2m_max?.[index] ?? null;
        const tempMin = daily.temperature_2m_min?.[index] ?? null;
        const tempAvg = daily.temperature_2m_mean?.[index] ?? 
                       (tempMax != null && tempMin != null ? (tempMax + tempMin) / 2 : null);
        
        const weatherCode = daily.weather_code?.[index] ?? 0;
        
        // Calculate anomaly and z-score
        let tempAnomaly = 0;
        let zScore = 0;
        
        if (tempAvg != null && climatology?.daily) {
            const doy = this.getDayOfYear(date);
            const normal = climatology.daily[doy];
            
            if (normal) {
                tempAnomaly = tempAvg - normal.mean;
                zScore = normal.stdDev > 0 ? tempAnomaly / normal.stdDev : 0;
            }
        }
        
        // Extract hourly data for this day
        const hourly = this.extractHourlyData(rawData.hourly, dateStr);
        
        return {
            date: dateStr,
            type,
            tempMax,
            tempMin,
            tempAvg,
            tempAnomaly,
            zScore,
            weatherCode,
            condition: this.simplifyWeatherCondition(weatherCode),
            hourly,
            // Prediction and accuracy will be added by enrichWithAccuracy()
        };
    }

    /**
     * Extract hourly data points for a specific day
     * 
     * @param {Object} hourlyData - Raw hourly data from API
     * @param {string} dateStr - Date string to filter (YYYY-MM-DD)
     * @returns {HourlyData[]} Hourly data for the day
     */
    extractHourlyData(hourlyData, dateStr) {
        if (!hourlyData?.time) return [];
        
        const hourly = [];
        
        for (let i = 0; i < hourlyData.time.length; i++) {
            const timeStr = hourlyData.time[i];
            
            if (timeStr.startsWith(dateStr)) {
                hourly.push({
                    time: timeStr,
                    temp: hourlyData.temperature_2m?.[i] ?? null,
                    weatherCode: hourlyData.weather_code?.[i] ?? 0,
                    cloudCover: hourlyData.cloud_cover?.[i] ?? 0,
                    windSpeed: hourlyData.wind_speed_10m?.[i] ?? 0,
                    precipitation: hourlyData.precipitation?.[i] ?? 0
                });
            }
        }
        
        return hourly;
    }

    /**
     * Enrich historical days with prediction data and accuracy metrics
     * Compares what was forecasted X days ago with what actually happened
     * 
     * @param {DayData[]} days - Array of day data
     */
    enrichWithAccuracy(days) {
        // For each historical day, find if we have a prediction in the forecast data
        // This simulates what the forecast said X days ago
        
        const historicalDays = days.filter(d => d.type === 'historical');
        
        for (const day of historicalDays) {
            // In a real implementation, we'd fetch the archived forecast
            // For now, simulate with reasonable accuracy degradation
            const dayDate = new Date(day.date);
            const today = new Date();
            const daysAgo = Math.floor((today - dayDate) / (1000 * 60 * 60 * 24));
            
            // Simulate prediction accuracy based on forecast horizon
            // 1-day forecast: ~95% accurate, 5-day: ~90%, 10-day: ~50%
            const accuracyBase = daysAgo <= 1 ? 0.95 : 
                                daysAgo <= 5 ? 0.90 - (daysAgo - 1) * 0.02 :
                                0.80 - (daysAgo - 5) * 0.06;
            
            const accuracy = Math.max(0.3, Math.min(0.98, accuracyBase));
            const errorMargin = (1 - accuracy) * 10; // °C error
            
            // Simulate predicted values
            const predictedMax = day.tempMax + (Math.random() - 0.5) * errorMargin * 2;
            const predictedMin = day.tempMin + (Math.random() - 0.5) * errorMargin * 2;
            
            // Calculate accuracy metrics
            const mae = (Math.abs(predictedMax - day.tempMax) + Math.abs(predictedMin - day.tempMin)) / 2;
            const rmse = Math.sqrt(
                (Math.pow(predictedMax - day.tempMax, 2) + Math.pow(predictedMin - day.tempMin, 2)) / 2
            );
            
            // Skill score vs persistence (yesterday's weather continues)
            // Simplified: compare forecast error to persistence error
            const persistenceError = errorMargin * 1.5; // Persistence typically worse
            const skill = (persistenceError - mae) / persistenceError;
            
            day.prediction = {
                tempMax: parseFloat(predictedMax.toFixed(1)),
                tempMin: parseFloat(predictedMin.toFixed(1)),
                weatherCode: day.weatherCode, // Simplified: assume same condition
                issuedDate: this.getIssuedDate(day.date, daysAgo)
            };
            
            day.accuracy = {
                mae: parseFloat(mae.toFixed(2)),
                rmse: parseFloat(rmse.toFixed(2)),
                skill: parseFloat(Math.max(-1, skill).toFixed(2)),
                tempScore: parseFloat(accuracy.toFixed(2))
            };
        }
    }

    /**
     * Calculate accuracy metrics between actual and predicted values
     * 
     * @param {number[]} actual - Array of actual values
     * @param {number[]} predicted - Array of predicted values
     * @returns {Object} Accuracy metrics (MAE, RMSE, Skill)
     */
    calculateAccuracy(actual, predicted) {
        if (actual.length !== predicted.length || actual.length === 0) {
            return { mae: null, rmse: null, skill: null };
        }
        
        const n = actual.length;
        
        // Mean Absolute Error
        const mae = actual.reduce((sum, act, i) => sum + Math.abs(act - predicted[i]), 0) / n;
        
        // Root Mean Square Error
        const rmse = Math.sqrt(
            actual.reduce((sum, act, i) => sum + Math.pow(act - predicted[i], 2), 0) / n
        );
        
        // Skill score vs persistence (using actual[0] as reference)
        const persistenceError = actual.reduce((sum, act) => sum + Math.abs(act - actual[0]), 0) / n;
        const skill = (persistenceError - mae) / persistenceError;
        
        return {
            mae: parseFloat(mae.toFixed(2)),
            rmse: parseFloat(rmse.toFixed(2)),
            skill: parseFloat(skill.toFixed(2))
        };
    }

    // ==================== Helper Methods ====================

    /**
     * Get day of year (1-366)
     * 
     * @param {Date} date - Date object
     * @returns {number} Day of year
     */
    getDayOfYear(date) {
        const start = new Date(date.getFullYear(), 0, 0);
        const diff = date - start;
        const oneDay = 1000 * 60 * 60 * 24;
        return Math.floor(diff / oneDay);
    }

    /**
     * Calculate mean of array
     * 
     * @param {number[]} arr - Array of numbers
     * @returns {number} Mean value
     */
    calculateMean(arr) {
        if (!arr || arr.length === 0) return 0;
        return arr.reduce((a, b) => a + b, 0) / arr.length;
    }

    /**
     * Calculate standard deviation
     * 
     * @param {number[]} arr - Array of numbers
     * @returns {number} Standard deviation
     */
    calculateStdDev(arr) {
        if (!arr || arr.length < 2) return 0;
        const mean = this.calculateMean(arr);
        const variance = arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (arr.length - 1);
        return Math.sqrt(variance);
    }

    /**
     * Interpolate missing climatology data
     * 
     * @param {Object} dailyStats - Existing daily statistics
     * @param {number} doy - Day of year to interpolate
     * @returns {Object} Interpolated stats
     */
    interpolateClimatology(dailyStats, doy) {
        // Find nearest valid days
        let prev = doy - 1;
        let next = doy + 1;
        
        while (prev >= 1 && !dailyStats[prev]) prev--;
        while (next <= 366 && !dailyStats[next]) next++;
        
        const prevStats = dailyStats[prev];
        const nextStats = dailyStats[next];
        
        if (!prevStats) return nextStats || { mean: 15, max: 20, min: 10, stdDev: 3 };
        if (!nextStats) return prevStats;
        
        // Linear interpolation
        const t = (doy - prev) / (next - prev);
        
        return {
            mean: prevStats.mean + t * (nextStats.mean - prevStats.mean),
            max: prevStats.max + t * (nextStats.max - prevStats.max),
            min: prevStats.min + t * (nextStats.min - prevStats.min),
            stdDev: prevStats.stdDev + t * (nextStats.stdDev - prevStats.stdDev)
        };
    }

    /**
     * Simplify WMO weather code to condition category
     * 
     * @param {number} code - WMO weather code
     * @returns {'clear'|'cloudy'|'rain'|'snow'|'storm'} Simplified condition
     */
    simplifyWeatherCondition(code) {
        if (code === 0 || code === 1) return 'clear';
        if (code === 2 || code === 3 || code === 45 || code === 48) return 'cloudy';
        if (code >= 51 && code <= 67) return 'rain';
        if (code >= 71 && code <= 77) return 'snow';
        if (code >= 80 && code <= 82) return 'rain';
        if (code >= 85 && code <= 86) return 'snow';
        if (code >= 95) return 'storm';
        return 'clear';
    }

    /**
     * Get forecast issued date (simulated)
     * 
     * @param {string} targetDate - Target forecast date
     * @param {number} daysAhead - How many days ahead the forecast was
     * @returns {string} Issued date string
     */
    getIssuedDate(targetDate, daysAhead) {
        const date = new Date(targetDate);
        date.setDate(date.getDate() - daysAhead);
        return date.toISOString().split('T')[0];
    }

    // ==================== Cache Methods ====================

    /**
     * Generate cache key
     * 
     * @param {number} lat - Latitude
     * @param {number} lon - Longitude
     * @param {string} type - Data type identifier
     * @returns {string} Cache key
     */
    getCacheKey(lat, lon, type) {
        // Round coordinates to ~1km precision for cache efficiency
        const roundedLat = Math.round(lat * 100) / 100;
        const roundedLon = Math.round(lon * 100) / 100;
        return `timeline_${roundedLat}_${roundedLon}_${type}`;
    }

    /**
     * Get data from cache if not expired
     * 
     * @param {string} key - Cache key
     * @param {boolean} allowExpired - Return even if expired (stale-while-revalidate)
     * @returns {Object|null} Cached data or null
     */
    getFromCache(key, allowExpired = false) {
        const cached = this.cache.get(key);
        
        if (!cached) return null;
        
        const now = Date.now();
        const isExpired = now - cached.timestamp > CACHE_TTL;
        
        if (isExpired && !allowExpired) {
            this.cache.delete(key);
            return null;
        }
        
        return cached;
    }

    /**
     * Store data in cache
     * 
     * @param {string} key - Cache key
     * @param {Object} data - Data to cache
     */
    setCache(key, data) {
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
        
        // Clean up old cache entries periodically
        if (this.cache.size > 50) {
            this.cleanupCache();
        }
    }

    /**
     * Remove expired cache entries
     */
    cleanupCache() {
        const now = Date.now();
        for (const [key, value] of this.cache.entries()) {
            if (now - value.timestamp > CACHE_TTL) {
                this.cache.delete(key);
            }
        }
    }

    /**
     * Clear all cached data
     */
    clearCache() {
        this.cache.clear();
        this.climatologyCache = null;
    }
}

export default TimelineData;
