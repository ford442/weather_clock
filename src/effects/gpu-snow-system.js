import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    Fn,
    If,
    billboarding,
    hash,
    instanceIndex,
    instancedArray,
    time,
    uint,
    uniform,
    uv,
    vec2,
    vec3
} from 'three/tsl';
import { ParticleSystemBase } from './particle-base.js';

export class GPUSnowSystem extends ParticleSystemBase {
    constructor(scene, zone, maxParticles = 7500, renderer = null) {
        super(scene);
        this.zone = zone || { minX: -8, maxX: 8 };
        this.maxParticles = maxParticles;
        this.renderer = renderer;
        this.currentIntensity = 0;
        this.activeCount = 0;
        this.positions = instancedArray(maxParticles, 'vec3');
        this.velocities = instancedArray(maxParticles, 'vec3');
        this.delta = uniform(0.016);
        this.wind = uniform(new THREE.Vector2());
        this.opacity = uniform(0);
        this.color = uniform(new THREE.Color(0xffffff));

        const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
        material.vertexNode = billboarding({ position: this.positions.toAttribute() });
        material.colorNode = this.color;
        const radial = uv().sub(vec2(0.5)).length();
        material.opacityNode = radial.oneMinus().mul(1.8).clamp().mul(this.opacity);
        this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.12), material);
        this.mesh.count = 0;
        this.mesh.frustumCulled = false;
        this.scene.add(this.mesh);
    }

    async initWebGPU() {
        if (this.computeUpdate || !this.renderer) return;
        const width = this.zone.maxX - this.zone.minX;
        const seed = uint(Math.floor(Math.random() * 0xffffff));
        const init = Fn(() => {
            const position = this.positions.element(instanceIndex);
            const velocity = this.velocities.element(instanceIndex);
            position.x = hash(instanceIndex.add(seed)).mul(width).add(this.zone.minX);
            position.y = hash(instanceIndex.add(seed.add(19)))
                .mul(20)
                .add(-5);
            position.z = hash(instanceIndex.add(seed.add(37)))
                .mul(20)
                .add(-10);
            velocity.assign(vec3(0));
            velocity.y = hash(instanceIndex.add(seed.add(53)))
                .mul(-0.7)
                .add(-0.5);
        })().compute(this.maxParticles);

        this.computeUpdate = Fn(() => {
            const position = this.positions.element(instanceIndex);
            const velocity = this.velocities.element(instanceIndex);
            const phase = time.mul(0.7).add(hash(instanceIndex.add(seed)).mul(20));
            const turbulence = vec3(
                phase.add(position.y.mul(0.13)).sin(),
                phase.mul(0.73).cos().mul(0.25),
                phase.mul(1.17).sin()
            );
            position.addAssign(
                velocity
                    .add(vec3(this.wind.x, 0, this.wind.y))
                    .add(turbulence.mul(0.35))
                    .mul(this.delta.min(0.05))
            );
            If(position.x.greaterThan(this.zone.maxX), () => position.x.subAssign(width));
            If(position.x.lessThan(this.zone.minX), () => position.x.addAssign(width));
            If(position.y.lessThan(-5), () => {
                position.y = 15;
                position.x = hash(instanceIndex.add(seed).add(time.mul(997).toUint()))
                    .mul(width)
                    .add(this.zone.minX);
            });
        })()
            .compute(this.maxParticles)
            .setName('Weather Clock Snow');
        this.renderer.compute(init);
    }

    update(delta, windSpeed, windDir, intensity, lightColor) {
        if (lightColor) this.color.value.copy(lightColor);
        this.currentIntensity += (intensity - this.currentIntensity) * Math.min(1, delta);
        this.activeCount =
            this.currentIntensity > 0.01
                ? Math.min(this.maxParticles, Math.max(50, Math.floor(this.currentIntensity * this.maxParticles)))
                : 0;
        const targetOpacity = this.activeCount ? Math.min(0.9, 0.3 + this.currentIntensity * 0.3) : 0;
        this.opacity.value = this.updateOpacity(delta, targetOpacity);
        this.mesh.visible = this.opacity.value > 0.01;
        this.mesh.count = this.activeCount;
        if (!this.mesh.visible || !this.computeUpdate) return;
        const rad = ((90 - windDir) * Math.PI) / 180;
        this.delta.value = delta;
        this.wind.value.set(Math.cos(rad) * windSpeed * 0.08, -Math.sin(rad) * windSpeed * 0.08);
        this.renderer.compute(this.computeUpdate);
    }
}
