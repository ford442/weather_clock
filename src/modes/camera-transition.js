// @ts-nocheck
import * as THREE from 'three';

export const MODE_CAMERA = {
    timeline: {
        position: new THREE.Vector3(0, 15, 25),
        target: new THREE.Vector3(0, 2, 0)
    },
    forecast: {
        position: new THREE.Vector3(3, 6, 10),
        target: new THREE.Vector3(0, 1, 0)
    }
};

const TRANSITION_DURATION_MS = 1500;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function animateModeCamera(owner, fromPosition, fromTarget, toPosition, toTarget) {
    return new Promise((resolve) => {
        const startTime = performance.now();
        const duration = owner.state?.reducedMotion ? 150 : TRANSITION_DURATION_MS;

        if (duration <= 0) {
            owner.camera.position.copy(toPosition);
            owner.controls.target.copy(toTarget);
            owner.camera.lookAt(toTarget);
            resolve();
            return;
        }

        const animate = (currentTime) => {
            const progress = Math.min((currentTime - startTime) / duration, 1);
            const eased = ease(progress);
            owner.camera.position.lerpVectors(fromPosition, toPosition, eased);
            const currentTarget = new THREE.Vector3().lerpVectors(fromTarget, toTarget, eased);
            owner.controls.target.copy(currentTarget);
            owner.camera.lookAt(currentTarget);

            if (progress < 1) {
                owner.animationId = requestAnimationFrame(animate);
            } else {
                owner.animationId = null;
                resolve();
            }
        };

        owner.animationId = requestAnimationFrame(animate);
    });
}
