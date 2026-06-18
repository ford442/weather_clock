// Aether Architect: Verified
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

/**
 * Compute day/night factor from sun altitude (Y in scene units).
 * Extended civil twilight range.
 */
export function getDayFactor(sunY) {
    const twilightRange = 6.0;
    if (sunY < -twilightRange) return 0;
    if (sunY > twilightRange) return 1;
    return (sunY + twilightRange) / (twilightRange * 2);
}

/**
 * Core lighting application for a *single* weather snapshot (used by both
 * the classic triple blend and the new 10-day forecast vignettes).
 * weatherSnap may contain: cloudCover, weatherCode, windSpeed, visibility, severity.
 */
export function updateSingleWeatherLighting(scene, sunLight, moonLight, ambientLight, sky, weatherSnap, astroData) {
    if (!weatherSnap) return;

    const sunY = sunLight ? sunLight.position.y : 0;
    const dayFactor = getDayFactor(sunY);

    const cloud = weatherSnap.cloudCover ?? 50;
    const code = weatherSnap.weatherCode ?? 0;
    const wind = weatherSnap.windSpeed ?? 0;
    const vis = weatherSnap.visibility ?? 10000;
    const sev = weatherSnap.severity !== undefined ? weatherSnap.severity : getSeverity(code);

    // --- SUN LIGHTING ---
    const baseSunIntensity = 2.0;
    const cloudSunFactor = 1 - (cloud / 100) * 0.4;
    const severityFactor = 1 - (sev / 100) * 0.4;
    const targetSunIntensity = baseSunIntensity * cloudSunFactor * severityFactor * dayFactor;

    // --- MOON LIGHTING ---
    let targetMoonIntensity = 0;
    let targetMoonColor = new THREE.Color(0x8899cc);

    if (astroData && moonLight) {
        const moonIllum = astroData.moonIllumination ? astroData.moonIllumination.fraction : 0.5;
        const moonIntensityBase = 0.5 * moonIllum;

        const cloudMoonFactor = 1 - (cloud / 100) * 0.9;

        const moonY = moonLight.position.y;
        let moonHorizonFactor = 1.0;
        if (moonY < -2) moonHorizonFactor = 0;
        else if (moonY > 2) moonHorizonFactor = 1;
        else moonHorizonFactor = (moonY + 2) / 4;

        targetMoonIntensity = moonIntensityBase * cloudMoonFactor * moonHorizonFactor;

        const minColor = new THREE.Color(0x0f1c30);
        const maxColor = new THREE.Color(0xe0e0ff);
        targetMoonColor.copy(minColor).lerp(maxColor, moonIllum);

        if (moonIllum > 0.8) targetMoonIntensity *= 1.2;
        if (sev > 50) {
            targetMoonColor.lerp(new THREE.Color(0x2a2a35), 0.6);
        }
    }

    // Update Sky Shader
    if (sky) {
        const uniforms = sky.material.uniforms;

        let scatteringSource = (sunLight && sunLight.position) ? sunLight.position.clone() : new THREE.Vector3(0, 1, 0);
        let isMoonSource = false;

        if (scatteringSource.y < -0.1 && moonLight && moonLight.position.y > 0) {
            scatteringSource.copy(moonLight.position);
            isMoonSource = true;
        }

        uniforms['sunPosition'].value.copy(scatteringSource).normalize();

        const targetTurbidity = 2.0 + (cloud / 100) * 10.0 + (sev / 100) * 18.0;
        uniforms['turbidity'].value = targetTurbidity;

        const targetRayleigh = 3.0 - (sev / 100) * 2.2;
        uniforms['rayleigh'].value = targetRayleigh;

        const targetMie = 0.005 + (cloud / 100) * 0.05;
        uniforms['mieCoefficient'].value = targetMie;

        uniforms['mieDirectionalG'].value = 0.7;
    }

    // Update Fog (single snap uses its own visibility if present)
    if (scene && scene.fog) {
        let visibilityFactor = 0;
        if (vis < 2000) {
            visibilityFactor = 1.0 - (vis / 2000);
        }
        let targetFogDensity = 0.0001 + (cloud / 100) * 0.005 + (sev / 100) * 0.03 + visibilityFactor * 0.05;
        if (targetFogDensity > 0.025) targetFogDensity = 0.025;

        scene.fog.density += (targetFogDensity - scene.fog.density) * 0.05;

        const fogColor = new THREE.Color().copy(ambientLight.color).multiplyScalar(0.8);
        scene.fog.color.lerp(fogColor, transitionSpeed);
    }

    // Ambient target
    const nightAmbient = 0.05;
    const dayAmbient = 0.5;
    const targetAmbientIntensity = nightAmbient + (dayAmbient - nightAmbient) * dayFactor;

    // Sun color (single uses the snap's code + cloud)
    let targetSunColor;
    if (code >= 95) {
        targetSunColor = new THREE.Color(0xccccff);
    } else if (code >= 70 && code <= 77) {
        targetSunColor = new THREE.Color(0xf0f8ff);
    } else if (code >= 60) {
        targetSunColor = new THREE.Color(0xddeeff);
    } else if (cloud > 70) {
        targetSunColor = new THREE.Color(0xeeeeee);
    } else if (cloud > 40) {
        targetSunColor = new THREE.Color(0xfffae0);
    } else {
        targetSunColor = new THREE.Color(0xfff0c0);
    }

    // Horizon tint (use snap's code/cloud)
    if (cloud < 70 && code < 60 && sunLight) {
        const sY = sunLight.position.y;
        if (sY >= 0 && sY < 10) {
            const sunsetColor = new THREE.Color(0xffaa55);
            const sunsetFactor = 1.0 - (sY / 10.0);
            targetSunColor.lerp(sunsetColor, sunsetFactor * 0.7);
        } else if (sY < 0 && sY > -6) {
            const sunsetColor = new THREE.Color(0xffaa55);
            const duskColor = new THREE.Color(0x8855aa);
            const t = Math.abs(sY) / 6.0;
            const base = new THREE.Color().copy(targetSunColor).lerp(sunsetColor, 0.7);
            targetSunColor.copy(base).lerp(duskColor, t);
        }
    }

    // Ambient color
    let targetAmbientColor;
    if (sev > 70) {
        targetAmbientColor = new THREE.Color(0x333355);
    } else if (sev > 40) {
        targetAmbientColor = new THREE.Color(0x555577);
    } else if (cloud > 60) {
        targetAmbientColor = new THREE.Color(0x888899);
    } else {
        targetAmbientColor = new THREE.Color(0xffffff);
    }

    if (dayFactor < 0.5) {
        const nightColor = new THREE.Color(0x111122);
        const duskColor = new THREE.Color(0x6a4a7c);
        if (dayFactor > 0.2) {
            const t = (0.5 - dayFactor) / 0.3;
            targetAmbientColor.lerp(duskColor, t);
        } else {
            const t = (0.2 - dayFactor) / 0.2;
            targetAmbientColor.copy(duskColor).lerp(nightColor, t);
        }
    }

    // Transitions + flicker (use provided snap wind)
    previousIntensity.sun += (targetSunIntensity - previousIntensity.sun) * transitionSpeed;
    previousIntensity.ambient += (targetAmbientIntensity - previousIntensity.ambient) * transitionSpeed;
    previousIntensity.moon += (targetMoonIntensity - previousIntensity.moon) * transitionSpeed;

    let flicker = 1.0;
    if (wind > 20) {
        const time = performance.now() * 0.001;
        const noise = Math.sin(time * 10) * 0.5 + Math.sin(time * 23) * 0.3 + Math.sin(time * 41) * 0.2;
        const magnitude = Math.min(0.1, (wind - 20) * 0.002);
        flicker = 1.0 + noise * magnitude;
    }

    if (sunLight) {
        sunLight.intensity = previousIntensity.sun * flicker;
        sunLight.color.lerp(targetSunColor, transitionSpeed);
    }
    if (ambientLight) {
        ambientLight.intensity = previousIntensity.ambient * flicker;
        ambientLight.color.lerp(targetAmbientColor, transitionSpeed);
    }
    if (moonLight) {
        moonLight.intensity = previousIntensity.moon * flicker;
        moonLight.color.lerp(targetMoonColor, transitionSpeed);
    }
}

/**
 * Original triple-blend entry point (used by clock mode 3-zone).
 * Computes weighted values then delegates to the single applicator.
 */
export function updateWeatherLighting(scene, sunLight, moonLight, ambientLight, sky, weatherData, astroData) {
    if (!weatherData) return;

    const sunY = sunLight ? sunLight.position.y : 0;
    const dayFactor = getDayFactor(sunY);

    const pastWeight = 0.2;
    const currentWeight = 0.5;
    const forecastWeight = 0.3;

    const pastCloud = weatherData.past?.cloudCover || 50;
    const currentCloud = weatherData.current?.cloudCover || 50;
    const forecastCloud = weatherData.forecast?.cloudCover || 50;

    const pastCode = weatherData.past?.weatherCode || 0;
    const currentCode = weatherData.current?.weatherCode || 0;
    const forecastCode = weatherData.forecast?.weatherCode || 0;

    const weightedCloud =
        pastCloud * pastWeight +
        currentCloud * currentWeight +
        forecastCloud * forecastWeight;

    const getSev = (data) => data && data.severity !== undefined ? data.severity : getSeverity(data?.weatherCode || 0);
    const weightedSeverity =
        getSev(weatherData.past) * pastWeight +
        getSev(weatherData.current) * currentWeight +
        getSev(weatherData.forecast) * forecastWeight;

    const getWind = (data) => data?.windSpeed || 0;
    const weightedWind =
        getWind(weatherData.past) * pastWeight +
        getWind(weatherData.current) * currentWeight +
        getWind(weatherData.forecast) * forecastWeight;

    // Build a "representative" snap for the applicator (color decisions lean on current)
    const repSnap = {
        cloudCover: weightedCloud,
        weatherCode: currentCode,
        windSpeed: weightedWind,
        visibility: (weatherData.current && weatherData.current.visibility) || 10000,
        severity: weightedSeverity
    };

    // Reuse the single implementation for actual application + sky/fog/transitions.
    // Note: the single fn recomputes dayFactor internally from sunY; we already have it but it's cheap.
    updateSingleWeatherLighting(scene, sunLight, moonLight, ambientLight, sky, repSnap, astroData);
}
