import * as THREE from 'three';
import { getNativeRuntime } from '../native/native-runtime.js';
import { ResourceManager } from './cloud-resources.js';
import { ParticleSystemBase } from './particle-base.js';

export class SnowSystem extends ParticleSystemBase {
    constructor(scene, zone, maxParticles = 1000) {
        super(scene);
        this.currentIntensity = 0;
        this.activeCount = 0;
        this.maxParticles = maxParticles;
        this.zone = zone || { minX: -8, maxX: 8 };

        this.nativeRuntime = getNativeRuntime();
        this.nativeBuffers = this.nativeRuntime.allocateParticleBuffers(maxParticles, 3);
        const geometry = new THREE.BufferGeometry();
        const positions = this.nativeBuffers.positions;
        const velocities = this.nativeBuffers.velocities;
        const offsets = this.nativeBuffers.offsets;

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
        this.activeCount = activeCount;
        this.mesh.material.opacity = opacity;

        if (opacity <= 0.01) {
            this.mesh.visible = false;
            return;
        }
        this.mesh.visible = true;
        this.mesh.geometry.setDrawRange(0, activeCount);

        const positions = this.mesh.geometry.attributes.position.array;
        const time = Date.now() * 0.001;

        const rad = ((90 - windDir) * Math.PI) / 180;
        const speedScale = 0.002;
        const wX = Math.cos(rad) * windSpeed * speedScale;
        const wZ = -Math.sin(rad) * windSpeed * speedScale;

        this.nativeRuntime.stepParticles(this.nativeBuffers, activeCount, wX, wZ, delta, {
            mode: 0,
            minX: this.zone.minX,
            maxX: this.zone.maxX,
            time
        });

        for (let i = 0; i < activeCount; i++) {
            const i3 = i * 3;
            if (positions[i3 + 1] < -5) {
                positions[i3 + 1] = 15;
                positions[i3] = this.zone.minX + Math.random() * (this.zone.maxX - this.zone.minX);
            }
        }
        this.mesh.geometry.attributes.position.needsUpdate = true;
    }

    dispose() {
        super.dispose();
        this.nativeBuffers?.dispose?.();
        this.nativeBuffers = null;
    }
}
