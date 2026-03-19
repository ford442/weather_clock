import * as THREE from 'three';
import Stats from 'three/addons/libs/stats.module.js';

import { setupRendering } from './rendering.js';
import { setupLights } from './lights.js';
import { setupSky, setupSundial, setupMoon, setupWeatherEffects, addToScene } from './scene-objects.js';
import { WeatherService } from './weather.js';
import { AstronomyService } from './astronomy.js';
import {
    updateTimeDisplay,
    updateWeatherDisplay,
    updateUnitButton,
    setupEventListeners,
    updateTimeWarpButton,
    setSearchLoading,
    drawSparkline
} from './ui.js';
import { AnimationController } from './animation.js';
import { setupDebugAPI } from './debug.js';

// ── Application State ────────────────────────────────────────────────────────
const state = {
    weatherData: null,
    simulationTime: new Date(),
    isTimeWarping: false,
    isDebugMode: false
};

const WEATHER_REFRESH_INTERVAL = 10 * 60 * 1000; // 10 min

// ── Rendering ────────────────────────────────────────────────────────────────
const { scene, camera, renderer, composer, clock, controls } = setupRendering();

// ── Lighting ─────────────────────────────────────────────────────────────────
const { ambientLight, sunLight, moonLight } = setupLights(scene);

// ── Scene Objects ────────────────────────────────────────────────────────────
const sky = setupSky();
const sundial = setupSundial();
const { moonGroup } = setupMoon();
const weatherEffects = setupWeatherEffects(scene, sundial, camera);
addToScene(scene, { sky, sundial, moonGroup });

// ── Services ─────────────────────────────────────────────────────────────────
const weatherService = new WeatherService();
const astronomyService = new AstronomyService();

// ── Stats (hidden by default; backtick ` toggles) ────────────────────────────
const stats = new Stats();
stats.dom.style.display = 'none';
document.body.appendChild(stats.dom);

window.addEventListener('keydown', (e) => {
    if (e.key === '`') {
        stats.dom.style.display = stats.dom.style.display === 'none' ? 'block' : 'none';
    }
});

// ── Animation loop ────────────────────────────────────────────────────────────
const animationController = new AnimationController(
    state,
    { weatherService, astronomyService },
    { scene, camera, composer, sky, sundial, moonGroup, weatherEffects, sunLight, moonLight, ambientLight, controls }
);

// ── UI Event Callbacks ────────────────────────────────────────────────────────
function setupUICallbacks() {
    return {
        onRetryLocation: async () => {
            document.getElementById('location').textContent = 'Retrying…';
            try {
                await weatherService.getLocation();
                const data = await weatherService.fetchWeather();
                state.weatherData = data;
                updateWeatherDisplay(data, weatherService);
                drawSparkline(state.simulationTime, data, weatherService);
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
                drawSparkline(state.simulationTime, state.weatherData, weatherService);
            }
        },

        onSearch: async (query) => {
            if (!query) return;
            setSearchLoading(true);
            try {
                const results = await weatherService.searchLocation(query);
                if (results && results.length > 0) {
                    const best = results[0];
                    weatherService.setManualLocation(best.lat, best.lon, best.display_name.split(',')[0]);

                    document.getElementById('location').textContent = 'Updating…';
                    const data = await weatherService.fetchWeather();
                    state.weatherData = data;
                    updateWeatherDisplay(data, weatherService);
                    drawSparkline(state.simulationTime, data, weatherService);

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

// ── Weather fetch ─────────────────────────────────────────────────────────────
async function fetchAndDisplayWeather() {
    if (state.isDebugMode) return;

    document.getElementById('location').textContent = 'Loading…';
    try {
        const data = await weatherService.initialize();
        if (state.isDebugMode) return;
        state.weatherData = data;
        updateWeatherDisplay(data, weatherService);
        drawSparkline(state.simulationTime, data, weatherService);
    } catch (error) {
        console.error('Weather initialization failed:', error);
        document.getElementById('location').textContent = 'Weather data unavailable';
        document.getElementById('current-description').textContent = 'Unable to fetch';
    }
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
    updateTimeDisplay(state.simulationTime, state.isTimeWarping);
    updateUnitButton(weatherService);

    const callbacks = setupUICallbacks();
    setupEventListeners(callbacks);

    setupDebugAPI(state, { weatherService, astronomyService }, {
        scene, sky, weatherEffects, sunLight, moonLight, ambientLight
    });

    animationController.start(clock, stats);

    await fetchAndDisplayWeather();

    setInterval(async () => {
        if (state.isDebugMode) return;
        try {
            const data = await weatherService.fetchWeather();
            if (state.isDebugMode) return;
            state.weatherData = data;
            updateWeatherDisplay(data, weatherService);
            drawSparkline(state.simulationTime, data, weatherService);
        } catch (error) {
            console.error('Weather update failed:', error);
        }
    }, WEATHER_REFRESH_INTERVAL);
}

init();
