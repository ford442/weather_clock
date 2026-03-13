// Aether Architect: Verified
import * as THREE from 'three';
import {
    rainVertexShader, rainFragmentShader,
    splashVertexShader, splashFragmentShader,
    cloudShaderInjection
} from './shaders.js';
import { SUNDIAL_DIMENSIONS } from './sundial.js';

// --- Shared Resources Manager ---
const ResourceManager = {
    cloudTextures: {},
    getCloudTexture: function(type = 'cumulus') {
        if (!this.cloudTextures[type]) {
            if (type === 'stratus') this.cloudTextures[type] = createStratusTexture();
            else if (type === 'cirrus') this.cloudTextures[type] = createCirrusTexture();
            else this.cloudTextures[type] = createCumulusTexture();
        }
        return this.cloudTextures[type];
    }
};

// Fluffy cumulus puff texture: bright top, soft shadow at base
function createCumulusTexture() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);

    const cx = size / 2, cy = size / 2;

    // Base elliptical shape: bottom-flat, top-rounded
    const baseGrad = ctx.createRadialGradient(cx, cy * 0.88, size * 0.06, cx, cy * 0.88, size * 0.48);
    baseGrad.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
    baseGrad.addColorStop(0.5, 'rgba(248, 250, 255, 0.10)');
    baseGrad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
    ctx.fillStyle = baseGrad;
    ctx.fillRect(0, 0, size, size);

    // Layered puff blobs: biased toward top half for dome shape
    const numPuffs = 200;
    for (let i = 0; i < numPuffs; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.pow(Math.random(), 0.55) * (size * 0.38);
        // Bias puffs toward the top half
        const px = cx + Math.cos(angle) * dist;
        const py = (cy * 0.85) + Math.sin(angle) * dist * (Math.sin(angle) < 0 ? 0.6 : 1.05);

        const r = size * (0.04 + Math.random() * 0.14);
        // Brighter on top, cooler on bottom
        const brightness = py < cy ? 250 + Math.random() * 5 : 232 + Math.random() * 12;
        const blueShift = py > cy ? 5 + Math.random() * 8 : 0;
        const opacity = 0.03 + Math.random() * 0.11;

        const grad = ctx.createRadialGradient(px, py, 0, px, py, r);
        grad.addColorStop(0, `rgba(${brightness}, ${brightness}, ${brightness + blueShift}, ${opacity})`);
        grad.addColorStop(0.5, `rgba(${brightness}, ${brightness}, ${brightness + blueShift}, ${opacity * 0.5})`);
        grad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
    }

    // Bright specular highlights at the top peaks
    for (let i = 0; i < 6; i++) {
        const px = cx + (Math.random() - 0.5) * size * 0.28;
        const py = cy * (0.4 + Math.random() * 0.45);
        const r = size * (0.04 + Math.random() * 0.07);
        const grad = ctx.createRadialGradient(px, py, 0, px, py, r);
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.40)');
        grad.addColorStop(0.4, 'rgba(255, 255, 255, 0.18)');
        grad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
    }

    // Bottom shadow gradient (blue-grey underside)
    const shadowGrad = ctx.createLinearGradient(0, cy * 0.9, 0, size);
    shadowGrad.addColorStop(0, 'rgba(190, 200, 220, 0.0)');
    shadowGrad.addColorStop(0.5, 'rgba(175, 185, 210, 0.07)');
    shadowGrad.addColorStop(1, 'rgba(150, 162, 195, 0.16)');
    ctx.fillStyle = shadowGrad;
    ctx.fillRect(0, cy * 0.9, size, size);

    // Subtle pixel-level noise for organic feel
    const imgData = ctx.getImageData(0, 0, size, size);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 0) {
            const noise = (Math.random() - 0.5) * 14;
            data[i] = Math.max(0, Math.min(255, data[i] + noise));
            data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
            data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
        }
    }
    ctx.putImageData(imgData, 0, 0);
    return new THREE.CanvasTexture(canvas);
}

// Flat stratus/nimbostratus texture: wide, grey, layered sheets
function createStratusTexture() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);

    // Wide soft base
    const baseGrad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.5);
    baseGrad.addColorStop(0, 'rgba(195, 200, 215, 0.28)');
    baseGrad.addColorStop(0.45, 'rgba(205, 210, 225, 0.14)');
    baseGrad.addColorStop(0.85, 'rgba(215, 220, 235, 0.05)');
    baseGrad.addColorStop(1, 'rgba(215, 220, 235, 0.0)');
    ctx.fillStyle = baseGrad;
    ctx.fillRect(0, 0, size, size);

    // Horizontal layered bands
    for (let i = 0; i < 10; i++) {
        const bandY = size * (0.25 + Math.random() * 0.5);
        const bandH = size * (0.06 + Math.random() * 0.14);
        const grey = 175 + Math.random() * 35;
        const opacity = 0.04 + Math.random() * 0.09;
        const grad = ctx.createLinearGradient(0, bandY - bandH, 0, bandY + bandH);
        grad.addColorStop(0, `rgba(${grey}, ${grey + 4}, ${grey + 14}, 0.0)`);
        grad.addColorStop(0.5, `rgba(${grey}, ${grey + 4}, ${grey + 14}, ${opacity})`);
        grad.addColorStop(1, `rgba(${grey}, ${grey + 4}, ${grey + 14}, 0.0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(size * 0.04, bandY - bandH, size * 0.92, bandH * 2);
    }

    // Wide flat elliptical blobs
    for (let i = 0; i < 55; i++) {
        const px = Math.random() * size;
        const py = size * (0.28 + Math.random() * 0.44);
        const rx = size * (0.12 + Math.random() * 0.22);
        const ry = size * (0.025 + Math.random() * 0.055);
        const grey = 180 + Math.random() * 28;
        const opacity = 0.025 + Math.random() * 0.065;
        ctx.save();
        ctx.translate(px, py);
        ctx.scale(1, ry / rx);
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
        grad.addColorStop(0, `rgba(${grey}, ${grey + 4}, ${grey + 12}, ${opacity})`);
        grad.addColorStop(1, 'rgba(215, 220, 235, 0.0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, rx, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // Darker bottom (rain-laden underside)
    const shadowGrad = ctx.createLinearGradient(0, size * 0.45, 0, size);
    shadowGrad.addColorStop(0, 'rgba(135, 140, 160, 0.0)');
    shadowGrad.addColorStop(0.6, 'rgba(120, 125, 148, 0.12)');
    shadowGrad.addColorStop(1, 'rgba(100, 108, 135, 0.22)');
    ctx.fillStyle = shadowGrad;
    ctx.fillRect(0, size * 0.45, size, size * 0.55);
    return new THREE.CanvasTexture(canvas);
}

// Thin cirrus texture: wispy elongated ice-crystal streaks
function createCirrusTexture() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);

    // Very thin wispy streaks
    for (let i = 0; i < 22; i++) {
        const startX = Math.random() * size * 0.25;
        const endX = startX + size * (0.45 + Math.random() * 0.45);
        const y = size * (0.3 + Math.random() * 0.4);
        const thickness = 2.5 + Math.random() * 7;
        const angle = (Math.random() - 0.5) * 0.14;

        ctx.save();
        ctx.translate(size / 2, size / 2);
        ctx.rotate(angle);
        ctx.translate(-size / 2, -size / 2);

        const opacity = 0.06 + Math.random() * 0.16;
        const grad = ctx.createLinearGradient(startX, y, endX, y);
        grad.addColorStop(0, 'rgba(238, 244, 255, 0.0)');
        grad.addColorStop(0.1, `rgba(238, 244, 255, ${opacity})`);
        grad.addColorStop(0.5, `rgba(244, 250, 255, ${opacity * 1.5})`);
        grad.addColorStop(0.9, `rgba(238, 244, 255, ${opacity})`);
        grad.addColorStop(1, 'rgba(238, 244, 255, 0.0)');

        ctx.strokeStyle = grad;
        ctx.lineWidth = thickness;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(startX, y);
        const cpY = y + (Math.random() - 0.5) * size * 0.055;
        ctx.quadraticCurveTo((startX + endX) / 2, cpY, endX, y + (Math.random() - 0.5) * size * 0.03);
        ctx.stroke();

        // Thin filament tails
        for (let j = 0; j < 4; j++) {
            const fStartX = startX + Math.random() * (endX - startX) * 0.6;
            const fLen = (endX - startX) * (0.08 + Math.random() * 0.25);
            const fY = y + (Math.random() - 0.5) * 18;
            const fOp = opacity * (0.3 + Math.random() * 0.3);
            const fGrad = ctx.createLinearGradient(fStartX, fY, fStartX + fLen, fY + (Math.random() - 0.5) * 14);
            fGrad.addColorStop(0, 'rgba(238, 244, 255, 0.0)');
            fGrad.addColorStop(0.5, `rgba(238, 244, 255, ${fOp})`);
            fGrad.addColorStop(1, 'rgba(238, 244, 255, 0.0)');
            ctx.strokeStyle = fGrad;
            ctx.lineWidth = 1 + Math.random() * 2.5;
            ctx.beginPath();
            ctx.moveTo(fStartX, fY);
            ctx.lineTo(fStartX + fLen, fY + (Math.random() - 0.5) * 14);
            ctx.stroke();
        }
        ctx.restore();
    }

    // Very subtle central glow
    const glow = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.5);
    glow.addColorStop(0, 'rgba(248, 252, 255, 0.06)');
    glow.addColorStop(1, 'rgba(248, 252, 255, 0.0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
}

// Helper for JS-side smoothstep
function smoothstep(min, max, value) {
  var x = Math.max(0, Math.min(1, (value-min)/(max-min)));
  return x*x*(3 - 2*x);
}

function curlNoise(x, y, z, time) {
    const eps = 0.1;
    const n = (a, b, c) => Math.sin(a * 0.5 + time) * Math.cos(b * 0.3 + time) * Math.sin(c * 0.5);
    const dx = n(x, y + eps, z) - n(x, y - eps, z);
    const dy = n(x - eps, y, z) - n(x + eps, y, z);
    const dz = Math.sin(x * 0.1 + time);
    return new THREE.Vector3(dx * 0.5, 0, dy * 0.5);
}

class ParticleSystemBase {
    constructor(scene) {
        this.scene = scene;
        this.isActive = true;
        this.targetOpacity = 0.0;
        this.currentOpacity = 0.0;
        this.fadeSpeed = 0.2;
    }

    updateOpacity(delta, target) {
        this.targetOpacity = target;
        if (this.currentOpacity < this.targetOpacity) {
            this.currentOpacity += delta * this.fadeSpeed;
            if (this.currentOpacity > this.targetOpacity) this.currentOpacity = this.targetOpacity;
        } else if (this.currentOpacity > this.targetOpacity) {
            this.currentOpacity -= delta * this.fadeSpeed;
            if (this.currentOpacity < this.targetOpacity) this.currentOpacity = this.targetOpacity;
        }
        return this.currentOpacity;
    }
}

class RainSystem extends ParticleSystemBase {
    constructor(scene, zone, maxParticles = 1500) {
        super(scene);
        this.currentIntensity = 0;
        this.maxParticles = maxParticles;
        this.zone = zone || { minX: -8, maxX: 8 };

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(maxParticles * 6);
        const velocities = new Float32Array(maxParticles * 3);
        const states = new Int8Array(maxParticles);

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: new THREE.Color(0x88ccff) },
                uOpacity: { value: 0.0 }
            },
            vertexShader: rainVertexShader,
            fragmentShader: rainFragmentShader,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide
        });

        this.mesh = new THREE.LineSegments(geometry, material);
        this.scene.add(this.mesh);

        this.velocities = velocities;
        this.states = states;

        for (let i = 0; i < maxParticles; i++) {
            this.resetParticle(i, true);
        }
        this.mesh.visible = true;
    }

    resetParticle(i, randomY = false) {
        const i3 = i * 3;
        const i6 = i * 6;
        const positions = this.mesh.geometry.attributes.position.array;

        const x = this.zone.minX + Math.random() * (this.zone.maxX - this.zone.minX);
        const y = randomY ? (Math.random() * 20 - 5) : (15 + Math.random() * 5);
        const z = Math.random() * 10 - 5;

        this.velocities[i3] = 0;
        this.velocities[i3 + 1] = -0.2 - Math.random() * 0.1;
        this.velocities[i3 + 2] = 0;

        positions[i6] = x;
        positions[i6 + 1] = y + 0.5;
        positions[i6 + 2] = z;
        positions[i6 + 3] = x;
        positions[i6 + 4] = y;
        positions[i6 + 5] = z;

        this.states[i] = 0;
    }

    update(delta, windSpeed, windDir, intensity, raycaster, sundialGroup, spawnSplashCallback, lightColor) {
        if (lightColor) {
            this.mesh.material.uniforms.uColor.value.copy(lightColor);
        }

        // Smooth intensity transition (approx 5s)
        const smoothFactor = Math.min(1.0, delta * 1.0);
        this.currentIntensity += (intensity - this.currentIntensity) * smoothFactor;

        let targetOp = 0;
        let activeCount = 0;

        if (this.currentIntensity > 0.01) {
            targetOp = Math.min(0.9, 0.3 + this.currentIntensity * 0.2);
            activeCount = Math.min(this.maxParticles, Math.floor(this.currentIntensity * 1000));
            if (activeCount < 50) activeCount = 50;
            if (activeCount > this.maxParticles) activeCount = this.maxParticles;
        }

        const opacity = this.updateOpacity(delta, targetOp);
        this.mesh.material.uniforms.uOpacity.value = opacity;

        if (opacity <= 0.01) {
            this.mesh.visible = false;
            return;
        }
        this.mesh.visible = true;

        this.mesh.geometry.setDrawRange(0, activeCount * 2);

        const positions = this.mesh.geometry.attributes.position.array;
        const rad = (90 - windDir) * Math.PI / 180;
        const speedScale = 0.005;
        const targetWindX = Math.cos(rad) * windSpeed * speedScale;
        const targetWindZ = -Math.sin(rad) * windSpeed * speedScale;

        for (let i = 0; i < activeCount; i++) {
            const i3 = i * 3;
            const i6 = i * 6;

            if (this.states[i] === 0) {
                this.velocities[i3] += (targetWindX - this.velocities[i3]) * 0.1;
                this.velocities[i3+2] += (targetWindZ - this.velocities[i3+2]) * 0.1;

                const vx = this.velocities[i3];
                const vy = this.velocities[i3+1];
                const vz = this.velocities[i3+2];

                positions[i6+3] += vx;
                positions[i6+4] += vy;
                positions[i6+5] += vz;

                // Longer streaks for faster perceived motion
                const streak = 4.0;
                positions[i6] = positions[i6+3] - vx * streak;
                positions[i6+1] = positions[i6+4] - vy * streak;
                positions[i6+2] = positions[i6+5] - vz * streak;

                if (positions[i6+3] > this.zone.maxX) {
                    const w = this.zone.maxX - this.zone.minX;
                    positions[i6+3] -= w; positions[i6] -= w;
                } else if (positions[i6+3] < this.zone.minX) {
                    const w = this.zone.maxX - this.zone.minX;
                    positions[i6+3] += w; positions[i6] += w;
                }

                const headY = positions[i6+4];
                if (headY > -1 && headY < 4) {
                    if (sundialGroup) {
                        const headX = positions[i6+3];
                        const headZ = positions[i6+5];
                        const distSq = headX*headX + headZ*headZ;

                        // Max radius check (squared)
                        // Base radius bottom is 3.2. Let's add slight margin.
                        const maxR = SUNDIAL_DIMENSIONS.base.radiusBottom + 0.1;
                        if (distSq < maxR * maxR) {
                            const dist = Math.sqrt(distSq);
                            let surfaceY = -100;

                            const faceTop = SUNDIAL_DIMENSIONS.face.y + SUNDIAL_DIMENSIONS.face.height / 2;
                            const baseTop = SUNDIAL_DIMENSIONS.base.y + SUNDIAL_DIMENSIONS.base.height / 2;
                            const baseBottom = SUNDIAL_DIMENSIONS.base.y - SUNDIAL_DIMENSIONS.base.height / 2;

                            if (dist < SUNDIAL_DIMENSIONS.face.radius) {
                                surfaceY = faceTop; // Hit Clock Face
                            } else if (dist < SUNDIAL_DIMENSIONS.base.radiusTop) {
                                surfaceY = baseTop; // Hit Base Top
                            } else if (dist < maxR) {
                                // Hit Base Slope
                                const r1 = SUNDIAL_DIMENSIONS.base.radiusTop;
                                const r2 = SUNDIAL_DIMENSIONS.base.radiusBottom;
                                // Aether Architect: Allow margin hits by clamping
                                const effectiveDist = Math.min(dist, r2);
                                const factor = (effectiveDist - r1) / (r2 - r1);
                                surfaceY = baseTop - factor * (baseTop - baseBottom);
                            }

                            if (surfaceY > -99 && headY < surfaceY) {
                                if(spawnSplashCallback) spawnSplashCallback(new THREE.Vector3(headX, surfaceY, headZ));
                                this.resetParticle(i);
                                continue;
                            }
                        }
                    }
                }

                if (headY < -5) this.resetParticle(i);
            }
        }
        this.mesh.geometry.attributes.position.needsUpdate = true;
    }
}

class SnowSystem extends ParticleSystemBase {
    constructor(scene, zone, maxParticles = 1000) {
        super(scene);
        this.currentIntensity = 0;
        this.maxParticles = maxParticles;
        this.zone = zone || { minX: -8, maxX: 8 };

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(maxParticles * 3);
        const velocities = new Float32Array(maxParticles * 3);
        const offsets = new Float32Array(maxParticles);

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 0.15,
            transparent: true,
            opacity: 0.0,
            map: ResourceManager.getCloudTexture(),
            depthWrite: false
        });

        this.mesh = new THREE.Points(geometry, material);
        this.scene.add(this.mesh);

        this.velocities = velocities;
        this.offsets = offsets;

        const posAttr = this.mesh.geometry.attributes.position.array;
        for (let i = 0; i < maxParticles; i++) {
            posAttr[i*3] = this.zone.minX + Math.random() * (this.zone.maxX - this.zone.minX);
            posAttr[i*3+1] = Math.random() * 15;
            posAttr[i*3+2] = Math.random() * 20 - 10;

            this.velocities[i*3] = 0;
            this.velocities[i*3+1] = -0.02 - Math.random() * 0.03;
            this.velocities[i*3+2] = 0;

            this.offsets[i] = Math.random() * 100;
        }
        this.mesh.visible = true;
    }

    update(delta, windSpeed, windDir, intensity, lightColor) {
        if (lightColor) {
            this.mesh.material.color.copy(lightColor);
        }

        // Smooth intensity transition (approx 5s)
        const smoothFactor = Math.min(1.0, delta * 1.0);
        this.currentIntensity += (intensity - this.currentIntensity) * smoothFactor;

        let targetOp = 0;
        let activeCount = 0;

        if (this.currentIntensity > 0.01) {
            targetOp = Math.min(0.9, 0.3 + this.currentIntensity * 0.3);
            activeCount = Math.min(this.maxParticles, Math.floor(this.currentIntensity * 1000));
            if (activeCount < 50) activeCount = 50;
            if (activeCount > this.maxParticles) activeCount = this.maxParticles;
        }

        const opacity = this.updateOpacity(delta, targetOp);
        this.mesh.material.opacity = opacity;

        if (opacity <= 0.01) {
            this.mesh.visible = false;
            return;
        }
        this.mesh.visible = true;
        this.mesh.geometry.setDrawRange(0, activeCount);

        const positions = this.mesh.geometry.attributes.position.array;
        const time = Date.now() * 0.001;

        const rad = (90 - windDir) * Math.PI / 180;
        const speedScale = 0.002;
        const wX = Math.cos(rad) * windSpeed * speedScale;
        const wZ = -Math.sin(rad) * windSpeed * speedScale;

        for (let i = 0; i < activeCount; i++) {
            const i3 = i * 3;
            const px = positions[i3];
            const py = positions[i3+1];
            const pz = positions[i3+2];

            const curl = curlNoise(px * 0.1, py * 0.1, pz * 0.1, time + this.offsets[i] * 0.01);

            positions[i3] += this.velocities[i3] + wX + curl.x * 0.05;
            positions[i3+1] += this.velocities[i3+1] + curl.y * 0.05;
            positions[i3+2] += this.velocities[i3+2] + wZ + curl.z * 0.05;

            if (positions[i3] > this.zone.maxX) positions[i3] -= (this.zone.maxX - this.zone.minX);
            if (positions[i3] < this.zone.minX) positions[i3] += (this.zone.maxX - this.zone.minX);

            if (positions[i3+1] < -5) {
                positions[i3+1] = 15;
                positions[i3] = this.zone.minX + Math.random() * (this.zone.maxX - this.zone.minX);
            }
        }
        this.mesh.geometry.attributes.position.needsUpdate = true;
    }
}

class WindDustSystem extends ParticleSystemBase {
    constructor(scene, zone, maxParticles = 300) {
        super(scene);
        this.currentIntensity = 0;
        this.maxParticles = maxParticles;
        this.zone = zone || { minX: -8, maxX: 8 };

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(maxParticles * 3);
        const velocities = new Float32Array(maxParticles * 3);
        const offsets = new Float32Array(maxParticles);

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        // Use a small, subtle particle (similar to Snow but smaller/fainter)
        const material = new THREE.PointsMaterial({
            color: 0xcccccc, // Dust color
            size: 0.1,       // Tiny
            transparent: true,
            opacity: 0.0,
            map: ResourceManager.getCloudTexture('cumulus'), // Reuse noise texture for softness
            depthWrite: false,
            blending: THREE.AdditiveBlending // Glowy/Airy feel
        });

        this.mesh = new THREE.Points(geometry, material);
        this.scene.add(this.mesh);

        this.velocities = velocities;
        this.offsets = offsets;

        const posAttr = this.mesh.geometry.attributes.position.array;
        for (let i = 0; i < maxParticles; i++) {
            this.resetParticle(i, posAttr);
            this.offsets[i] = Math.random() * 100;
        }
        this.mesh.visible = true;
    }

    resetParticle(i, posAttr) {
        posAttr[i*3] = this.zone.minX + Math.random() * (this.zone.maxX - this.zone.minX);
        // Aether Architect: Cluster dust near ground to simulate "invisible grass" rustling
        posAttr[i*3+1] = Math.pow(Math.random(), 2.5) * 8;
        posAttr[i*3+2] = Math.random() * 20 - 10;

        // Initial random velocity
        this.velocities[i*3] = 0;
        this.velocities[i*3+1] = 0;
        this.velocities[i*3+2] = 0;
    }

    update(delta, windSpeed, windDir, rainIntensity, lightColor) {
        if (lightColor) {
            // Tint with light but keep it subtle
            this.mesh.material.color.copy(lightColor).multiplyScalar(0.8);
        }

        // Logic: Show dust if wind is decent (>5) AND NOT heavy rain (rain washes dust out)
        let targetIntensity = 0;
        if (windSpeed > 5 && rainIntensity < 2.0) {
             targetIntensity = Math.min(1.0, (windSpeed - 5) / 20.0);
        }

        // Smooth transition
        this.currentIntensity += (targetIntensity - this.currentIntensity) * delta * 1.0;

        let targetOp = 0;
        let activeCount = 0;

        if (this.currentIntensity > 0.01) {
            targetOp = Math.min(0.3, this.currentIntensity * 0.3); // Max opacity 0.3
            activeCount = Math.floor(this.currentIntensity * this.maxParticles);
        }

        const opacity = this.updateOpacity(delta, targetOp);
        this.mesh.material.opacity = opacity;

        if (opacity <= 0.01) {
            this.mesh.visible = false;
            return;
        }
        this.mesh.visible = true;
        this.mesh.geometry.setDrawRange(0, activeCount);

        const positions = this.mesh.geometry.attributes.position.array;
        const time = Date.now() * 0.001;

        const rad = (90 - windDir) * Math.PI / 180;
        const speedScale = 0.003; // Dust is light, moves easily
        const wX = Math.cos(rad) * windSpeed * speedScale;
        const wZ = -Math.sin(rad) * windSpeed * speedScale;

        for (let i = 0; i < activeCount; i++) {
            const i3 = i * 3;
            const px = positions[i3];
            const py = positions[i3+1];
            const pz = positions[i3+2];

            const curl = curlNoise(px * 0.2, py * 0.2, pz * 0.2, time + this.offsets[i] * 0.01);

            // Move with wind + turbulence
            positions[i3] += wX + curl.x * 0.02;
            positions[i3+1] += curl.y * 0.02 + (Math.random()-0.5)*0.01; // Slight vertical drift
            positions[i3+2] += wZ + curl.z * 0.02;

            // Wrap around
            if (positions[i3] > this.zone.maxX) positions[i3] -= (this.zone.maxX - this.zone.minX);
            if (positions[i3] < this.zone.minX) positions[i3] += (this.zone.maxX - this.zone.minX);

            // Height clamp/wrap
            if (positions[i3+1] > 8) positions[i3+1] = 0;
            if (positions[i3+1] < 0) positions[i3+1] = 8;
        }
        this.mesh.geometry.attributes.position.needsUpdate = true;
    }
}

class CloudSystem extends ParticleSystemBase {
    /**
     * @param {string} cloudType  'cumulus' | 'stratus' | 'cirrus'
     */
    constructor(scene, camera, zone, maxClouds = 12, cloudType = 'cumulus') {
        super(scene);
        this.currentCloudCover = 0;
        this.camera = camera;
        this.maxClouds = maxClouds;
        this.cloudType = cloudType;
        this.zone = zone || { minX: -12, maxX: 12 };

        // Puff counts and scale ranges per cloud type
        const typeConfig = {
            cumulus: { puffsPerCloud: 10, scaleMin: 2.0, scaleMax: 4.0,
                       yMin: 6,  yRange: 4,  windMult: 1.0, bobAmp: 0.07 },
            stratus: { puffsPerCloud: 5,  scaleMin: 4.5, scaleMax: 7.5,
                       yMin: 4,  yRange: 2,  windMult: 0.6, bobAmp: 0.04 },
            cirrus:  { puffsPerCloud: 4,  scaleMin: 3.5, scaleMax: 5.5,
                       yMin: 12, yRange: 4,  windMult: 1.8, bobAmp: 0.015 }
        };
        const cfg = typeConfig[cloudType] || typeConfig.cumulus;
        this.cfg = cfg;
        this.puffsPerCloud = cfg.puffsPerCloud;
        this.totalInstances = maxClouds * this.puffsPerCloud;

        const map = ResourceManager.getCloudTexture(cloudType);
        this.material = new THREE.MeshBasicMaterial({
            map: map,
            transparent: true,
            opacity: 0.0,
            depthWrite: false,
            side: THREE.DoubleSide
        });

        // Inject Volumetric Shader Logic
        this.material.onBeforeCompile = cloudShaderInjection.onBeforeCompile;

        const geometry = new THREE.PlaneGeometry(1, 1);
        this.mesh = new THREE.InstancedMesh(geometry, this.material, this.totalInstances);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

        // Enable per-instance colors for depth shading (bright top, shadowed bottom)
        const whiteColor = new THREE.Color(1, 1, 1);
        for (let i = 0; i < this.totalInstances; i++) {
            this.mesh.setColorAt(i, whiteColor);
        }
        if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

        this.scene.add(this.mesh);

        this.clouds = [];
        this.dummy = new THREE.Object3D();
        // Reusable quaternion for puff spin
        this._spinQuat = new THREE.Quaternion();
        this._spinAxis = new THREE.Vector3(0, 0, 1);
        // Reusable color for instance color writes
        this._puffColor = new THREE.Color();

        for (let i = 0; i < maxClouds; i++) {
            this.addCloud();
        }

        // Hide all instances initially
        for (let i = 0; i < this.totalInstances; i++) {
            this.dummy.position.set(0, -1000, 0);
            this.dummy.updateMatrix();
            this.mesh.setMatrixAt(i, this.dummy.matrix);
        }
        this.mesh.instanceMatrix.needsUpdate = true;
        this.mesh.visible = true;
    }

    addCloud() {
        const startIndex = this.clouds.length * this.puffsPerCloud;
        const indices = Array.from({ length: this.puffsPerCloud }, (_, i) => startIndex + i);
        const { scaleMin, scaleMax, yMin, yRange } = this.cfg;

        const cloud = {
            x: this.zone.minX + Math.random() * (this.zone.maxX - this.zone.minX),
            y: yMin + Math.random() * yRange,
            z: Math.random() * 10 - 5,
            scale: scaleMin + Math.random() * (scaleMax - scaleMin),
            indices,
            puffs: this._createPuffs(),
            floatOffset: Math.random() * Math.PI * 2   // for gentle vertical bob
        };
        this.clouds.push(cloud);
    }

    _createPuffs() {
        const count = this.puffsPerCloud;
        const puffs = [];

        if (this.cloudType === 'cumulus') {
            // Dome arrangement: 3 tiers — base ring, middle ring, top cap
            // Tier 0: 3 puffs at base, wide spread
            const tier0 = [[0, 120, 240], 0.90, 0.00, [0.65, 0.85]];
            // Tier 1: 4 puffs in middle, medium spread
            const tier1 = [[30, 120, 210, 300], 0.62, 0.35, [0.72, 0.95]];
            // Tier 2: 2 puffs upper, tighter
            const tier2 = [[60, 220], 0.35, 0.60, [0.55, 0.72]];
            // Tier 3: 1 apex puff
            const tier3 = [[0], 0.00, 0.80, [0.45, 0.62]];

            for (const [angles, radius, yOff, [sMin, sMax]] of [tier0, tier1, tier2, tier3]) {
                for (const deg of angles) {
                    const a = (deg + (Math.random() - 0.5) * 25) * Math.PI / 180;
                    puffs.push({
                        x: Math.cos(a) * radius + (Math.random() - 0.5) * 0.15,
                        y: yOff + (Math.random() - 0.5) * 0.18,
                        z: Math.sin(a) * radius * 0.55 + (Math.random() - 0.5) * 0.15,
                        scale: sMin + Math.random() * (sMax - sMin),
                        rotation: Math.random() * Math.PI,
                        rotSpeed: (Math.random() - 0.5) * 0.04,
                        // colorT: 0=bottom-shadow, 1=top-bright
                        colorT: 0.2 + yOff * 0.7
                    });
                }
            }
        } else if (this.cloudType === 'stratus') {
            // Wide, flat arrangement: 5 puffs in a horizontal strip
            for (let i = 0; i < count; i++) {
                const t = (i / (count - 1)) - 0.5; // -0.5 to +0.5
                puffs.push({
                    x: t * 2.8 + (Math.random() - 0.5) * 0.4,
                    y: (Math.random() - 0.5) * 0.15,
                    z: (Math.random() - 0.5) * 0.55,
                    scale: 1.0 + Math.random() * 0.65,
                    rotation: Math.random() * Math.PI,
                    rotSpeed: (Math.random() - 0.5) * 0.015,
                    colorT: 0.45 + Math.random() * 0.25  // stratus is mid-grey, darker at bottom
                });
            }
        } else if (this.cloudType === 'cirrus') {
            // Elongated streak: 4 puffs in a diagonal line
            for (let i = 0; i < count; i++) {
                const t = (i / (count - 1)) - 0.5; // -0.5 to +0.5
                puffs.push({
                    x: t * 3.8 + (Math.random() - 0.5) * 0.25,
                    y: t * 0.12 + (Math.random() - 0.5) * 0.08,  // slight diagonal
                    z: (Math.random() - 0.5) * 0.22,
                    scale: 0.28 + Math.random() * 0.38,
                    rotation: Math.random() * Math.PI,
                    rotSpeed: (Math.random() - 0.5) * 0.025,
                    colorT: 0.80 + Math.random() * 0.20  // cirrus is near-white, very bright
                });
            }
        }

        return puffs;
    }

    update(delta, windSpeed, cloudCover, lightColor, sunPos, moonPos, sunColor, moonColor, weatherCode = 0) {
        // Update global lighting uniforms (shared across all cloud systems)
        if (lightColor) cloudShaderInjection.uniforms.uAmbientColor.value.copy(lightColor);
        if (sunPos)     cloudShaderInjection.uniforms.uSunPosition.value.copy(sunPos);
        if (moonPos)    cloudShaderInjection.uniforms.uMoonPosition.value.copy(moonPos);
        if (sunColor)   cloudShaderInjection.uniforms.uSunColor.value.copy(sunColor);
        if (moonColor)  cloudShaderInjection.uniforms.uMoonColor.value.copy(moonColor);

        // Derive a storm darkness factor (0=clear, 1=heavy storm)
        const isStorm = weatherCode >= 95;
        const isRain  = weatherCode >= 51 && weatherCode < 95;
        const stormFactor = isStorm ? 1.0 : isRain ? 0.5 : 0.0;

        // Smooth cloud cover transition
        const smoothFactor = Math.min(1.0, delta * 1.0);
        this.currentCloudCover += (cloudCover - this.currentCloudCover) * smoothFactor;

        let targetOp = 0;
        let activeClouds = 0;

        if (this.currentCloudCover > 10) {
            targetOp = Math.min(0.9, this.currentCloudCover / 100.0);
            activeClouds = Math.floor((this.currentCloudCover / 100.0) * this.maxClouds);
        }
        if (this.currentCloudCover > 80) targetOp = Math.max(targetOp, 0.6);

        // Stratus/storm clouds are more opaque
        if (this.cloudType === 'stratus' && stormFactor > 0) {
            targetOp = Math.min(0.92, targetOp * (1.0 + stormFactor * 0.35));
        }

        const opacity = this.updateOpacity(delta, targetOp);
        this.material.opacity = opacity;

        if (opacity <= 0.01) {
            this.mesh.visible = false;
            return;
        }
        this.mesh.visible = true;

        const camQuat = this.camera.quaternion;
        const time = Date.now() * 0.001;
        const { windMult } = this.cfg;

        // Instance color: top = white, bottom = shadow tinted by stormFactor
        // Storm tops are darker overall
        const topR = 1.0 - stormFactor * 0.35;
        const topG = 1.0 - stormFactor * 0.30;
        const topB = 1.0 - stormFactor * 0.20;
        const botR = (this.cloudType === 'stratus' ? 0.62 : 0.70) - stormFactor * 0.22;
        const botG = (this.cloudType === 'stratus' ? 0.65 : 0.73) - stormFactor * 0.20;
        const botB = (this.cloudType === 'stratus' ? 0.78 : 0.85) - stormFactor * 0.18;

        let instanceColorDirty = false;

        for (let i = 0; i < this.clouds.length; i++) {
            const cloud = this.clouds[i];

            // Move cloud horizontally (cirrus faster, stratus slower)
            const moveSpeed = (0.05 + windSpeed * 0.01) * delta * windMult;
            cloud.x += moveSpeed;
            if (cloud.x > this.zone.maxX) cloud.x = this.zone.minX;
            if (cloud.x < this.zone.minX) cloud.x = this.zone.maxX;

            // Gentle vertical bob (amplitude comes from per-type config)
            const bob = Math.sin(time * 0.28 + cloud.floatOffset) * this.cfg.bobAmp;

            const isVisible = i < activeClouds;

            cloud.indices.forEach((idx, j) => {
                if (isVisible) {
                    const puff = cloud.puffs[j];
                    // Animate puff rotation slowly
                    puff.rotation += puff.rotSpeed * delta;

                    this.dummy.position.set(
                        cloud.x + puff.x * cloud.scale * 0.5,
                        cloud.y + bob + puff.y * cloud.scale * 0.5,
                        cloud.z + puff.z * cloud.scale * 0.5
                    );
                    // Billboard to camera, then apply puff spin in screen space
                    this.dummy.quaternion.copy(camQuat);
                    this._spinQuat.setFromAxisAngle(this._spinAxis, puff.rotation);
                    this.dummy.quaternion.multiply(this._spinQuat);
                    this.dummy.scale.setScalar(puff.scale * cloud.scale);
                    this.dummy.updateMatrix();
                    this.mesh.setMatrixAt(idx, this.dummy.matrix);

                    // Per-puff depth color: lerp between bottom shadow and top highlight
                    const t = puff.colorT;
                    this._puffColor.setRGB(
                        botR + (topR - botR) * t,
                        botG + (topG - botG) * t,
                        botB + (topB - botB) * t
                    );
                    this.mesh.setColorAt(idx, this._puffColor);
                    instanceColorDirty = true;
                } else {
                    this.dummy.position.set(0, -1000, 0);
                    this.dummy.updateMatrix();
                    this.mesh.setMatrixAt(idx, this.dummy.matrix);
                }
            });
        }
        this.mesh.instanceMatrix.needsUpdate = true;
        if (instanceColorDirty && this.mesh.instanceColor) {
            this.mesh.instanceColor.needsUpdate = true;
        }
    }
}

class StarField {
    constructor(scene) {
        this.scene = scene;
        const count = 3000;
        const radius = 2000;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);

        for(let i=0; i<count; i++) {
            const u = Math.random();
            const v = Math.random();
            const theta = 2 * Math.PI * u;
            const phi = Math.acos(2 * v - 1);

            const x = radius * Math.sin(phi) * Math.cos(theta);
            const y = radius * Math.sin(phi) * Math.sin(theta);
            const z = radius * Math.cos(phi);

            positions[i*3] = x;
            positions[i*3+1] = y;
            positions[i*3+2] = z;

            sizes[i] = 0.5 + Math.random() * 1.5;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const vertexShader = `
            uniform float uTime;
            uniform float uOpacity;
            attribute float size;
            varying float vOpacity;

            void main() {
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mvPosition;

                // Twinkle logic: Random offset based on position
                float random = sin(position.x * 12.9898 + position.y * 78.233 + position.z * 45.164);

                // Twinkle speed and intensity
                float twinkle = 0.7 + 0.3 * sin(uTime * 2.0 + random * 100.0);

                vOpacity = uOpacity * twinkle;
                gl_PointSize = size;
            }
        `;

        const fragmentShader = `
            varying float vOpacity;
            void main() {
                if (vOpacity <= 0.01) discard;

                // Circular soft point
                vec2 coord = gl_PointCoord - vec2(0.5);
                float dist = length(coord);
                if (dist > 0.5) discard;

                // Soft core
                float strength = 1.0 - (dist * 2.0);
                strength = pow(strength, 1.5);

                gl_FragColor = vec4(1.0, 1.0, 1.0, vOpacity * strength);
            }
        `;

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uOpacity: { value: 0.0 }
            },
            vertexShader: vertexShader,
            fragmentShader: fragmentShader,
            transparent: true,
            depthWrite: false,
            fog: false
        });

        this.mesh = new THREE.Points(geometry, material);
        this.mesh.renderOrder = -1; // Render with background
        this.scene.add(this.mesh);
    }

    update(sunPos) {
        if (!sunPos) return;

        // Sun elevation check (sunPos is approx 20 units away)
        // Twilight ends around -6 degrees
        const sunY = sunPos.y;

        let targetOpacity = 0;
        // Aether Architect: Improved Star Visibility (Civil Twilight)
        // Stars should be gone by Civil Twilight start (-6 degrees).
        // Radius = 20.
        // -12 degrees (Nautical Start) = 20 * sin(-12) = -4.16
        // -6 degrees (Civil Start) = 20 * sin(-6) = -2.09

        const fadeStart = -4.2;
        const fadeEnd = -2.1;

        if (sunY < fadeStart) {
            targetOpacity = 1.0;
        } else if (sunY < fadeEnd) {
            // Interpolate from 1 (at fadeStart) to 0 (at fadeEnd)
            targetOpacity = 1.0 - (sunY - fadeStart) / (fadeEnd - fadeStart);
        }

        if (targetOpacity > 0.01) {
             const time = Date.now() * 0.001;
             this.mesh.material.uniforms.uTime.value = time;
             this.mesh.material.uniforms.uOpacity.value = targetOpacity;
             this.mesh.visible = true;
        } else {
             this.mesh.visible = false;
        }
    }
}

export class WeatherEffects {
    constructor(scene, sundialGroup, camera) {
        this.scene = scene;
        this.sundialGroup = sundialGroup;
        this.starField = new StarField(scene);
        this.camera = camera;

        const pastZone = { minX: -12, maxX: -4 };
        const currZone = { minX: -4, maxX: 4 };
        const futureZone = { minX: 4, maxX: 12 };

        this.pastRain = new RainSystem(scene, pastZone, 2000);
        this.pastSnow = new SnowSystem(scene, pastZone, 1500);
        this.pastCumulus = new CloudSystem(scene, camera, pastZone, 10, 'cumulus');
        this.pastStratus = new CloudSystem(scene, camera, pastZone, 8,  'stratus');
        this.pastCirrus  = new CloudSystem(scene, camera, pastZone, 6,  'cirrus');
        this.pastDust = new WindDustSystem(scene, pastZone, 300);

        this.currRain = new RainSystem(scene, currZone, 2000);
        this.currSnow = new SnowSystem(scene, currZone, 1500);
        this.currCumulus = new CloudSystem(scene, camera, currZone, 10, 'cumulus');
        this.currStratus = new CloudSystem(scene, camera, currZone, 8,  'stratus');
        this.currCirrus  = new CloudSystem(scene, camera, currZone, 6,  'cirrus');
        this.currDust = new WindDustSystem(scene, currZone, 300);

        this.futureRain = new RainSystem(scene, futureZone, 2000);
        this.futureSnow = new SnowSystem(scene, futureZone, 1500);
        this.futureCumulus = new CloudSystem(scene, camera, futureZone, 10, 'cumulus');
        this.futureStratus = new CloudSystem(scene, camera, futureZone, 8,  'stratus');
        this.futureCirrus  = new CloudSystem(scene, camera, futureZone, 6,  'cirrus');
        this.futureDust = new WindDustSystem(scene, futureZone, 300);

        this.raycaster = new THREE.Raycaster();
        this.downVector = new THREE.Vector3(0, -1, 0);
        this.flashIntensity = 0;

        // Pooled lightning light
        this.lightningLight = new THREE.PointLight(0xaaddff, 5, 50);
        this.lightningLight.visible = false;
        this.scene.add(this.lightningLight);

        this.createSplashes();
    }

    /**
     * Split total cloudCover into per-type cover values based on weather code.
     * Returns { cumulus, stratus, cirrus } each in 0–100 range.
     *
     * Fractions are meteorologically motivated:
     *  - Cirrus: high-altitude ice crystals, prominent only in fair weather (codes 1–2).
     *    0.55 for code 1 = mostly cirrus at "few clouds"; 0.30 for code 2 = some cirrus mixed in.
     *  - Stratus: layer clouds dominant in overcast/precipitation. 0.35/0.65 split for showers/storms
     *    reflects the stratus anvil base beneath active convection.
     *  - Cumulus: convective clouds. 0.85 for storms = tall cumulonimbus; 0.40 general fallback
     *    for mixed conditions (e.g. drizzle has mostly stratus, only some cumulus).
     */
    _cloudTypeCovers(code, cover) {
        // Cirrus: high-altitude ice-crystal wisps appear only in fair/mostly-clear skies
        let cirrus = 0;
        if (code === 1) cirrus = cover * 0.55;       // few clouds = mostly high cirrus
        else if (code === 2) cirrus = cover * 0.30;  // partly cloudy = some cirrus above cumulus

        // Stratus: low/mid flat layer clouds dominate overcast and precipitation codes
        let stratus = 0;
        if (code === 3)                            stratus = cover;          // overcast = full stratus sheet
        else if (code >= 45 && code <= 48)         stratus = 100;            // fog = dense, surface-level stratus
        else if (code >= 51 && code <= 77)         stratus = cover;          // drizzle/rain/snow — nimbostratus
        else if (code >= 80 && code <= 82)         stratus = cover * 0.35;   // showers — stratus anvil base (35%)
        else if (code >= 95)                       stratus = cover * 0.65;   // storm — heavy stratus base (65%)

        // Cumulus: convective puffy/towering clouds in fair and active-weather codes
        let cumulus = 0;
        if (code === 0)                            cumulus = 0;               // clear sky — no clouds
        else if (code <= 2)                        cumulus = cover;           // few/partly — scattered cumulus
        else if (code === 3)                       cumulus = cover * 0.25;    // overcast — minimal cumulus remnants
        else if (code >= 80 && code <= 82)         cumulus = cover;           // showers — active cumulus/congestus
        else if (code >= 95)                       cumulus = cover * 0.85;    // storm — towering cumulonimbus (85%)
        else                                       cumulus = cover * 0.40;    // other rain — mixed, mostly stratus

        return { cumulus, stratus, cirrus };
    }

    update(past, current, forecast, delta = 0.016, lightColor, sunPos, moonPos, sunColor, moonColor) {
        if (this.flashIntensity > 0) {
            this.flashIntensity -= delta * 15.0;
            if (this.flashIntensity < 0) this.flashIntensity = 0;
        }

        const extractData = (data) => ({
            rain: (data.rain || 0) + (data.showers || 0),
            snow: (data.snowfall || 0),
            cloud: data.cloudCover || 0,
            wind: data.windSpeed || 0,
            dir: data.windDirection || 0,
            code: data.weatherCode || 0
        });

        const p = extractData(past);
        const c = extractData(current);
        const f = extractData(forecast);

        const pCovers = this._cloudTypeCovers(p.code, p.cloud);
        const cCovers = this._cloudTypeCovers(c.code, c.cloud);
        const fCovers = this._cloudTypeCovers(f.code, f.cloud);

        const args = [lightColor, sunPos, moonPos, sunColor, moonColor];

        this.pastRain.update(delta, p.wind, p.dir, p.rain, this.raycaster, null, null, lightColor);
        this.pastSnow.update(delta, p.wind, p.dir, p.snow, lightColor);
        this.pastCumulus.update(delta, p.wind, pCovers.cumulus, ...args, p.code);
        this.pastStratus.update(delta, p.wind, pCovers.stratus, ...args, p.code);
        this.pastCirrus.update(delta,  p.wind, pCovers.cirrus,  ...args, p.code);
        this.pastDust.update(delta, p.wind, p.dir, p.rain, lightColor);

        this.currRain.update(delta, c.wind, c.dir, c.rain, this.raycaster, this.sundialGroup, (pos) => this.spawnSplash(pos), lightColor);
        this.currSnow.update(delta, c.wind, c.dir, c.snow, lightColor);
        this.currCumulus.update(delta, c.wind, cCovers.cumulus, ...args, c.code);
        this.currStratus.update(delta, c.wind, cCovers.stratus, ...args, c.code);
        this.currCirrus.update(delta,  c.wind, cCovers.cirrus,  ...args, c.code);
        this.currDust.update(delta, c.wind, c.dir, c.rain, lightColor);

        this.futureRain.update(delta, f.wind, f.dir, f.rain, this.raycaster, null, null, lightColor);
        this.futureSnow.update(delta, f.wind, f.dir, f.snow, lightColor);
        this.futureCumulus.update(delta, f.wind, fCovers.cumulus, ...args, f.code);
        this.futureStratus.update(delta, f.wind, fCovers.stratus, ...args, f.code);
        this.futureCirrus.update(delta,  f.wind, fCovers.cirrus,  ...args, f.code);
        this.futureDust.update(delta, f.wind, f.dir, f.rain, lightColor);

        if (sunPos) {
            this.starField.update(sunPos);
        }

        if (p.code >= 95 || c.code >= 95 || f.code >= 95) {
             if (Math.random() < 0.01) {
                 this.createLightning();
             }
        }

        this.updateSplashes(lightColor);
    }

    getLightningFlash() {
        return this.flashIntensity;
    }

    createLightning() {
        if (this.flashIntensity > 0.5) return;

        const zone = { minX: -8, maxX: 8 };
        // Reuse pooled light
        this.lightningLight.position.set(zone.minX + Math.random() * (zone.maxX - zone.minX), 10, Math.random() * 10 - 5);
        this.lightningLight.visible = true;

        // Hide after random duration
        setTimeout(() => {
            this.lightningLight.visible = false;
        }, 100 + Math.random() * 100);

        this.flashIntensity = 2.0;
    }

    createSplashes() {
        const particleCount = 1000;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const life = new Float32Array(particleCount);

        for(let i=0; i<particleCount*3; i++) positions[i] = -100;
        for(let i=0; i<particleCount; i++) life[i] = 0;

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('life', new THREE.BufferAttribute(life, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: new THREE.Color(0xffffff) }
            },
            vertexShader: splashVertexShader,
            fragmentShader: splashFragmentShader,
            transparent: true,
            depthWrite: false
        });

        this.splashSystem = new THREE.Points(geometry, material);
        this.splashSystem.frustumCulled = false;
        this.scene.add(this.splashSystem);
    }

    spawnSplash(pos) {
        const positions = this.splashSystem.geometry.attributes.position.array;
        const life = this.splashSystem.geometry.attributes.life.array;

        for(let i=0; i<life.length; i++) {
            if (life[i] <= 0) {
                life[i] = 1.0;
                positions[i*3] = pos.x;
                positions[i*3+1] = pos.y + 0.02;
                positions[i*3+2] = pos.z;

                this.splashSystem.geometry.attributes.life.needsUpdate = true;
                this.splashSystem.geometry.attributes.position.needsUpdate = true;
                break;
            }
        }
    }

    updateSplashes(lightColor) {
        if (lightColor) {
            this.splashSystem.material.uniforms.uColor.value.copy(lightColor);
        }

        const positions = this.splashSystem.geometry.attributes.position.array;
        const life = this.splashSystem.geometry.attributes.life.array;
        let needsUpdate = false;

        for(let i=0; i<life.length; i++) {
            if (life[i] > 0) {
                life[i] -= 0.05;
                if (life[i] <= 0) {
                    life[i] = 0;
                    positions[i*3] = -100;
                }
                needsUpdate = true;
            }
        }

        if (needsUpdate) {
            this.splashSystem.geometry.attributes.life.needsUpdate = true;
            this.splashSystem.geometry.attributes.position.needsUpdate = true;
        }
    }
}
