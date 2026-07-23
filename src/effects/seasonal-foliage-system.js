// Seasonal ambience: grass tufts + autumn leaf-fall, keyed off simulated month
// and hemisphere. Low particle/instance budget — pure ambience, not a focal
// effect. Leaf-fall uses a plain THREE.Points buffer (not the native particle
// runtime) since the budget here is small enough that it isn't worth the
// coupling to `wind-dust-system.js`'s native-buffer machinery.
import * as THREE from 'three';
import { ResourceManager } from './cloud-resources.js';

const SEASON_COLORS = {
    spring: 0x5fae4a,
    summer: 0x4a8f3a,
    autumn: 0x9c7a3c,
    winter: 0x5fae4a // grass hidden in winter; color unused
};

const BASE_GRASS_INSTANCES = 400;
const BASE_LEAF_PARTICLES = 140;

/**
 * @param {Date} simulationTime
 * @param {number} latitude
 * @returns {'spring'|'summer'|'autumn'|'winter'}
 */
export function deriveSeason(simulationTime, latitude) {
    const month = simulationTime.getMonth(); // 0-11
    const isNorthern = latitude >= 0;
    // Northern-hemisphere mapping; shifted 6 months for the south.
    const shifted = isNorthern ? month : (month + 6) % 12;
    if (shifted <= 1 || shifted === 11) return 'winter'; // Dec, Jan, Feb
    if (shifted <= 4) return 'spring'; // Mar-May
    if (shifted <= 7) return 'summer'; // Jun-Aug
    return 'autumn'; // Sep-Nov
}

export class SeasonalFoliageSystem {
    /**
     * @param {THREE.Scene} scene
     * @param {number} groundRadius
     */
    constructor(scene, groundRadius) {
        this.scene = scene;
        this.groundRadius = groundRadius;
        this.season = 'summer';
        this.particleDivisor = 1;

        this._buildGrass();
        this._buildLeaves();
    }

    _buildGrass() {
        const bladeGeometry = new THREE.PlaneGeometry(0.06, 0.22);
        bladeGeometry.translate(0, 0.11, 0);
        const material = new THREE.MeshBasicMaterial({
            color: SEASON_COLORS.summer,
            side: THREE.DoubleSide
        });

        this.grassMesh = new THREE.InstancedMesh(bladeGeometry, material, BASE_GRASS_INSTANCES);
        this.grassMesh.frustumCulled = false;

        const dummy = new THREE.Object3D();
        for (let i = 0; i < BASE_GRASS_INSTANCES; i++) {
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.sqrt(Math.random()) * this.groundRadius * 0.95;
            dummy.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
            dummy.rotation.y = Math.random() * Math.PI * 2;
            const scale = 0.7 + Math.random() * 0.6;
            dummy.scale.setScalar(scale);
            dummy.updateMatrix();
            this.grassMesh.setMatrixAt(i, dummy.matrix);
        }
        this.grassMesh.instanceMatrix.needsUpdate = true;
        this.grassMesh.count = BASE_GRASS_INSTANCES;
        this.scene.add(this.grassMesh);
    }

    _buildLeaves() {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(BASE_LEAF_PARTICLES * 3);
        const velocities = new Float32Array(BASE_LEAF_PARTICLES * 3);
        for (let i = 0; i < BASE_LEAF_PARTICLES; i++) {
            this._resetLeaf(i, positions, velocities);
        }
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this._leafPositions = positions;
        this._leafVelocities = velocities;

        const material = new THREE.PointsMaterial({
            color: 0xb5651d,
            size: 0.12,
            map: ResourceManager.getCloudTexture('cumulus'),
            transparent: true,
            opacity: 0,
            depthWrite: false
        });

        this.leafMesh = new THREE.Points(geometry, material);
        this.leafMesh.frustumCulled = false;
        this.leafMesh.visible = false;
        this.scene.add(this.leafMesh);
    }

    _resetLeaf(i, positions, velocities) {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * this.groundRadius;
        positions[i * 3] = Math.cos(angle) * radius;
        positions[i * 3 + 1] = Math.random() * 4 + 1;
        positions[i * 3 + 2] = Math.sin(angle) * radius;
        velocities[i * 3] = (Math.random() - 0.5) * 0.3;
        velocities[i * 3 + 1] = -(0.3 + Math.random() * 0.4);
        velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
    }

    setQuality(tier, particleDivisor = 1) {
        this.particleDivisor = Math.max(1, particleDivisor);
        this.grassMesh.count = Math.floor(BASE_GRASS_INSTANCES / this.particleDivisor);
    }

    setLatitude(latitude) {
        this._latitude = latitude;
    }

    /**
     * @param {number} delta wall-clock seconds (leaf drift is cosmetic, doesn't need sim-time correctness)
     * @param {Date} simulationTime
     * @param {number} latitude
     * @param {number} windSpeed
     * @param {number} windDirection
     */
    update(delta, simulationTime, latitude, windSpeed = 0, windDirection = 0) {
        const season = deriveSeason(simulationTime, latitude);
        if (season !== this.season) {
            this.season = season;
            this.grassMesh.material.color.setHex(SEASON_COLORS[season]);
            this.grassMesh.visible = season !== 'winter';
        }

        const leafActive = season === 'autumn';
        const targetOpacity = leafActive ? 0.85 : 0;
        this.leafMesh.material.opacity += (targetOpacity - this.leafMesh.material.opacity) * Math.min(1, delta * 0.5);
        this.leafMesh.visible = this.leafMesh.material.opacity > 0.01;

        if (!this.leafMesh.visible) return;

        const activeCount = Math.max(1, Math.floor(BASE_LEAF_PARTICLES / this.particleDivisor));
        this.leafMesh.geometry.setDrawRange(0, activeCount);

        const rad = ((90 - windDirection) * Math.PI) / 180;
        const windX = Math.cos(rad) * windSpeed * 0.02;
        const windZ = -Math.sin(rad) * windSpeed * 0.02;
        const positions = this._leafPositions;
        const velocities = this._leafVelocities;

        for (let i = 0; i < activeCount; i++) {
            const i3 = i * 3;
            positions[i3] += (velocities[i3] + windX) * delta;
            positions[i3 + 1] += velocities[i3 + 1] * delta;
            positions[i3 + 2] += (velocities[i3 + 2] + windZ) * delta;
            if (positions[i3 + 1] < 0) {
                this._resetLeaf(i, positions, velocities);
            }
        }
        this.leafMesh.geometry.attributes.position.needsUpdate = true;
    }

    dispose() {
        this.scene.remove(this.grassMesh);
        this.grassMesh.geometry.dispose();
        this.grassMesh.material.dispose();
        this.scene.remove(this.leafMesh);
        this.leafMesh.geometry.dispose();
        this.leafMesh.material.dispose();
    }
}
