// Aether Architect: Verified
import * as THREE from 'three';

let previousIntensity = { sun: 0.8, moon: 0.0, ambient: 0.4 };
const transitionSpeed = 0.01; // Slower transition (approx 5s)

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;

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

function getSeasonalWarmth(date = new Date(), lat = 40.7128) {
    const d = date instanceof Date ? date : new Date(date);
    const start = new Date(d.getFullYear(), 0, 0);
    const dayOfYear = Math.floor((d.getTime() - start.getTime()) / 86400000);
    const northernWarmth = (Math.sin(((dayOfYear - 80) / 365) * Math.PI * 2) + 1) / 2;
    return lat < 0 ? 1 - northernWarmth : northernWarmth;
}

function getVisibilityHaze(visibility = 10000) {
    if (visibility == null) return 0;
    return clamp(1 - (visibility - 2000) / 10000, 0, 1);
}

/**
 * Forecast-day atmosphere controls for the Three Sky shader and lights.
 * This is intentionally opt-in: clock mode omits weatherSnap.atmosphere and
 * keeps the established live lighting formula.
 * @param {WeatherSnapshot} weatherSnap
 * @param {Object|null} [astroData]
 * @param {{date?: Date, lat?: number}} [options]
 * @returns {AtmosphereUniforms}
 */
export function deriveDailyAtmosphere(weatherSnap, astroData = null, options = {}) {
    const cloud = clamp(weatherSnap?.cloudCover ?? 50, 0, 100);
    const cloudFactor = cloud / 100;
    const code = weatherSnap?.weatherCode ?? 0;
    const severity = clamp(weatherSnap?.severity ?? getSeverity(code), 0, 100) / 100;
    const visibility = weatherSnap?.visibility ?? 10000;
    const haze = clamp(getVisibilityHaze(visibility) * 0.75 + cloudFactor * 0.35 + severity * 0.4, 0, 1);
    const seasonalWarmth = getSeasonalWarmth(options.date, options.lat ?? 40.7128);

    const sunY = astroData?.sunPosition?.y ?? 0;
    const dayFactor = getDayFactor(sunY);
    const lowSunFactor = dayFactor > 0 ? clamp(1 - sunY / 12, 0, 1) : 0;
    const overcastFactor = clamp((cloudFactor - 0.55) / 0.45, 0, 1);
    const brokenCloudFactor = cloudFactor > 0.25 && cloudFactor < 0.75 ? 1 : 0;

    const clearBlueBoost = (1 - cloudFactor) * (0.75 + seasonalWarmth * 0.25);
    const stormCooling = code >= 95 ? 1 : 0;
    const snowCooling = code >= 70 && code <= 77 ? 1 : 0;

    return {
        turbidity: clamp(lerp(2.2, 9.5, cloudFactor) + haze * 9.5 + severity * 7.0 + lowSunFactor * 2.0, 2, 28),
        rayleigh: clamp(lerp(1.25, 4.2, clearBlueBoost) - severity * 1.0 - overcastFactor * 0.8, 0.55, 4.5),
        mieCoefficient: clamp(
            0.0035 + haze * 0.05 + cloudFactor * 0.018 + lowSunFactor * brokenCloudFactor * 0.018,
            0.002,
            0.09
        ),
        mieDirectionalG: clamp(0.68 + haze * 0.12 + lowSunFactor * brokenCloudFactor * 0.06, 0.62, 0.86),
        sunIntensityMultiplier: clamp(
            (0.78 + seasonalWarmth * 0.18) * (1 - overcastFactor * 0.45) * (1 - severity * 0.35),
            0.18,
            1.15
        ),
        ambientIntensityMultiplier: clamp(0.82 + overcastFactor * 0.55 + haze * 0.18, 0.72, 1.45),
        moonIntensityMultiplier: clamp((1 - cloudFactor * 0.85) * (1 - haze * 0.35), 0.05, 1),
        shadowRadius: lerp(0.8, 6.0, clamp(overcastFactor * 0.75 + haze * 0.35 + severity * 0.35, 0, 1)),
        fogDensityMultiplier: clamp(0.75 + haze * 1.6 + severity * 0.7, 0.75, 3.0),
        skyFogColor: new THREE.Color(0x9fb4ca).lerp(
            new THREE.Color(0x7f8791),
            clamp(overcastFactor + severity * 0.5, 0, 1)
        ),
        sunColor: new THREE.Color(0xfff2c8)
            .lerp(new THREE.Color(0xffb36a), lowSunFactor * (1 - overcastFactor) * 0.55)
            .lerp(new THREE.Color(0xdde7f2), overcastFactor * 0.5 + snowCooling * 0.3)
            .lerp(new THREE.Color(0xbcc8ff), stormCooling * 0.35),
        ambientColor: new THREE.Color(0xffffff)
            .lerp(new THREE.Color(0x8d98a8), overcastFactor * 0.75)
            .lerp(new THREE.Color(0x667089), severity * 0.45)
    };
}

/**
 * Core lighting application for a *single* weather snapshot (used by both
 * the classic triple blend and the new 10-day forecast vignettes).
 * weatherSnap may contain: cloudCover, weatherCode, windSpeed, visibility, severity.
 * @param {WeatherSnapshot} weatherSnap
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
    const atmosphere = weatherSnap.atmosphere || null;
    const localTransitionSpeed = atmosphere ? 0.045 : transitionSpeed;

    // --- SUN LIGHTING ---
    const baseSunIntensity = 2.0;
    const cloudSunFactor = 1 - (cloud / 100) * 0.4;
    const severityFactor = 1 - (sev / 100) * 0.4;
    const targetSunIntensity =
        baseSunIntensity * cloudSunFactor * severityFactor * dayFactor * (atmosphere?.sunIntensityMultiplier ?? 1);

    // --- MOON LIGHTING ---
    let targetMoonIntensity = 0;
    let targetMoonColor = new THREE.Color(0x8899cc);

    if (astroData && moonLight) {
        const moonIllum = astroData.moonIllumination ? astroData.moonIllumination.fraction : 0.5;
        const moonIntensityBase = 0.5 * moonIllum;

        const cloudMoonFactor = 1 - (cloud / 100) * 0.9;

        const moonY = moonLight.position.y;
        let moonHorizonFactor;
        if (moonY < -2) moonHorizonFactor = 0;
        else if (moonY > 2) moonHorizonFactor = 1;
        else moonHorizonFactor = (moonY + 2) / 4;

        targetMoonIntensity =
            moonIntensityBase * cloudMoonFactor * moonHorizonFactor * (atmosphere?.moonIntensityMultiplier ?? 1);

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

        let scatteringSource = sunLight && sunLight.position ? sunLight.position.clone() : new THREE.Vector3(0, 1, 0);
        if (scatteringSource.y < -0.1 && moonLight && moonLight.position.y > 0) {
            scatteringSource.copy(moonLight.position);
        }

        uniforms['sunPosition'].value.copy(scatteringSource).normalize();

        const targetTurbidity = atmosphere?.turbidity ?? 2.0 + (cloud / 100) * 10.0 + (sev / 100) * 18.0;
        uniforms['turbidity'].value = targetTurbidity;

        const targetRayleigh = atmosphere?.rayleigh ?? 3.0 - (sev / 100) * 2.2;
        uniforms['rayleigh'].value = targetRayleigh;

        const targetMie = atmosphere?.mieCoefficient ?? 0.005 + (cloud / 100) * 0.05;
        uniforms['mieCoefficient'].value = targetMie;

        uniforms['mieDirectionalG'].value = atmosphere?.mieDirectionalG ?? 0.7;
        sky.userData.atmosphere = {
            turbidity: targetTurbidity,
            rayleigh: targetRayleigh,
            mieCoefficient: targetMie,
            mieDirectionalG: uniforms['mieDirectionalG'].value
        };
    }

    // Update Fog (single snap uses its own visibility if present)
    if (scene && scene.fog) {
        let visibilityFactor = 0;
        if (vis < 2000) {
            visibilityFactor = 1.0 - vis / 2000;
        }
        let targetFogDensity =
            (0.0001 + (cloud / 100) * 0.005 + (sev / 100) * 0.03 + visibilityFactor * 0.05) *
            (atmosphere?.fogDensityMultiplier ?? 1);
        if (targetFogDensity > 0.025) targetFogDensity = 0.025;

        scene.fog.density += (targetFogDensity - scene.fog.density) * 0.05;

        const fogColor = atmosphere?.skyFogColor
            ? new THREE.Color().copy(atmosphere.skyFogColor)
            : new THREE.Color().copy(ambientLight.color).multiplyScalar(0.8);
        scene.fog.color.lerp(fogColor, localTransitionSpeed);
    }

    // Ambient target
    const nightAmbient = 0.05;
    const dayAmbient = 0.5;
    const targetAmbientIntensity = nightAmbient + (dayAmbient - nightAmbient) * dayFactor;

    // Sun color (single uses the snap's code + cloud)
    let targetSunColor;
    if (atmosphere?.sunColor) {
        targetSunColor = atmosphere.sunColor.clone();
    } else if (code >= 95) {
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
            const sunsetFactor = 1.0 - sY / 10.0;
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
    if (atmosphere?.ambientColor) {
        targetAmbientColor = atmosphere.ambientColor.clone();
    } else if (sev > 70) {
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
    const adjustedAmbientIntensity = targetAmbientIntensity * (atmosphere?.ambientIntensityMultiplier ?? 1);
    previousIntensity.sun += (targetSunIntensity - previousIntensity.sun) * localTransitionSpeed;
    previousIntensity.ambient += (adjustedAmbientIntensity - previousIntensity.ambient) * localTransitionSpeed;
    previousIntensity.moon += (targetMoonIntensity - previousIntensity.moon) * localTransitionSpeed;

    let flicker = 1.0;
    if (wind > 20) {
        const time = performance.now() * 0.001;
        const noise = Math.sin(time * 10) * 0.5 + Math.sin(time * 23) * 0.3 + Math.sin(time * 41) * 0.2;
        const magnitude = Math.min(0.1, (wind - 20) * 0.002);
        flicker = 1.0 + noise * magnitude;
    }

    if (sunLight) {
        sunLight.intensity = previousIntensity.sun * flicker;
        sunLight.color.lerp(targetSunColor, localTransitionSpeed);
        if (sunLight.shadow && atmosphere?.shadowRadius != null) {
            sunLight.shadow.radius += (atmosphere.shadowRadius - sunLight.shadow.radius) * localTransitionSpeed;
        }
    }
    if (ambientLight) {
        ambientLight.intensity = previousIntensity.ambient * flicker;
        ambientLight.color.lerp(targetAmbientColor, localTransitionSpeed);
    }
    if (moonLight) {
        moonLight.intensity = previousIntensity.moon * flicker;
        moonLight.color.lerp(targetMoonColor, localTransitionSpeed);
    }
}

/**
 * Original triple-blend entry point (used by clock mode 3-zone).
 * Computes weighted values then delegates to the single applicator.
 */
export function updateWeatherLighting(scene, sunLight, moonLight, ambientLight, sky, weatherData, astroData) {
    if (!weatherData) return;

    const pastWeight = 0.2;
    const currentWeight = 0.5;
    const forecastWeight = 0.3;

    const pastCloud = weatherData.past?.cloudCover || 50;
    const currentCloud = weatherData.current?.cloudCover || 50;
    const forecastCloud = weatherData.forecast?.cloudCover || 50;

    const currentCode = weatherData.current?.weatherCode || 0;

    const weightedCloud = pastCloud * pastWeight + currentCloud * currentWeight + forecastCloud * forecastWeight;

    const getSev = (data) =>
        data && data.severity !== undefined ? data.severity : getSeverity(data?.weatherCode || 0);
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
