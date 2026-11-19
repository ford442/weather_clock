import * as THREE from 'three';
import { SCENE_LAYOUT } from '../scene-layout.js';
import { buildAuroraMaterialWebGPU, createAuroraMaterial } from '../webgpu/materials/AuroraMaterial.js';

const DEG = Math.PI / 180;

/**
 * @typedef {object} AuroraRibbonLayout
 * @property {number} azimuth - Centre azimuth, degrees east of the bearing.
 * @property {number} halfSpan - Half the ribbon's width in azimuth, degrees.
 * @property {number} baseAltitude - Lower hem altitude, degrees.
 * @property {number} height - Altitude the ribbon climbs above its hem, degrees.
 * @property {number} seed - Decorrelates folds and rays between ribbons.
 */

export const AURORA_RENDER_CONFIG = Object.freeze({
    /** Just inside the star sphere: drawn with the stars, in front of them. */
    radius: SCENE_LAYOUT.starSphere.radius * 0.92,
    columns: 96,
    rows: 4,
    /** Peak alpha. A glow on the horizon, not a neon sign. */
    peakOpacity: 0.62,
    /** Skyglow dims the curtain, but far less than it dims the faint stars. */
    lightPollutionDimming: 0.5,
    /** Fold amplitudes: azimuth wander and hem ripple, degrees. */
    foldAzimuthDeg: 5,
    foldAltitudeDeg: 2.2,
    /** Wall-clock seconds per frame are clamped so a stalled tab does not lurch. */
    maxStepSeconds: 0.1,
    /** @type {ReadonlyArray<AuroraRibbonLayout>} */
    ribbons: Object.freeze([
        Object.freeze({ azimuth: -18, halfSpan: 55, baseAltitude: 7, height: 24, seed: 0.13 }),
        Object.freeze({ azimuth: 22, halfSpan: 46, baseAltitude: 11, height: 20, seed: 0.57 }),
        Object.freeze({ azimuth: -4, halfSpan: 64, baseAltitude: 16, height: 28, seed: 0.91 })
    ])
});

/**
 * Scene-frame direction for a compass azimuth/altitude with North = +Z and
 * East = +X (see AGENTS.md, Coordinate Systems).
 * @param {number} azimuthRad
 * @param {number} altitudeRad
 * @param {number} radius
 * @returns {[number, number, number]}
 */
function localDirection(azimuthRad, altitudeRad, radius) {
    const horizontal = Math.cos(altitudeRad) * radius;
    return [Math.sin(azimuthRad) * horizontal, Math.sin(altitudeRad) * radius, Math.cos(azimuthRad) * horizontal];
}

/**
 * Lay the ribbons out facing north (+Z); the mesh turns to face south.
 * @param {number} radius
 * @returns {THREE.BufferGeometry}
 */
export function buildAuroraGeometry(radius = AURORA_RENDER_CONFIG.radius) {
    const { columns, rows, ribbons, foldAzimuthDeg, foldAltitudeDeg } = AURORA_RENDER_CONFIG;
    const perRibbon = (columns + 1) * (rows + 1);
    const positions = new Float32Array(perRibbon * ribbons.length * 3);
    const uvs = new Float32Array(perRibbon * ribbons.length * 2);
    const seeds = new Float32Array(perRibbon * ribbons.length);
    /** @type {number[]} */
    const indices = [];

    ribbons.forEach((ribbon, r) => {
        const first = r * perRibbon;
        for (let column = 0; column <= columns; column++) {
            const u = column / columns;
            const phase = u * 2 * Math.PI;
            const azimuth =
                ribbon.azimuth +
                ribbon.halfSpan * (2 * u - 1) +
                foldAzimuthDeg * Math.sin(phase * 1.3 + ribbon.seed * 9);
            const hem = ribbon.baseAltitude + foldAltitudeDeg * Math.sin(phase * 2.1 + ribbon.seed * 4);
            const height = ribbon.height * (0.85 + 0.15 * Math.sin(phase * 1.7 + ribbon.seed * 7));
            for (let row = 0; row <= rows; row++) {
                const v = row / rows;
                const i = first + row * (columns + 1) + column;
                const [x, y, z] = localDirection(azimuth * DEG, (hem + height * v) * DEG, radius);
                positions[i * 3] = x;
                positions[i * 3 + 1] = y;
                positions[i * 3 + 2] = z;
                uvs[i * 2] = u;
                uvs[i * 2 + 1] = v;
                seeds[i] = ribbon.seed;
            }
        }
        for (let row = 0; row < rows; row++) {
            for (let column = 0; column < columns; column++) {
                const a = first + row * (columns + 1) + column;
                const b = a + 1;
                const c = a + columns + 1;
                const d = c + 1;
                indices.push(a, c, b, b, c, d);
            }
        }
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    return geometry;
}

/**
 * The aurora: a few ribbons in one mesh, standing on the sky toward the
 * geomagnetic pole. Local, so it hangs off the scene rather than the star
 * field's equatorial `skyGroup` — it does not rise and set with sidereal time.
 * The star field owns it and hands it the opacity it already computed from
 * twilight and cloud; this class only draws.
 */
export class AuroraCurtain {
    /**
     * @param {THREE.Object3D} parent - Local (alt/az) frame: the scene.
     * @param {{radius?: number, nodeModules?: {webgpu: typeof import('three/webgpu'), tsl: typeof import('three/tsl')}|null}} [options]
     */
    constructor(parent, options = {}) {
        this.parent = parent;
        this.radius = options.radius ?? AURORA_RENDER_CONFIG.radius;
        this.opacity = 0;
        /** Wave phase, seconds. Held still under reduced motion. */
        this.time = 0;
        this.bearing = 0;
        this._webgpu = false;
        this._lastStepAt = Number.NaN;

        this.geometry = buildAuroraGeometry(this.radius);
        /** @type {THREE.ShaderMaterial | import('three/webgpu').MeshBasicNodeMaterial} */
        this.material = createAuroraMaterial();
        this.mesh = new THREE.Mesh(this.geometry, /** @type {THREE.Material} */ (this.material));
        this.mesh.name = 'aurora';
        // With the stars (they draw at -1), after the Milky Way (-2).
        this.mesh.renderOrder = -1;
        this.mesh.frustumCulled = false;
        this.mesh.visible = false;
        this.mesh.raycast = () => {};
        this.parent.add(this.mesh);

        if (options.nodeModules) this.initWebGPU(options.nodeModules);
    }

    /**
     * @param {object} frame
     * @param {number} frame.opacity - Final opacity 0…1 (twilight × cloud × activity).
     * @param {number} frame.bearing - Compass azimuth to face, 0 or 180.
     * @param {boolean} [frame.reducedMotion] - Hold the traveling wave still.
     * @param {number} [frame.now] - Wall-clock ms, for the wave.
     */
    update({ opacity, bearing, reducedMotion = false, now = Date.now() }) {
        this.opacity = Math.max(0, Math.min(1, opacity));
        this.mesh.visible = this.opacity > 0.002;
        if (bearing !== this.bearing) {
            this.bearing = bearing;
            this.mesh.rotation.y = bearing * DEG;
        }
        const step = Number.isFinite(this._lastStepAt) ? (now - this._lastStepAt) / 1000 : 0;
        this._lastStepAt = now;
        if (!reducedMotion && this.mesh.visible) {
            // Wrapped well before float32 loses the fraction.
            this.time = (this.time + Math.max(0, Math.min(AURORA_RENDER_CONFIG.maxStepSeconds, step))) % 3600;
        }
        const uniforms = this._uniforms();
        uniforms.uOpacity.value = this.opacity * AURORA_RENDER_CONFIG.peakOpacity;
        uniforms.uTime.value = this.time;
        uniforms.uHorizonRadius.value = this.radius;
    }

    /** @returns {{uOpacity: {value: number}, uTime: {value: number}, uHorizonRadius: {value: number}}} */
    _uniforms() {
        const material = /** @type {any} */ (this.material);
        return material.uniforms ?? material.userData.auroraUniforms;
    }

    /**
     * Swap to the TSL material.
     * @param {{webgpu: typeof import('three/webgpu'), tsl: typeof import('three/tsl')}} modules
     */
    initWebGPU(modules) {
        if (this._webgpu) return;
        const next = buildAuroraMaterialWebGPU(modules);
        this.material.dispose();
        this.material = next;
        this.mesh.material = /** @type {any} */ (next);
        this._webgpu = true;
    }

    /** @returns {{backend: 'webgpu'|'webgl', visible: boolean, opacity: number, bearing: number, time: number}} */
    getState() {
        return {
            backend: this._webgpu ? 'webgpu' : 'webgl',
            visible: this.mesh.visible,
            opacity: this.opacity,
            bearing: this.bearing,
            time: this.time
        };
    }

    dispose() {
        this.parent.remove(this.mesh);
        this.geometry.dispose();
        this.material.dispose();
    }
}
