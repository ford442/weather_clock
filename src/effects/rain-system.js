import * as THREE from 'three';
import { createRainMaterial, createRainMaterialWebGPU } from '../webgpu/materials/RainMaterial.js';
import { SUNDIAL_DIMENSIONS } from '../sundial.js';
import { ParticleSystemBase } from './particle-base.js';

export class RainSystem extends ParticleSystemBase {
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

        const material = createRainMaterial();

        this.mesh = new THREE.LineSegments(geometry, material);
        this.scene.add(this.mesh);

        this.velocities = velocities;
        this.states = states;

        for (let i = 0; i < maxParticles; i++) {
            this.resetParticle(i, true);
        }
        this.mesh.visible = true;
    }

    async initWebGPU() {
        this.mesh.material = await createRainMaterialWebGPU();
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
                this.velocities[i3 + 2] += (targetWindZ - this.velocities[i3 + 2]) * 0.1;

                const vx = this.velocities[i3];
                const vy = this.velocities[i3 + 1];
                const vz = this.velocities[i3 + 2];

                positions[i6 + 3] += vx;
                positions[i6 + 4] += vy;
                positions[i6 + 5] += vz;

                // Longer streaks for faster perceived motion
                const streak = 4.0;
                positions[i6] = positions[i6 + 3] - vx * streak;
                positions[i6 + 1] = positions[i6 + 4] - vy * streak;
                positions[i6 + 2] = positions[i6 + 5] - vz * streak;

                if (positions[i6 + 3] > this.zone.maxX) {
                    const w = this.zone.maxX - this.zone.minX;
                    positions[i6 + 3] -= w; positions[i6] -= w;
                } else if (positions[i6 + 3] < this.zone.minX) {
                    const w = this.zone.maxX - this.zone.minX;
                    positions[i6 + 3] += w; positions[i6] += w;
                }

                const headY = positions[i6 + 4];
                if (headY > -1 && headY < 4) {
                    if (sundialGroup) {
                        const headX = positions[i6 + 3];
                        const headZ = positions[i6 + 5];
                        const distSq = headX * headX + headZ * headZ;

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
                                if (spawnSplashCallback) spawnSplashCallback(new THREE.Vector3(headX, surfaceY, headZ));
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
