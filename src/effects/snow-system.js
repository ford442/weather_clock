import * as THREE from 'three';
import { ResourceManager } from './cloud-resources.js';
import { ParticleSystemBase, curlNoise } from './particle-base.js';

export class SnowSystem extends ParticleSystemBase {
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
            posAttr[i * 3] = this.zone.minX + Math.random() * (this.zone.maxX - this.zone.minX);
            posAttr[i * 3 + 1] = Math.random() * 15;
            posAttr[i * 3 + 2] = Math.random() * 20 - 10;

            this.velocities[i * 3] = 0;
            this.velocities[i * 3 + 1] = -0.02 - Math.random() * 0.03;
            this.velocities[i * 3 + 2] = 0;

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
            const py = positions[i3 + 1];
            const pz = positions[i3 + 2];

            const curl = curlNoise(px * 0.1, py * 0.1, pz * 0.1, time + this.offsets[i] * 0.01);

            positions[i3] += this.velocities[i3] + wX + curl.x * 0.05;
            positions[i3 + 1] += this.velocities[i3 + 1] + curl.y * 0.05;
            positions[i3 + 2] += this.velocities[i3 + 2] + wZ + curl.z * 0.05;

            if (positions[i3] > this.zone.maxX) positions[i3] -= (this.zone.maxX - this.zone.minX);
            if (positions[i3] < this.zone.minX) positions[i3] += (this.zone.maxX - this.zone.minX);

            if (positions[i3 + 1] < -5) {
                positions[i3 + 1] = 15;
                positions[i3] = this.zone.minX + Math.random() * (this.zone.maxX - this.zone.minX);
            }
        }
        this.mesh.geometry.attributes.position.needsUpdate = true;
    }
}
