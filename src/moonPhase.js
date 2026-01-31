import * as THREE from 'three';

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

const moonVertexShader = `
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

const moonFragmentShader = `
uniform vec3 uSunPosition;
varying vec3 vNormal;
varying vec3 vWorldPosition;

// Simple pseudo-random noise
float rand(vec2 co){
    return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
}

void main() {
    vec3 sunDir = normalize(uSunPosition - vWorldPosition);
    float nDotL = dot(vNormal, sunDir);

    // Sharpness of the terminator (shadow edge)
    // Moon has no atmosphere, so it's relatively sharp but surface roughness softens it slightly
    float lightIntensity = smoothstep(-0.05, 0.05, nDotL);

    // Base colors
    vec3 litColor = vec3(0.8, 0.8, 0.75); // Pale yellow-white
    vec3 darkColor = vec3(0.02, 0.02, 0.03); // Very dark blue-grey (Earthshine)

    // Simple crater noise
    float noise = rand(vWorldPosition.xy * 2.0) * 0.1;
    litColor -= noise;

    vec3 finalColor = mix(darkColor, litColor, lightIntensity);

    gl_FragColor = vec4(finalColor, 1.0);
}
`;

export function createMoon(phase = 0) {
    const moonGroup = new THREE.Group();

    // Create moon sphere
    const moonGeometry = new THREE.SphereGeometry(0.4, 64, 64); // Increased segment count for smooth shader

    const moonMaterial = new THREE.ShaderMaterial({
        uniforms: {
            uSunPosition: { value: new THREE.Vector3(0, 0, 100) } // Default sun pos
        },
        vertexShader: moonVertexShader,
        fragmentShader: moonFragmentShader
    });

    const moon = new THREE.Mesh(moonGeometry, moonMaterial);
    moon.name = 'MoonMesh';
    moon.castShadow = true;
    moon.receiveShadow = true;
    moonGroup.add(moon);

    return moonGroup;
}

export function updateMoonVisuals(moonGroup, sunPosition) {
    const moon = moonGroup.getObjectByName('MoonMesh');
    if (moon && moon.material.uniforms) {
        moon.material.uniforms.uSunPosition.value.copy(sunPosition);
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
