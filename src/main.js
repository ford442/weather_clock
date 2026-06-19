import * as THREE from 'three';
import Stats from 'three/addons/libs/stats.module.js';

import { setupRendering, getQualityTier, setQualityTier } from './rendering.js';
import { setupLights } from './lights.js';
import { setupSky, setupSundial, setupMoon, setupWeatherEffects, addToScene } from './scene-objects.js';
import { initMoonWebGPU } from './moonPhase.js';
import { WeatherService } from './weather.js';
import { AstronomyService } from './astronomy.js';
import {
    updateTimeDisplay,
    updateWeatherDisplay,
    updateUnitButton,
    updateQualityButton,
    setupEventListeners,
    updateTimelineScrubber,
    setSearchLoading,
    drawSparkline,
    updateSunriseSunset,
    showToast,
    setupKeyboardShortcuts,
    setReducedMotionPreference
} from './ui.js';
import { AnimationController } from './animation.js';
import { setupDebugAPI } from './debug.js';
import { ModeController } from './ModeController.js';
import { updateAtmosphereTheme } from './atmosphereTheme.js';

// ── Application State ────────────────────────────────────────────────────────
const state = {
    weatherData: null,
    simulationTime: new Date(),
    isTimeWarping: false,
    isDebugMode: false,
    timeSpeed: 60,
    reducedMotion: false
};

// ── Mode Controller (Clock/Timeline) ─────────────────────────────────────────
let modeController = null;

const WEATHER_REFRESH_INTERVAL = 10 * 60 * 1000; // 10 min

// ── Preferences (localStorage) ───────────────────────────────────────────────
const PREF_KEYS = {
    lat: 'weatherclock_lat',
    lon: 'weatherclock_lon',
    location: 'weatherclock_location',
    unit: 'weatherclock_unit',
    windUnit: 'weatherclock_wind_unit'
};

// ── Bootstrap ────────────────────────────────────────────────────────────────
async function bootstrap() {
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    state.reducedMotion = reducedMotionQuery.matches;

    // Rendering — async because WebGPU path requires async init
    const { scene, camera, renderer, pipeline, clock, controls, isWebGPU } = await setupRendering();

    // Expose WebGPU status for debug / material factories
    window.__IS_WEBGPU__ = isWebGPU;

    // Lighting
    const quality = getQualityTier();
    const { ambientLight, sunLight, moonLight } = setupLights(scene, quality);

    // Scene Objects
    const sky = setupSky();
    const sundial = setupSundial();
    const { moonGroup } = setupMoon();
    const weatherEffects = await setupWeatherEffects(scene, sundial, camera, isWebGPU);
    if (isWebGPU) {
        await initMoonWebGPU(moonGroup);
    }
    addToScene(scene, { sky, sundial, moonGroup });

    // Services
    const weatherService = new WeatherService();
    const astronomyService = new AstronomyService();

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

    // Stats (hidden by default; backtick ` toggles)
    const stats = new Stats();
    stats.dom.style.display = 'none';
    if (document.body) {
        document.body.appendChild(stats.dom);
    }

    const qualityLabel = document.createElement('div');
    qualityLabel.id = 'quality-stats-badge';
    qualityLabel.style.position = 'absolute';
    qualityLabel.style.left = '80px';
    qualityLabel.style.top = '0px';
    qualityLabel.style.background = 'rgba(0, 0, 0, 0.7)';
    qualityLabel.style.color = '#00ffcc';
    qualityLabel.style.fontFamily = 'monospace';
    qualityLabel.style.fontSize = '9px';
    qualityLabel.style.padding = '4px 8px';
    qualityLabel.style.borderRadius = '3px';
    qualityLabel.style.zIndex = '10001';
    qualityLabel.style.display = 'none';
    qualityLabel.style.pointerEvents = 'none';
    qualityLabel.textContent = `TIER: ${quality.toUpperCase()}`;
    if (document.body) {
        document.body.appendChild(qualityLabel);
    }

    window.addEventListener('keydown', (e) => {
        if (e.key === '`') {
            const isHidden = stats.dom.style.display === 'none';
            stats.dom.style.display = isHidden ? 'block' : 'none';
            qualityLabel.style.display = isHidden ? 'block' : 'none';
        }
    });

    // Animation loop
    const animationController = new AnimationController(
        state,
        { weatherService, astronomyService },
        { scene, camera, renderer, pipeline, sky, sundial, moonGroup, weatherEffects, sunLight, moonLight, ambientLight, controls }
    );

    // UI Event Callbacks
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
                    savePreferences();
                    await loadDailyForecast();

                    if (data && data.isCached) {
                        const timeStr = new Date(data.cachedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                        showToast(`Showing cached weather from ${timeStr}`, 'info');
                    }
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
                    drawSparkline(state.simulationTime, state.weatherData, weatherService);
                }
                savePreferences();
            },

            onSetQuality: (tier) => {
                const current = getQualityTier();
                if (current === tier) return;
                setQualityTier(tier);
                updateQualityButton(tier);
                showToast(`Quality set to ${tier.toUpperCase()}. Reloading scene...`, 'info');
                setTimeout(() => {
                    window.location.reload();
                }, 1500);
            },

            onSearch: async (query) => {
                if (!query) return;
                setSearchLoading(true);
                try {
                    const results = await weatherService.searchLocation(query);
                    if (results && results.length > 0) {
                        const best = results[0];
                        const isUS = best.address?.country_code === 'us';
                        weatherService.setWindUnit(isUS ? 'imperial' : 'metric');
                        weatherService.setManualLocation(
                            best.lat,
                            best.lon,
                            best.display_name.split(',')[0]
                        );

                        document.getElementById('location').textContent = 'Updating…';
                        const data = await weatherService.fetchWeather();
                        state.weatherData = data;
                        updateWeatherDisplay(data, weatherService);
                        drawSparkline(state.simulationTime, data, weatherService);
                        savePreferences();
                        await loadDailyForecast();

                        const searchInput = document.getElementById('location-search');
                        if (searchInput) searchInput.value = '';

                        if (data && data.isCached) {
                            const timeStr = new Date(data.cachedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                            showToast(`Showing cached weather from ${timeStr}`, 'info');
                        }
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
                if (state.reducedMotion && !state.isTimeWarping) {
                    showToast('Time warp is disabled while reduced motion is enabled.', 'info', 2500);
                    return;
                }
                state.isTimeWarping = !state.isTimeWarping;
                document.body.classList.toggle('time-warping', state.isTimeWarping);
            },

            onScrub: (dayFraction) => {
                const startOfDay = new Date(state.simulationTime);
                startOfDay.setHours(0, 0, 0, 0);
                state.simulationTime = new Date(startOfDay.getTime() + dayFraction * 86400000);
            },

            onCycleSpeed: () => {
                const speeds = [1, 10, 60];
                const idx = speeds.indexOf(state.timeSpeed);
                state.timeSpeed = speeds[(idx + 1) % speeds.length];
            },

            onPause: () => {
                if (state.isTimeWarping) {
                    state.isTimeWarping = false;
                    document.body.classList.toggle('time-warping', false);
                }
            },

            onLoadNearby: async () => {
                const list = document.getElementById('regional-list');
                if (!list) return;

                if (state.weatherData && !state.weatherData.regional) {
                    list.innerHTML = '<div class="loading" style="padding: 10px 0; color: rgba(255,255,255,0.6); font-size: 13px;">Loading nearby regions…</div>';
                    try {
                        const regional = await weatherService.fetchRegionalWeather();
                        state.weatherData.regional = regional;

                        list.innerHTML = '';
                        const deg = weatherService.unit === 'metric' ? 'C' : 'F';
                        if (regional && regional.length > 0) {
                            regional.forEach(reg => {
                                const div = document.createElement('div');
                                const tempVal = weatherService.convertTemp(reg.temp);
                                div.innerHTML = `<b>${reg.name}:</b> ${tempVal.toFixed(1)}°${deg}`;
                                list.appendChild(div);
                            });
                        } else {
                            list.textContent = 'No regional data available';
                        }
                    } catch (e) {
                        console.error('Failed to load regional weather:', e);
                        list.textContent = 'Failed to load regional data';
                    }
                }
            },

            onSetQuality: (tier) => {
                setQualityTier(tier);
                showToast(`Quality set to ${tier.toUpperCase()}. Reloading page...`, 'success', 3000);
                setTimeout(() => {
                    window.location.reload();
                }, 1500);
            }
        };
    }

    // Load daily 10-day forecast and attach it to the weather data object.
    // This is intentionally non-blocking: a failure here should not break the clock.
    async function loadDailyForecast() {
        if (!weatherService.latitude || !weatherService.longitude) return;
        try {
            const daily = await weatherService.getDailyForecast(
                weatherService.latitude,
                weatherService.longitude,
                10
            );
            if (state.weatherData) {
                state.weatherData.dailyForecast = daily;
            }
        } catch (error) {
            console.warn('Failed to load daily forecast:', error);
        }
    }

    // Weather fetch
    async function fetchAndDisplayWeather() {
        if (state.isDebugMode) return;

        document.getElementById('location').textContent = 'Loading…';
        try {
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
            drawSparkline(state.simulationTime, data, weatherService);

            // Load 10-day daily forecast in the background
            await loadDailyForecast();

            if (data && data.isCached) {
                const timeStr = new Date(data.cachedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                showToast(`Showing cached weather from ${timeStr}`, 'info');
            }
        } catch (error) {
            console.error('Weather initialization failed:', error);
            document.getElementById('location').textContent = 'Weather data unavailable';
            document.getElementById('current-description').textContent = 'Unable to fetch';
            showToast('Failed to load weather data. Check your connection.', 'error');
        }
    }

    // Init
    async function init() {
        const applyReducedMotionPreference = (isReduced) => {
            state.reducedMotion = isReduced;
            document.body.classList.toggle('reduced-motion', isReduced);
            setReducedMotionPreference(isReduced);
            if (isReduced && state.isTimeWarping) {
                state.isTimeWarping = false;
                document.body.classList.toggle('time-warping', false);
            }
            weatherEffects.setReducedMotion?.(isReduced);
            modeController?.setReducedMotion?.(isReduced);
        };

        updateTimeDisplay(state.simulationTime, state.isTimeWarping);
        updateUnitButton(weatherService);
        updateQualityButton(getQualityTier());

        modeController = new ModeController(
            scene,
            camera,
            controls,
            renderer,
            weatherService,
            state
        );
        
        animationController.setModeController(modeController);
        window.modeController = modeController;
        applyReducedMotionPreference(state.reducedMotion);

        reducedMotionQuery.addEventListener('change', (event) => {
            applyReducedMotionPreference(event.matches);
        });

        const callbacks = setupUICallbacks();
        setupEventListeners(callbacks, modeController);
        setupKeyboardShortcuts(callbacks);

        setupDebugAPI(state, { weatherService, astronomyService }, {
            scene, sky, weatherEffects, sunLight, moonLight, ambientLight
        });

        if (state.weatherData) {
            updateAtmosphereTheme(renderer, scene, state.weatherData);
        }

        animationController.start(clock, stats);

        await fetchAndDisplayWeather();

        async function refreshWeatherWithBackoff(retryCount = 0, delay = 2000) {
            if (state.isDebugMode) return;
            try {
                const data = await weatherService.fetchWeather();
                if (state.isDebugMode) return;
                state.weatherData = data;
                updateWeatherDisplay(data, weatherService);
                drawSparkline(state.simulationTime, state.weatherData, weatherService);

                if (data && data.isCached) {
                    const timeStr = new Date(data.cachedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                    showToast(`Showing cached weather from ${timeStr}`, 'info');

                    if (retryCount < 3) {
                        console.warn(`Fetch returned cached data. Retrying network fetch in ${delay}ms (attempt ${retryCount + 1}/3)...`);
                        setTimeout(() => {
                            refreshWeatherWithBackoff(retryCount + 1, delay * 2);
                        }, delay);
                    }
                }
            } catch (error) {
                console.error('Weather update failed:', error);
                if (retryCount < 3) {
                    console.warn(`Weather update failed. Retrying network fetch in ${delay}ms (attempt ${retryCount + 1}/3)...`);
                    setTimeout(() => {
                        refreshWeatherWithBackoff(retryCount + 1, delay * 2);
                    }, delay);
                }
            }
        }

        setInterval(async () => {
            await refreshWeatherWithBackoff();
        }, WEATHER_REFRESH_INTERVAL);
    }

    await init();
}

bootstrap();
