import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { createSundial } from './sundial.js';
import { WeatherService } from './weather.js';
import { updateWeatherLighting, getSeverity } from './weatherLighting.js';
import { calculateMoonPhase, createMoon } from './moonPhase.js';
import { WeatherEffects } from './weatherEffects.js';
import { AstronomyService } from './astronomy.js';

// Scene setup
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xaaaaaa, 0.0001); // Add Fog (Start clear)
const clock = new THREE.Clock();
// Increased far plane to ensure Sky (scaled 450000) is visible
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000000);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); // Opaque for proper Sky rendering

// Tone mapping for HDR effect (Sky shader + Bloom)
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.8; // Adjusted for balance

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
bloomPass.strength = 0.65;  // Increased intensity for "intense glow"
bloomPass.radius = 0.5;     // Slightly softer
composer.addPass(bloomPass);

// Sky Setup
const sky = new Sky();
sky.scale.setScalar(10000);
sky.renderOrder = -1;
const skyUniforms = sky.material.uniforms;
skyUniforms['turbidity'].value = 10;
skyUniforms['rayleigh'].value = 3;
skyUniforms['mieCoefficient'].value = 0.005;
skyUniforms['mieDirectionalG'].value = 0.7;
// Ensure Sky is not affected by Fog (if possible via material property, though ShaderMaterial needs manual handling)
// Since Sky is a large box, and FogExp2 is distance based, we just need to ensure Sky renders correctly.
// Disabling depth write for Sky is common.
sky.material.depthWrite = false;
sky.material.fog = false; // Disable fog on sky material
sky.frustumCulled = false; // Ensure it's not culled
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
let isDebugMode = false;
const REAL_TIME_SCALE = 1.0;
const WARP_SCALE = 1440.0; // Time Lapse: 24h in 60s (1440x speed)

function updateTimeDisplay() {
    const timeDisplay = document.getElementById('time-display');
    if (timeDisplay) {
        const hours = simulationTime.getHours().toString().padStart(2, '0');
        const minutes = simulationTime.getMinutes().toString().padStart(2, '0');
        timeDisplay.textContent = `${hours}:${minutes}`;

        // Add Sim Speed indicator
        if (isTimeWarping) {
             timeDisplay.style.color = '#ffaa44';
             timeDisplay.style.textShadow = '0 0 10px #ffaa44';
        } else {
             timeDisplay.style.color = '#ffffff';
             timeDisplay.style.textShadow = '0 0 5px #000000';
        }
    }
}

// Debug API for Verification
window.setDebugWeather = (weatherCode) => {
    console.log("Setting debug weather code:", weatherCode);
    isDebugMode = true;

    // Generate Timeline
    const timeline = [];
    // Start timeline from current simulation time aligned to hour
    const start = new Date(simulationTime);
    start.setMinutes(0, 0, 0);
    start.setMilliseconds(0);

    for (let i = -3; i < 24; i++) {
        const t = new Date(start.getTime() + i * 3600 * 1000);
        let code = weatherCode;

        // Dynamic Mode: -1
        // Cycle: Clear -> Rain -> Snow -> Clear
        if (weatherCode === -1) {
            const cycle = 6; // Hours per phase
            const phase = Math.floor((i + 3) / cycle) % 3;
            if (phase === 0) code = 0; // Clear
            else if (phase === 1) code = 63; // Rain
            else code = 71; // Snow
        }

        const isRain = (code >= 50 && code < 70) || (code >= 80 && code < 83) || (code >= 95);
        const isSnow = (code >= 70 && code < 80) || (code >= 85 && code < 87);
        const isCloudy = code > 0;

        timeline.push({
            time: t,
            temp: 20 + Math.sin(i * 0.5) * 10,
            weatherCode: code,
            description: "Debug " + code,
            cloudCover: isCloudy ? 90 : 0,
            windSpeed: 10 + Math.sin(i) * 10,
            visibility: 10000,
            rain: isRain ? 10.0 : 0, // Heavy rain for storms
            showers: 0,
            snowfall: isSnow ? 5.0 : 0
        });
    }

    // Find current mock
    const currentMock = timeline.find(t => Math.abs(t.time.getTime() - simulationTime.getTime()) < 3600*1000) || timeline[3];

    const mock = {
        current: currentMock,
        past: timeline[0],
        forecast: timeline[6],
        timeline: timeline,
        location: "Debug Simulation (" + (weatherCode === -1 ? "Dynamic" : "Static") + ")"
    };
    weatherData = mock;
    updateWeatherLighting(scene, sunLight, moonLight, ambientLight, sky, mock, astronomyService.update(simulationTime, weatherService.latitude, weatherService.longitude, 20));
    updateWeatherDisplay(mock);
};

// Expose internal objects for Verification
window.aetherDebug = {
    scene,
    sky,
    weatherEffects,
    sunLight,
    moonLight,
    ambientLight,
    getSimulationTime: () => simulationTime,
    getWeatherData: () => weatherData
};

window.setDebugTime = (hour) => {
    simulationTime.setHours(hour, 0, 0, 0);
    // Force update
    if (weatherData) {
         updateWeatherLighting(scene, sunLight, moonLight, ambientLight, sky, weatherData, astronomyService.update(simulationTime, weatherService.latitude, weatherService.longitude, 20));
         updateTimeDisplay();
    }
};

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

    // Calculate interpolated severity for smooth lighting transitions
    const prevSev = getSeverity(prev.weatherCode);
    const nextSev = getSeverity(next.weatherCode);
    const severity = prevSev + (nextSev - prevSev) * factor;

    // Interpolate wind direction (handle 360 wrap)
    let d1 = prev.windDirection || 0;
    let d2 = next.windDirection || 0;
    let diff = d2 - d1;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    let windDir = d1 + diff * factor;
    if (windDir < 0) windDir += 360;
    if (windDir >= 360) windDir -= 360;

    return {
        temp: prev.temp + (next.temp - prev.temp) * factor,
        weatherCode: weatherCode,
        description: description,
        cloudCover: prev.cloudCover + (next.cloudCover - prev.cloudCover) * factor,
        windSpeed: prev.windSpeed + (next.windSpeed - prev.windSpeed) * factor,
        windDirection: windDir,
        visibility: (prev.visibility || 10000) + ((next.visibility || 10000) - (prev.visibility || 10000)) * factor,
        rain: (prev.rain || 0) + ((next.rain || 0) - (prev.rain || 0)) * factor,
        showers: (prev.showers || 0) + ((next.showers || 0) - (prev.showers || 0)) * factor,
        snowfall: (prev.snowfall || 0) + ((next.snowfall || 0) - (prev.snowfall || 0)) * factor,
        severity: severity
    };
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
    if (isDebugMode) return;
    document.getElementById('location').textContent = 'Loading...';
    weatherService.initialize().then(data => {
        if (isDebugMode) return;
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
            // Visual feedback
            warpBtn.style.background = isTimeWarping ? 'rgba(255, 100, 100, 0.8)' : 'rgba(100, 255, 100, 0.4)';
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
        document.getElementById('past-cloud').textContent = `${Math.round(data.past.cloudCover)}%`;
    }

    // RIGHT PANEL (Forecast)
    if (data.forecast) {
        document.getElementById('forecast-description').textContent = data.forecast.description;
        document.getElementById('forecast-temp').textContent = `${t(data.forecast.temp)}${deg}`;
        document.getElementById('forecast-wind').textContent = `${Math.round(data.forecast.windSpeed)} km/h`;
        document.getElementById('forecast-cloud').textContent = `${Math.round(data.forecast.cloudCover)}%`;
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
        const simPast = weatherData.timeline ? getWeatherAtTime(new Date(simulationTime.getTime() - 3*3600*1000), weatherData.timeline) : (weatherData.past || simWeather);
        const simForecast = weatherData.timeline ? getWeatherAtTime(new Date(simulationTime.getTime() + 3*3600*1000), weatherData.timeline) : (weatherData.forecast || simWeather);

        const activeWeatherData = {
            current: simWeather,
            past: simPast,
            forecast: simForecast
        };

        // Update Lighting (includes Sky Shader and Fog interpolation)
    // Ensure sun position is valid before updating sky
    if (astroData && astroData.sunPosition && astroData.sunPosition.lengthSq() > 0) {
        updateWeatherLighting(scene, sunLight, moonLight, ambientLight, sky, activeWeatherData, astroData);
    }

        // Update Effects
        weatherEffects.update(
            simPast || { weatherCode: 0, windSpeed: 0, windDirection: 0 },
            simWeather || { weatherCode: 0, windSpeed: 0, windDirection: 0 },
            simForecast || { weatherCode: 0, windSpeed: 0, windDirection: 0 },
            delta, // We pass real delta for animation smoothness, not warped time
            ambientLight.color, // Pass ambient color for particle tinting
            sunLight.position,
            moonLight.position,
            sunLight.color,
            moonLight.color
        );

        if (isTimeWarping && Math.random() < 0.1) { // Simple throttle
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
            { weatherCode: 0, windSpeed: 0, windDirection: 0 },
            { weatherCode: 0, windSpeed: 0, windDirection: 0 },
            { weatherCode: 0, windSpeed: 0, windDirection: 0 },
            delta,
            ambientLight.color
        );
    }

    if (weatherEffects.getLightningFlash && weatherEffects.getLightningFlash() > 0) {
        const flash = weatherEffects.getLightningFlash();
        ambientLight.intensity += flash;

        // Override ambient color with lightning color (Blue-White) for dramatic effect
        // Flash intensity starts around 2.0, so we saturate the lerp
        const flashColor = new THREE.Color(0xaaddff);
        const lerpFactor = Math.min(1.0, flash * 0.8);
        ambientLight.color.lerp(flashColor, lerpFactor);
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
    if (isDebugMode) return;
    try {
        const data = await weatherService.fetchWeather();
        if (isDebugMode) return;
        weatherData = data;
        updateWeatherDisplay(weatherData);
    } catch (error) {
        console.error('Weather update failed:', error);
    }
}, 10 * 60 * 1000);
