import * as THREE from 'three';
import { ResourceManager } from './cloud-resources.js';
import { ParticleSystemBase } from './particle-base.js';
import { SCENE_LAYOUT } from '../scene-layout.js';

/**
 * Sparse amber motes that drift through the scene on high tree/grass/weed
 * pollen days. Deliberately tiny (a few dozen points, plain CPU stepping) so it
 * stays free on the frame budget — the particle count is quality-gated by the
 * caller and the system is skipped entirely on the lowest tiers.
 */
export class PollenSystem extends ParticleSystemBase {
    constructor(scene, zone, maxParticles = 60) {
        super(scene);
        this.currentIntensity = 0;
        this.maxParticles = maxParticles;
        this.zone = zone || SCENE_LAYOUT.zones.current;
        this.fadeSpeed = 0.35;

        const positions = new Float32Array(maxParticles * 3);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.PointsMaterial({
            color: 0xe8c55a, // amber
            size: 0.16,
            transparent: true,
            opacity: 0.0,
            map: ResourceManager.getCloudTexture('cumulus'),
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        this.mesh = new THREE.Points(geometry, material);
        this.scene.add(this.mesh);

        /** Per-particle drift phase, so motes don't move in lockstep. */
        this.phases = new Float32Array(maxParticles);
        for (let i = 0; i < maxParticles; i++) {
            this.resetParticle(i, positions);
            this.phases[i] = Math.random() * Math.PI * 2;
        }
    }

    resetParticle(i, positions) {
        positions[i * 3] = this.zone.minX + Math.random() * (this.zone.maxX - this.zone.minX);
        positions[i * 3 + 1] = Math.random() * 9;
        positions[i * 3 + 2] = Math.random() * 20 - 10;
    }

    /**
     * @param {number} delta seconds
     * @param {number} intensity01 pollen load, 0..1 (see getPollenIntensity)
     * @param {number} windSpeed km/h
     * @param {number} windDir degrees the wind is coming from
     * @param {number} rainIntensity rain washes pollen out of the air
     * @param {THREE.Color|null} [lightColor]
     */
    update(delta, intensity01, windSpeed, windDir, rainIntensity = 0, lightColor = null) {
        if (!this.mesh) return;
        if (lightColor) {
            this.mesh.material.color.copy(lightColor).multiplyScalar(0.9).lerp(new THREE.Color(0xe8c55a), 0.6);
        }

        const target = rainIntensity > 0.2 ? 0 : Math.max(0, Math.min(1, intensity01 ?? 0));
        this.currentIntensity += (target - this.currentIntensity) * Math.min(1, delta * 1.5);

        const opacity = this.updateOpacity(delta, this.currentIntensity * 0.32);
        this.mesh.material.opacity = opacity;

        if (opacity <= 0.01) {
            this.mesh.visible = false;
            return;
        }
        this.mesh.visible = true;

        const activeCount = Math.max(1, Math.floor(this.currentIntensity * this.maxParticles));
        this.mesh.geometry.setDrawRange(0, activeCount);

        const positions = this.mesh.geometry.attributes.position.array;
        const rad = ((90 - windDir) * Math.PI) / 180;
        const speedScale = 0.0025; // pollen is light but slower than dust
        const wX = Math.cos(rad) * windSpeed * speedScale;
        const wZ = -Math.sin(rad) * windSpeed * speedScale;
        const time = Date.now() * 0.001;
        const span = this.zone.maxX - this.zone.minX;

        for (let i = 0; i < activeCount; i++) {
            const i3 = i * 3;
            const phase = this.phases[i];
            positions[i3] += (wX + Math.sin(time * 0.6 + phase) * 0.06) * delta * 60;
            positions[i3 + 1] += (Math.sin(time * 0.45 + phase) * 0.05 - 0.01) * delta * 60;
            positions[i3 + 2] += (wZ + Math.cos(time * 0.5 + phase) * 0.04) * delta * 60;

            if (positions[i3] > this.zone.maxX) positions[i3] -= span;
            if (positions[i3] < this.zone.minX) positions[i3] += span;
            if (positions[i3 + 1] > 10) positions[i3 + 1] = 0.2;
            if (positions[i3 + 1] < 0) positions[i3 + 1] = 9.5;
            if (positions[i3 + 2] > 10) positions[i3 + 2] = -10;
            if (positions[i3 + 2] < -10) positions[i3 + 2] = 10;
        }
        this.mesh.geometry.attributes.position.needsUpdate = true;
    }
}
