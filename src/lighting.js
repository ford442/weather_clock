import * as THREE from 'three';

let previousIntensity = { sun: 0.8, ambient: 0.4 };
let previousColor = { sun: 0xffffff, ambient: 0xffffff };
const transitionSpeed = 0.02;

export function updateLighting(scene, sunLight, ambientLight, weatherData) {
    if (!weatherData) return;

    // Calculate target lighting based on past, current, and forecast
    const pastWeight = 0.2;
    const currentWeight = 0.5;
    const forecastWeight = 0.3;

    // Get cloud cover values
    const pastCloud = weatherData.past?.cloudCover || 50;
    const currentCloud = weatherData.current?.cloudCover || 50;
    const forecastCloud = weatherData.forecast?.cloudCover || 50;

    // Get weather codes
    const pastCode = weatherData.past?.weatherCode || 0;
    const currentCode = weatherData.current?.weatherCode || 0;
    const forecastCode = weatherData.forecast?.weatherCode || 0;

    // Calculate weighted cloud cover
    const weightedCloud = 
        pastCloud * pastWeight +
        currentCloud * currentWeight +
        forecastCloud * forecastWeight;

    // Calculate weighted severity (0 = clear, 100 = severe weather)
    const getSeverity = (code) => {
        if (code === 0) return 0;
        if (code <= 3) return code * 10;
        if (code >= 95) return 100; // Thunderstorm
        if (code >= 80) return 70; // Heavy rain/snow
        if (code >= 60) return 50; // Rain
        return 30; // Other conditions
    };

    const weightedSeverity = 
        getSeverity(pastCode) * pastWeight +
        getSeverity(currentCode) * currentWeight +
        getSeverity(forecastCode) * forecastWeight;

    // Calculate target sun light intensity based on cloud cover and weather
    const baseIntensity = 1.2;
    const cloudFactor = 1 - (weightedCloud / 100) * 0.6;
    const severityFactor = 1 - (weightedSeverity / 100) * 0.4;
    const targetSunIntensity = baseIntensity * cloudFactor * severityFactor;

    // Calculate target ambient light intensity
    const targetAmbientIntensity = 0.3 + (1 - cloudFactor) * 0.3;

    // Calculate sun color based on weather
    let targetSunColor;
    if (currentCode >= 95) {
        // Thunderstorm - dark bluish
        targetSunColor = new THREE.Color(0x8899cc);
    } else if (currentCode >= 70 && currentCode <= 77) {
        // Snow - cool white
        targetSunColor = new THREE.Color(0xccddff);
    } else if (currentCode >= 60) {
        // Rain - slightly blue-grey
        targetSunColor = new THREE.Color(0xaabbcc);
    } else if (weightedCloud > 70) {
        // Heavy clouds - grey-white
        targetSunColor = new THREE.Color(0xcccccc);
    } else if (weightedCloud > 40) {
        // Some clouds - slightly dimmed
        targetSunColor = new THREE.Color(0xffffee);
    } else {
        // Clear - warm sunlight
        targetSunColor = new THREE.Color(0xffffcc);
    }

    // Calculate ambient color
    let targetAmbientColor;
    if (weightedSeverity > 70) {
        targetAmbientColor = new THREE.Color(0x444466);
    } else if (weightedCloud > 60) {
        targetAmbientColor = new THREE.Color(0x888899);
    } else {
        targetAmbientColor = new THREE.Color(0xffffff);
    }

    // Smoothly transition intensities
    previousIntensity.sun += (targetSunIntensity - previousIntensity.sun) * transitionSpeed;
    previousIntensity.ambient += (targetAmbientIntensity - previousIntensity.ambient) * transitionSpeed;

    sunLight.intensity = previousIntensity.sun;
    ambientLight.intensity = previousIntensity.ambient;

    // Smoothly transition colors
    sunLight.color.lerp(targetSunColor, transitionSpeed);
    ambientLight.color.lerp(targetAmbientColor, transitionSpeed);

    // Update sun position based on time of day
    const now = new Date();
    const hours = now.getHours() + now.getMinutes() / 60;
    const sunAngle = ((hours - 6) / 12) * Math.PI; // 6 AM to 6 PM
    
    const sunDistance = 10;
    sunLight.position.x = Math.cos(sunAngle) * sunDistance;
    sunLight.position.y = Math.sin(sunAngle) * sunDistance * 0.8 + 5;
    sunLight.position.z = 5;

    // Adjust scene background based on weather
    if (scene.background instanceof THREE.Color) {
        const targetBgColor = new THREE.Color();
        if (weightedSeverity > 70) {
            targetBgColor.setHex(0x1a1a2e);
        } else if (weightedCloud > 60) {
            targetBgColor.setHex(0x2a3a5e);
        } else {
            targetBgColor.setHex(0x3a5a8e);
        }
        
        if (!scene.background) {
            scene.background = new THREE.Color();
        }
        scene.background.lerp(targetBgColor, transitionSpeed);
    } else {
        scene.background = new THREE.Color(0x2a3a5e);
    }
}
