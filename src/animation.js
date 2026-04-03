// Animation loop and time management
import * as THREE from 'three';
import { updateMoonVisuals } from './moonPhase.js';
import { updateWeatherLighting } from './weatherLighting.js';
import { getWeatherAtTime, getActiveWeatherData } from './weather-simulation.js';
import { updateTimeDisplay, updateWeatherDisplay, updateSunriseSunset } from './ui.js';

const ANIMATION_CONFIG = {
    realTimeScale: 1.0,
    warpTimeScale: 1440.0, // 24h in 60s
    weatherUpdateThrottle: 0.1, // 10% chance per frame when warping
};

export class AnimationController {
    constructor(state, services, scene3d) {
        this.state = state;
        this.services = services;
        this.scene3d = scene3d;
        this.isRunning = false;
        this._lastSunriseDay = -1; // track day to avoid per-frame DOM updates
    }

    /**
     * Start the animation loop
     * @param {THREE.Clock} clock - Three.js clock for delta time
     * @param {Stats} stats - Performance stats object
     */
    start(clock, stats) {
        if (this.isRunning) return;
        this.isRunning = true;

        const animate = () => {
            requestAnimationFrame(animate);
            stats.update();
            this.update(clock.getDelta(), stats);
        };

        animate();
    }

    /**
     * Main update loop
     * @param {number} delta - Delta time in seconds
     * @param {Stats} stats - Performance stats object
     */
    update(delta, stats) {
        const { state, services, scene3d } = this;
        const { weatherService, astronomyService } = services;
        const {
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
        } = scene3d;

        // Update simulation time
        const timeScale = state.isTimeWarping ? ANIMATION_CONFIG.warpTimeScale : ANIMATION_CONFIG.realTimeScale;
        state.simulationTime = new Date(state.simulationTime.getTime() + delta * 1000 * timeScale);

        // Update sundial
        sundial.update(state.simulationTime);

        // Update astronomy
        const lat = weatherService.latitude;
        const lon = weatherService.longitude;
        const astroData = astronomyService.update(state.simulationTime, lat, lon, 20);

        // Update light positions
        sunLight.position.copy(astroData.sunPosition);
        moonGroup.position.copy(astroData.moonPosition);
        moonGroup.lookAt(0, 0, 0);
        moonLight.position.copy(astroData.moonPosition);

        if (astroData.sunPosition) {
            updateMoonVisuals(moonGroup, astroData.sunPosition);
        }

        // Update UI time display
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
            // Update lighting
            if (astroData && astroData.sunPosition && astroData.sunPosition.lengthSq() > 0) {
                updateWeatherLighting(
                    scene,
                    sunLight,
                    moonLight,
                    ambientLight,
                    sky,
                    {
                        current: activeWeatherData.current,
                        past: activeWeatherData.past,
                        forecast: activeWeatherData.forecast
                    },
                    astroData
                );
            }

            // Update weather effects
            weatherEffects.update(
                activeWeatherData.past || { weatherCode: 0, windSpeed: 0, windDirection: 0 },
                activeWeatherData.current || { weatherCode: 0, windSpeed: 0, windDirection: 0 },
                activeWeatherData.forecast || { weatherCode: 0, windSpeed: 0, windDirection: 0 },
                delta, // Real delta for smooth animation
                ambientLight.color,
                sunLight.position,
                moonLight.position,
                sunLight.color,
                moonLight.color
            );

            // Throttled weather display update during time warp
            if (state.isTimeWarping && Math.random() < ANIMATION_CONFIG.weatherUpdateThrottle) {
                const displayData = {
                    ...state.weatherData,
                    current: activeWeatherData.current,
                    past: activeWeatherData.past,
                    forecast: activeWeatherData.forecast
                };
                updateWeatherDisplay(displayData, weatherService);
            }
        } else {
            // No weather data, render empty effects
            weatherEffects.update(
                { weatherCode: 0, windSpeed: 0, windDirection: 0 },
                { weatherCode: 0, windSpeed: 0, windDirection: 0 },
                { weatherCode: 0, windSpeed: 0, windDirection: 0 },
                delta,
                ambientLight.color
            );
        }

        // Handle lightning flashes
        if (weatherEffects.getLightningFlash && weatherEffects.getLightningFlash() > 0) {
            const flash = weatherEffects.getLightningFlash();
            ambientLight.intensity += flash;

            const flashColor = new THREE.Color(0xaaddff);
            const lerpFactor = Math.min(1.0, flash * 0.8);
            ambientLight.color.lerp(flashColor, lerpFactor);

            // Sync fog color with lightning
            if (scene.fog) {
                scene.fog.color.copy(ambientLight.color).multiplyScalar(0.8);
            }
        }

        // Render
        composer.render();
    }

    stop() {
        this.isRunning = false;
    }
}

export { ANIMATION_CONFIG };
