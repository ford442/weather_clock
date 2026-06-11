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
    drawSparkline,
    updateTimelineScrubber,
    showToast
} from './ui.js';
import { updateAtmosphereTheme } from './atmosphereTheme.js';
import { getQualityTier, setQualityTier } from './rendering.js';

const ANIMATION_CONFIG = {
    realTimeScale: 1.0,
    warpTimeScale: 1440.0,        // 24 h in 60 s
    weatherUpdateThrottle: 0.1,   // 10 % chance per frame during time warp
    themeUpdateInterval: 500,     // ms between panel-theme updates
    reducedMotionParticleFrameInterval: 3,
};

export class AnimationController {
    constructor(state, services, scene3d) {
        this.state = state;
        this.services = services;
        this.scene3d = scene3d;
        this.isRunning = false;
        this.modeController = null; // Set by main.js after initialization
        this.rafId = null;
        this.clock = null;
        this.stats = null;
        this._visibilityBound = false;
        this._reducedMotionFrameCount = 0;
        this._reducedMotionDelta = 0;

        // Throttle trackers
        this._lastThemeMs = 0;
        this._lastSparklineHour = -1;
        this._lastSunriseDay = -1; // track day to avoid per-frame DOM updates

        // FPS tracking for auto-downgrade
        this.fpsSamples = [];
        this.lastFpsCheckTime = performance.now();
    }
    
    /**
     * Set the mode controller reference for timeline updates
     * @param {ModeController} controller
     */
    setModeController(controller) {
        this.modeController = controller;
    }

    /** Start the rAF loop */
    start(clock, stats) {
        if (this.isRunning) return;
        this.clock = clock;
        this.stats = stats;
        this.isRunning = true;
        this._ensureVisibilityHandler();
        this.clock?.start?.();
        this.clock?.getDelta?.();

        const animate = () => {
            if (!this.isRunning) return;
            this.rafId = requestAnimationFrame(animate);
            this.stats?.update();
            this.update(this.clock.getDelta());
        };

        animate();
    }

    _ensureVisibilityHandler() {
        if (this._visibilityBound || typeof document === 'undefined') return;
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.stop();
                this.clock?.stop?.();
                return;
            }
            if (this.clock && this.stats) {
                this.start(this.clock, this.stats);
            }
        });
        this._visibilityBound = true;
    }

    /** Per-frame update */
    update(delta) {
        const { state, services, scene3d } = this;
        const { weatherService, astronomyService } = services;
        const {
            scene, pipeline, sky,
            sundial, moonGroup, weatherEffects,
            sunLight, moonLight, ambientLight,
            controls, renderer
        } = scene3d;

        // ── FPS tracking & auto-downgrade ──
        if (typeof window !== 'undefined') {
            const now = performance.now();
            const fps = delta > 0 ? 1 / delta : 60;
            this.fpsSamples.push(fps);
            if (this.fpsSamples.length > 300) {
                this.fpsSamples.shift();
            }

            if (now - this.lastFpsCheckTime >= 5000) {
                this.lastFpsCheckTime = now;
                if (this.fpsSamples.length >= 150) {
                    const avgFps = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
                    const currentTier = getQualityTier();
                    
                    if (avgFps < 30) {
                        let nextTier = null;
                        if (currentTier === 'high') {
                            nextTier = 'medium';
                        } else if (currentTier === 'medium') {
                            nextTier = 'low';
                        }
                        
                        if (nextTier) {
                            setQualityTier(nextTier);
                            if (window.updateQualityButton) {
                                window.updateQualityButton(nextTier);
                            }
                            showToast(`Performance low (${Math.round(avgFps)} FPS). Automatically switching to ${nextTier.toUpperCase()} quality... Reloading to apply.`, 'warning');
                            this.fpsSamples = [];
                            setTimeout(() => {
                                window.location.reload();
                            }, 2000);
                        }
                    }
                }
            }
        }

        // ── Advance simulation time ──
        const timeScale = state.isTimeWarping
            ? state.timeSpeed
            : ANIMATION_CONFIG.realTimeScale;
        state.simulationTime = new Date(state.simulationTime.getTime() + delta * 1000 * timeScale);

        const shouldUpdateReducedMotionEffects = !state.reducedMotion
            || this._shouldUpdateReducedMotionEffects(delta);

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
        updateTimelineScrubber(state.simulationTime, state.isTimeWarping, state.timeSpeed);

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
            if (shouldUpdateReducedMotionEffects) {
                weatherEffects.update(
                    activeWeatherData.past     || empty,
                    activeWeatherData.current  || empty,
                    activeWeatherData.forecast || empty,
                    state.reducedMotion ? this._consumeReducedMotionDelta() : delta,
                    ambientLight.color,
                    sunLight.position,
                    moonLight.position,
                    sunLight.color,
                    moonLight.color
                );
            }

            if (shouldUpdateReducedMotionEffects && activeWeatherData.current?.windDirection != null) {
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
            if (shouldUpdateReducedMotionEffects) {
                weatherEffects.update(
                    empty,
                    empty,
                    empty,
                    state.reducedMotion ? this._consumeReducedMotionDelta() : delta,
                    ambientLight.color
                );
            }
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
        
        // ── Timeline update (if in timeline mode) ──
        if (this.modeController?.isTimelineMode() && this.modeController.timelineController) {
            this.modeController.timelineController.update(delta);
        }

        // ── Atmosphere theme (drives CSS custom properties) ──
        if (state.weatherData) {
            updateAtmosphereTheme(renderer, scene, state.weatherData);
        }

        pipeline.render();
    }

    _shouldUpdateReducedMotionEffects(delta) {
        this._reducedMotionFrameCount += 1;
        this._reducedMotionDelta += delta;
        return this._reducedMotionFrameCount >= ANIMATION_CONFIG.reducedMotionParticleFrameInterval;
    }

    _consumeReducedMotionDelta() {
        const accumulatedDelta = this._reducedMotionDelta || 0;
        this._reducedMotionFrameCount = 0;
        this._reducedMotionDelta = 0;
        return accumulatedDelta || 0.016;
    }

    stop() {
        this.isRunning = false;
        if (this.rafId != null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }
}

export { ANIMATION_CONFIG };
