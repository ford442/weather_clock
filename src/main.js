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
        // Accuracy delta is temperature difference
        // We need to convert the delta too, but delta conversion is different (it's a range, not absolute)
        // 1 degree C delta = 1.8 degree F delta
        let delta = data.accuracy.delta;
        if (weatherService.unit === 'imperial') {
            delta = delta * 1.8;
        }

        const sign = delta > 0 ? '+' : (delta < 0 ? '-' : '');
        document.getElementById('accuracy-delta').textContent = `${sign}${Math.abs(delta).toFixed(1)}${deg}`;

        // Color code: Green if abs(delta) < 2 (metric) or approx 3.6 (imperial), else Red
        // We use the metric value for threshold to keep logic simple
        const color = Math.abs(data.accuracy.delta) < 2 ? '#44ff44' : '#ff4444';
        document.getElementById('accuracy-delta').style.color = color;

        document.getElementById('accuracy-score').textContent = `Score: ${data.accuracy.accuracy}%`;
    }

    if (data.regional) {
        const list = document.getElementById('regional-list');
        list.innerHTML = '';
        data.regional.forEach(reg => {
            const div = document.createElement('div');
            // e.g. "North: 20°"
            div.innerHTML = `<b>${reg.name}:</b> ${t(reg.temp)}${deg}`;
            list.appendChild(div);
        });
    }
}

// Update time display
function updateTimeDisplay() {
    const hours = String(simulationTime.getHours()).padStart(2, '0');
    const minutes = String(simulationTime.getMinutes()).padStart(2, '0');
    document.getElementById('time-display').textContent = `${hours}:${minutes}`;
}

// Animation loop
function animate() {
    requestAnimationFrame(animate);

    const delta = clock.getDelta();

    // Update Simulation Time
    const scale = isTimeWarping ? WARP_SCALE : REAL_TIME_SCALE;
    // Add milliseconds: delta (s) * 1000 * scale
    simulationTime = new Date(simulationTime.getTime() + delta * 1000 * scale);

    // Update sundial hands (using simulationTime?)
    // Sundial code likely uses its own time or we need to pass it?
    // Looking at sundial.js (I haven't checked it but I assume it has update(time)?)
    // The current code called `sundial.update()` without args.
    // Let's assume it checks system time. I might need to update sundial.js to accept time.
    // I will check sundial.js in a moment. For now, let's pass simulationTime if it accepts it, or just call it.
    sundial.update(simulationTime);

    // Update Astronomy (Sun/Moon positions)
    // Use weather service lat/lon if available, else default
    const lat = weatherService.latitude;
    const lon = weatherService.longitude;

    // Calculate positions (distance 20 to keep lights outside scene bounds)
    const astroData = astronomyService.update(simulationTime, lat, lon, 20);

    // Update Sun Light
    sunLight.position.copy(astroData.sunPosition);

    // Update Moon Mesh & Light
    // We update the moonGroup position directly
    moonGroup.position.copy(astroData.moonPosition);
    moonGroup.lookAt(0, 0, 0); // Face earth/center

    // Moon light sits at the moon
    moonLight.position.copy(astroData.moonPosition);

    // Update time display
    updateTimeDisplay();

    // Update lighting intensity/color based on weather
    if (weatherData) {
        // We use the weather lighting helper for intensity/color transitions
        updateWeatherLighting(scene, sunLight, ambientLight, sky, weatherData);
        
        // Also adjust moon light intensity based on phase/cloud?
        // Moon phase illumination
        const moonIntensityBase = 0.5 * astroData.moonIllumination.fraction;

        // Calculate weighted cloud cover
        const pastWeight = 0.2;
        const currentWeight = 0.5;
        const forecastWeight = 0.3;

        const pastCloud = weatherData.past?.cloudCover || 0;
        const currentCloud = weatherData.current?.cloudCover || 0;
        const forecastCloud = weatherData.forecast?.cloudCover || 0;

        const weightedCloud =
            pastCloud * pastWeight +
            currentCloud * currentWeight +
            forecastCloud * forecastWeight;

        // Calculate cloud attenuation (0.2 to 1.0)
        // 100% cloud cover reduces light to 20%
        const cloudFactor = 1 - (weightedCloud / 100) * 0.8;

        // Calculate horizon dimming (similar to sun)
        const moonY = astroData.moonPosition.y;
        let moonHorizonFactor = 1.0;
        if (moonY < -2) moonHorizonFactor = 0;
        else if (moonY > 2) moonHorizonFactor = 1;
        else moonHorizonFactor = (moonY + 2) / 4;

        moonLight.intensity = moonIntensityBase * cloudFactor * moonHorizonFactor;

        // Update weather effects (Split zones)
        weatherEffects.update(
            weatherData.past || { weatherCode: 0, windSpeed: 0 },
            weatherData.current || { weatherCode: 0, windSpeed: 0 },
            weatherData.forecast || { weatherCode: 0, windSpeed: 0 },
            delta
        );
    } else {
        // Default weather effects update if no data?
         weatherEffects.update(
            { weatherCode: 0, windSpeed: 0 },
            { weatherCode: 0, windSpeed: 0 },
            { weatherCode: 0, windSpeed: 0 },
            delta
        );
    }

    // Apply Lightning Flash (Global Ambient Boost)
    if (weatherEffects.getLightningFlash && weatherEffects.getLightningFlash() > 0) {
        ambientLight.intensity += weatherEffects.getLightningFlash();
    }

    // renderer.render(scene, camera); // Replaced by composer
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
