import * as THREE from 'three';
import { getNativeRuntime } from '../native/native-runtime.js';
import { ResourceManager } from './cloud-resources.js';
import { ParticleSystemBase } from './particle-base.js';

export class WindDustSystem extends ParticleSystemBase {
    constructor(scene, zone, maxParticles = 300) {
        super(scene);
        this.currentIntensity = 0;
        this.maxParticles = maxParticles;
        this.zone = zone || { minX: -8, maxX: 8 };

        this.nativeRuntime = getNativeRuntime();
        this.nativeBuffers = this.nativeRuntime.allocateParticleBuffers(maxParticles, 3);
        const geometry = new THREE.BufferGeometry();
        const positions = this.nativeBuffers.positions;
        const velocities = this.nativeBuffers.velocities;
        const offsets = this.nativeBuffers.offsets;

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        // Use a small, subtle particle (similar to Snow but smaller/fainter)
        const material = new THREE.PointsMaterial({
            color: 0xcccccc, // Dust color
            size: 0.1, // Tiny
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
        posAttr[i * 3] = this.zone.minX + Math.random() * (this.zone.maxX - this.zone.minX);
        // Aether Architect: Cluster dust near ground to simulate "invisible grass" rustling
        posAttr[i * 3 + 1] = Math.pow(Math.random(), 2.5) * 8;
        posAttr[i * 3 + 2] = Math.random() * 20 - 10;

        // Initial random velocity
        this.velocities[i * 3] = 0;
        this.velocities[i * 3 + 1] = 0;
        this.velocities[i * 3 + 2] = 0;
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

        const rad = ((90 - windDir) * Math.PI) / 180;
        const speedScale = 0.003; // Dust is light, moves easily
        const wX = Math.cos(rad) * windSpeed * speedScale;
        const wZ = -Math.sin(rad) * windSpeed * speedScale;

        this.nativeRuntime.stepParticles(this.nativeBuffers, activeCount, wX, wZ, delta, {
            mode: 2,
            minX: this.zone.minX,
            maxX: this.zone.maxX,
            time
        });

        for (let i = 0; i < activeCount; i++) {
            const i3 = i * 3;
            // Height clamp/wrap
            if (positions[i3 + 1] > 8) positions[i3 + 1] = 0;
            if (positions[i3 + 1] < 0) positions[i3 + 1] = 8;
        }
        this.mesh.geometry.attributes.position.needsUpdate = true;
    }

    dispose() {
        super.dispose();
        this.nativeBuffers?.dispose?.();
        this.nativeBuffers = null;
    }
}
