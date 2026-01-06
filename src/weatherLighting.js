import * as THREE from 'three';

let previousIntensity = { sun: 0.8, ambient: 0.4 };
const transitionSpeed = 0.02;

export function updateWeatherLighting(scene, sunLight, ambientLight, sky, weatherData) {
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
    const baseIntensity = 2.0;
    // Don't reduce intensity too much for clouds, just diffuse it
    const cloudFactor = 1 - (weightedCloud / 100) * 0.4;
    const severityFactor = 1 - (weightedSeverity / 100) * 0.4;

    const targetSunIntensity = baseIntensity * cloudFactor * severityFactor * dayFactor;

    // Update Sky Shader
    if (sky) {
        const uniforms = sky.material.uniforms;
        // Sky shader expects a normalized direction or distant position.
        // We copy the position but should ensure it behaves as a direction.
        // Standard Three.js example uses radius 1.
        uniforms['sunPosition'].value.copy(sunLight.position).normalize();

        // Adjust Turbidity (haze) based on clouds and severity
        // Clear day: 2-5, Cloudy: 10-20
        const targetTurbidity = 2 + (weightedCloud / 100) * 15 + (weightedSeverity / 100) * 5;
        uniforms['turbidity'].value = targetTurbidity;

        // Rayleigh (scattering) - lowered for "heavy" atmosphere/rain
        // Standard: 3. Rain: 1.5
        const targetRayleigh = 3 - (weightedSeverity / 100) * 1.5;
        uniforms['rayleigh'].value = targetRayleigh;

        // Mie Coefficient (fog/scattering)
        // Clear: 0.005, Cloudy: 0.05
        const targetMie = 0.005 + (weightedCloud / 100) * 0.05;
        uniforms['mieCoefficient'].value = targetMie;

        // Mie Directional G (glare)
        uniforms['mieDirectionalG'].value = 0.7;
    }

    // Update Fog
    if (scene.fog) {
        // Fog density
        // Clear: 0.002, Heavy Cloud/Rain: 0.05
        // Visibility check: If visibility is low (e.g. < 1000m), increase fog
        // Note: weightedCloud is 0-100.

        let visibilityFactor = 0;
        if (weatherData.current && weatherData.current.visibility !== undefined) {
             // Visibility < 2000m starts adding fog
             const vis = weatherData.current.visibility;
             if (vis < 2000) {
                 visibilityFactor = 1.0 - (vis / 2000); // 0 at 2000m, 1 at 0m
             }
        }

        const targetFogDensity = 0.002 + (weightedCloud / 100) * 0.02 + (weightedSeverity / 100) * 0.04 + visibilityFactor * 0.05;

        // Interpolate current density to target
        scene.fog.density += (targetFogDensity - scene.fog.density) * 0.05;

        // Fog color matching ambient/sky
        // We use the same target ambient color but maybe slightly lighter/bluer
        const fogColor = new THREE.Color().copy(ambientLight.color).multiplyScalar(0.8);
        scene.fog.color.lerp(fogColor, transitionSpeed);
    }

    // Calculate target ambient light intensity
    // Minimum ambient at night (moonlight ambient)
    const nightAmbient = 0.05;
    // Ambient should be higher when cloudy (scattering) relative to sun
    // Base day ambient 0.5
    const dayAmbient = 0.5;
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

    // Adjust scene background - if Sky is present, we don't need to lerp background color manually
    // EXCEPT if we want to fallback or control "ambient" background if sky is hidden (unlikely here)
    // But Sky shader handles the visuals.
    // However, for reflections or if sky is not covering everything, we might keep it.
    // For now, let's keep it but it might be overridden by Sky rendering if not handled carefully.
    // Actually, Sky is a mesh, so scene.background is behind it?
    // Sky is usually a huge Box/Sphere.
    // If we use Sky, scene.background is occluded.
    // So we can remove this block or leave it as fallback. I'll leave it but commented out or simplified
    // to avoid fighting with Sky if Sky opacity is 1.

    // NOTE: Aether Architect wants Sky Shader.
    // We will assume Sky covers the background.
}
