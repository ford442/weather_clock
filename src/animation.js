// Animation loop and time management
import * as THREE from 'three';
import { updateMoonVisuals } from './moonPhase.js';
import { updateWeatherLighting } from './weatherLighting.js';
import { getWeatherAtTime, getActiveWeatherData } from './weather-simulation.js';
import {
    updateTimeDisplay,
    updateWeatherDisplay,
    updateSunriseSunset,
    updateWindCompass,
    updatePanelTheme,
    drawSparkline
} from './ui.js';

const ANIMATION_CONFIG = {
    realTimeScale: 1.0,
    warpTimeScale: 1440.0,        // 24 h in 60 s
    weatherUpdateThrottle: 0.1,   // 10 % chance per frame during time warp
    themeUpdateInterval: 500,     // ms between panel-theme updates
};

export class AnimationController {
    constructor(state, services, scene3d) {
        this.state = state;
        this.services = services;
        this.scene3d = scene3d;
        this.isRunning = false;

        // Throttle trackers
        this._lastThemeMs = 0;
        this._lastSparklineHour = -1;
        this._lastSunriseDay = -1; // track day to avoid per-frame DOM updates
    }

    /** Start the rAF loop */
    start(clock, stats) {
        if (this.isRunning) return;
        this.isRunning = true;

        const animate = () => {
            requestAnimationFrame(animate);
            stats.update();
            this.update(clock.getDelta());
        };

        animate();
    }

    /** Per-frame update */
    update(delta) {
        const { state, services, scene3d } = this;
        const { weatherService, astronomyService } = services;
        const {
            scene, composer, sky,
            sundial, moonGroup, weatherEffects,
            sunLight, moonLight, ambientLight,
            controls
        } = scene3d;

        // ── Advance simulation time ──
        const timeScale = state.isTimeWarping
            ? ANIMATION_CONFIG.warpTimeScale
            : ANIMATION_CONFIG.realTimeScale;
        state.simulationTime = new Date(state.simulationTime.getTime() + delta * 1000 * timeScale);

        // ── Orbit controls damping ──
        if (controls) controls.update();

        // ── Sundial ──
        sundial.update(state.simulationTime);

        // ── Astronomy ──
        const lat = weatherService.latitude;
        const lon = weatherService.longitude;
        const astroData = astronomyService.update(state.simulationTime, lat, lon, 20);

        sunLight.position.copy(astroData.sunPosition);
        moonGroup.position.copy(astroData.moonPosition);
        moonGroup.lookAt(0, 0, 0);
        moonLight.position.copy(astroData.moonPosition);

        if (astroData.sunPosition) {
            updateMoonVisuals(moonGroup, astroData.sunPosition);
        }

        // ── Time display ──
        updateTimeDisplay(state.simulationTime, state.isTimeWarping);

        // Update sunrise/sunset only when the day changes (not every frame)
        const simDay = state.simulationTime.getDate();
        if (simDay !== this._lastSunriseDay && astroData.sunrise && astroData.sunset) {
            updateSunriseSunset(astroData.sunrise, astroData.sunset);
            this._lastSunriseDay = simDay;
        }

        // Get active weather data
        const activeWeatherData = getActiveWeatherData(state.simulationTime, state.weatherData);

        if (activeWeatherData) {
            // Lighting
            if (astroData.sunPosition.lengthSq() > 0) {
                updateWeatherLighting(scene, sunLight, moonLight, ambientLight, sky, {
                    current: activeWeatherData.current,
                    past: activeWeatherData.past,
                    forecast: activeWeatherData.forecast
                }, astroData);
            }

            // Weather effects
            const empty = { weatherCode: 0, windSpeed: 0, windDirection: 0 };
            weatherEffects.update(
                activeWeatherData.past     || empty,
                activeWeatherData.current  || empty,
                activeWeatherData.forecast || empty,
                delta,
                ambientLight.color,
                sunLight.position,
                moonLight.position,
                sunLight.color,
                moonLight.color
            );

            // Wind compass (per-frame, lightweight DOM update)
            if (activeWeatherData.current?.windDirection != null) {
                updateWindCompass(activeWeatherData.current.windDirection);
            }

            // Throttled weather display update during time warp
            if (state.isTimeWarping && Math.random() < ANIMATION_CONFIG.weatherUpdateThrottle) {
                updateWeatherDisplay({
                    ...state.weatherData,
                    current: activeWeatherData.current,
                    past: activeWeatherData.past,
                    forecast: activeWeatherData.forecast
                }, weatherService);
            }

            // ── Panel theme (throttled: ~2 Hz) ──
            const nowMs = performance.now();
            if (nowMs - this._lastThemeMs > ANIMATION_CONFIG.themeUpdateInterval) {
                this._lastThemeMs = nowMs;

                // dayFactor: normalised sin of sun altitude (-1 night … +1 noon)
                const dayFactor = astroData.sunPosition.y / 20;
                const weatherSeverity = activeWeatherData.current?.severity ?? 0;

                // tempTrend: how much warmer/cooler today is vs the same date last year
                // clamped to ±1 over a 10 °C swing
                const histTemp = state.weatherData?.historicalYearAgo?.temp;
                const currTemp = activeWeatherData.current?.temp;
                const tempTrend = (histTemp != null && currTemp != null)
                    ? Math.max(-1, Math.min(1, (currTemp - histTemp) / 10))
                    : 0;

                updatePanelTheme(dayFactor, weatherSeverity, tempTrend);
            }

            // ── Sparkline — redraw when the simulation hour rolls over ──
            const simHour = Math.floor(state.simulationTime.getTime() / 3_600_000);
            if (simHour !== this._lastSparklineHour && state.weatherData) {
                this._lastSparklineHour = simHour;
                drawSparkline(state.simulationTime, state.weatherData, weatherService);
            }

        } else {
            // No data — still run effects at idle
            const empty = { weatherCode: 0, windSpeed: 0, windDirection: 0 };
            weatherEffects.update(empty, empty, empty, delta, ambientLight.color);
        }

        // ── Lightning flash ──
        if (weatherEffects.getLightningFlash?.() > 0) {
            const flash = weatherEffects.getLightningFlash();
            ambientLight.intensity += flash;

            const flashColor = new THREE.Color(0xaaddff);
            ambientLight.color.lerp(flashColor, Math.min(1.0, flash * 0.8));

            if (scene.fog) {
                scene.fog.color.copy(ambientLight.color).multiplyScalar(0.8);
            }
        }

        composer.render();
    }

    stop() {
        this.isRunning = false;
    }
}

export { ANIMATION_CONFIG };
