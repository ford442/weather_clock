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
    setSearchLoading,
    updateSunriseSunset,
    showToast,
    setupKeyboardShortcuts
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

// ============= Preferences (localStorage) =============
const PREF_KEYS = {
    lat: 'weatherclock_lat',
    lon: 'weatherclock_lon',
    location: 'weatherclock_location',
    unit: 'weatherclock_unit',
    windUnit: 'weatherclock_wind_unit'
};

function loadPreferences() {
    const lat = localStorage.getItem(PREF_KEYS.lat);
    const lon = localStorage.getItem(PREF_KEYS.lon);
    const location = localStorage.getItem(PREF_KEYS.location);
    const unit = localStorage.getItem(PREF_KEYS.unit);
    const windUnit = localStorage.getItem(PREF_KEYS.windUnit);

    if (lat && lon && location) {
        weatherService.setManualLocation(lat, lon, location);
    }
    if (unit) {
        weatherService.unit = unit;
    }
    if (windUnit) {
        weatherService.windUnit = windUnit;
    }
    return !!(lat && lon);
}

function savePreferences() {
    if (weatherService.latitude) {
        localStorage.setItem(PREF_KEYS.lat, weatherService.latitude);
        localStorage.setItem(PREF_KEYS.lon, weatherService.longitude);
        localStorage.setItem(PREF_KEYS.location, weatherService.location);
    }
    localStorage.setItem(PREF_KEYS.unit, weatherService.unit);
    localStorage.setItem(PREF_KEYS.windUnit, weatherService.windUnit);
}

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
                savePreferences();
            } catch (error) {
                console.error('Location retry failed:', error);
                document.getElementById('location').textContent = 'Location unavailable';
                showToast('Could not detect location. Try searching for a city.', 'error');
            }
        },

        onToggleUnit: () => {
            weatherService.toggleUnit();
            updateUnitButton(weatherService);
            if (state.weatherData) {
                updateWeatherDisplay(state.weatherData, weatherService);
            }
            savePreferences();
        },

        onSearch: async (query) => {
            if (!query) return;

            setSearchLoading(true);
            try {
                const results = await weatherService.searchLocation(query);
                if (results && results.length > 0) {
                    const best = results[0];
                    // Detect wind unit from country code
                    const isUS = best.address?.country_code === 'us';
                    weatherService.setWindUnit(isUS ? 'imperial' : 'metric');
                    weatherService.setManualLocation(
                        best.lat,
                        best.lon,
                        best.display_name.split(',')[0]
                    );

                    document.getElementById('location').textContent = 'Updating...';
                    const data = await weatherService.fetchWeather();
                    state.weatherData = data;
                    updateWeatherDisplay(data, weatherService);
                    savePreferences();

                    // Clear search input
                    const searchInput = document.getElementById('location-search');
                    if (searchInput) searchInput.value = '';
                } else {
                    showToast(`No results found for "${query}"`, 'error');
                }
            } catch (error) {
                console.error('Search failed:', error);
                showToast('Search failed. Check your connection and try again.', 'error');
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
        // Try to restore saved location; fall back to geolocation if none saved
        const hadSavedLocation = loadPreferences();
        updateUnitButton(weatherService);

        let data;
        if (hadSavedLocation) {
            data = await weatherService.fetchWeather();
        } else {
            data = await weatherService.initialize();
            savePreferences();
        }

        if (state.isDebugMode) return;
        state.weatherData = data;
        updateWeatherDisplay(data, weatherService);
    } catch (error) {
        console.error('Weather initialization failed:', error);
        document.getElementById('location').textContent = 'Weather data unavailable';
        document.getElementById('current-description').textContent = 'Unable to fetch';
        showToast('Failed to load weather data. Check your connection.', 'error');
    }
}

// ============= Initialize Application =============
async function init() {
    // Update initial UI state
    updateTimeDisplay(state.simulationTime, state.isTimeWarping);
    updateUnitButton(weatherService);

    // Setup event listeners and keyboard shortcuts
    const callbacks = setupUICallbacks();
    setupEventListeners(callbacks);
    setupKeyboardShortcuts(callbacks);

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
