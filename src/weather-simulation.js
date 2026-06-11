// Weather simulation: interpolation and data management
import { getSeverity } from './weatherLighting.js';

/**
 * Ensure weather data object has rainIntensity, snowIntensity, and fogIntensity
 * @param {Object} data - Weather data point
 * @returns {Object} Data point with intensities populated
 */
export function ensureIntensities(data) {
    if (!data) return null;
    if (data.rainIntensity !== undefined && data.snowIntensity !== undefined && data.fogIntensity !== undefined) {
        return data;
    }

    let rainVal = (data.rain || 0) + (data.showers || 0);
    let rainIntensity = 0;
    if (rainVal > 0) {
        rainIntensity = Math.min(1.0, rainVal / 5.0);
    } else {
        const code = data.weatherCode || 0;
        if (code === 51) rainIntensity = 0.2;
        else if (code === 53) rainIntensity = 0.4;
        else if (code === 55) rainIntensity = 0.6;
        else if (code === 61) rainIntensity = 0.3;
        else if (code === 63) rainIntensity = 0.6;
        else if (code === 65) rainIntensity = 1.0;
        else if (code === 80) rainIntensity = 0.4;
        else if (code === 81) rainIntensity = 0.7;
        else if (code === 82) rainIntensity = 1.0;
        else if (code === 95 || code === 96 || code === 99) rainIntensity = 0.8;
    }

    let snowVal = data.snowfall || 0;
    let snowIntensity = 0;
    if (snowVal > 0) {
        snowIntensity = Math.min(1.0, snowVal / 3.0);
    } else {
        const code = data.weatherCode || 0;
        if (code === 71) snowIntensity = 0.3;
        else if (code === 73) snowIntensity = 0.6;
        else if (code === 75) snowIntensity = 1.0;
        else if (code === 77) snowIntensity = 0.4;
        else if (code === 85) snowIntensity = 0.4;
        else if (code === 86) snowIntensity = 1.0;
    }

    let fogIntensity = 0;
    const code = data.weatherCode || 0;
    if (code === 45 || code === 48) {
        fogIntensity = 1.0;
    } else {
        const vis = data.visibility ?? 10000;
        if (vis < 10000) {
            fogIntensity = Math.max(0.0, Math.min(1.0, (10000 - vis) / 9000));
        }
    }

    return {
        ...data,
        rainIntensity,
        snowIntensity,
        fogIntensity
    };
}

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

    // If outside range, clamp factor
    if (t < prev.time.getTime()) {
        factor = 0;
    } else if (t > next.time.getTime()) {
        factor = 1;
    }

    const prevInt = ensureIntensities(prev);
    const nextInt = ensureIntensities(next);

    // Interpolate simple values, pick discrete for codes
    const weatherCode = factor < 0.5 ? prevInt.weatherCode : nextInt.weatherCode;
    const description = factor < 0.5 ? prevInt.description : nextInt.description;

    // Calculate interpolated severity for smooth lighting transitions
    const prevSev = getSeverity(prevInt.weatherCode);
    const nextSev = getSeverity(nextInt.weatherCode);
    const severity = prevSev + (nextSev - prevSev) * factor;

    // Interpolate wind direction (handle 360 wrap)
    let d1 = prevInt.windDirection || 0;
    let d2 = nextInt.windDirection || 0;
    let diff = d2 - d1;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    let windDir = d1 + diff * factor;
    if (windDir < 0) windDir += 360;
    if (windDir >= 360) windDir -= 360;

    const lerp = (a, b) => (a || 0) + ((b || 0) - (a || 0)) * factor;

    return {
        temp: lerp(prevInt.temp, nextInt.temp),
        apparentTemp: lerp(prevInt.apparentTemp ?? prevInt.temp, nextInt.apparentTemp ?? nextInt.temp),
        humidity: lerp(prevInt.humidity, nextInt.humidity),
        uvIndex: lerp(prevInt.uvIndex, nextInt.uvIndex),
        precipProb: lerp(prevInt.precipProb, nextInt.precipProb),
        weatherCode: weatherCode,
        description: description,
        cloudCover: lerp(prevInt.cloudCover, nextInt.cloudCover),
        windSpeed: lerp(prevInt.windSpeed, nextInt.windSpeed),
        windDirection: windDir,
        visibility: lerp(prevInt.visibility ?? 10000, nextInt.visibility ?? 10000),
        rain: lerp(prevInt.rain, nextInt.rain),
        showers: lerp(prevInt.showers, nextInt.showers),
        snowfall: lerp(prevInt.snowfall, nextInt.snowfall),
        severity: severity,
        rainIntensity: prevInt.rainIntensity + (nextInt.rainIntensity - prevInt.rainIntensity) * factor,
        snowIntensity: prevInt.snowIntensity + (nextInt.snowIntensity - prevInt.snowIntensity) * factor,
        fogIntensity: prevInt.fogIntensity + (nextInt.fogIntensity - prevInt.fogIntensity) * factor
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
        current: ensureIntensities(simWeather),
        past: ensureIntensities(simPast),
        forecast: ensureIntensities(simForecast)
    };
}
