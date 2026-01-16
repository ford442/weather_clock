import * as THREE from 'three';

let previousIntensity = { sun: 0.8, moon: 0.0, ambient: 0.4 };
const transitionSpeed = 0.01; // Slower transition (approx 5s)

// Calculate weighted severity (0 = clear, 100 = severe weather)
export const getSeverity = (code) => {
    if (code === 0) return 0;
    if (code <= 3) return code * 10;
    if (code >= 95) return 100; // Thunderstorm
    if (code >= 80) return 70; // Heavy rain/snow
    if (code >= 60) return 50; // Rain
    return 30; // Other conditions
};

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

    // Helper to get severity from object (if pre-interpolated) or code
    const getSev = (data) => data && data.severity !== undefined ? data.severity : getSeverity(data?.weatherCode || 0);

    const weightedSeverity = 
        getSev(weatherData.past) * pastWeight +
        getSev(weatherData.current) * currentWeight +
        getSev(weatherData.forecast) * forecastWeight;

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

        // Calculate Moon Color (Photorealistic Upgrade)
        // Deep Navy (0x0f1c30) for new moon -> Bright Silver (0xe0e0ff) for full moon
        // This gives a much richer night atmosphere than the previous simple blue.
        const minColor = new THREE.Color(0x0f1c30);
        const maxColor = new THREE.Color(0xe0e0ff);
        targetMoonColor.copy(minColor).lerp(maxColor, moonIllum);

        // Boost intensity slightly for full moon to cast clearer shadows
        if (moonIllum > 0.8) targetMoonIntensity *= 1.2;

        // Tint with weather? If storming, shift towards a moody slate grey
        if (weightedSeverity > 50) {
             targetMoonColor.lerp(new THREE.Color(0x2a2a35), 0.6);
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
        // Photorealistic Tuning:
        // Clear day: ~2. Storm: ~15 (More haze/density).
        // We increase range to make storms look oppressive.
        const targetTurbidity = 2 + (weightedCloud / 100) * 8 + (weightedSeverity / 100) * 10;
        uniforms['turbidity'].value = targetTurbidity;

        // Rayleigh (scattering) - Determines sky color.
        // 3.0 = Nice Blue. Lower = Darker/Greyer. Higher = Redder sunset.
        // During heavy weather, we want a darker sky, so we drop Rayleigh slightly less aggressively
        // but ensure Turbidity does the work of "greying" it out.
        // Start: 3.0. Storm: 1.2.
        const targetRayleigh = 3.0 - (weightedSeverity / 100) * 1.8;
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

        let targetFogDensity = 0.0001 + (weightedCloud / 100) * 0.005 + (weightedSeverity / 100) * 0.02 + visibilityFactor * 0.05;
        // CAP Fog density to avoid "Grey Screen of Death"
        // Reduced max density from 0.02 to 0.015 to ensure Sky Shader remains visible
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
    // Enhanced palette for realism:
    // Thunderstorm: Cold, bluish-white (electric).
    // Snow: Clean white (no yellow tint).
    // Rain: Muted, desaturated warm grey.
    // Overcast: Flat white.
    // Clear: Warm, golden-white.
    let targetSunColor;
    if (currentCode >= 95) {
        targetSunColor = new THREE.Color(0xccccff); // Electric Blue-White
    } else if (currentCode >= 70 && currentCode <= 77) { // Snow
        targetSunColor = new THREE.Color(0xf0f8ff); // Alice Blue / Ice White
    } else if (currentCode >= 60) { // Rain
        targetSunColor = new THREE.Color(0xddeeff); // Cool White
    } else if (weightedCloud > 70) {
        targetSunColor = new THREE.Color(0xeeeeee); // Flat White
    } else if (weightedCloud > 40) {
        targetSunColor = new THREE.Color(0xfffae0); // Soft Yellow-White
    } else {
        targetSunColor = new THREE.Color(0xfff0c0); // Golden White
    }

    // Calculate ambient color
    let targetAmbientColor;
    if (weightedSeverity > 70) {
        targetAmbientColor = new THREE.Color(0x444466);
    } else if (weightedSeverity > 40) { // Rain/Moderate weather (Code 63 is here)
        // Darker, bluer grey for rain
        targetAmbientColor = new THREE.Color(0x555577);
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
