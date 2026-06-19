import * as THREE from 'three';
import { createFogTexture } from './cloud-resources.js';

export class FogEffect {
    constructor(scene, zone) {
        this.scene = scene;
        this.zone = zone;
        this.currentOpacity = 0;
        this.targetOpacity = 0;

        const count = 18;
        const texture = createFogTexture();
        const zoneWidth = zone.maxX - zone.minX;

        this.planes = [];
        for (let i = 0; i < count; i++) {
            const w = 3 + Math.random() * 5;
            const h = 0.8 + Math.random() * 1.8;
            const geo = new THREE.PlaneGeometry(w, h);
            const mat = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                opacity: 0,
                depthWrite: false,
                side: THREE.DoubleSide
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(
                zone.minX + Math.random() * zoneWidth,
                -0.3 + Math.random() * 2.2,
                (Math.random() - 0.5) * 14
            );
            mesh.rotation.x = -Math.PI / 2 + (Math.random() - 0.5) * 0.35;
            mesh.rotation.z = Math.random() * Math.PI * 2;
            mesh.visible = false;
            this.scene.add(mesh);
            this.planes.push({
                mesh,
                driftX: (Math.random() - 0.5) * 0.008,
                driftZ: (Math.random() - 0.5) * 0.008,
                baseOpacity: 0.04 + Math.random() * 0.08
            });
        }
    }

    setIntensity(intensity) {
        this.targetOpacity = Math.max(0, Math.min(1, intensity));
    }

    update(delta, windSpeed, windDir) {
        const diff = this.targetOpacity - this.currentOpacity;
        this.currentOpacity += diff * Math.min(delta * 0.5, 1);

        if (this.currentOpacity < 0.005) {
            this.planes.forEach(p => { p.mesh.visible = false; });
            return;
        }

        const windRad = ((windDir || 0) - 180) * Math.PI / 180;
        const speed = (windSpeed || 2) * 0.00015 + 0.0008;
        const wx = Math.sin(windRad) * speed;
        const wz = Math.cos(windRad) * speed;

        this.planes.forEach(({ mesh, driftX, driftZ, baseOpacity }) => {
            mesh.visible = true;
            mesh.material.opacity = this.currentOpacity * baseOpacity;
            mesh.position.x += wx + driftX * delta;
            mesh.position.z += wz + driftZ * delta;
            if (mesh.position.x > this.zone.maxX + 1) mesh.position.x = this.zone.minX - 1;
            if (mesh.position.x < this.zone.minX - 1) mesh.position.x = this.zone.maxX + 1;
            if (mesh.position.z > 8) mesh.position.z = -8;
            if (mesh.position.z < -8) mesh.position.z = 8;
        });
    }

    setVisible(visible) {
        this.planes.forEach(({ mesh }) => {
            mesh.visible = visible && this.currentOpacity >= 0.005;
        });
    }

    dispose() {
        this.planes.forEach(({ mesh }) => {
            this.scene.remove(mesh);
            mesh.geometry?.dispose?.();
            mesh.material?.map?.dispose?.();
            mesh.material?.dispose?.();
        });
        this.planes = [];
    }
}
