import * as THREE from 'three';

let previousIntensity = { sun: 0.8, ambient: 0.4 };
const transitionSpeed = 0.02;

export function updateWeatherLighting(scene, sunLight, ambientLight, weatherData) {
    if (!weatherData) return;

    // Calculate day/night factor based on current sun altitude (sunLight.position.y)
    // We assume sunLight.position has been updated to the correct astronomical position before this call.
    // NOTE: This function must NOT modify sunLight.position, as it is controlled by the astronomy service.
    const sunY = sunLight.position.y;
    let dayFactor = 1.0;

    // Smooth transition around horizon (y=-2 to y=2)
    // If sun is below horizon, dim lights
    if (sunY < -2) dayFactor = 0;
    else if (sunY > 2) dayFactor = 1;
    else dayFactor = (sunY + 2) / 4;

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

    // Calculate target sun light intensity based on cloud cover and weather AND day/night
    const baseIntensity = 1.2;
    const cloudFactor = 1 - (weightedCloud / 100) * 0.6;
    const severityFactor = 1 - (weightedSeverity / 100) * 0.4;

    const targetSunIntensity = baseIntensity * cloudFactor * severityFactor * dayFactor;

    // Calculate target ambient light intensity
    // Minimum ambient at night (moonlight ambient)
    const nightAmbient = 0.05;
    const dayAmbient = 0.3 + (1 - cloudFactor) * 0.3;
    const targetAmbientIntensity = nightAmbient + (dayAmbient - nightAmbient) * dayFactor;

    // Calculate sun color based on weather
    let targetSunColor;
    if (currentCode >= 95) {
        targetSunColor = new THREE.Color(0x8899cc);
    } else if (currentCode >= 70 && currentCode <= 77) {
        targetSunColor = new THREE.Color(0xccddff);
    } else if (currentCode >= 60) {
        targetSunColor = new THREE.Color(0xaabbcc);
    } else if (weightedCloud > 70) {
        targetSunColor = new THREE.Color(0xcccccc);
    } else if (weightedCloud > 40) {
        targetSunColor = new THREE.Color(0xffffee);
    } else {
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

    // Tint ambient blue-ish at night
    if (dayFactor < 0.5) {
        targetAmbientColor.lerp(new THREE.Color(0x111122), 1.0 - dayFactor * 2);
    }

    // Smoothly transition intensities
    previousIntensity.sun += (targetSunIntensity - previousIntensity.sun) * transitionSpeed;
    previousIntensity.ambient += (targetAmbientIntensity - previousIntensity.ambient) * transitionSpeed;

    sunLight.intensity = previousIntensity.sun;
    ambientLight.intensity = previousIntensity.ambient;

    // Smoothly transition colors
    sunLight.color.lerp(targetSunColor, transitionSpeed);
    ambientLight.color.lerp(targetAmbientColor, transitionSpeed);

    // Adjust scene background based on weather and time
    if (scene.background instanceof THREE.Color) {
        const targetBgColor = new THREE.Color();
        if (weightedSeverity > 70) {
            targetBgColor.setHex(0x1a1a2e);
        } else if (weightedCloud > 60) {
            targetBgColor.setHex(0x2a3a5e);
        } else {
            targetBgColor.setHex(0x3a5a8e);
        }
        
        // Darken for night
        const nightColor = new THREE.Color(0x050510);
        const finalBgColor = new THREE.Color().lerpVectors(nightColor, targetBgColor, dayFactor);

        if (!scene.background) {
            scene.background = new THREE.Color();
        }
        scene.background.lerp(finalBgColor, transitionSpeed);
    } else {
        scene.background = new THREE.Color(0x2a3a5e);
    }
}
