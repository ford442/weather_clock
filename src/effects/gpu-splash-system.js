import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { Fn, If, instanceIndex, instancedArray, positionGeometry, uniform, uv, vec2 } from 'three/tsl';

export class GPUSplashSystem {
    constructor(scene, renderer, maxParticles = 5000) {
        this.scene = scene;
        this.renderer = renderer;
        this.maxParticles = maxParticles;
        this.positions = instancedArray(maxParticles, 'vec3');
        this.life = instancedArray(maxParticles, 'float');
        this.delta = uniform(0.016);
        this.color = uniform(new THREE.Color(0xffffff));

        const lifeNode = this.life.element(instanceIndex);
        const ring = uv().sub(vec2(0.5)).length().sub(lifeNode.mul(0.45)).abs().oneMinus().pow(16);
        const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
        material.positionNode = positionGeometry.add(this.positions.toAttribute());
        material.colorNode = this.color;
        material.opacityNode = ring.mul(lifeNode);
        const geometry = new THREE.PlaneGeometry(0.8, 0.8);
        geometry.rotateX(-Math.PI / 2);
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.count = maxParticles;
        this.mesh.frustumCulled = false;
        scene.add(this.mesh);
    }

    async initWebGPU() {
        if (this.computeUpdate || !this.renderer) return;
        const init = Fn(() => {
            const position = this.positions.element(instanceIndex);
            position.x = 0;
            position.y = -100;
            position.z = 0;
            this.life.element(instanceIndex).assign(0);
        })().compute(this.maxParticles);
        this.computeUpdate = Fn(() => {
            const position = this.positions.element(instanceIndex);
            const life = this.life.element(instanceIndex);
            If(life.greaterThan(0), () => {
                life.subAssign(this.delta.mul(1.8));
                If(life.lessThanEqual(0), () => {
                    life.assign(0);
                    position.y = -100;
                });
            });
        })()
            .compute(this.maxParticles)
            .setName('Weather Clock Splashes');
        this.renderer.compute(init);
    }

    spawnSplash() {}

    update(lightColor, delta = 0.016) {
        if (lightColor) this.color.value.copy(lightColor);
        if (!this.computeUpdate) return;
        this.delta.value = delta;
        this.renderer.compute(this.computeUpdate);
    }

    setVisible(visible) {
        this.mesh.visible = visible;
    }
    dispose() {
        this.scene.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
        this.mesh = null;
    }
}
