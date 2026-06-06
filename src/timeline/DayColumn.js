// DayColumn.js - 3D Weather Timeline Visualization Component
// Represents a single day as a vertical column with temperature gradient and weather particles

import * as THREE from 'three';
import {
  AccuracyRing,
  MiniParticleSystem,
  TEMP_COLORS,
  dayColumnFragmentShader,
  dayColumnVertexShader,
  getConditionFromCode
} from './day-column-visuals.js';

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
    this.createThermalAura();
    this.createWindStreaks();
    this.createLabel();
    if (this.data.type === 'historical' && this.data.accuracy) {
      this.createAccuracyRing();
    }
  }

  computeAvgWind() {
    const hours = this.data.hourly;
    if (!Array.isArray(hours) || hours.length === 0) return 0;
    let total = 0, count = 0;
    for (const h of hours) {
      if (typeof h.windSpeed === 'number') {
        total += h.windSpeed;
        count++;
      }
    }
    return count > 0 ? total / count : 0;
  }
  
  createMesh() {
    // Create cylinder with shader material
    const { height, radius, segments } = this.options;
    
    const geometry = new THREE.CylinderGeometry(radius, radius, height, segments);
    
    // Determine if this is "today" for glow intensity
    const isToday = this.data.type === 'forecast' && Math.abs(this.data.dayOffset || 0) < 0.5;
    const glowIntensity = isToday ? 1.0 : 0.5;
    
    // Normalize wind: 40 km/h ≈ full strength
    const avgWind = this.computeAvgWind();
    this.avgWindSpeed = avgWind;
    const windStrength = Math.min(1, avgWind / 40);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uZScore: { value: this.data.zScore || 0 },
        uTempMin: { value: this.data.tempMin || 0 },
        uTempMax: { value: this.data.tempMax || 0 },
        uTime: { value: 0 },
        uGlowIntensity: { value: glowIntensity },
        uWindStrength: { value: windStrength },
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
  
  createThermalAura() {
    const z = this.data.zScore || 0;
    if (Math.abs(z) < 0.8) return; // Only for notably hot/cold days

    const isHot = z > 0;
    const intensity = Math.min(1, (Math.abs(z) - 0.8) / 1.5);
    const color = isHot ? new THREE.Color(0xff6b35) : new THREE.Color(0x8fd9ff);

    // Soft glowing halo cylinder around the column
    const { height, radius } = this.options;
    const auraGeo = new THREE.CylinderGeometry(
      radius * 1.25,
      radius * 1.4,
      height * 1.05,
      24,
      1,
      true
    );
    const auraMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: color },
        uIntensity: { value: intensity },
        uIsHot: { value: isHot ? 1.0 : 0.0 }
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPosition;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPosition = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColor;
        uniform float uIntensity;
        uniform float uIsHot;
        varying vec2 vUv;
        varying vec3 vWorldPosition;
        void main() {
          // Hot: shimmer rising upward; Cold: drifting downward
          float dir = mix(-1.0, 1.0, uIsHot);
          float ripple = sin((vUv.y * 8.0) - uTime * dir * 1.5 + vUv.x * 6.2831) * 0.5 + 0.5;
          float vert = mix(0.55, 0.0, vUv.y); // fade toward top
          float side = 1.0 - abs(vUv.x * 2.0 - 1.0);
          float a = ripple * vert * side * uIntensity * 0.9;
          gl_FragColor = vec4(uColor, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });
    this.auraMesh = new THREE.Mesh(auraGeo, auraMat);
    this.auraMesh.position.y = 0;
    this.mesh.add(this.auraMesh);
  }

  createWindStreaks() {
    const wind = this.avgWindSpeed || 0;
    if (wind < 10) return; // Only for breezy days and up

    const strength = Math.min(1, wind / 40);
    const count = Math.floor(8 + strength * 24);
    const { radius, height } = this.options;

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 6);
    const phases = new Float32Array(count * 2);

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = radius * (1.05 + Math.random() * 0.25);
      const y = (Math.random() - 0.5) * height * 0.9;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const len = 0.25 + Math.random() * 0.5;
      const tx = -Math.sin(angle) * len;
      const tz = Math.cos(angle) * len;

      positions[i * 6] = x;
      positions[i * 6 + 1] = y;
      positions[i * 6 + 2] = z;
      positions[i * 6 + 3] = x + tx;
      positions[i * 6 + 4] = y;
      positions[i * 6 + 5] = z + tz;
      phases[i * 2] = angle;
      phases[i * 2 + 1] = y;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.LineBasicMaterial({
      color: 0xcfe9ff,
      transparent: true,
      opacity: 0.35 + strength * 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.windMesh = new THREE.LineSegments(geometry, material);
    this.windMesh.userData.basePhases = phases;
    this.windMesh.userData.windStrength = strength;
    this.mesh.add(this.windMesh);
  }

  createLabel() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    const date = new Date(this.data.date + 'T00:00:00');
    const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
    const monthDay = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const hi = this.data.tempMax != null ? `${Math.round(this.data.tempMax)}°` : '--';
    const lo = this.data.tempMin != null ? `${Math.round(this.data.tempMin)}°` : '--';

    ctx.fillStyle = 'rgba(8, 12, 20, 0.55)';
    ctx.beginPath();
    const r = 18;
    const w = canvas.width, h = canvas.height;
    ctx.moveTo(r, 0);
    ctx.lineTo(w - r, 0);
    ctx.quadraticCurveTo(w, 0, w, r);
    ctx.lineTo(w, h - r);
    ctx.quadraticCurveTo(w, h, w - r, h);
    ctx.lineTo(r, h);
    ctx.quadraticCurveTo(0, h, 0, h - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 36px Inter, system-ui, sans-serif';
    ctx.fillText(dayName, w / 2, 30);
    ctx.font = '20px Inter, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(monthDay, w / 2, 60);

    ctx.font = 'bold 30px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#ffb74d';
    ctx.fillText(hi, w / 2 - 38, 100);
    ctx.fillStyle = '#8fd9ff';
    ctx.fillText(lo, w / 2 + 38, 100);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false
    });

    this.labelSprite = new THREE.Sprite(material);
    this.labelSprite.scale.set(2.2, 1.1, 1);
    this.labelSprite.position.y = this.options.height / 2 + 1.2;
    this.mesh.add(this.labelSprite);
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

    if (this.auraMesh) this.auraMesh.visible = newLOD !== 'low';
    if (this.windMesh) this.windMesh.visible = newLOD !== 'low';
    if (this.labelSprite) this.labelSprite.visible = newLOD !== 'low';
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

    // Thermal aura shimmer
    if (this.auraMesh && this.auraMesh.material.uniforms) {
      this.auraMesh.material.uniforms.uTime.value = this.time;
    }

    // Wind streak drift — rotate streaks around column
    if (this.windMesh && this.lodLevel !== 'low') {
      const strength = this.windMesh.userData.windStrength || 0.3;
      this.windMesh.rotation.y += delta * (0.4 + strength * 1.8);
      this.windMesh.material.opacity =
        (0.35 + strength * 0.4) * (0.85 + Math.sin(this.time * 3) * 0.15);
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

    // Dispose aura
    if (this.auraMesh) {
      this.auraMesh.geometry.dispose();
      this.auraMesh.material.dispose();
      this.auraMesh = null;
    }

    // Dispose wind streaks
    if (this.windMesh) {
      this.windMesh.geometry.dispose();
      this.windMesh.material.dispose();
      this.windMesh = null;
    }

    // Dispose label sprite
    if (this.labelSprite) {
      if (this.labelSprite.material) {
        if (this.labelSprite.material.map) this.labelSprite.material.map.dispose();
        this.labelSprite.material.dispose();
      }
      this.labelSprite = null;
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
