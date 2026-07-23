import * as THREE from 'three';

const MAX_BOLTS = 4;
const MAX_SEGMENTS_PER_BOLT = 48;
const BOLT_LIFETIME = 0.12; // seconds — a 2-3 frame flash at 60fps
const BRANCH_DEPTH = 4;
const BRANCH_PROBABILITY = 0.35;

/**
 * Recursive midpoint-displacement fork generator. Pushes [p1, p2] pairs
 * (THREE.Vector3) into `out` until the segment budget is exhausted.
 */
function subdivide(p1, p2, depth, spread, out, isBranch = false) {
    if (out.length >= MAX_SEGMENTS_PER_BOLT - 1) {
        out.push([p1, p2]);
        return;
    }
    if (depth <= 0) {
        out.push([p1, p2]);
        return;
    }

    const mid = p1.clone().lerp(p2, 0.4 + Math.random() * 0.2);
    mid.x += (Math.random() - 0.5) * spread;
    mid.z += (Math.random() - 0.5) * spread;

    subdivide(p1, mid, depth - 1, spread * 0.55, out, isBranch);

    if (!isBranch && Math.random() < BRANCH_PROBABILITY && out.length < MAX_SEGMENTS_PER_BOLT - 6) {
        const branchEnd = mid
            .clone()
            .lerp(p2, 0.3 + Math.random() * 0.3)
            .add(new THREE.Vector3((Math.random() - 0.5) * spread * 2, -spread * 0.5, (Math.random() - 0.5) * spread * 2));
        subdivide(mid, branchEnd, Math.max(0, depth - 2), spread * 0.5, out, true);
    }

    subdivide(mid, p2, depth - 1, spread * 0.55, out, isBranch);
}

function generateBoltSegments(start, end) {
    const segments = [];
    subdivide(start, end, BRANCH_DEPTH, 1.4, segments);
    return segments.slice(0, MAX_SEGMENTS_PER_BOLT);
}

/**
 * Branching lightning-bolt strikes, pooled and additive-blended.
 * Purely cosmetic — paired with WeatherEffects' existing flash light.
 */
export class LightningBoltSystem {
    constructor(scene) {
        this.scene = scene;
        this.bolts = [];

        for (let i = 0; i < MAX_BOLTS; i++) {
            const geometry = new THREE.BufferGeometry();
            const positions = new Float32Array(MAX_SEGMENTS_PER_BOLT * 2 * 3);
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setDrawRange(0, 0);

            const material = new THREE.LineBasicMaterial({
                color: 0xcfe8ff,
                transparent: true,
                opacity: 0,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });

            const mesh = new THREE.LineSegments(geometry, material);
            mesh.frustumCulled = false;
            mesh.visible = false;
            this.scene.add(mesh);

            this.bolts.push({ mesh, geometry, material, life: 0 });
        }
    }

    /**
     * @param {THREE.Vector3} origin - cloud-base spawn point
     * @param {number} [groundY=0]
     */
    spawnBolt(origin, groundY = 0) {
        const slot = this.bolts.find((b) => b.life <= 0) || this.bolts[0];

        const end = new THREE.Vector3(
            origin.x + (Math.random() - 0.5) * 2,
            groundY,
            origin.z + (Math.random() - 0.5) * 2
        );
        const segments = generateBoltSegments(origin, end);

        const positions = slot.geometry.attributes.position.array;
        let idx = 0;
        for (const [p1, p2] of segments) {
            positions[idx++] = p1.x;
            positions[idx++] = p1.y;
            positions[idx++] = p1.z;
            positions[idx++] = p2.x;
            positions[idx++] = p2.y;
            positions[idx++] = p2.z;
        }
        slot.geometry.attributes.position.needsUpdate = true;
        slot.geometry.setDrawRange(0, segments.length * 2);
        slot.geometry.computeBoundingSphere();

        slot.material.opacity = 1;
        slot.mesh.visible = true;
        slot.life = BOLT_LIFETIME;

        return slot;
    }

    update(delta) {
        for (const bolt of this.bolts) {
            if (bolt.life <= 0) continue;
            bolt.life -= delta;
            bolt.material.opacity = Math.max(0, bolt.life / BOLT_LIFETIME);
            if (bolt.life <= 0) {
                bolt.mesh.visible = false;
            }
        }
    }

    dispose() {
        for (const bolt of this.bolts) {
            this.scene.remove(bolt.mesh);
            bolt.geometry.dispose();
            bolt.material.dispose();
        }
        this.bolts = [];
    }
}
