import * as THREE from 'three';

let previousIntensity = { sun: 0.8, moon: 0.0, ambient: 0.4 };
const transitionSpeed = 0.02;

export function updateWeatherLighting(scene, sunLight, moonLight, ambientLight, sky, weatherData, astroData) {
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

    // --- SUN LIGHTING ---
    // Calculate target sun light intensity based on cloud cover and weather AND day/night
    const baseSunIntensity = 2.0;
    // Don't reduce intensity too much for clouds, just diffuse it
    const cloudSunFactor = 1 - (weightedCloud / 100) * 0.4;
    const severityFactor = 1 - (weightedSeverity / 100) * 0.4;

    const targetSunIntensity = baseSunIntensity * cloudSunFactor * severityFactor * dayFactor;

    // --- MOON LIGHTING ---
    let targetMoonIntensity = 0;
    let targetMoonColor = new THREE.Color(0x8899cc); // Default blue-ish

    if (astroData && moonLight) {
        // Moon phase illumination
        const moonIllum = astroData.moonIllumination ? astroData.moonIllumination.fraction : 0.5;
        const moonIntensityBase = 0.5 * moonIllum;

        // Calculate cloud attenuation for moon (more aggressive than sun)
        // 100% cloud cover reduces light to 10%
        const cloudMoonFactor = 1 - (weightedCloud / 100) * 0.9;

        // Horizon dimming
        const moonY = moonLight.position.y;
        let moonHorizonFactor = 1.0;
        if (moonY < -2) moonHorizonFactor = 0;
        else if (moonY > 2) moonHorizonFactor = 1;
        else moonHorizonFactor = (moonY + 2) / 4;

        targetMoonIntensity = moonIntensityBase * cloudMoonFactor * moonHorizonFactor;

        // Calculate Moon Color
        // Low illum: Deep Blue (0x223366) -> High illum: Silver/White (0xddddff)
        const minColor = new THREE.Color(0x445588);
        const maxColor = new THREE.Color(0xddddff);
        targetMoonColor.copy(minColor).lerp(maxColor, moonIllum);

        // Tint with weather? If storming, maybe darker/greener?
        if (weightedSeverity > 50) {
             targetMoonColor.lerp(new THREE.Color(0x333344), 0.5);
        }
    }

    // Update Sky Shader
    if (sky) {
        const uniforms = sky.material.uniforms;

        // Use Sun position for scattering
        let scatteringSource = sunLight.position.clone();

        // If Sun is down, use Moon for scattering to keep sky interesting (Moonlight)
        // Check elevation
        if (scatteringSource.y < -0.1 && moonLight && moonLight.position.y > 0) {
            scatteringSource.copy(moonLight.position);
            // Lower intensity/Rayleigh for moon?
            // For now just position.
        }

        uniforms['sunPosition'].value.copy(scatteringSource).normalize();

        // Adjust Turbidity (haze) based on clouds and severity
        // Clear day: 2-5, Cloudy: 10-20
        // Reduced max turbidity to keep sky blue-ish even when cloudy
        const targetTurbidity = 2 + (weightedCloud / 100) * 8 + (weightedSeverity / 100) * 5;
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

        let targetFogDensity = 0.002 + (weightedCloud / 100) * 0.01 + (weightedSeverity / 100) * 0.02 + visibilityFactor * 0.05;
        // CAP Fog density to avoid "Grey Screen of Death"
        // 0.02 is reasonably thick (50m visibility approx).
        if (targetFogDensity > 0.02) targetFogDensity = 0.02;

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
    previousIntensity.moon += (targetMoonIntensity - previousIntensity.moon) * transitionSpeed;

    sunLight.intensity = previousIntensity.sun;
    ambientLight.intensity = previousIntensity.ambient;
    if (moonLight) {
        moonLight.intensity = previousIntensity.moon;
        moonLight.color.lerp(targetMoonColor, transitionSpeed);
    }

    // Smoothly transition colors
    sunLight.color.lerp(targetSunColor, transitionSpeed);
    ambientLight.color.lerp(targetAmbientColor, transitionSpeed);
}
