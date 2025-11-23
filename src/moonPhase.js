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

    // Phase values:
    // 0 = New Moon
    // 1 = Waxing Crescent
    // 2 = First Quarter
    // 3 = Waxing Gibbous
    // 4 = Full Moon
    // 5 = Waning Gibbous
    // 6 = Last Quarter
    // 7 = Waning Crescent

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

export function createMoon(phase = 0) {
    const moonGroup = new THREE.Group();

    // Create moon sphere
    const moonGeometry = new THREE.SphereGeometry(0.4, 32, 32);
    const moonMaterial = new THREE.MeshStandardMaterial({
        color: 0xccccaa,
        emissive: 0x444433,
        emissiveIntensity: 0.3,
        roughness: 0.8,
        metalness: 0.1
    });
    const moon = new THREE.Mesh(moonGeometry, moonMaterial);
    moon.castShadow = true;
    moon.receiveShadow = true;
    moonGroup.add(moon);

    // Add shadow overlay for phases
    const shadowGeometry = new THREE.SphereGeometry(0.41, 32, 32);
    const shadowMaterial = new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.7,
        side: THREE.FrontSide
    });
    const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
    
    // Adjust shadow position based on phase
    // 0 = new (fully dark), 4 = full (no shadow), etc.
    const phaseAngle = (phase / 8) * Math.PI * 2;
    shadow.scale.x = Math.abs(Math.cos(phaseAngle));
    
    if (phase > 4) {
        // Waning phases - shadow on right
        shadow.position.x = -0.2 * (1 - shadow.scale.x);
    } else if (phase > 0) {
        // Waxing phases - shadow on left
        shadow.position.x = 0.2 * (1 - shadow.scale.x);
    }

    if (phase !== 4) { // Not full moon
        moonGroup.add(shadow);
    }

    return moonGroup;
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
