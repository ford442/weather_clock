// Debug utilities and tools
import { updateWeatherLighting } from './weatherLighting.js';
import { updateWeatherDisplay } from './ui.js';

/**
 * Generate debug weather timeline
 * @param {Date} simulationTime - Current simulation time
 * @param {number} weatherCode - Weather code to use (or -1 for dynamic)
 * @returns {Array} Timeline of debug weather data
 */
export function generateDebugTimeline(simulationTime, weatherCode) {
    const timeline = [];
    const start = new Date(simulationTime);
    start.setMinutes(0, 0, 0);
    start.setMilliseconds(0);

    for (let i = -3; i < 24; i++) {
        const t = new Date(start.getTime() + i * 3600 * 1000);
        let code = weatherCode;

        // Dynamic Mode: -1 cycles through Clear -> Rain -> Snow
        if (weatherCode === -1) {
            const cycle = 6; // Hours per phase
            const phase = Math.floor((i + 3) / cycle) % 3;
            if (phase === 0) code = 0; // Clear
            else if (phase === 1) code = 63; // Rain
            else code = 71; // Snow
        }

        const isRain = (code >= 50 && code < 70) || (code >= 80 && code < 83) || (code >= 95);
        const isSnow = (code >= 70 && code < 80) || (code >= 85 && code < 87);
        const isCloudy = code > 0;

        timeline.push({
            time: t,
            temp: 20 + Math.sin(i * 0.5) * 10,
            weatherCode: code,
            description: 'Debug ' + code,
            cloudCover: isCloudy ? 90 : 0,
            windSpeed: 10 + Math.sin(i) * 10,
            visibility: 10000,
            rain: isRain ? 10.0 : 0,
            showers: 0,
            snowfall: isSnow ? 5.0 : 0
        });
    }

    return timeline;
}

/**
 * Create a debug weather data object
 * @param {Date} simulationTime - Current simulation time
 * @param {number} weatherCode - Weather code to use
 * @param {Array} timeline - Debug timeline
 * @returns {Object} Mock weather data object
 */
export function createDebugWeatherData(simulationTime, weatherCode, timeline) {
    const currentMock = timeline.find(
        (t) => Math.abs(t.time.getTime() - simulationTime.getTime()) < 3600 * 1000
    ) || timeline[3];

    return {
        current: currentMock,
        past: timeline[0],
        forecast: timeline[6],
        timeline: timeline,
        location: `Debug Simulation (${weatherCode === -1 ? 'Dynamic' : 'Static'})`
    };
}

/**
 * Setup debug API for testing and verification
 * @param {Object} state - Application state object
 * @param {Object} services - Services (weatherService, astronomyService)
 * @param {Object} scene3d - 3D scene objects (scene, sky, weatherEffects, lights)
 */
export function setupDebugAPI(state, services, scene3d) {
    const { weatherService, astronomyService } = services;
    const { scene, sky, weatherEffects, sunLight, moonLight, ambientLight } = scene3d;

    // Debug function: set weather code
    window.setDebugWeather = (weatherCode) => {
        console.log('Setting debug weather code:', weatherCode);
        state.isDebugMode = true;

        const timeline = generateDebugTimeline(state.simulationTime, weatherCode);
        const mock = createDebugWeatherData(state.simulationTime, weatherCode, timeline);

        state.weatherData = mock;

        const astroData = astronomyService.update(
            state.simulationTime,
            weatherService.latitude,
            weatherService.longitude,
            20
        );

        updateWeatherLighting(scene, sunLight, moonLight, ambientLight, sky, mock, astroData);
        updateWeatherDisplay(mock, weatherService);
    };

    // Debug function: set time
    window.setDebugTime = (hour) => {
        state.simulationTime.setHours(hour, 0, 0, 0);

        if (state.weatherData) {
            const astroData = astronomyService.update(
                state.simulationTime,
                weatherService.latitude,
                weatherService.longitude,
                20
            );

            updateWeatherLighting(scene, sunLight, moonLight, ambientLight, sky, state.weatherData, astroData);
        }
    };

    // Expose internal objects for verification
    window.aetherDebug = {
        scene,
        sky,
        weatherEffects,
        sunLight,
        moonLight,
        ambientLight,
        getSimulationTime: () => state.simulationTime,
        getWeatherData: () => state.weatherData
    };
}

/**
 * Cleanup debug API
 */
export function cleanupDebugAPI() {
    delete window.setDebugWeather;
    delete window.setDebugTime;
    delete window.aetherDebug;
}
