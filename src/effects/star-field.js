import * as THREE from 'three';
import { createStarFieldMaterial, createStarFieldMaterialWebGPU } from '../webgpu/materials/StarFieldMaterial.js';

export class StarField {
    constructor(scene) {
        this.scene = scene;
        const count = 3000;
        const radius = 2000;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const u = Math.random();
            const v = Math.random();
            const theta = 2 * Math.PI * u;
            const phi = Math.acos(2 * v - 1);

            const x = radius * Math.sin(phi) * Math.cos(theta);
            const y = radius * Math.sin(phi) * Math.sin(theta);
            const z = radius * Math.cos(phi);

            positions[i * 3] = x;
            positions[i * 3 + 1] = y;
            positions[i * 3 + 2] = z;

            sizes[i] = 0.5 + Math.random() * 1.5;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const material = createStarFieldMaterial();

        this.mesh = new THREE.Points(geometry, material);
        this.mesh.renderOrder = -1; // Render with background
        this.scene.add(this.mesh);
    }

    async initWebGPU() {
        this.mesh.material = await createStarFieldMaterialWebGPU();
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

    dispose() {
        this.scene.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
    }
}
