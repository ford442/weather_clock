import * as THREE from 'three';
import { createMoonMaterial, createMoonMaterialWebGPU } from './webgpu/materials/MoonMaterial.js';

/** Tuning for the moon disk's own appearance (the light it casts lives in weatherLighting.js). */
export const MOON_DISK_CONFIG = {
    /** Surface brightness at a quarter moon vs. at full — the opposition surge on the disk itself. */
    minSurfaceBrightness: 0.85,
    maxSurfaceBrightness: 1.15,
    /** How dark extinction is allowed to take the disk at the horizon. */
    minHorizonBrightness: 0.35,
    /** Clamp on the super/micromoon apparent-size swing, ±5% of mean. */
    maxApparentSizeDelta: 0.06
};

export function calculateMoonPhase(date = new Date()) {
    // Moon phase calculation using astronomical algorithm
    let year = date.getFullYear();
    let month = date.getMonth() + 1;
    const day = date.getDate();

    let c, e, jd, b;

    if (month < 3) {
        year--;
        month += 12;
    }

    c = 365.25 * year;
    e = 30.6 * month;
    jd = c + e + day - 694039.09; // Julian date relative to Jan 1, 2000
    jd /= 29.53059; // Divide by moon cycle
    b = parseInt(jd);
    jd -= b;
    b = Math.round(jd * 8);

    if (b >= 8) b = 0;

    const phaseNames = [
        'New Moon 🌑',
        'Waxing Crescent 🌒',
        'First Quarter 🌓',
        'Waxing Gibbous 🌔',
        'Full Moon 🌕',
        'Waning Gibbous 🌖',
        'Last Quarter 🌗',
        'Waning Crescent 🌘'
    ];

    return {
        phase: b,
        phaseName: phaseNames[b],
        illumination: jd // 0-1, fraction of moon illuminated
    };
}

export const moonVertexShader = `
varying vec3 vNormal;
varying vec3 vWorldPosition;

void main() {
    // Transform normal to world space
    // Note: This assumes uniform scaling. For non-uniform, use normalMatrix (view space) or inverse transpose of model matrix.
    // Here we use modelMatrix rotation part.
    vNormal = normalize(mat3(modelMatrix) * normal);

    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;

    gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const moonFragmentShader = `
uniform vec3 uSunPosition;
// Surface brightness of the lit disk relative to a full moon at the zenith:
// folds the opposition surge together with atmospheric extinction.
uniform float uBrightness;
// Ashen light filling the dark limb — sunlight bounced off the Earth. Peaks
// near new moon, when the Earth is full as seen from the Moon.
uniform float uEarthshine;
// How far extinction has reddened the moon (0 at the zenith, 1 near the horizon).
uniform float uWarmth;

varying vec3 vNormal;
varying vec3 vWorldPosition;

// Simple pseudo-random noise
float rand(vec2 co){
    return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
}

void main() {
    vec3 normal = normalize(vNormal);
    vec3 sunDir = normalize(uSunPosition - vWorldPosition);
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);

    float nDotL = dot(normal, sunDir);
    float muSun = max(nDotL, 0.0);
    float muView = max(dot(normal, viewDir), 0.0);

    // Sharpness of the terminator (shadow edge)
    // Moon has no atmosphere, so it's relatively sharp but surface roughness softens it slightly
    float terminator = smoothstep(-0.04, 0.05, nDotL);

    // Lommel-Seeliger reflectance: the regolith back-scatters, so the lit face
    // reads nearly flat out to the limb rather than falling off like a Lambert
    // sphere. This is what makes the real Moon look like a disk, and it keeps a
    // crescent's bright edge crisp instead of fading into the terminator.
    float scatter = muSun / max(muSun + muView, 0.001);
    float lightIntensity = clamp(terminator * mix(muSun, scatter * 1.35, 0.85), 0.0, 1.0);

    // Base colors
    vec3 litColor = mix(vec3(0.8, 0.8, 0.75), vec3(0.86, 0.7, 0.52), uWarmth); // pale grey → horizon amber
    vec3 darkColor = vec3(0.015, 0.015, 0.022); // Very dark blue-grey
    vec3 earthshineColor = vec3(0.045, 0.06, 0.105); // Cool blue-grey earthshine — faint by design

    // Simple crater noise
    float noise = rand(vWorldPosition.xy * 2.0) * 0.1;
    litColor -= noise;
    litColor *= uBrightness;

    vec3 shadowedColor = mix(darkColor, earthshineColor, clamp(uEarthshine, 0.0, 1.0));
    vec3 finalColor = mix(shadowedColor, litColor, lightIntensity);

    gl_FragColor = vec4(finalColor, 1.0);
}
`;

export function createMoon(_phase = 0) {
    const moonGroup = new THREE.Group();

    // Create moon sphere
    const moonGeometry = new THREE.SphereGeometry(0.4, 64, 64); // Increased segment count for smooth shader

    const moonMaterial = createMoonMaterial();

    const moon = new THREE.Mesh(moonGeometry, moonMaterial);
    moon.name = 'MoonMesh';
    moon.castShadow = true;
    moon.receiveShadow = true;
    moonGroup.add(moon);

    return moonGroup;
}

/**
 * Drive the moon disk from the current sun position and moonlight model so the
 * terminator, earthshine, horizon warmth and apparent size all track the real
 * phase, distance and altitude. Used by clock mode and the forecast/timeline
 * vignettes alike.
 * @param {THREE.Object3D} moonGroup
 * @param {THREE.Vector3} sunPosition
 * @param {MoonlightModel|null} [moonlight] Omit to leave the photometric uniforms untouched.
 */
export function updateMoonVisuals(moonGroup, sunPosition, moonlight = null) {
    const moon = moonGroup.getObjectByName('MoonMesh');
    if (!moon) return;

    const uniforms = /** @type {THREE.ShaderMaterial} */ (moon.material).uniforms;
    if (uniforms?.uSunPosition) {
        uniforms.uSunPosition.value.copy(sunPosition);
    }
    if (!moonlight) return;

    if (uniforms?.uBrightness) {
        // Surface brightness is nearly phase-independent (a crescent's lit sliver
        // is as bright per unit area as a full moon's) — the opposition surge is
        // the one real exception, so it only nudges the disk. Extinction is what
        // actually dims a moon sitting low on the horizon.
        const surge = Math.sqrt(Math.max(moonlight.oppositionSurge, 0));
        const surfaceBrightness =
            MOON_DISK_CONFIG.minSurfaceBrightness +
            (MOON_DISK_CONFIG.maxSurfaceBrightness - MOON_DISK_CONFIG.minSurfaceBrightness) * surge;
        const extinctionDimming =
            MOON_DISK_CONFIG.minHorizonBrightness +
            (1 - MOON_DISK_CONFIG.minHorizonBrightness) * moonlight.transmission;
        uniforms.uBrightness.value = surfaceBrightness * extinctionDimming;
    }
    if (uniforms?.uEarthshine) {
        uniforms.uEarthshine.value = moonlight.earthshine;
    }
    if (uniforms?.uWarmth) {
        uniforms.uWarmth.value = moonlight.horizonReddening;
    }

    // Perigee/apogee change the moon's apparent diameter by ~±5%.
    const sizeDelta = Math.max(
        -MOON_DISK_CONFIG.maxApparentSizeDelta,
        Math.min(MOON_DISK_CONFIG.maxApparentSizeDelta, (moonlight.apparentSizeFactor ?? 1) - 1)
    );
    moon.scale.setScalar(1 + sizeDelta);
}

export async function initMoonWebGPU(moonGroup) {
    const moon = moonGroup.getObjectByName('MoonMesh');
    if (moon) {
        moon.material = await createMoonMaterialWebGPU();
    }
}

export function positionMoon(moonGroup, sundialPosition, time = new Date()) {
    // Position moon in orbit around sundial
    const hours = time.getHours() + time.getMinutes() / 60;

    // Moon rises in the evening and sets in the morning
    // Opposite schedule to sun
    const moonAngle = ((hours + 12) / 24) * Math.PI * 2;

    const orbitRadius = 6;
    const moonHeight = 4;

    moonGroup.position.x = sundialPosition.x + Math.cos(moonAngle) * orbitRadius;
    moonGroup.position.y = sundialPosition.y + moonHeight + Math.sin(moonAngle) * 2;
    moonGroup.position.z = sundialPosition.z + Math.sin(moonAngle) * orbitRadius;

    // Make moon look at sundial
    moonGroup.lookAt(sundialPosition.x, sundialPosition.y, sundialPosition.z);
}
