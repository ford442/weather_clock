import * as THREE from 'three';
import Stats from 'three/addons/libs/stats.module.js';

// Import modular components
import { setupRendering } from './rendering.js';
import { setupLights } from './lights.js';
import { setupSky, setupSundial, setupMoon, setupWeatherEffects, addToScene } from './scene-objects.js';
import { WeatherService } from './weather.js';
import { AstronomyService } from './astronomy.js';
import {
    formatTime12,
    updateTimeDisplay,
    updateWeatherDisplay,
    updateUnitButton,
    setupEventListeners,
    updateTimeWarpButton,
    setSearchLoading
} from './ui.js';
import { AnimationController } from './animation.js';
import { setupDebugAPI } from './debug.js';

// ============= Application State =============
const state = {
    weatherData: null,
    simulationTime: new Date(),
    isTimeWarping: false,
    isDebugMode: false
};

const WEATHER_REFRESH_INTERVAL = 10 * 60 * 1000; // 10 minutes

// ============= Initialize 3D Rendering =============
const { scene, camera, renderer, composer, clock } = setupRendering();

// ============= Setup Scene Lighting =============
const { ambientLight, sunLight, moonLight } = setupLights(scene);

// ============= Setup Scene Objects =============
const sky = setupSky();
const sundial = setupSundial();
const { moonGroup, moonPhaseData } = setupMoon();
const weatherEffects = setupWeatherEffects(scene, sundial, camera);

// Add objects to scene
addToScene(scene, { sky, sundial, moonGroup });

// ============= Setup Services =============
const weatherService = new WeatherService();
const astronomyService = new AstronomyService();

// ============= Setup Performance Monitoring =============
const stats = new Stats();
document.body.appendChild(stats.dom);

// ============= Setup Animation Loop =============
const animationController = new AnimationController(state, { weatherService, astronomyService }, {
    scene,
    camera,
    composer,
    sky,
    sundial,
    moonGroup,
    weatherEffects,
    sunLight,
    moonLight,
    ambientLight
});

// ============= UI Event Handlers =============
function setupUICallbacks() {
    return {
        onRetryLocation: async () => {
            document.getElementById('location').textContent = 'Retrying...';
            try {
                await weatherService.getLocation();
                const data = await weatherService.fetchWeather();
                state.weatherData = data;
                updateWeatherDisplay(data, weatherService);
            } catch (error) {
                console.error('Location retry failed:', error);
                document.getElementById('location').textContent = 'Location unavailable';
            }
        },

        onToggleUnit: () => {
            weatherService.toggleUnit();
            updateUnitButton(weatherService);
            if (state.weatherData) {
                updateWeatherDisplay(state.weatherData, weatherService);
            }
        },

        onSearch: async (query) => {
            if (!query) return;

            setSearchLoading(true);
            try {
                const results = await weatherService.searchLocation(query);
                if (results && results.length > 0) {
                    const best = results[0];
                    weatherService.setManualLocation(
                        best.lat,
                        best.lon,
                        best.display_name.split(',')[0]
                    );

                    document.getElementById('location').textContent = 'Updating...';
                    const data = await weatherService.fetchWeather();
                    state.weatherData = data;
                    updateWeatherDisplay(data, weatherService);

                    // Clear search input
                    const searchInput = document.getElementById('location-search');
                    if (searchInput) searchInput.value = '';
                } else {
                    alert('Location not found');
                }
            } catch (error) {
                console.error('Search failed:', error);
                alert('Search failed');
            } finally {
                setSearchLoading(false);
            }
        },

        onToggleTimeWarp: () => {
            state.isTimeWarping = !state.isTimeWarping;
            updateTimeWarpButton(state.isTimeWarping);
        }
    };
}

// ============= Fetch and Display Weather =============
async function fetchAndDisplayWeather() {
    if (state.isDebugMode) return;

    document.getElementById('location').textContent = 'Loading...';
    try {
        const data = await weatherService.initialize();
        if (state.isDebugMode) return;
        state.weatherData = data;
        updateWeatherDisplay(data, weatherService);
    } catch (error) {
        console.error('Weather initialization failed:', error);
        document.getElementById('location').textContent = 'Weather data unavailable';
        document.getElementById('current-description').textContent = 'Unable to fetch';
    }
}

// ============= Initialize Application =============
async function init() {
    // Update initial UI state
    updateTimeDisplay(state.simulationTime, state.isTimeWarping);
    updateUnitButton(weatherService);

    // Setup event listeners
    const callbacks = setupUICallbacks();
    setupEventListeners(callbacks);

    // Setup debug API
    setupDebugAPI(state, { weatherService, astronomyService }, {
        scene,
        sky,
        weatherEffects,
        sunLight,
        moonLight,
        ambientLight
    });

    // Start animation loop
    animationController.start(clock, stats);

    // Fetch initial weather
    await fetchAndDisplayWeather();

    // Setup weather refresh interval
    setInterval(async () => {
        if (state.isDebugMode) return;
        try {
            const data = await weatherService.fetchWeather();
            if (state.isDebugMode) return;
            state.weatherData = data;
            updateWeatherDisplay(data, weatherService);
        } catch (error) {
            console.error('Weather update failed:', error);
        }
    }, WEATHER_REFRESH_INTERVAL);
}

// ============= Start Application =============
init();
