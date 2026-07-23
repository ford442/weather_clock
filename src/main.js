import '@fontsource/inter/latin-200.css';
import '@fontsource/inter/latin-300.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-ext-200.css';
import '@fontsource/inter/latin-ext-300.css';
import '@fontsource/inter/latin-ext-400.css';
import '@fontsource/inter/latin-ext-500.css';
import '@fontsource/inter/latin-ext-700.css';

import './registerSW.js';

import Stats from 'three/addons/libs/stats.module.js';

import {
    setupRendering,
    setupRendererRecovery,
    getQualityTier,
    setQualityTier,
    applyQualityTier
} from './rendering.js';
import { setupLights } from './lights.js';
import {
    setupSky,
    setupSundial,
    setupMoon,
    setupWeatherEffects,
    setupGround,
    setupGroundEffects,
    addToScene
} from './scene-objects.js';
import { initMoonWebGPU } from './moonPhase.js';
import { getRequestedNativeKernels, initializeNativeRuntime } from './native/native-runtime.js';
import { WeatherService } from './weather.js';
import { AstronomyService } from './astronomy.js';
import {
    updateTimeDisplay,
    updateWeatherDisplay,
    updateUnitButton,
    updateQualityButton,
    setupEventListeners,
    setSearchLoading,
    drawSparkline,
    showToast,
    setupKeyboardShortcuts,
    setReducedMotionPreference,
    updateAirQualityDisplay,
    updateAlertBanner
} from './ui.js';
import { AnimationController } from './animation.js';
import { setupDebugAPI } from './debug.js';
import { AmbienceEngine } from './audio/AmbienceEngine.js';
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
    windUnit: 'weatherclock_wind_unit',
    ambienceMuted: 'weatherclock_ambience_muted'
};

// ── Bootstrap ────────────────────────────────────────────────────────────────
async function bootstrap() {
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    state.reducedMotion = reducedMotionQuery.matches;

    // Rendering — async because WebGPU path requires async init
    const { scene, camera, renderer, pipeline, clock, controls, isWebGPU } = await setupRendering();

    // Experimental SIMD kernels are opt-in until the benchmark clears the 2x gate.
    // A failed import/instantiation leaves the JS paths active.
    const nativeRuntime = await initializeNativeRuntime({ kernels: getRequestedNativeKernels(window.location.search) });
    window.__NATIVE_BACKEND__ = nativeRuntime.backend;
    window.__NATIVE_BACKENDS__ = nativeRuntime.backends;
    if (new URLSearchParams(window.location.search).get('nativeBenchmark') === '1') {
        const { runBrowserNativeBenchmarks } = await import('./native/browser-benchmark.js');
        window.runNativeBenchmarks = runBrowserNativeBenchmarks;
    }

    // Expose WebGPU status for debug / material factories
    window.__IS_WEBGPU__ = isWebGPU;

    // Lighting
    const quality = getQualityTier();
    const { ambientLight, sunLight, moonLight } = setupLights(scene, quality);

    // Scene Objects
    const sky = setupSky();
    const sundial = setupSundial();
    const { moonGroup } = setupMoon();
    const weatherEffects = await setupWeatherEffects(scene, sundial, camera, isWebGPU, renderer);
    if (isWebGPU) {
        await initMoonWebGPU(moonGroup);
    }
    const ground = setupGround(isWebGPU);
    const groundEffects = await setupGroundEffects(scene, ground, sundial, camera, renderer, isWebGPU);
    addToScene(scene, { sky, sundial, moonGroup, ground });

    // Services
    const weatherService = new WeatherService();
    const astronomyService = new AstronomyService();
    const ambienceEngine = new AmbienceEngine();

    const ambienceToggle = document.getElementById('ambience-toggle');
    const storedMuted = localStorage.getItem(PREF_KEYS.ambienceMuted);
    ambienceEngine.muted = storedMuted === null ? true : storedMuted === 'true';

    function updateAmbienceButton() {
        if (!ambienceToggle) return;
        const muted = ambienceEngine.muted;
        ambienceToggle.setAttribute('aria-pressed', String(!muted));
        ambienceToggle.title = muted ? 'Ambient sound (muted)' : 'Ambient sound (on)';
        ambienceToggle.classList.toggle('active', !muted);
    }
    updateAmbienceButton();

    if (ambienceToggle) {
        ambienceToggle.addEventListener('click', () => {
            ambienceEngine.ensureStarted();
            ambienceEngine.setMuted(!ambienceEngine.muted);
            localStorage.setItem(PREF_KEYS.ambienceMuted, String(ambienceEngine.muted));
            updateAmbienceButton();
        });
    }

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
            localStorage.setItem(PREF_KEYS.lat, String(weatherService.latitude));
            localStorage.setItem(PREF_KEYS.lon, String(weatherService.longitude));
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
    const scene3d = {
        scene,
        camera,
        renderer,
        pipeline,
        sky,
        sundial,
        moonGroup,
        weatherEffects,
        ground,
        groundEffects,
        sunLight,
        moonLight,
        ambientLight,
        controls
    };
    const animationController = new AnimationController(
        state,
        { weatherService, astronomyService, ambienceEngine },
        scene3d
    );
    setupRendererRecovery({ ...scene3d, isWebGPU }, animationController, { showToast });

    let qualityChangeInProgress = false;
    async function changeQuality(tier, { automatic = false, fps = 0 } = {}) {
        const current = getQualityTier();
        if (current === tier || qualityChangeInProgress) return;

        qualityChangeInProgress = true;
        animationController.stop();
        try {
            await applyQualityTier(tier, scene3d);
            setQualityTier(tier);
            updateQualityButton(tier);
            const reason = automatic ? ` after averaging ${fps} FPS` : '';
            showToast(`Quality changed to ${tier.toUpperCase()}${reason}.`, automatic ? 'warning' : 'success');
            animationController.start(clock, stats);
        } catch (error) {
            console.error('Live quality change failed; reloading as a fallback:', error);
            setQualityTier(tier);
            showToast(`Could not apply ${tier.toUpperCase()} quality live. Reloading scene...`, 'warning');
            setTimeout(() => window.location.reload(), 1500);
        } finally {
            qualityChangeInProgress = false;
        }
    }

    animationController.setQualityChangeHandler(changeQuality);
    let searchRequestId = 0;

    const offlineStatus = document.getElementById('offline-status');

    function updateOfflineStatus(isOffline, cachedAt = null) {
        if (!offlineStatus) return;
        if (isOffline && cachedAt) {
            const timeStr = new Date(cachedAt).toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit'
            });
            offlineStatus.textContent = `Offline — showing data from ${timeStr}`;
            offlineStatus.hidden = false;
            offlineStatus.classList.add('visible');
        } else if (isOffline) {
            offlineStatus.textContent = 'Offline';
            offlineStatus.hidden = false;
            offlineStatus.classList.add('visible');
        } else {
            offlineStatus.classList.remove('visible');
            offlineStatus.hidden = true;
        }
    }

    function showLatestOfflineStatus() {
        const cached = weatherService.latitude
            ? weatherService.getFromCache(
                  weatherService.getCacheKey(weatherService.latitude, weatherService.longitude),
                  true
              )
            : null;
        updateOfflineStatus(true, cached?.timestamp);
    }

    window.addEventListener('offline', showLatestOfflineStatus);
    window.addEventListener('online', () => updateOfflineStatus(false));

    /** Apply one weather payload consistently across state, UI, persistence, and forecast data. */
    async function applyWeatherData(data) {
        state.weatherData = data;
        groundEffects.setLatitude(weatherService.latitude);
        updateWeatherDisplay(data, weatherService);
        drawSparkline(state.simulationTime, data, weatherService);
        savePreferences();

        if (data?.isCached) {
            updateOfflineStatus(data.isOffline, data.cachedAt);
            if (data.isOffline) {
                showToast('Offline — showing cached data', 'info');
            } else {
                const timeStr = new Date(data.cachedAt).toLocaleTimeString([], {
                    hour: 'numeric',
                    minute: '2-digit'
                });
                showToast(`Showing cached weather from ${timeStr}`, 'info');
            }
        } else if (!navigator.onLine) {
            showLatestOfflineStatus();
        } else {
            updateOfflineStatus(false);
        }

        await loadDailyForecast();
        await loadAirQualityAndAlerts();
    }

    // Kiosk / wake-lock mode
    let wakeLock = null;
    const kioskToggle = document.getElementById('kiosk-toggle');
    if (kioskToggle) {
        const canWakeLock = 'wakeLock' in navigator;
        const canFullscreen = document.documentElement.requestFullscreen != null;
        if (canWakeLock || canFullscreen) {
            kioskToggle.hidden = false;
        }

        async function requestWakeLock() {
            if (!canWakeLock) return;
            try {
                wakeLock = await navigator.wakeLock.request('screen');
                wakeLock.addEventListener('release', () => {
                    if (wakeLock == null) kioskToggle.classList.remove('active');
                });
            } catch (error) {
                console.warn('Wake lock request failed:', error);
            }
        }

        async function releaseWakeLock() {
            if (wakeLock) {
                try {
                    await wakeLock.release();
                } catch (error) {
                    console.warn('Wake lock release failed:', error);
                }
                wakeLock = null;
            }
        }

        async function enterKiosk() {
            if (canFullscreen) {
                try {
                    await document.documentElement.requestFullscreen();
                } catch (error) {
                    console.warn('Fullscreen request failed:', error);
                }
            }
            await requestWakeLock();
            kioskToggle.classList.add('active');
            kioskToggle.setAttribute('aria-pressed', 'true');
            kioskToggle.title = 'Exit kiosk mode';
        }

        async function exitKiosk() {
            if (document.fullscreenElement && canFullscreen) {
                try {
                    await document.exitFullscreen();
                } catch (error) {
                    console.warn('Exit fullscreen failed:', error);
                }
            }
            await releaseWakeLock();
            kioskToggle.classList.remove('active');
            kioskToggle.setAttribute('aria-pressed', 'false');
            kioskToggle.title = 'Enter kiosk mode (fullscreen + keep screen on)';
        }

        kioskToggle.addEventListener('click', () => {
            const active = kioskToggle.classList.contains('active');
            if (active) {
                exitKiosk();
            } else {
                enterKiosk();
            }
        });

        document.addEventListener('visibilitychange', () => {
            if (!kioskToggle.classList.contains('active')) return;
            if (document.visibilityState === 'visible') {
                requestWakeLock();
            } else {
                releaseWakeLock();
            }
        });

        window.addEventListener('beforeunload', () => {
            releaseWakeLock();
        });
    }

    // UI Event Callbacks
    function setupUICallbacks() {
        return {
            onRetryLocation: async () => {
                document.getElementById('location').textContent = 'Retrying…';
                try {
                    await weatherService.getLocation();
                    const data = await weatherService.fetchWeather();
                    await applyWeatherData(data);
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

            onSetQuality: (tier) => changeQuality(tier),

            onSearch: async (query) => {
                if (!query) return;
                const requestId = ++searchRequestId;
                setSearchLoading(true);
                try {
                    const results = await weatherService.searchLocation(query);
                    if (requestId !== searchRequestId) return;
                    if (results && results.length > 0) {
                        const best = results[0];
                        const isUS = best.address?.country_code === 'us';
                        weatherService.setWindUnit(isUS ? 'imperial' : 'metric');
                        weatherService.setManualLocation(best.lat, best.lon, best.display_name.split(',')[0]);

                        document.getElementById('location').textContent = 'Updating…';
                        const data = await weatherService.fetchWeather();
                        if (requestId !== searchRequestId) return;
                        await applyWeatherData(data);

                        const searchInput = /** @type {HTMLInputElement|null} */ (
                            document.getElementById('location-search')
                        );
                        if (searchInput) searchInput.value = '';
                    } else {
                        showToast(`No results found for "${query}"`, 'error');
                    }
                } catch (error) {
                    if (error?.code === 'ABORTED') return;
                    console.error('Search failed:', error);
                    showToast(
                        error?.isOffline
                            ? 'Search unavailable while offline.'
                            : 'Search failed. Check your connection and try again.',
                        'error'
                    );
                } finally {
                    if (requestId === searchRequestId) setSearchLoading(false);
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
                    list.innerHTML =
                        '<div class="loading" style="padding: 10px 0; color: rgba(255,255,255,0.6); font-size: 13px;">Loading nearby regions…</div>';
                    try {
                        const regional = await weatherService.fetchRegionalWeather();
                        state.weatherData.regional = regional;

                        list.innerHTML = '';
                        const deg = weatherService.unit === 'metric' ? 'C' : 'F';
                        if (regional && regional.length > 0) {
                            regional.forEach((reg) => {
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
            }
        };
    }

    // Load air quality + severe-weather alerts and attach them to the weather data
    // object. Non-blocking and best-effort: air quality has no coverage everywhere,
    // and NWS alerts only cover the US, so a failure here just means the chips/banner
    // stay hidden rather than breaking the clock.
    async function loadAirQualityAndAlerts() {
        if (!weatherService.latitude || !weatherService.longitude) return;
        try {
            const [airQuality, alerts] = await Promise.all([
                weatherService.fetchAirQuality(),
                weatherService.fetchAlerts()
            ]);
            if (state.weatherData) {
                state.weatherData.airQuality = airQuality;
                state.weatherData.alerts = alerts;
            }
            updateAirQualityDisplay(airQuality);
            updateAlertBanner(alerts);
        } catch (error) {
            console.warn('Failed to load air quality / alerts:', error);
        }
    }

    // Load daily 10-day forecast and attach it to the weather data object.
    // This is intentionally non-blocking: a failure here should not break the clock.
    async function loadDailyForecast() {
        if (!weatherService.latitude || !weatherService.longitude) return;
        try {
            const daily = await weatherService.getDailyForecast(weatherService.latitude, weatherService.longitude, 10);
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
            await applyWeatherData(data);
        } catch (error) {
            console.error('Weather initialization failed:', error);
            document.getElementById('location').textContent = 'Weather data unavailable';
            document.getElementById('current-description').textContent = 'Unable to fetch';

            const isOffline = error?.isOffline || !navigator.onLine;
            if (isOffline) {
                showLatestOfflineStatus();
                showToast('Offline — no cached weather data available', 'error');
            } else {
                updateOfflineStatus(false);
                showToast('Failed to load weather data. Check your connection.', 'error');
            }
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

        modeController = new ModeController(scene, camera, controls, renderer, weatherService, state);

        animationController.setModeController(modeController);
        window.modeController = modeController;
        applyReducedMotionPreference(state.reducedMotion);

        reducedMotionQuery.addEventListener('change', (event) => {
            applyReducedMotionPreference(event.matches);
        });

        const callbacks = setupUICallbacks();
        setupEventListeners(callbacks, modeController);
        setupKeyboardShortcuts(callbacks);

        setupDebugAPI(
            state,
            { weatherService, astronomyService },
            {
                scene,
                sky,
                weatherEffects,
                sunLight,
                moonLight,
                ambientLight
            }
        );

        if (state.weatherData) {
            updateAtmosphereTheme(renderer, scene, state.weatherData);
        }

        animationController.start(clock, stats);

        if (!navigator.onLine) {
            showLatestOfflineStatus();
        }

        await fetchAndDisplayWeather();

        async function refreshWeather() {
            if (state.isDebugMode) return;
            try {
                const data = await weatherService.fetchWeather();
                if (state.isDebugMode) return;
                await applyWeatherData(data);
            } catch (error) {
                console.error('Weather update failed:', error);
                showToast(
                    error?.isOffline ? 'Offline — no cached weather data available' : 'Weather update failed.',
                    'error'
                );
            }
        }

        setInterval(async () => {
            await refreshWeather();
        }, WEATHER_REFRESH_INTERVAL);
    }

    await init();
}

bootstrap().catch((error) => {
    console.error('Application initialization failed:', error);
    showToast('Graphics initialization failed. Reload the page to try again.', 'error', 8000);
});
