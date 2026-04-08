// Weather simulation: interpolation and data management
import { getSeverity } from './weatherLighting.js';

/**
 * Interpolate weather data from a timeline at a specific time
 * @param {Date} time - The time to get weather for
 * @param {Array} timeline - Array of weather data points
 * @returns {Object|null} Interpolated weather data
 */
export function getWeatherAtTime(time, timeline) {
    if (!timeline || timeline.length === 0) return null;

    const t = time.getTime();

    // Find surrounding data points
    let prev = timeline[0];
    let next = timeline[timeline.length - 1];

    for (let i = 0; i < timeline.length - 1; i++) {
        const t1 = timeline[i].time.getTime();
        const t2 = timeline[i + 1].time.getTime();
        if (t >= t1 && t <= t2) {
            prev = timeline[i];
            next = timeline[i + 1];
            break;
        }
    }

    // Interpolation factor
    const range = next.time.getTime() - prev.time.getTime();
    let factor = 0;
    if (range > 0) {
        factor = (t - prev.time.getTime()) / range;
    }

    // If outside range, clamp to nearest
    if (t < prev.time.getTime()) return prev;
    if (t > next.time.getTime()) return next;

    // Interpolate simple values, pick discrete for codes
    const weatherCode = factor < 0.5 ? prev.weatherCode : next.weatherCode;
    const description = factor < 0.5 ? prev.description : next.description;

    // Calculate interpolated severity for smooth lighting transitions
    const prevSev = getSeverity(prev.weatherCode);
    const nextSev = getSeverity(next.weatherCode);
    const severity = prevSev + (nextSev - prevSev) * factor;

    // Interpolate wind direction (handle 360 wrap)
    let d1 = prev.windDirection || 0;
    let d2 = next.windDirection || 0;
    let diff = d2 - d1;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    let windDir = d1 + diff * factor;
    if (windDir < 0) windDir += 360;
    if (windDir >= 360) windDir -= 360;

    const lerp = (a, b) => (a || 0) + ((b || 0) - (a || 0)) * factor;

    return {
        temp: lerp(prev.temp, next.temp),
        apparentTemp: lerp(prev.apparentTemp ?? prev.temp, next.apparentTemp ?? next.temp),
        humidity: lerp(prev.humidity, next.humidity),
        uvIndex: lerp(prev.uvIndex, next.uvIndex),
        precipProb: lerp(prev.precipProb, next.precipProb),
        weatherCode: weatherCode,
        description: description,
        cloudCover: lerp(prev.cloudCover, next.cloudCover),
        windSpeed: lerp(prev.windSpeed, next.windSpeed),
        windDirection: windDir,
        visibility: lerp(prev.visibility ?? 10000, next.visibility ?? 10000),
        rain: lerp(prev.rain, next.rain),
        showers: lerp(prev.showers, next.showers),
        snowfall: lerp(prev.snowfall, next.snowfall),
        severity: severity
    };
}

/**
 * Get weather data for current, past, and forecast times
 * @param {Date} simulationTime - Current simulation time
 * @param {Object} weatherData - Full weather data object
 * @returns {Object} Active weather data with current, past, and forecast
 */
export function getActiveWeatherData(simulationTime, weatherData) {
    if (!weatherData) return null;

    let simWeather = null;
    if (weatherData.timeline) {
        simWeather = getWeatherAtTime(simulationTime, weatherData.timeline);
    }

    // Fallback if no timeline
    if (!simWeather && weatherData) {
        simWeather = weatherData.current;
    }

    if (!simWeather) return null;

    const simPast = weatherData.timeline
        ? getWeatherAtTime(new Date(simulationTime.getTime() - 3 * 3600 * 1000), weatherData.timeline)
        : (weatherData.past || simWeather);

    const simForecast = weatherData.timeline
        ? getWeatherAtTime(new Date(simulationTime.getTime() + 3 * 3600 * 1000), weatherData.timeline)
        : (weatherData.forecast || simWeather);

    return {
        current: simWeather,
        past: simPast,
        forecast: simForecast
    };
}
