/**
 * dailyForecast.js - Helpers for fetching and normalizing Open-Meteo daily forecast data.
 *
 * This module is intentionally separate from weather.js so the daily 10-day view
 * can evolve independently from the live clock's current/hourly flow.
 */

import SunCalc from 'suncalc';

/**
 * Daily variables requested from Open-Meteo.
 * Note: cloud_cover and visibility are not available as daily aggregates, so we
 * request hourly data for the same period and compute daily means.
 */
export const DAILY_FORECAST_PARAMS = [
    'weather_code',
    'temperature_2m_max',
    'temperature_2m_min',
    'apparent_temperature_max',
    'apparent_temperature_min',
    'precipitation_sum',
    'rain_sum',
    'showers_sum',
    'snowfall_sum',
    'precipitation_probability_max',
    'wind_speed_10m_max',
    'wind_direction_10m_dominant'
].join(',');

export const DAILY_HOURLY_PARAMS = [
    'temperature_2m',
    'weather_code',
    'cloud_cover',
    'visibility',
    'wind_speed_10m'
].join(',');

/**
 * Visual presets used by scene renderers and UI cards.
 * @typedef {'clear' | 'partly-cloudy' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'thunderstorm'} VisualPreset
 */

/**
 * Map a WMO weather code to a visual preset.
 * @param {number} code - WMO weather code
 * @returns {VisualPreset}
 */
export function getVisualPreset(code) {
    if (code === 0 || code === 1) return 'clear';
    if (code === 2) return 'partly-cloudy';
    if (code === 3) return 'cloudy';
    if (code === 45 || code === 48) return 'fog';
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
    if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return 'snow';
    if (code >= 95 && code <= 99) return 'thunderstorm';
    return 'clear';
}

/**
 * Human-readable description for a daily forecast code.
 * Mirrors WeatherService.getWeatherDescription for consistency.
 * @param {number} code - WMO weather code
 * @returns {string}
 */
export function getDailyDescription(code) {
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
        56: 'Light freezing drizzle',
        57: 'Dense freezing drizzle',
        61: 'Slight rain',
        63: 'Moderate rain',
        65: 'Heavy rain',
        66: 'Light freezing rain',
        67: 'Heavy freezing rain',
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

/**
 * Compute a daily mean cloud cover and visibility from hourly data for a given date.
 * @param {Object} hourly - Open-Meteo hourly response object
 * @param {string} dateStr - ISO date string YYYY-MM-DD
 * @returns {{cloudCover: number, visibility: number}}
 */
export function computeHourlyAggregates(hourly, dateStr) {
    let cloudSum = 0;
    let visibilitySum = 0;
    let count = 0;

    if (!hourly || !Array.isArray(hourly.time)) {
        return { cloudCover: 0, visibility: 10000 };
    }

    for (let i = 0; i < hourly.time.length; i++) {
        const timeStr = hourly.time[i];
        if (!timeStr || !timeStr.startsWith(dateStr)) continue;

        const cloud = hourly.cloud_cover?.[i];
        const vis = hourly.visibility?.[i];

        if (cloud != null) {
            cloudSum += cloud;
            count++;
        }
        if (vis != null) {
            visibilitySum += vis;
        }
    }

    if (count === 0) {
        return { cloudCover: 0, visibility: 10000 };
    }

    return {
        cloudCover: Math.round(cloudSum / count),
        visibility: Math.round(visibilitySum / count) || 10000
    };
}

/**
 * Estimate sensible cloud cover / visibility fallback values from a weather code.
 * Used when hourly data is unavailable.
 * @param {number} code - WMO weather code
 * @returns {{cloudCover: number, visibility: number}}
 */
export function estimateCloudAndVisibility(code) {
    const preset = getVisualPreset(code);
    switch (preset) {
        case 'clear':
            return { cloudCover: 10, visibility: 10000 };
        case 'partly-cloudy':
            return { cloudCover: 40, visibility: 10000 };
        case 'cloudy':
            return { cloudCover: 85, visibility: 8000 };
        case 'fog':
            return { cloudCover: 95, visibility: 2000 };
        case 'rain':
            return { cloudCover: 90, visibility: 5000 };
        case 'snow':
            return { cloudCover: 95, visibility: 3000 };
        case 'thunderstorm':
            return { cloudCover: 100, visibility: 3000 };
        default:
            return { cloudCover: 50, visibility: 10000 };
    }
}

/**
 * Normalize a raw Open-Meteo forecast response into a clean daily forecast array.
 *
 * @param {Object} apiResponse - Raw Open-Meteo /v1/forecast response
 * @param {Object} [options]
 * @param {number} [options.expectedDays=10] - Number of days requested
 * @returns {Array<Object>} Normalized daily forecast objects
 */
export function parseDailyForecast(apiResponse, options = {}) {
    const { expectedDays = 10 } = options;
    const daily = apiResponse?.daily;
    const hourly = apiResponse?.hourly;
    const dailyUnits = apiResponse?.daily_units || {};

    if (!daily || !Array.isArray(daily.time)) {
        return [];
    }

    const count = Math.min(
        daily.time.length,
        daily.weather_code?.length ?? Infinity,
        daily.temperature_2m_max?.length ?? Infinity,
        daily.temperature_2m_min?.length ?? Infinity,
        expectedDays
    );

    const result = [];

    for (let i = 0; i < count; i++) {
        const dateStr = daily.time[i];
        const code = daily.weather_code?.[i] ?? 0;

        const { cloudCover, visibility } = hourly
            ? computeHourlyAggregates(hourly, dateStr)
            : estimateCloudAndVisibility(code);

        const tMax = daily.temperature_2m_max?.[i] ?? null;
        const tMin = daily.temperature_2m_min?.[i] ?? null;
        const windSpeedMax = daily.wind_speed_10m_max?.[i] ?? 0;
        const precipSum = daily.precipitation_sum?.[i] ?? 0;

        result.push({
            date: dateStr,
            weatherCode: code,
            description: getDailyDescription(code),
            condition: getVisualPreset(code),
            // Canonical normalized fields
            tMax,
            tMin,
            // Backward-compatible aliases for existing forecast UI
            tempMax: tMax,
            tempMin: tMin,
            apparentTMax: daily.apparent_temperature_max?.[i] ?? null,
            apparentTMin: daily.apparent_temperature_min?.[i] ?? null,
            precipSum,
            rainSum: daily.rain_sum?.[i] ?? 0,
            showersSum: daily.showers_sum?.[i] ?? 0,
            snowfallSum: daily.snowfall_sum?.[i] ?? 0,
            precipProbabilityMax: daily.precipitation_probability_max?.[i] ?? 0,
            windSpeedMax,
            windDir: daily.wind_direction_10m_dominant?.[i] ?? 0,
            cloudCover,
            visibility,
            // Minimal hourly snapshot for 2D vignette renderers
            hourly: [{
                time: `${dateStr}T12:00:00`,
                temp: (tMax != null && tMin != null) ? (tMax + tMin) / 2 : null,
                weatherCode: code,
                cloudCover,
                windSpeed: windSpeedMax,
                precipitation: precipSum
            }],
            units: {
                temperature: dailyUnits.temperature_2m_max || '°C',
                speed: dailyUnits.wind_speed_10m_max || 'km/h',
                precipitation: dailyUnits.precipitation_sum || 'mm',
                visibility: dailyUnits.visibility || 'm'
            }
        });
    }

    return result;
}

/**
 * Return a representative Date for a forecast day, preferring solar noon.
 * Falls back to local noon if SunCalc fails.
 *
 * @param {string} dateStr - ISO date string YYYY-MM-DD
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @returns {Date}
 */
export function getRepresentativeTimeForDay(dateStr, lat, lon) {
    const base = new Date(`${dateStr}T12:00:00`);

    try {
        const times = SunCalc.getTimes(base, lat ?? 40.7, lon ?? -74);
        if (times && times.solarNoon && !isNaN(times.solarNoon.getTime())) {
            return new Date(times.solarNoon);
        }
    } catch (e) {
        // Fall through to local noon
    }

    return base;
}

/**
 * Build a representative hourly timeline for a single day from its daily summary.
 * Useful for debug modes and vignette rendering when only daily data is available.
 *
 * @param {Object} day - Normalized daily forecast object
 * @param {Date} repDate - Representative date/time for the day
 * @returns {Array<Object>} 24 hourly-like snapshots
 */
export function buildHourlyTimelineFromDay(day, repDate) {
    const timeline = [];
    const base = new Date(repDate);
    base.setHours(0, 0, 0, 0);

    const code = day.weatherCode ?? 0;
    const isRain = getVisualPreset(code) === 'rain';
    const isSnow = getVisualPreset(code) === 'snow';
    const isStorm = getVisualPreset(code) === 'thunderstorm';

    for (let h = 0; h < 24; h++) {
        const t = new Date(base.getTime() + h * 3600 * 1000);
        // Simple diurnal temperature curve peaking at 15:00
        const hourFactor = Math.sin(((h - 9) / 24) * Math.PI * 2);
        const temp = (day.tMax != null && day.tMin != null)
            ? (day.tMax + day.tMin) / 2 + hourFactor * (day.tMax - day.tMin) / 2
            : 15;

        timeline.push({
            time: t,
            temp,
            apparentTemp: temp,
            weatherCode: code,
            description: day.description,
            cloudCover: day.cloudCover ?? 0,
            windSpeed: day.windSpeedMax ?? 10,
            windDirection: day.windDir ?? 0,
            visibility: day.visibility ?? 10000,
            rain: isRain || isStorm ? (day.rainSum / 24) : 0,
            showers: isStorm ? (day.showersSum / 24) : 0,
            snowfall: isSnow ? (day.snowfallSum / 24) : 0,
            precipProb: day.precipProbabilityMax ?? 0,
            pressure: 1013.25
        });
    }

    return timeline;
}
