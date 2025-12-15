import * as THREE from 'three';
import { createSundial } from './sundial.js';
import { WeatherService } from './weather.js';
import { updateWeatherLighting } from './weatherLighting.js';
import { calculateMoonPhase, createMoon } from './moonPhase.js';
import { WeatherEffects } from './weatherEffects.js';
import { AstronomyService } from './astronomy.js';

// Scene setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('canvas-container').appendChild(renderer.domElement);

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

// Add moon light (PointLight for local glow + Directional/Spot for shadows?
// PointLight shadows can be expensive. Let's use SpotLight or Directional for moon shadow if needed,
// or just PointLight with shadow enabled.)
const moonLight = new THREE.PointLight(0x8899cc, 0.5, 50);
moonLight.castShadow = true;
moonLight.shadow.mapSize.width = 1024;
moonLight.shadow.mapSize.height = 1024;
scene.add(moonLight);

// Weather effects
const weatherEffects = new WeatherEffects(scene, sundial.group);

// Services
const weatherService = new WeatherService();
const astronomyService = new AstronomyService();

let weatherData = null;

// Initialize
async function init() {
    // Initial UI State
    updateTimeDisplay();
    
    try {
        weatherData = await weatherService.initialize();
        updateWeatherDisplay(weatherData);
    } catch (error) {
        console.error('Weather initialization failed:', error);
        document.getElementById('location').textContent = 'Weather data unavailable';
        document.getElementById('current-description').textContent = 'Unable to fetch';
    }

    animate();
}

// Update weather display
function updateWeatherDisplay(data) {
    if (!data) return;

    // CENTER PANEL (Current)
    document.getElementById('location').textContent = data.location || 'Unknown';

    if (data.current) {
        document.getElementById('current-description').textContent = data.current.description;
        document.getElementById('current-temp').textContent = `${Math.round(data.current.temp)}°`;
        document.getElementById('current-wind').textContent = `${Math.round(data.current.windSpeed)} km/h`;
    }

    // LEFT PANEL (Past)
    if (data.past) {
        document.getElementById('past-description').textContent = data.past.description;
        document.getElementById('past-temp').textContent = `${Math.round(data.past.temp)}°`;
        document.getElementById('past-wind').textContent = `${Math.round(data.past.windSpeed)} km/h`;
        document.getElementById('past-cloud').textContent = `${data.past.cloudCover}%`;
    }

    // RIGHT PANEL (Forecast)
    if (data.forecast) {
        document.getElementById('forecast-description').textContent = data.forecast.description;
        document.getElementById('forecast-temp').textContent = `${Math.round(data.forecast.temp)}°`;
        document.getElementById('forecast-wind').textContent = `${Math.round(data.forecast.windSpeed)} km/h`;
        document.getElementById('forecast-cloud').textContent = `${data.forecast.cloudCover}%`;
    }

    // Update Moon Phase Text
    const mp = calculateMoonPhase();
    document.getElementById('moon-phase').textContent = mp.phaseName;
}

// Update time display
function updateTimeDisplay() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    document.getElementById('time-display').textContent = `${hours}:${minutes}`;
}

// Animation loop
function animate() {
    requestAnimationFrame(animate);

    const now = new Date();

    // Update sundial hands
    sundial.update();

    // Update Astronomy (Sun/Moon positions)
    // Use weather service lat/lon if available, else default
    const lat = weatherService.latitude;
    const lon = weatherService.longitude;

    // Calculate positions (distance 20 to keep lights outside scene bounds)
    const astroData = astronomyService.update(now, lat, lon, 20);

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
        updateWeatherLighting(scene, sunLight, ambientLight, weatherData);
        
        // Also adjust moon light intensity based on phase/cloud?
        // Moon phase illumination
        const moonIntensityBase = 0.5 * astroData.moonIllumination.fraction;
        moonLight.intensity = moonIntensityBase;

        // Update weather effects (Split zones)
        weatherEffects.update(
            weatherData.past || { weatherCode: 0, windSpeed: 0 },
            weatherData.current || { weatherCode: 0, windSpeed: 0 },
            weatherData.forecast || { weatherCode: 0, windSpeed: 0 }
        );
    } else {
        // Default weather effects update if no data?
         weatherEffects.update(
            { weatherCode: 0, windSpeed: 0 },
            { weatherCode: 0, windSpeed: 0 },
            { weatherCode: 0, windSpeed: 0 }
        );
    }

    renderer.render(scene, camera);
}

// Handle window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
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
