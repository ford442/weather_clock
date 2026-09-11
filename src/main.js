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
    updateAlertBanner,
    updateHealthPanel
} from './ui.js';
import { t, formatTime, formatTemp } from './i18n/strings.js';
import { AnimationController } from './animation.js';
import { setupDebugAPI } from './debug.js';
import { setupCapture } from './capture/index.js';
import { AmbienceEngine } from './audio/AmbienceEngine.js';
import { ModeController } from './ModeController.js';
import { updateAtmosphereTheme } from './atmosphereTheme.js';

// ── Application State ────────────────────────────────────────────────────────
/** @type {AppState} */
const state = {
    weatherData: null,
    simulationTime: new Date(),
    isTimeWarping: false,
    isDebugMode: false,
    timeSpeed: 60,
    reducedMotion: false
};

// ── Mode Controller (Clock/Timeline) ─────────────────────────────────────────
/** @type {import('./ModeController.js').ModeController|null} */
let modeController = null;

const WEATHER_REFRESH_INTERVAL = 10 * 60 * 1000; // 10 min

// ── Preferences (localStorage) ───────────────────────────────────────────────
const PREF_KEYS = {
    lat: 'weatherclock_lat',
    lon: 'weatherclock_lon',
    location: 'weatherclock_location',
    unit: 'weatherclock_unit',
    windUnit: 'weatherclock_wind_unit',
    ambienceMuted: 'weatherclock_ambience_muted',
    nightSky: 'weatherclock_night_sky'
};

/**
 * Night-sky overlay levels, cycled with `C`. Stars themselves are always on —
 * this only controls how much extra scaffolding is drawn over them.
 * @type {readonly {constellations: boolean, labels: boolean, toast: 'nightSkyOff'|'nightSkyLines'|'nightSkyLabels'}[]}
 */
const NIGHT_SKY_LEVELS = Object.freeze([
    { constellations: false, labels: false, toast: 'nightSkyOff' },
    { constellations: true, labels: false, toast: 'nightSkyLines' },
    { constellations: true, labels: true, toast: 'nightSkyLabels' }
]);

// localStorage can throw (quota exceeded, private browsing, blocked storage)
// on either the origin's own weather cache or another app sharing the
// origin's quota. Preference persistence should never break the weather
// display over that, so every access goes through these safe wrappers.
function readPref(key) {
    try {
        return localStorage.getItem(key);
    } catch (e) {
        console.warn(`Failed to read preference "${key}":`, e);
        return null;
    }
}

function writePref(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (e) {
        console.warn(`Failed to save preference "${key}":`, e);
    }
}

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
    const storedMuted = readPref(PREF_KEYS.ambienceMuted);
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
            writePref(PREF_KEYS.ambienceMuted, String(ambienceEngine.muted));
            updateAmbienceButton();
        });
    }

    function loadPreferences() {
        const lat = readPref(PREF_KEYS.lat);
        const lon = readPref(PREF_KEYS.lon);
        const location = readPref(PREF_KEYS.location);
        const unit = readPref(PREF_KEYS.unit);
        const windUnit = readPref(PREF_KEYS.windUnit);

        if (lat && lon && location) {
            weatherService.setManualLocation(lat, lon, location);
        }
        if (unit === 'metric' || unit === 'imperial') {
            weatherService.unit = unit;
        }
        if (windUnit === 'metric' || windUnit === 'imperial') {
            weatherService.windUnit = windUnit;
        }
        return !!(lat && lon);
    }

    function savePreferences() {
        if (weatherService.latitude) {
            writePref(PREF_KEYS.lat, String(weatherService.latitude));
            writePref(PREF_KEYS.lon, String(weatherService.longitude));
            writePref(PREF_KEYS.location, weatherService.location);
        }
        writePref(PREF_KEYS.unit, weatherService.unit);
        writePref(PREF_KEYS.windUnit, weatherService.windUnit);
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
            showToast(t('qualityChanged', tier.toUpperCase(), reason), automatic ? 'warning' : 'success');
            animationController.start(clock, stats);
        } catch (error) {
            console.error('Live quality change failed; reloading as a fallback:', error);
            setQualityTier(tier);
            showToast(t('qualityChangeFailed', tier.toUpperCase()), 'warning');
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
            const timeStr = formatTime(new Date(cachedAt));
            offlineStatus.textContent = t('offlineWithTime', timeStr);
            offlineStatus.hidden = false;
            offlineStatus.classList.add('visible');
        } else if (isOffline) {
            offlineStatus.textContent = t('offline');
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
                showToast(t('offlineCachedData'), 'info');
            } else {
                const timeStr = formatTime(new Date(data.cachedAt));
                showToast(t('offlineCachedWeatherAt', timeStr), 'info');
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
    /** @type {WakeLockSentinel|null} */
    let wakeLock = null;
    const kioskToggle = document.getElementById('kiosk-toggle');
    if (kioskToggle) {
        // Function declarations below are hoisted, so TS can't see they're only
        // ever invoked from within this `if (kioskToggle)` guard — rebind to a
        // local so it type-narrows to non-null inside them too.
        const toggle = kioskToggle;
        const canWakeLock = 'wakeLock' in navigator;
        const canFullscreen = document.documentElement.requestFullscreen != null;
        if (canWakeLock || canFullscreen) {
            toggle.hidden = false;
        }

        async function requestWakeLock() {
            if (!canWakeLock) return;
            try {
                wakeLock = await navigator.wakeLock.request('screen');
                wakeLock.addEventListener('release', () => {
                    if (wakeLock == null) toggle.classList.remove('active');
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
            toggle.classList.add('active');
            toggle.setAttribute('aria-pressed', 'true');
            toggle.title = 'Exit kiosk mode';
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
            toggle.classList.remove('active');
            toggle.setAttribute('aria-pressed', 'false');
            toggle.title = 'Enter kiosk mode (fullscreen + keep screen on)';
        }

        toggle.addEventListener('click', () => {
            const active = toggle.classList.contains('active');
            if (active) {
                exitKiosk();
            } else {
                enterKiosk();
            }
        });

        document.addEventListener('visibilitychange', () => {
            if (!toggle.classList.contains('active')) return;
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
    // Night sky overlays: stars and planets always render, the constellation
    // scaffolding is opt-in so the sky does not get cluttered.
    let nightSkyLevel = (() => {
        const saved = readPref(PREF_KEYS.nightSky);
        if (saved === null) return 1;
        const level = Number(saved);
        return Number.isInteger(level) && level >= 0 && level < NIGHT_SKY_LEVELS.length ? level : 1;
    })();

    function applyNightSkyLevel() {
        const level = NIGHT_SKY_LEVELS[nightSkyLevel];
        weatherEffects.setSkyLayers?.({
            constellations: level.constellations,
            labels: level.labels,
            planets: true
        });
    }

    function setupUICallbacks() {
        return {
            onRetryLocation: async () => {
                const locationEl = document.getElementById('location');
                if (locationEl) locationEl.textContent = 'Retrying…';
                try {
                    await weatherService.getLocation();
                    const data = await weatherService.fetchWeather();
                    await applyWeatherData(data);
                } catch (error) {
                    console.error('Location retry failed:', error);
                    if (locationEl) locationEl.textContent = 'Location unavailable';
                    showToast(t('locationNotDetected'), 'error');
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

            onCycleNightSky: () => {
                nightSkyLevel = (nightSkyLevel + 1) % NIGHT_SKY_LEVELS.length;
                applyNightSkyLevel();
                writePref(PREF_KEYS.nightSky, String(nightSkyLevel));
                showToast(t(NIGHT_SKY_LEVELS[nightSkyLevel].toast));
            },

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
                        weatherService.countryCode = best.address?.country_code ?? null;
                        weatherService.setWindUnit(isUS ? 'imperial' : 'metric');
                        weatherService.setManualLocation(best.lat, best.lon, best.display_name.split(',')[0]);

                        const locationEl = document.getElementById('location');
                        if (locationEl) locationEl.textContent = 'Updating…';
                        const data = await weatherService.fetchWeather();
                        if (requestId !== searchRequestId) return;
                        await applyWeatherData(data);

                        const searchInput = /** @type {HTMLInputElement|null} */ (
                            document.getElementById('location-search')
                        );
                        if (searchInput) searchInput.value = '';
                    } else {
                        showToast(t('noResultsFor', query), 'error');
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
                    showToast(t('timeWarpDisabledReducedMotion'), 'info', 2500);
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

                const weatherData = state.weatherData;
                if (weatherData && !weatherData.regional) {
                    list.innerHTML =
                        '<div class="loading" style="padding: 10px 0; color: rgba(255,255,255,0.6); font-size: 13px;">Loading nearby regions…</div>';
                    try {
                        const regional = await weatherService.fetchRegionalWeather();
                        weatherData.regional = regional;

                        list.innerHTML = '';
                        const deg = weatherService.unit === 'metric' ? 'C' : 'F';
                        if (regional && regional.length > 0) {
                            regional.forEach((reg) => {
                                const div = document.createElement('div');
                                const tempVal = weatherService.convertTemp(reg.temp);
                                div.innerHTML = `<b>${reg.name}:</b> ${formatTemp(tempVal, deg, { maximumFractionDigits: 1 })}`;
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
            updateAirQualityDisplay(airQuality, weatherService.countryCode);
            updateHealthPanel(airQuality, state.weatherData?.current?.uvIndex, weatherService.countryCode);
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

        const locationEl = document.getElementById('location');
        if (locationEl) locationEl.textContent = 'Loading…';
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
            if (locationEl) locationEl.textContent = 'Weather data unavailable';
            const descEl = document.getElementById('current-description');
            if (descEl) descEl.textContent = 'Unable to fetch';

            const isOffline = error?.isOffline || !navigator.onLine;
            if (isOffline) {
                showLatestOfflineStatus();
                showToast(t('offlineNoCachedData'), 'error');
            } else {
                updateOfflineStatus(false);
                showToast(t('weatherLoadFailed'), 'error');
            }
        }
    }

    // Init
    async function init() {
        /** @type {ReturnType<typeof setupCapture>|null} */
        let capture = null;
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
            capture?.setReducedMotion(isReduced);
            ambienceEngine.setReducedMotion(isReduced);
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

        applyNightSkyLevel();

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
                ambientLight,
                ambienceEngine
            }
        );

        // Photo mode + time-lapse export (buttons wire themselves; shortcuts
        // go through the shared callbacks object).
        capture = setupCapture({
            state,
            renderer,
            pipeline,
            animationController,
            modeController,
            showToast
        });
        callbacks.onCapturePhoto = capture.capturePhoto;
        callbacks.onToggleTimelapse = capture.toggleTimelapse;
        capture.setReducedMotion(state.reducedMotion);

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
                showToast(error?.isOffline ? t('offlineNoCachedData') : 'Weather update failed.', 'error');
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
    showToast(t('graphicsInitFailed'), 'error', 8000);
});
