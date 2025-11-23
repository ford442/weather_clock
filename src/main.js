import * as THREE from 'three';
import { createSundial } from './sundial.js';
import { WeatherService } from './weather.js';
import { updateLighting } from './lighting.js';

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

// Weather service
const weatherService = new WeatherService();
let weatherData = null;

// Initialize weather
async function initWeather() {
    try {
        weatherData = await weatherService.initialize();
        updateWeatherDisplay(weatherData);
    } catch (error) {
        console.error('Weather initialization failed:', error);
        document.getElementById('location').textContent = 'Unable to get location';
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

    // Update time display
    updateTimeDisplay();

    // Update lighting based on weather
    if (weatherData) {
        updateLighting(scene, sunLight, ambientLight, weatherData);
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
setInterval(async () => {
    try {
        weatherData = await weatherService.fetchWeather();
        updateWeatherDisplay(weatherData);
    } catch (error) {
        console.error('Weather update failed:', error);
    }
}, 10 * 60 * 1000);
