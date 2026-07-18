import * as THREE from 'three';
import { createSplashMaterial, createSplashMaterialWebGPU } from '../webgpu/materials/SplashMaterial.js';

export class SplashSystem {
    constructor(scene) {
        this.scene = scene;
        this.createSplashes();
    }

    createSplashes() {
        const particleCount = 1000;
        this.maxParticles = particleCount;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const life = new Float32Array(particleCount);

        for (let i = 0; i < particleCount * 3; i++) positions[i] = -100;
        for (let i = 0; i < particleCount; i++) life[i] = 0;

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('life', new THREE.BufferAttribute(life, 1));

        const material = createSplashMaterial();

        this.mesh = new THREE.Points(geometry, material);
        this.mesh.frustumCulled = false;
        this.scene.add(this.mesh);
    }

    async initWebGPU() {
        this.mesh.material = await createSplashMaterialWebGPU();
    }

    spawnSplash(pos) {
        const positions = this.mesh.geometry.attributes.position.array;
        const life = this.mesh.geometry.attributes.life.array;

        for (let i = 0; i < life.length; i++) {
            if (life[i] <= 0) {
                life[i] = 1.0;
                positions[i * 3] = pos.x;
                positions[i * 3 + 1] = pos.y + 0.02;
                positions[i * 3 + 2] = pos.z;

                this.mesh.geometry.attributes.life.needsUpdate = true;
                this.mesh.geometry.attributes.position.needsUpdate = true;
                break;
            }
        }
    }

    update(lightColor) {
        if (lightColor) {
            this.mesh.material.uniforms.uColor.value.copy(lightColor);
        }

        const positions = this.mesh.geometry.attributes.position.array;
        const life = this.mesh.geometry.attributes.life.array;
        let needsUpdate = false;

        for (let i = 0; i < life.length; i++) {
            if (life[i] > 0) {
                life[i] -= 0.05;
                if (life[i] <= 0) {
                    life[i] = 0;
                    positions[i * 3] = -100;
                }
                needsUpdate = true;
            }
        }

        if (needsUpdate) {
            this.mesh.geometry.attributes.life.needsUpdate = true;
            this.mesh.geometry.attributes.position.needsUpdate = true;
        }
    }

    setVisible(visible) {
        if (this.mesh) this.mesh.visible = visible;
    }

    dispose() {
        if (!this.mesh) return;
        this.scene.remove(this.mesh);
        this.mesh.geometry?.dispose?.();
        this.mesh.material?.dispose?.();
        this.mesh = null;
    }
}
