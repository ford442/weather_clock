// DayColumn.js - 3D Weather Timeline Visualization Component
// Represents a single day as a vertical column with temperature gradient and weather particles

import * as THREE from 'three';

// --- Shader Code for Temperature Gradient ---
// Uses z-score to interpolate between cold and hot colors

const dayColumnVertexShader = `
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

const dayColumnFragmentShader = `
  uniform vec3 uColorCold;      // Deep blue for extreme cold
  uniform vec3 uColorCool;      // Cyan for below normal
  uniform vec3 uColorNeutral;   // Green for near normal
  uniform vec3 uColorWarm;      // Yellow for above normal
  uniform vec3 uColorHot;       // Orange/red for extreme heat
  uniform float uZScore;
  uniform float uTime;
  uniform float uGlowIntensity;
  
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
    
    // Add vertical gradient based on temp range (min at bottom, max at top)
    vec3 bottomTint = tempColor * 0.7;  // Darker at bottom
    vec3 topTint = tempColor * 1.3;      // Brighter at top
    vec3 gradientColor = mix(bottomTint, topTint, vTempRatio);
    
    // Add subtle pulsing glow effect
    float pulse = 1.0 + sin(uTime * 2.0) * 0.05 * uGlowIntensity;
    gradientColor *= pulse;
    
    // Edge highlight for 3D definition
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    vec3 normal = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
    float fresnel = pow(1.0 - abs(dot(viewDir, normal)), 2.0);
    gradientColor += tempColor * fresnel * 0.3;
    
    gl_FragColor = vec4(gradientColor, 0.9);
  }
`;

// --- Temperature Color Constants (Scientifically Calibrated) ---
const TEMP_COLORS = {
  cold: new THREE.Color(0x1a237e),      // Deep blue: Exceptional cold (<-2σ)
  cool: new THREE.Color(0x4fc3f7),      // Cyan: Below normal (-2σ to -1σ)
  neutral: new THREE.Color(0x81c784),   // Green: Near normal (-1σ to +1σ)
  warm: new THREE.Color(0xfff176),      // Yellow: Above normal (+1σ to +2σ)
  hot: new THREE.Color(0xe53935)        // Red: Exceptional hot (>+2σ)
};

// --- Weather Code Classification ---
const WEATHER_CONDITIONS = {
  CLEAR: [0, 1],
  CLOUDY: [2, 3, 45, 48],
  RAIN: [51, 53, 55, 61, 63, 65, 80, 81, 82],
  SNOW: [71, 73, 75, 77, 85, 86],
  STORM: [95, 96, 99]
};

function getConditionFromCode(code) {
  if (WEATHER_CONDITIONS.CLEAR.includes(code)) return 'clear';
  if (WEATHER_CONDITIONS.CLOUDY.includes(code)) return 'cloudy';
  if (WEATHER_CONDITIONS.RAIN.includes(code)) return 'rain';
  if (WEATHER_CONDITIONS.SNOW.includes(code)) return 'snow';
  if (WEATHER_CONDITIONS.STORM.includes(code)) return 'storm';
  return 'clear';
}

// --- Mini Particle System for Weather State ---
class MiniParticleSystem {
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
      puff.position.set(
        Math.cos(angle) * r,
        1 + Math.random() * 2,
        Math.sin(angle) * r
      );
      
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
    const cloudGeo = new THREE.CylinderGeometry(
      this.radius * 1.1,
      this.radius * 1.1,
      1.5,
      16,
      1,
      true
    );
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
      const twinkle = 0.5 + 0.5 * Math.sin(time * 3 + phases[i]);
      positions[i * 3 + 1] += Math.sin(time * 2 + phases[i]) * 0.01;
    }
    
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.material.opacity = 0.4 + Math.sin(time * 2) * 0.2;
  }
  
  updateClouds(delta, time) {
    // Gentle bobbing
    this.particles.forEach((p, i) => {
      p.mesh.position.y = p.basePos.y + Math.sin(time * p.speed + i) * 0.1;
    });
  }
  
  updateRain(delta, time) {
    const positions = this.mesh.geometry.attributes.position.array;
    
    for (let i = 0; i < this.velocities.length; i++) {
      const i6 = i * 6;
      
      // Move rain down
      positions[i6 + 1] += this.velocities[i];
      positions[i6 + 4] += this.velocities[i];
      
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
          this.mesh.material.forEach(m => m.dispose());
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
    this.particles.forEach(p => {
      if (p.mesh) {
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
      }
    });
  }
}

// --- Accuracy Ring for Historical Days ---
class AccuracyRing {
  constructor(accuracy, parentMesh, radius) {
    this.accuracy = accuracy; // { mae, rmse, skill, tempScore }
    this.parentMesh = parentMesh;
    this.radius = radius;
    this.mesh = null;
    this.label = null;
    
    this.init();
  }
  
  init() {
    const { skill, mae } = this.accuracy;
    
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
    
    const geometry = new THREE.TorusGeometry(
      ringRadius,
      tubeRadius,
      8,
      Math.floor(32 * completeness),
      arc
    );
    
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
    const glowGeo = new THREE.TorusGeometry(
      ringRadius,
      tubeRadius * 2,
      8,
      Math.floor(32 * completeness),
      arc
    );
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

// --- Main DayColumn Class ---

export class DayColumn {
  constructor(dayData, options = {}) {
    this.data = dayData;
    this.options = {
      height: 5,
      radius: 1,
      segments: 32,
      lodDistance: { high: 10, medium: 25, low: 50 },
      ...options
    };
    
    this.mesh = null;
    this.particleSystem = null;
    this.accuracyRing = null;
    this.lodLevel = 'high';
    this.time = 0;
    
    this.init();
  }
  
  init() {
    this.createMesh();
    this.createWeatherParticles();
    if (this.data.type === 'historical' && this.data.accuracy) {
      this.createAccuracyRing();
    }
  }
  
  createMesh() {
    // Create cylinder with shader material
    const { height, radius, segments } = this.options;
    
    const geometry = new THREE.CylinderGeometry(radius, radius, height, segments);
    
    // Determine if this is "today" for glow intensity
    const isToday = this.data.type === 'forecast' && Math.abs(this.data.dayOffset || 0) < 0.5;
    const glowIntensity = isToday ? 1.0 : 0.5;
    
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uZScore: { value: this.data.zScore || 0 },
        uTempMin: { value: this.data.tempMin || 0 },
        uTempMax: { value: this.data.tempMax || 0 },
        uTime: { value: 0 },
        uGlowIntensity: { value: glowIntensity },
        uColorCold: { value: TEMP_COLORS.cold },
        uColorCool: { value: TEMP_COLORS.cool },
        uColorNeutral: { value: TEMP_COLORS.neutral },
        uColorWarm: { value: TEMP_COLORS.warm },
        uColorHot: { value: TEMP_COLORS.hot }
      },
      vertexShader: dayColumnVertexShader,
      fragmentShader: dayColumnFragmentShader,
      transparent: true,
      side: THREE.DoubleSide
    });
    
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.y = height / 2; // Sit on ground plane
    
    // Add user data for raycasting identification
    this.mesh.userData = {
      dayColumn: this,
      date: this.data.date,
      type: this.data.type
    };
  }
  
  createWeatherParticles() {
    const condition = this.data.condition || getConditionFromCode(this.data.weatherCode);
    this.particleSystem = new MiniParticleSystem(
      condition,
      this.mesh,
      this.options.radius
    );
  }
  
  createAccuracyRing() {
    if (!this.data.accuracy) return;
    
    this.accuracyRing = new AccuracyRing(
      this.data.accuracy,
      this.mesh,
      this.options.radius
    );
  }
  
  /**
   * Update detail level based on camera distance
   * @param {number} distance - Distance from camera to column
   */
  updateLOD(distance) {
    const { lodDistance } = this.options;
    
    let newLOD;
    if (distance < lodDistance.high) {
      newLOD = 'high';
    } else if (distance < lodDistance.medium) {
      newLOD = 'medium';
    } else {
      newLOD = 'low';
    }
    
    if (newLOD === this.lodLevel) return;
    this.lodLevel = newLOD;
    
    // Adjust geometry segments based on LOD
    const geometry = this.mesh.geometry;
    const material = this.mesh.material;
    
    switch (newLOD) {
      case 'high':
        // Full detail - all particles active
        if (this.particleSystem && this.particleSystem.mesh) {
          this.particleSystem.mesh.visible = true;
        }
        material.uniforms.uGlowIntensity.value = this.data.type === 'today' ? 1.0 : 0.5;
        break;
        
      case 'medium':
        // Reduced particle count, simpler material
        if (this.particleSystem && this.particleSystem.mesh) {
          this.particleSystem.mesh.visible = true;
        }
        material.uniforms.uGlowIntensity.value = 0.3;
        break;
        
      case 'low':
        // No particles, minimal glow
        if (this.particleSystem && this.particleSystem.mesh) {
          this.particleSystem.mesh.visible = false;
        }
        material.uniforms.uGlowIntensity.value = 0.1;
        break;
    }
  }
  
  /**
   * Update animation state
   * @param {number} delta - Time delta in seconds
   */
  update(delta) {
    this.time += delta;
    
    // Update shader time uniform
    if (this.mesh && this.mesh.material.uniforms) {
      this.mesh.material.uniforms.uTime.value = this.time;
    }
    
    // Update particle system
    if (this.particleSystem && this.lodLevel !== 'low') {
      this.particleSystem.update(delta, this.time);
    }
  }
  
  /**
   * Get the mesh for adding to scene
   * @returns {THREE.Mesh}
   */
  getMesh() {
    return this.mesh;
  }
  
  /**
   * Set position in world space
   * @param {number} x - X position
   * @param {number} z - Z position (optional, defaults to 0)
   */
  setPosition(x, z = 0) {
    if (this.mesh) {
      this.mesh.position.x = x;
      this.mesh.position.z = z;
    }
  }
  
  /**
   * Highlight this column (for hover/selection)
   * @param {boolean} highlighted - Whether to highlight
   */
  setHighlighted(highlighted) {
    if (!this.mesh) return;
    
    const material = this.mesh.material;
    if (highlighted) {
      material.uniforms.uGlowIntensity.value = 1.5;
      this.mesh.scale.setScalar(1.1);
    } else {
      material.uniforms.uGlowIntensity.value = this.data.type === 'today' ? 1.0 : 0.5;
      this.mesh.scale.setScalar(1.0);
    }
  }
  
  /**
   * Get tooltip data for this day
   * @returns {Object}
   */
  getTooltipData() {
    const { date, tempMax, tempMin, tempAvg, zScore, anomaly, condition, accuracy } = this.data;
    
    return {
      date,
      tempMax,
      tempMin,
      tempAvg,
      zScore: zScore?.toFixed(2),
      anomaly: anomaly?.toFixed(1),
      condition,
      accuracy: accuracy ? {
        mae: accuracy.mae?.toFixed(1),
        skill: accuracy.skill?.toFixed(2)
      } : null
    };
  }
  
  /**
   * Create and add to parent group
   * @param {THREE.Group} parent - Parent group to add mesh to
   */
  create(parent) {
    if (this.mesh) {
      this.mesh.position.x = this.options.x || 0;
      this.mesh.position.z = this.options.z || 0;
      parent.add(this.mesh);
    }
  }
  
  /**
   * Animate column appearing
   * @param {number} delay - Delay in seconds before animation starts
   */
  animateIn(delay = 0) {
    if (!this.mesh) return;
    
    // Start scaled down
    this.mesh.scale.set(0, 0, 0);
    
    // Animate to full scale after delay
    setTimeout(() => {
      const startTime = performance.now();
      const duration = 600; // ms
      
      const animate = (currentTime) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Elastic ease out
        const ease = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
        const scale = ease;
        
        this.mesh.scale.set(scale, scale, scale);
        
        if (progress < 1) {
          requestAnimationFrame(animate);
        }
      };
      
      requestAnimationFrame(animate);
    }, delay * 1000);
  }
  
  /**
   * Get meshes for raycasting
   * @returns {THREE.Mesh[]}
   */
  getRaycastMeshes() {
    return this.mesh ? [this.mesh] : [];
  }
  
  /**
   * Check if this column contains a given mesh
   * @param {THREE.Mesh} mesh - Mesh to check
   * @returns {boolean}
   */
  containsMesh(mesh) {
    return this.mesh === mesh;
  }
  
  /**
   * Set hover state
   * @param {boolean} hovered - Whether column is hovered
   */
  setHovered(hovered) {
    this.setHighlighted(hovered);
  }
  
  /**
   * Set selected state
   * @param {boolean} selected - Whether column is selected
   */
  setSelected(selected) {
    if (!this.mesh) return;
    
    if (selected) {
      // Scale up and add emissive glow effect
      this.mesh.scale.setScalar(1.15);
      if (this.mesh.material.uniforms) {
        this.mesh.material.uniforms.uGlowIntensity.value = 2.0;
      }
    } else {
      this.mesh.scale.setScalar(1.0);
      if (this.mesh.material.uniforms) {
        const isToday = this.data.type === 'forecast' && Math.abs(this.data.dayOffset || 0) < 0.5;
        this.mesh.material.uniforms.uGlowIntensity.value = isToday ? 1.0 : 0.5;
      }
    }
  }
  
  /**
   * Get day data
   * @returns {Object}
   */
  getData() {
    return {
      date: this.data.date,
      type: this.data.type,
      tempMax: this.data.tempMax,
      tempMin: this.data.tempMin,
      tempAvg: this.data.tempAvg,
      tempAnomaly: this.data.tempAnomaly || this.data.anomaly,
      zScore: this.data.zScore,
      weatherCode: this.data.weatherCode,
      condition: this.data.condition || getConditionFromCode(this.data.weatherCode),
      accuracy: this.data.accuracy,
      hourly: this.data.hourly
    };
  }
  
  /**
   * Dispose all resources for memory management
   */
  dispose() {
    // Dispose particle system
    if (this.particleSystem) {
      this.particleSystem.dispose();
      this.particleSystem = null;
    }
    
    // Dispose accuracy ring
    if (this.accuracyRing) {
      this.accuracyRing.dispose();
      this.accuracyRing = null;
    }
    
    // Dispose mesh and material
    if (this.mesh) {
      if (this.mesh.geometry) {
        this.mesh.geometry.dispose();
      }
      if (this.mesh.material) {
        this.mesh.material.dispose();
      }
      // Note: Parent is responsible for removing from scene
      this.mesh = null;
    }
  }
}

export default DayColumn;
