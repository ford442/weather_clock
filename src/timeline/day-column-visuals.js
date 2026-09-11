// DayColumn.js - 3D Weather Timeline Visualization Component
// Represents a single day as a vertical column with temperature gradient and weather particles

import * as THREE from 'three';

// --- Shader Code for Temperature Gradient ---
// Uses z-score to interpolate between cold and hot colors

export const dayColumnVertexShader = `
  uniform float uZScore;
  uniform float uTempMin;
  uniform float uTempMax;
  uniform float uTime;
  
  varying vec2 vUv;
  varying float vHeight;
  varying vec3 vWorldPosition;
  varying float vTempRatio;
  
  void main() {
    vUv = uv;
    vHeight = position.y;
    
    // Calculate temperature ratio based on height within column
    // Bottom = tempMin, Top = tempMax
    float normalizedY = (position.y + 2.5) / 5.0; // Assuming height 5, centered at 0
    vTempRatio = clamp(normalizedY, 0.0, 1.0);
    
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

export const dayColumnFragmentShader = `
  uniform vec3 uColorCold;      // Deep blue for extreme cold
  uniform vec3 uColorCool;      // Cyan for below normal
  uniform vec3 uColorNeutral;   // Green for near normal
  uniform vec3 uColorWarm;      // Yellow for above normal
  uniform vec3 uColorHot;       // Orange/red for extreme heat
  uniform float uZScore;
  uniform float uTime;
  uniform float uGlowIntensity;
  uniform float uWindStrength;  // 0..1 normalized wind speed

  varying vec2 vUv;
  varying float vHeight;
  varying vec3 vWorldPosition;
  varying float vTempRatio;
  
  // Smooth color interpolation based on z-score
  vec3 getTemperatureColor(float z) {
    // Z-score color mapping:
    // <-2.0: Deep freeze (cold)
    // -2.0 to -1.0: Cold (cool)
    // -1.0 to +1.0: Normal (neutral)
    // +1.0 to +2.0: Warm (warm)
    // >+2.0: Hot (hot)
    
    if (z < -2.0) {
      return uColorCold;
    } else if (z < -1.0) {
      float t = (z + 2.0) / 1.0; // 0 to 1
      return mix(uColorCold, uColorCool, smoothstep(0.0, 1.0, t));
    } else if (z < 0.0) {
      float t = (z + 1.0) / 1.0; // 0 to 1
      return mix(uColorCool, uColorNeutral, smoothstep(0.0, 1.0, t));
    } else if (z < 1.0) {
      float t = z / 1.0; // 0 to 1
      return mix(uColorNeutral, uColorWarm, smoothstep(0.0, 1.0, t));
    } else if (z < 2.0) {
      float t = (z - 1.0) / 1.0; // 0 to 1
      return mix(uColorWarm, uColorHot, smoothstep(0.0, 1.0, t));
    } else {
      return uColorHot;
    }
  }
  
  void main() {
    // Get base temperature color from z-score
    vec3 tempColor = getTemperatureColor(uZScore);

    // Vertical gradient: cooler/darker at base, hotter/brighter at top
    vec3 bottomTint = tempColor * 0.55;
    vec3 topTint = tempColor * 1.45;
    vec3 gradientColor = mix(bottomTint, topTint, smoothstep(0.0, 1.0, vTempRatio));

    // Heat-shimmer bands: rising horizontal stripes, stronger for hot days
    float heat = smoothstep(0.0, 2.0, uZScore);
    float bands = sin((vTempRatio * 18.0) - uTime * 2.0);
    bands = smoothstep(0.6, 1.0, bands) * 0.25 * heat;
    gradientColor += tempColor * bands;

    // Frost crystalline shimmer for cold days
    float cold = smoothstep(0.0, 2.0, -uZScore);
    float frost = sin(vTempRatio * 40.0 + uTime * 1.5) * sin(vUv.x * 50.0);
    frost = smoothstep(0.7, 1.0, frost) * 0.35 * cold;
    gradientColor += vec3(0.8, 0.95, 1.0) * frost;

    // Wind-driven diagonal streaks across the column
    float windStreak = sin((vUv.x * 8.0) + (vTempRatio * 4.0) - uTime * (2.0 + uWindStrength * 6.0));
    windStreak = smoothstep(0.75, 1.0, windStreak) * 0.4 * uWindStrength;
    gradientColor += mix(vec3(0.8, 0.9, 1.0), tempColor, 0.5) * windStreak;

    // Slow breathing pulse — stronger for today
    float pulse = 1.0 + sin(uTime * 2.0) * 0.08 * uGlowIntensity;
    gradientColor *= pulse;

    // Rim/fresnel glow for glassy 3D definition
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    vec3 normal = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
    float fresnel = pow(1.0 - abs(dot(viewDir, normal)), 2.5);
    gradientColor += tempColor * fresnel * (0.6 + uGlowIntensity * 0.4);

    // Top-cap brightening
    float cap = smoothstep(0.85, 1.0, vTempRatio);
    gradientColor += tempColor * cap * 0.4;

    float alpha = 0.85 + fresnel * 0.15;
    gl_FragColor = vec4(gradientColor, alpha);
  }
`;

// --- Temperature Color Constants (Scientifically Calibrated) ---
export const TEMP_COLORS = {
    cold: new THREE.Color(0x1a237e), // Deep blue: Exceptional cold (<-2σ)
    cool: new THREE.Color(0x4fc3f7), // Cyan: Below normal (-2σ to -1σ)
    neutral: new THREE.Color(0x81c784), // Green: Near normal (-1σ to +1σ)
    warm: new THREE.Color(0xfff176), // Yellow: Above normal (+1σ to +2σ)
    hot: new THREE.Color(0xe53935) // Red: Exceptional hot (>+2σ)
};

// --- Weather Code Classification ---
const WEATHER_CONDITIONS = {
    CLEAR: [0, 1],
    CLOUDY: [2, 3, 45, 48],
    RAIN: [51, 53, 55, 61, 63, 65, 80, 81, 82],
    SNOW: [71, 73, 75, 77, 85, 86],
    STORM: [95, 96, 99]
};

/**
 * @param {number} code - WMO weather code
 * @returns {'clear'|'cloudy'|'rain'|'snow'|'storm'}
 */
export function getConditionFromCode(code) {
    if (WEATHER_CONDITIONS.CLEAR.includes(code)) return 'clear';
    if (WEATHER_CONDITIONS.CLOUDY.includes(code)) return 'cloudy';
    if (WEATHER_CONDITIONS.RAIN.includes(code)) return 'rain';
    if (WEATHER_CONDITIONS.SNOW.includes(code)) return 'snow';
    if (WEATHER_CONDITIONS.STORM.includes(code)) return 'storm';
    return 'clear';
}

// --- Mini Particle System for Weather State ---
export class MiniParticleSystem {
    /**
     * @param {'clear'|'cloudy'|'rain'|'snow'|'storm'} condition
     * @param {THREE.Object3D} parentMesh
     * @param {number} [radius]
     */
    constructor(condition, parentMesh, radius = 1) {
        this.condition = condition;
        this.parentMesh = parentMesh;
        this.radius = radius;
        this.mesh = null;
        this.particles = [];
        this.time = 0;

        this.init();
    }

    init() {
        switch (this.condition) {
            case 'clear':
                this.createSparkleParticles();
                break;
            case 'cloudy':
                this.createCloudParticles();
                break;
            case 'rain':
                this.createRainParticles();
                break;
            case 'snow':
                this.createSnowParticles();
                break;
            case 'storm':
                this.createStormParticles();
                break;
            default:
                this.createSparkleParticles();
        }
    }

    createSparkleParticles() {
        // Few bright sparkle particles for clear sky
        const count = 8;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const phases = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const r = Math.random() * this.radius * 0.8;
            positions[i * 3] = Math.cos(angle) * r;
            positions[i * 3 + 1] = Math.random() * 4 - 1;
            positions[i * 3 + 2] = Math.sin(angle) * r;
            sizes[i] = 0.1 + Math.random() * 0.15;
            phases[i] = Math.random() * Math.PI * 2;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));

        const material = new THREE.PointsMaterial({
            color: 0xffffaa,
            size: 0.15,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.mesh = new THREE.Points(geometry, material);
        this.parentMesh.add(this.mesh);
    }

    createCloudParticles() {
        // Soft cloud puffs using small spheres
        const count = 5;
        const group = new THREE.Group();

        for (let i = 0; i < count; i++) {
            const size = 0.3 + Math.random() * 0.4;
            const geometry = new THREE.SphereGeometry(size, 8, 6);
            const material = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.3 + Math.random() * 0.3
            });
            const puff = new THREE.Mesh(geometry, material);

            const angle = Math.random() * Math.PI * 2;
            const r = Math.random() * this.radius * 0.6;
            puff.position.set(Math.cos(angle) * r, 1 + Math.random() * 2, Math.sin(angle) * r);

            group.add(puff);
            this.particles.push({
                mesh: puff,
                basePos: puff.position.clone(),
                speed: 0.2 + Math.random() * 0.3
            });
        }

        this.mesh = group;
        this.parentMesh.add(this.mesh);
    }

    createRainParticles() {
        // Vertical rain streaks
        const count = 30;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 6); // Line segments
        const velocities = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const r = Math.random() * this.radius * 0.9;
            const x = Math.cos(angle) * r;
            const z = Math.sin(angle) * r;
            const y = Math.random() * 5;

            // Line from top to bottom
            positions[i * 6] = x;
            positions[i * 6 + 1] = y;
            positions[i * 6 + 2] = z;
            positions[i * 6 + 3] = x;
            positions[i * 6 + 4] = y - 0.5;
            positions[i * 6 + 5] = z;

            velocities[i] = -0.1 - Math.random() * 0.1;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.LineBasicMaterial({
            color: 0x88ccff,
            transparent: true,
            opacity: 0.6
        });

        this.mesh = new THREE.LineSegments(geometry, material);
        this.velocities = velocities;
        this.parentMesh.add(this.mesh);
    }

    createSnowParticles() {
        // Falling white particles
        const count = 20;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const phases = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const r = Math.random() * this.radius * 0.9;
            positions[i * 3] = Math.cos(angle) * r;
            positions[i * 3 + 1] = Math.random() * 5;
            positions[i * 3 + 2] = Math.sin(angle) * r;
            phases[i] = Math.random() * Math.PI * 2;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));

        const material = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 0.12,
            transparent: true,
            opacity: 0.8
        });

        this.mesh = new THREE.Points(geometry, material);
        this.parentMesh.add(this.mesh);
    }

    createStormParticles() {
        // Intense rain + dark cloud volumes
        this.createRainParticles();

        // Add dark cloud overlay
        const cloudGeo = new THREE.CylinderGeometry(this.radius * 1.1, this.radius * 1.1, 1.5, 16, 1, true);
        const cloudMat = new THREE.MeshBasicMaterial({
            color: 0x4a4a6a,
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide
        });
        const cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
        cloudMesh.position.y = 3;
        this.parentMesh.add(cloudMesh);
        this.stormCloud = cloudMesh;
    }

    update(delta, time) {
        this.time += delta;
        if (!this.mesh) return;

        switch (this.condition) {
            case 'clear':
                this.updateSparkle(delta, time);
                break;
            case 'cloudy':
                this.updateClouds(delta, time);
                break;
            case 'rain':
                this.updateRain(delta, time);
                break;
            case 'snow':
                this.updateSnow(delta, time);
                break;
            case 'storm':
                this.updateStorm(delta, time);
                break;
        }
    }

    updateSparkle(delta, time) {
        // Twinkle effect
        const phases = this.mesh.geometry.attributes.phase.array;
        const positions = this.mesh.geometry.attributes.position.array;

        for (let i = 0; i < phases.length; i++) {
            positions[i * 3 + 1] += Math.sin(time * 2 + phases[i]) * 0.01;
        }

        this.mesh.geometry.attributes.position.needsUpdate = true;
        this.mesh.material.opacity = 0.4 + Math.sin(time * 2) * 0.2;
    }

    updateClouds(_delta, time) {
        // Gentle bobbing
        this.particles.forEach((p, i) => {
            p.mesh.position.y = p.basePos.y + Math.sin(time * p.speed + i) * 0.1;
        });
    }

    updateRain(_delta, _time) {
        const velocities = this.velocities;
        if (!velocities) return;

        const positions = this.mesh.geometry.attributes.position.array;

        for (let i = 0; i < velocities.length; i++) {
            const i6 = i * 6;

            // Move rain down
            positions[i6 + 1] += velocities[i];
            positions[i6 + 4] += velocities[i];

            // Reset if below bottom
            if (positions[i6 + 1] < -2.5) {
                positions[i6 + 1] = 2.5;
                positions[i6 + 4] = 2.0;
            }
        }

        this.mesh.geometry.attributes.position.needsUpdate = true;
    }

    updateSnow(delta, time) {
        const positions = this.mesh.geometry.attributes.position.array;
        const phases = this.mesh.geometry.attributes.phase.array;

        for (let i = 0; i < phases.length; i++) {
            const i3 = i * 3;

            // Fall down slowly
            positions[i3 + 1] -= 0.03;

            // Flutter side to side
            positions[i3] += Math.sin(time * 2 + phases[i]) * 0.01;
            positions[i3 + 2] += Math.cos(time * 1.5 + phases[i]) * 0.01;

            // Reset if below bottom
            if (positions[i3 + 1] < -2.5) {
                positions[i3 + 1] = 2.5;
                // Randomize x/z on reset
                const angle = Math.random() * Math.PI * 2;
                const r = Math.random() * this.radius * 0.9;
                positions[i3] = Math.cos(angle) * r;
                positions[i3 + 2] = Math.sin(angle) * r;
            }
        }

        this.mesh.geometry.attributes.position.needsUpdate = true;
    }

    updateStorm(delta, time) {
        // Update rain
        this.updateRain(delta, time);

        // Flash lightning occasionally
        if (this.stormCloud && Math.random() < 0.01) {
            this.stormCloud.material.opacity = 0.6;
            setTimeout(() => {
                if (this.stormCloud) {
                    this.stormCloud.material.opacity = 0.3;
                }
            }, 100);
        }
    }

    dispose() {
        if (this.mesh) {
            if (this.mesh.geometry) this.mesh.geometry.dispose();
            if (this.mesh.material) {
                if (Array.isArray(this.mesh.material)) {
                    this.mesh.material.forEach((m) => m.dispose());
                } else {
                    this.mesh.material.dispose();
                }
            }
            this.parentMesh.remove(this.mesh);
        }
        if (this.stormCloud) {
            this.stormCloud.geometry.dispose();
            this.stormCloud.material.dispose();
            this.parentMesh.remove(this.stormCloud);
        }
        this.particles.forEach((p) => {
            if (p.mesh) {
                p.mesh.geometry.dispose();
                p.mesh.material.dispose();
            }
        });
    }
}

// --- Accuracy Ring for Historical Days ---
export class AccuracyRing {
    /**
     * @param {TimelineForecastAccuracy} accuracy
     * @param {THREE.Object3D} parentMesh
     * @param {number} radius
     */
    constructor(accuracy, parentMesh, radius) {
        this.accuracy = accuracy; // { mae, rmse, skill, tempScore }
        this.parentMesh = parentMesh;
        this.radius = radius;
        this.mesh = null;
        this.label = null;

        this.init();
    }

    init() {
        // skill is null when there's not enough data to score (legitimate no-data
        // case); treat it as 0 (lowest accuracy) which is also what `null` coerces
        // to in the arithmetic comparisons below, so this is behavior-preserving.
        const skill = this.accuracy.skill ?? 0;

        // Color based on skill score
        // Green (>0.7): Highly accurate
        // Yellow (0.3-0.7): Moderate accuracy
        // Red (<0.3): Low accuracy
        let color;
        if (skill > 0.7) {
            color = 0x4caf50; // Green
        } else if (skill > 0.3) {
            color = 0xffc107; // Yellow
        } else {
            color = 0xf44336; // Red
        }

        // Ring geometry - completeness represents skill score
        const ringRadius = this.radius * 1.3;
        const tubeRadius = 0.08;

        // Create partial torus based on completeness
        const completeness = Math.max(0.1, Math.min(1.0, skill));
        const arc = completeness * Math.PI * 2;

        const geometry = new THREE.TorusGeometry(ringRadius, tubeRadius, 8, Math.floor(32 * completeness), arc);

        const material = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.8
        });

        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.rotation.x = Math.PI / 2; // Lay flat around column
        this.mesh.position.y = -2; // At base of column

        this.parentMesh.add(this.mesh);

        // Add glow effect
        const glowGeo = new THREE.TorusGeometry(ringRadius, tubeRadius * 2, 8, Math.floor(32 * completeness), arc);
        const glowMat = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.3
        });
        this.glowMesh = new THREE.Mesh(glowGeo, glowMat);
        this.glowMesh.rotation.x = Math.PI / 2;
        this.glowMesh.position.y = -2;
        this.parentMesh.add(this.glowMesh);
    }

    dispose() {
        if (this.mesh) {
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
            this.parentMesh.remove(this.mesh);
        }
        if (this.glowMesh) {
            this.glowMesh.geometry.dispose();
            this.glowMesh.material.dispose();
            this.parentMesh.remove(this.glowMesh);
        }
    }
}

// --- Temperature Trend Indicator ---

/** Lazily-built chevron strip shared by every column's trend indicator. */
/** @type {THREE.CanvasTexture|null} */
let trendChevronTexture = null;

/**
 * A vertically tiling chevron pointing toward +Y, faded at both ends.
 * @returns {THREE.CanvasTexture}
 */
function getTrendChevronTexture() {
    if (trendChevronTexture) return trendChevronTexture;

    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));

    const stroke = ctx.createLinearGradient(0, 0, 0, size);
    stroke.addColorStop(0, 'rgba(255, 255, 255, 0)');
    stroke.addColorStop(0.5, 'rgba(255, 255, 255, 0.9)');
    stroke.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.strokeStyle = stroke;
    ctx.lineWidth = size * 0.09;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(size * 0.16, size * 0.7);
    ctx.lineTo(size * 0.5, size * 0.24);
    ctx.lineTo(size * 0.84, size * 0.7);
    ctx.stroke();

    // Taper the sides so the chevron melts into the column's silhouette.
    ctx.globalCompositeOperation = 'destination-in';
    const fade = ctx.createLinearGradient(0, 0, size, 0);
    fade.addColorStop(0, 'rgba(0, 0, 0, 0)');
    fade.addColorStop(0.5, 'rgba(0, 0, 0, 1)');
    fade.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'source-over';

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    trendChevronTexture = texture;
    return texture;
}

/** °C/day of day-over-day change that saturates the trend indicator. */
export const TREND_SATURATION_C = 6;
/** Below this |°C/day| the day reads as steady and shows no chevrons. */
export const TREND_STEADY_C = 0.5;

/**
 * How strongly a day-over-day temperature change should show, 0 (steady — draw nothing)
 * to 1 (a full swing). Shared with the trend indicator so the threshold is testable.
 * @param {number} trendDelta - Day-over-day mean temperature change, in °C.
 * @returns {number}
 */
export function computeTrendStrength(trendDelta) {
    const magnitude = Math.abs(trendDelta || 0);
    return Math.min(1, Math.max(0, (magnitude - TREND_STEADY_C) / TREND_SATURATION_C));
}

/**
 * Chevrons climbing (warming) or falling (cooling) around a day column — the timeline's
 * half of the same rising/falling/steady language the clock scene's temporal band uses.
 * A steady day shows nothing at all, which is the point: only change draws the eye.
 */
export class TrendIndicator {
    /**
     * @param {number} trendDelta - Day-over-day mean temperature change, in °C.
     * @param {THREE.Object3D} parentMesh
     * @param {number} radius - Column radius.
     * @param {number} height - Column height.
     */
    constructor(trendDelta, parentMesh, radius, height) {
        this.trendDelta = trendDelta || 0;
        this.direction = Math.sign(this.trendDelta);
        this.strength = computeTrendStrength(this.trendDelta);
        /** @type {THREE.Group|null} */
        this.group = null;
        this.time = 0;

        if (this.strength <= 0) return;

        const texture = getTrendChevronTexture().clone();
        texture.needsUpdate = true;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(1, 3);
        // Cooling: flip the chevron so it points downward.
        if (this.direction < 0) {
            texture.repeat.y = -3;
            texture.offset.y = 1;
        }
        this.texture = texture;

        this.material = new THREE.MeshBasicMaterial({
            map: texture,
            color: this.direction > 0 ? new THREE.Color(0xff7a45) : new THREE.Color(0x74c7ff),
            transparent: true,
            opacity: 0.25 + this.strength * 0.45,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide
        });

        const geometry = new THREE.PlaneGeometry(radius * 1.35, height * 0.92);
        this.group = new THREE.Group();
        for (const rotation of [0, Math.PI / 2]) {
            const plane = new THREE.Mesh(geometry.clone(), this.material);
            plane.rotation.y = rotation;
            plane.position.set(Math.sin(rotation) * radius * 1.04, 0, Math.cos(rotation) * radius * 1.04);
            this.group.add(plane);
        }
        parentMesh.add(this.group);
    }

    /**
     * @param {number} delta - Seconds since the previous frame.
     */
    update(delta) {
        if (!this.group || !this.texture) return;
        this.time += delta;
        // Chevrons travel the way the temperature is going: up as it warms, down as it cools.
        this.texture.offset.y += delta * (0.12 + this.strength * 0.3) * (this.direction > 0 ? 1 : -1);
        this.material.opacity =
            (0.25 + this.strength * 0.45) * (0.82 + Math.sin(this.time * 1.6) * 0.18 * this.strength);
    }

    /** @param {boolean} visible */
    setVisible(visible) {
        if (this.group) this.group.visible = visible;
    }

    dispose() {
        if (!this.group) return;
        for (const child of this.group.children) {
            /** @type {THREE.Mesh} */ (child).geometry?.dispose();
        }
        this.group.parent?.remove(this.group);
        this.material?.dispose();
        this.texture?.dispose();
        this.group = null;
    }
}
