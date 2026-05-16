import * as THREE from 'three';

export function smoothstep(min, max, value) {
  var x = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return x * x * (3 - 2 * x);
}

export function curlNoise(x, y, z, time) {
    const eps = 0.1;
    const n = (a, b, c) => Math.sin(a * 0.5 + time) * Math.cos(b * 0.3 + time) * Math.sin(c * 0.5);
    const dx = n(x, y + eps, z) - n(x, y - eps, z);
    const dy = n(x - eps, y, z) - n(x + eps, y, z);
    const dz = Math.sin(x * 0.1 + time);
    return new THREE.Vector3(dx * 0.5, 0, dy * 0.5);
}

export class ParticleSystemBase {
    constructor(scene) {
        this.scene = scene;
        this.isActive = true;
        this.targetOpacity = 0.0;
        this.currentOpacity = 0.0;
        this.fadeSpeed = 0.2;
    }

    updateOpacity(delta, target) {
        this.targetOpacity = target;
        if (this.currentOpacity < this.targetOpacity) {
            this.currentOpacity += delta * this.fadeSpeed;
            if (this.currentOpacity > this.targetOpacity) this.currentOpacity = this.targetOpacity;
        } else if (this.currentOpacity > this.targetOpacity) {
            this.currentOpacity -= delta * this.fadeSpeed;
            if (this.currentOpacity < this.targetOpacity) this.currentOpacity = this.targetOpacity;
        }
        return this.currentOpacity;
    }
}
