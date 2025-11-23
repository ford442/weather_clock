import * as THREE from 'three';
import { createSundial } from './sundial.js';
import { WeatherService } from './weather.js';
import { updateLighting } from './lighting.js';
import { calculateMoonPhase, createMoon, positionMoon } from './moonPhase.js';
import { WeatherEffects } from './weatherEffects.js';

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
sunLight.position.set(5, 10, 5);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
scene.add(sunLight);

// Create sundial
const sundial = createSundial();
scene.add(sundial.group);

// Create moon
const moonPhase = calculateMoonPhase();
const moon = createMoon(moonPhase.phase);
scene.add(moon);

// Add moon light
const moonLight = new THREE.PointLight(0x8899cc, 0.3, 15);
moon.add(moonLight);

// Weather effects
const weatherEffects = new WeatherEffects(scene);

// Weather service
const weatherService = new WeatherService();
let weatherData = null;

// Initialize weather
async function initWeather() {
    // Always show moon phase
    document.getElementById('moon-phase').textContent = moonPhase.phaseName;
    
    try {
        weatherData = await weatherService.initialize();
        updateWeatherDisplay(weatherData);
    } catch (error) {
        console.error('Weather initialization failed:', error);
        document.getElementById('location').textContent = 'Weather data unavailable';
        document.getElementById('current-weather').textContent = 'Unable to fetch';
    }
}

// Update weather display
function updateWeatherDisplay(data) {
    if (!data) return;

    // Location
    document.getElementById('location').textContent = data.location || 'Unknown';

    // Current weather
    if (data.current) {
        document.getElementById('current-weather').textContent = data.current.description;
        document.getElementById('current-temp').textContent = `${Math.round(data.current.temp)}°C`;
    }

    // Past weather
    if (data.past) {
        document.getElementById('past-weather').textContent = data.past.description;
        document.getElementById('past-temp').textContent = `${Math.round(data.past.temp)}°C`;
    }

    // Forecast
    if (data.forecast) {
        document.getElementById('forecast-weather').textContent = data.forecast.description;
        document.getElementById('forecast-temp').textContent = `${Math.round(data.forecast.temp)}°C`;
    }

    // Wind speed
    if (data.current && data.current.windSpeed !== undefined) {
        document.getElementById('wind-speed').textContent = `${Math.round(data.current.windSpeed)} km/h`;
    }

    // Moon phase
    document.getElementById('moon-phase').textContent = moonPhase.phaseName;
}

// Update time display
function updateTimeDisplay() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    document.getElementById('time-display').textContent = `${hours}:${minutes}:${seconds}`;
}

// Animation loop
function animate() {
    requestAnimationFrame(animate);

    // Update sundial (rotates gnomon based on time)
    sundial.update();

    // Update moon position
    positionMoon(moon, { x: 0, y: 0, z: 0 });

    // Update time display
    updateTimeDisplay();

    // Update lighting based on weather
    if (weatherData) {
        updateLighting(scene, sunLight, ambientLight, weatherData);
        
        // Update weather effects (rain, snow, clouds, etc.)
        const windSpeed = weatherData.current?.windSpeed || 0;
        weatherEffects.update(weatherData.current?.weatherCode || 0, windSpeed);
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
initWeather();
animate();

// Refresh weather data every 10 minutes
let isUpdatingWeather = false;
setInterval(async () => {
    if (isUpdatingWeather) return; // Prevent overlapping requests
    
    isUpdatingWeather = true;
    try {
        weatherData = await weatherService.fetchWeather();
        updateWeatherDisplay(weatherData);
    } catch (error) {
        console.error('Weather update failed:', error);
    } finally {
        isUpdatingWeather = false;
    }
}, 10 * 60 * 1000);
