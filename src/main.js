import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { createSundial } from './sundial.js';
import { WeatherService } from './weather.js';
import { updateWeatherLighting } from './weatherLighting.js';
import { calculateMoonPhase, createMoon } from './moonPhase.js';
import { WeatherEffects } from './weatherEffects.js';
import { AstronomyService } from './astronomy.js';

// Scene setup
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xaaaaaa, 0.002); // Add Fog
const clock = new THREE.Clock();
// Increased far plane to ensure Sky (scaled 450000) is visible
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000000);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });

// Tone mapping for HDR effect (Sky shader + Bloom)
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('canvas-container').appendChild(renderer.domElement);

// Post-processing
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
bloomPass.threshold = 0.85; // Slightly lower threshold to catch more sun glow
bloomPass.strength = 1.2;   // Increased intensity for "intense glow"
bloomPass.radius = 0.6;     // Tighter bloom
composer.addPass(bloomPass);

// Sky Setup
const sky = new Sky();
sky.scale.setScalar(450000);
const skyUniforms = sky.material.uniforms;
skyUniforms['turbidity'].value = 10;
skyUniforms['rayleigh'].value = 3;
skyUniforms['mieCoefficient'].value = 0.005;
skyUniforms['mieDirectionalG'].value = 0.7;
scene.add(sky);

// Camera position
camera.position.set(0, 5, 8);
camera.lookAt(0, 0, 0);

// Ambient light
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

// Directional light (sun)
const sunLight = new THREE.DirectionalLight(0xffffff, 0.8);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 0.5;
sunLight.shadow.camera.far = 50;
sunLight.shadow.camera.left = -10;
sunLight.shadow.camera.right = 10;
sunLight.shadow.camera.top = 10;
sunLight.shadow.camera.bottom = -10;
scene.add(sunLight);

// Create sundial
const sundial = createSundial();
scene.add(sundial.group);

// Create moon
const moonPhaseData = calculateMoonPhase();
const moonGroup = createMoon(moonPhaseData.phase);
scene.add(moonGroup);

// Add moon light (DirectionalLight for efficient shadows)
const moonLight = new THREE.DirectionalLight(0x8899cc, 0.5);
moonLight.castShadow = true;
moonLight.shadow.mapSize.width = 1024;
moonLight.shadow.mapSize.height = 1024;
moonLight.shadow.camera.near = 0.5;
moonLight.shadow.camera.far = 50;
moonLight.shadow.camera.left = -10;
moonLight.shadow.camera.right = 10;
moonLight.shadow.camera.top = 10;
moonLight.shadow.camera.bottom = -10;
scene.add(moonLight);

// Weather effects
const weatherEffects = new WeatherEffects(scene, sundial.group, camera);

// Services
const weatherService = new WeatherService();
const astronomyService = new AstronomyService();

let weatherData = null;
let simulationTime = new Date();
let isTimeWarping = false;
const REAL_TIME_SCALE = 1.0;
const WARP_SCALE = 1440.0; // 24h in 60s -> 1440x

// Helper to find interpolated weather from timeline
function getWeatherAtTime(time, timeline) {
    if (!timeline || timeline.length === 0) return null;

    const t = time.getTime();

    // Find surrounding data points
    // We assume timeline is sorted
    let prev = timeline[0];
    let next = timeline[timeline.length - 1];

    for (let i = 0; i < timeline.length - 1; i++) {
        const t1 = timeline[i].time.getTime();
        const t2 = timeline[i+1].time.getTime();
        if (t >= t1 && t <= t2) {
            prev = timeline[i];
            next = timeline[i+1];
            break;
        }
    }

    // Interpolation factor
    const range = next.time.getTime() - prev.time.getTime();
    let factor = 0;
    if (range > 0) {
        factor = (t - prev.time.getTime()) / range;
    }

    // If outside range (e.g. past or future beyond data), clamp to nearest
    if (t < prev.time.getTime()) return prev;
    if (t > next.time.getTime()) return next;

    // Interpolate simple values, pick discrete for codes
    // For weather code, we just pick the nearest to avoid "half rain"
    const weatherCode = factor < 0.5 ? prev.weatherCode : next.weatherCode;
    const description = factor < 0.5 ? prev.description : next.description;

    return {
        temp: prev.temp + (next.temp - prev.temp) * factor,
        weatherCode: weatherCode,
        description: description,
        cloudCover: prev.cloudCover + (next.cloudCover - prev.cloudCover) * factor,
        windSpeed: prev.windSpeed + (next.windSpeed - prev.windSpeed) * factor,
        visibility: (prev.visibility || 10000) + ((next.visibility || 10000) - (prev.visibility || 10000)) * factor,
        rain: (prev.rain || 0) + ((next.rain || 0) - (prev.rain || 0)) * factor,
        showers: (prev.showers || 0) + ((next.showers || 0) - (prev.showers || 0)) * factor,
        snowfall: (prev.snowfall || 0) + ((next.snowfall || 0) - (prev.snowfall || 0)) * factor
    };
}

function updateTimeDisplay() {
    const timeDisplay = document.getElementById('time-display');
    if (timeDisplay) {
        const hours = simulationTime.getHours().toString().padStart(2, '0');
        const minutes = simulationTime.getMinutes().toString().padStart(2, '0');
        timeDisplay.textContent = `${hours}:${minutes}`;
    }
}

// Initialize
function init() {
    // Initial UI State
    updateTimeDisplay();
    updateUnitButton();
    
    // Start animation loop immediately
    animate();

    // Fetch weather asynchronously
    fetchAndDisplayWeather();

    setupEventListeners();
}

function fetchAndDisplayWeather() {
    document.getElementById('location').textContent = 'Loading...';
    weatherService.initialize().then(data => {
        weatherData = data;
        updateWeatherDisplay(weatherData);
    }).catch(error => {
        console.error('Weather initialization failed:', error);
        document.getElementById('location').textContent = 'Weather data unavailable';
        document.getElementById('current-description').textContent = 'Unable to fetch';
    });
}

function setupEventListeners() {
    // Retry Location
    document.getElementById('retry-location').addEventListener('click', () => {
        document.getElementById('location').textContent = 'Retrying...';
        weatherService.getLocation().then(() => {
            weatherService.fetchWeather().then(data => {
                weatherData = data;
                updateWeatherDisplay(weatherData);
            });
        });
    });

    // Toggle Unit
    document.getElementById('unit-toggle').addEventListener('click', () => {
        weatherService.toggleUnit();
        updateUnitButton();
        if (weatherData) {
            // Re-update display with current weather data
            updateWeatherDisplay(weatherData);
        }
    });

    // Search Location
    const searchInput = document.getElementById('location-search');
    const searchBtn = document.getElementById('search-btn');

    const performSearch = () => {
        const query = searchInput.value;
        if (!query) return;

        searchBtn.textContent = '...';
        weatherService.searchLocation(query).then(results => {
            searchBtn.textContent = 'Go';
            if (results && results.length > 0) {
                const best = results[0];
                weatherService.setManualLocation(best.lat, best.lon, best.display_name.split(',')[0]);

                // Refresh weather
                document.getElementById('location').textContent = 'Updating...';
                weatherService.fetchWeather().then(data => {
                    weatherData = data;
                    updateWeatherDisplay(weatherData);
                });
            } else {
                alert('Location not found');
            }
        }).catch(err => {
            searchBtn.textContent = 'Go';
            console.error(err);
            alert('Search failed');
        });
    };

    searchBtn.addEventListener('click', performSearch);
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performSearch();
    });

    // Time Warp
    const warpBtn = document.getElementById('time-warp-btn');
    if (warpBtn) {
        warpBtn.addEventListener('click', () => {
            isTimeWarping = !isTimeWarping;
            warpBtn.style.background = isTimeWarping ? 'rgba(255, 200, 100, 0.4)' : 'rgba(255,255,255,0.1)';
            warpBtn.textContent = isTimeWarping ? '⏸️' : '⏩';
        });
    }
}

function updateUnitButton() {
    const btn = document.getElementById('unit-toggle');
    const nextUnit = weatherService.unit === 'metric' ? '°F' : '°C';
    btn.textContent = `Switch to ${nextUnit}`;
}

// Update weather display
function updateWeatherDisplay(data) {
    if (!data) return;

    const t = (c) => Math.round(weatherService.convertTemp(c));
    const unitSymbol = weatherService.unit === 'metric' ? '°C' : '°F';
    // Actually typically display just °
    const deg = '°';

    // CENTER PANEL (Current)
    document.getElementById('location').textContent = data.location || 'Unknown';

    if (data.current) {
        document.getElementById('current-description').textContent = data.current.description;
        document.getElementById('current-temp').textContent = `${t(data.current.temp)}${deg}`;
        document.getElementById('current-wind').textContent = `${Math.round(data.current.windSpeed)} km/h`;
    }

    // LEFT PANEL (Past)
    if (data.past) {
        document.getElementById('past-description').textContent = data.past.description;
        document.getElementById('past-temp').textContent = `${t(data.past.temp)}${deg}`;
        document.getElementById('past-wind').textContent = `${Math.round(data.past.windSpeed)} km/h`;
        document.getElementById('past-cloud').textContent = `${data.past.cloudCover}%`;
    }

    // RIGHT PANEL (Forecast)
    if (data.forecast) {
        document.getElementById('forecast-description').textContent = data.forecast.description;
        document.getElementById('forecast-temp').textContent = `${t(data.forecast.temp)}${deg}`;
        document.getElementById('forecast-wind').textContent = `${Math.round(data.forecast.windSpeed)} km/h`;
        document.getElementById('forecast-cloud').textContent = `${data.forecast.cloudCover}%`;
    }

    // Update Moon Phase Text
    const mp = calculateMoonPhase();
    document.getElementById('moon-phase').textContent = mp.phaseName;

    // ADVANCED PANEL
    if (data.historicalYearAgo) {
        document.getElementById('history-temp').textContent = `${t(data.historicalYearAgo.temp)}${deg}`;
        document.getElementById('history-desc').textContent = data.historicalYearAgo.description;
    }

    if (data.accuracy) {
        let delta = data.accuracy.delta;
        if (weatherService.unit === 'imperial') {
            delta = delta * 1.8;
        }

        const sign = delta > 0 ? '+' : (delta < 0 ? '-' : '');
        document.getElementById('accuracy-delta').textContent = `${sign}${Math.abs(delta).toFixed(1)}${deg}`;
        const color = Math.abs(data.accuracy.delta) < 2 ? '#44ff44' : '#ff4444';
        document.getElementById('accuracy-delta').style.color = color;
        document.getElementById('accuracy-score').textContent = `Score: ${data.accuracy.accuracy}%`;
    }

    if (data.regional) {
        const list = document.getElementById('regional-list');
        list.innerHTML = '';
        data.regional.forEach(reg => {
            const div = document.createElement('div');
            div.innerHTML = `<b>${reg.name}:</b> ${t(reg.temp)}${deg}`;
            list.appendChild(div);
        });
    }
}

// Animation loop
function animate() {
    requestAnimationFrame(animate);

    const delta = clock.getDelta();

    // Update Simulation Time
    const scale = isTimeWarping ? WARP_SCALE : REAL_TIME_SCALE;
    simulationTime = new Date(simulationTime.getTime() + delta * 1000 * scale);

    // Update sundial
    sundial.update(simulationTime);

    // Update Astronomy
    const lat = weatherService.latitude;
    const lon = weatherService.longitude;
    const astroData = astronomyService.update(simulationTime, lat, lon, 20);

    sunLight.position.copy(astroData.sunPosition);
    moonGroup.position.copy(astroData.moonPosition);
    moonGroup.lookAt(0, 0, 0);
    moonLight.position.copy(astroData.moonPosition);

    updateTimeDisplay();

    // Determine Simulated Weather
    let simWeather = null;
    if (weatherData && weatherData.timeline) {
        // Get interpolated weather for the simulation time
        simWeather = getWeatherAtTime(simulationTime, weatherData.timeline);
    }

    // Fallback if no timeline or simulation fails
    if (!simWeather && weatherData) simWeather = weatherData.current;

    if (simWeather) {
        // Construct a temporary "weatherData" object for lighting update
        // We only replace 'current' with 'simWeather' for visual effects
        // We keep past/forecast relative to the *real* fetch time or should we shift them?
        // For visual simplicity, Past/Forecast zones in 3D usually represent "Left" and "Right" relative to "Center".
        // If we warp time, maybe "Past" becomes "3 hours before simulationTime"?
        // Implementing dynamic Past/Forecast relative to simulationTime requires finding those points in timeline too.

        const simPast = weatherData.timeline ? getWeatherAtTime(new Date(simulationTime.getTime() - 3*3600*1000), weatherData.timeline) : (weatherData.past || simWeather);
        const simForecast = weatherData.timeline ? getWeatherAtTime(new Date(simulationTime.getTime() + 3*3600*1000), weatherData.timeline) : (weatherData.forecast || simWeather);

        const activeWeatherData = {
            current: simWeather,
            past: simPast,
            forecast: simForecast
        };

        // Update Lighting
        updateWeatherLighting(scene, sunLight, moonLight, ambientLight, sky, activeWeatherData, astroData);

        // Update Effects
        weatherEffects.update(
            simPast || { weatherCode: 0, windSpeed: 0 },
            simWeather || { weatherCode: 0, windSpeed: 0 },
            simForecast || { weatherCode: 0, windSpeed: 0 },
            delta // We pass real delta for animation smoothness, not warped time
        );

        // Optionally update UI to reflect simulation time weather?
        // "Watch a 24-hour weather cycle". The UI should probably show the simulated values.
        // But the UI panel says "Current", "Past", "Forecast".
        // If we are warping, "Current" means "Simulated Current".
        // Let's update the UI less frequently or just update the DOM elements directly here?
        // Calling updateWeatherDisplay every frame is bad for DOM performance.
        // Maybe update every 10 frames or if second changes?
        // For now, let's leave UI as "Real Time Data" or update it?
        // Aether's Journal says "Watch a 24-hour weather cycle". Seeing the numbers change is cool.
        // Let's update only if isTimeWarping is true, and throttle it.

        if (isTimeWarping && Math.random() < 0.1) { // Simple throttle
             // Create a dummy object matching the structure updateWeatherDisplay expects
             // We can reuse the `activeWeatherData` but add location/etc
             const displayData = {
                 ...weatherData,
                 current: activeWeatherData.current,
                 past: activeWeatherData.past,
                 forecast: activeWeatherData.forecast,
             };
             updateWeatherDisplay(displayData);
        }

    } else {
         weatherEffects.update(
            { weatherCode: 0, windSpeed: 0 },
            { weatherCode: 0, windSpeed: 0 },
            { weatherCode: 0, windSpeed: 0 },
            delta
        );
    }

    if (weatherEffects.getLightningFlash && weatherEffects.getLightningFlash() > 0) {
        ambientLight.intensity += weatherEffects.getLightningFlash();
    }

    composer.render();
}

// Handle window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
});

// Start
init();

// Refresh weather data every 10 minutes
setInterval(async () => {
    try {
        weatherData = await weatherService.fetchWeather();
        updateWeatherDisplay(weatherData);
    } catch (error) {
        console.error('Weather update failed:', error);
    }
}, 10 * 60 * 1000);
