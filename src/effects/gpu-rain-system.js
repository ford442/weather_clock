import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    Fn,
    If,
    billboarding,
    float,
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
import { SUNDIAL_DIMENSIONS } from '../sundial.js';
import { ParticleSystemBase } from './particle-base.js';

export class GPURainSystem extends ParticleSystemBase {
    constructor(scene, zone, maxParticles = 10000, renderer = null) {
        super(scene);
        this.zone = zone || { minX: -8, maxX: 8 };
        this.maxParticles = maxParticles;
        this.renderer = renderer;
        this.currentIntensity = 0;
        this.activeCount = 0;
        this.splashSystem = null;

        this.positions = instancedArray(maxParticles, 'vec3');
        this.velocities = instancedArray(maxParticles, 'vec3');
        this.delta = uniform(0.016);
        this.wind = uniform(new THREE.Vector2());
        this.opacity = uniform(0);
        this.color = uniform(new THREE.Color(0x88ccff));

        const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
        material.vertexNode = billboarding({ position: this.positions.toAttribute() });
        material.colorNode = this.color;
        material.opacityNode = uv().distance(vec2(0.5, 0)).oneMinus().mul(2).clamp().mul(this.opacity);

        this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.8), material);
        this.mesh.count = 0;
        this.mesh.frustumCulled = false;
        this.scene.add(this.mesh);
    }

    setSplashSystem(system) {
        this.splashSystem = system;
    }

    async initWebGPU() {
        if (this.computeUpdate || !this.renderer) return;
        const width = this.zone.maxX - this.zone.minX;
        const seed = uint(Math.floor(Math.random() * 0xffffff));
        const init = Fn(() => {
            const position = this.positions.element(instanceIndex);
            const velocity = this.velocities.element(instanceIndex);
            position.x = hash(instanceIndex.add(seed)).mul(width).add(this.zone.minX);
            position.y = hash(instanceIndex.add(seed.add(17)))
                .mul(25)
                .add(-5);
            position.z = hash(instanceIndex.add(seed.add(31)))
                .mul(10)
                .add(-5);
            velocity.assign(vec3(0));
            velocity.y = hash(instanceIndex.add(seed.add(47)))
                .mul(-3)
                .add(-12);
        })().compute(this.maxParticles);

        this.computeUpdate = Fn(() => {
            const position = this.positions.element(instanceIndex);
            const velocity = this.velocities.element(instanceIndex);
            const frameScale = this.delta.min(0.05);
            velocity.x.addAssign(this.wind.x.sub(velocity.x).mul(frameScale.mul(6)));
            velocity.z.addAssign(this.wind.y.sub(velocity.z).mul(frameScale.mul(6)));
            position.addAssign(velocity.mul(frameScale));

            If(position.x.greaterThan(this.zone.maxX), () => position.x.subAssign(width));
            If(position.x.lessThan(this.zone.minX), () => position.x.addAssign(width));

            const surfaceY = float(-5).toVar();
            const radius = position.xz.length();
            If(radius.lessThan(SUNDIAL_DIMENSIONS.face.radius), () => {
                surfaceY.assign(SUNDIAL_DIMENSIONS.face.y + SUNDIAL_DIMENSIONS.face.height / 2);
            })
                .ElseIf(radius.lessThan(SUNDIAL_DIMENSIONS.base.radiusTop), () => {
                    surfaceY.assign(SUNDIAL_DIMENSIONS.base.y + SUNDIAL_DIMENSIONS.base.height / 2);
                })
                .ElseIf(radius.lessThan(SUNDIAL_DIMENSIONS.base.radiusBottom), () => {
                    const slope = radius
                        .sub(SUNDIAL_DIMENSIONS.base.radiusTop)
                        .div(SUNDIAL_DIMENSIONS.base.radiusBottom - SUNDIAL_DIMENSIONS.base.radiusTop);
                    const top = SUNDIAL_DIMENSIONS.base.y + SUNDIAL_DIMENSIONS.base.height / 2;
                    surfaceY.assign(float(top).sub(slope.mul(SUNDIAL_DIMENSIONS.base.height)));
                });

            If(position.y.lessThan(surfaceY), () => {
                if (this.splashSystem) {
                    const splashIndex = instanceIndex.mod(uint(this.splashSystem.maxParticles));
                    const splashPosition = this.splashSystem.positions.element(splashIndex);
                    splashPosition.x = position.x;
                    splashPosition.y = surfaceY.add(0.02);
                    splashPosition.z = position.z;
                    this.splashSystem.life.element(splashIndex).assign(1);
                }
                position.y = hash(instanceIndex.add(time.mul(1000).toUint()))
                    .mul(5)
                    .add(15);
                position.x = hash(instanceIndex.add(seed).add(time.mul(997).toUint()))
                    .mul(width)
                    .add(this.zone.minX);
                position.z = hash(instanceIndex.add(seed.add(61)).add(time.mul(991).toUint()))
                    .mul(10)
                    .add(-5);
            });
        })()
            .compute(this.maxParticles)
            .setName('Weather Clock Rain');

        this.renderer.compute(init);
    }

    update(delta, windSpeed, windDir, intensity, _raycaster, _sundialGroup, _spawnSplash, lightColor) {
        if (lightColor) this.color.value.copy(lightColor);
        this.currentIntensity += (intensity - this.currentIntensity) * Math.min(1, delta);
        this.activeCount =
            this.currentIntensity > 0.01
                ? Math.min(this.maxParticles, Math.max(50, Math.floor(this.currentIntensity * this.maxParticles)))
                : 0;
        const targetOpacity = this.activeCount ? Math.min(0.9, 0.3 + this.currentIntensity * 0.2) : 0;
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
