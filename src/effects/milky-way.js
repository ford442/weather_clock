import * as THREE from 'three';
import { DEG, equatorialToVector, julianCenturies } from '../sky/celestialCoordinates.js';
import { MILKY_WAY_HALF_WIDTH_DEG, galacticToEquatorial, milkyWayBrightness } from '../sky/milkyWay.js';
import { buildMilkyWayMaterialWebGPU, createMilkyWayMaterial } from '../webgpu/materials/MilkyWayMaterial.js';

export const MILKY_WAY_CONFIG = Object.freeze({
    /** Ribbon resolution: segments around the galactic equator, rows across it. */
    longitudeSegments: 240,
    latitudeRows: 16,
    /** Baked texture size: u runs once round the band in l, v across it in b. */
    textureWidth: 512,
    textureHeight: 64,
    /** Peak alpha of the brightest texel. The band is a glow behind the stars, never a stripe in front of them. */
    intensity: 0.34,
    /** Relayout when precession has moved more than about a year, as the star catalog does. */
    precessionRebuildCenturies: 0.01,
    /**
     * The band is a surface brightness sitting just above the eye's threshold,
     * so cloud and skyglow erase it before they erase any point source. Its
     * opacity is the faint field's (same twilight × cloud × light-pollution
     * factors) raised to this power, and snapped to 0 below `cutoff`.
     */
    contrastExponent: 2,
    cutoff: 0.03,
    /** Latitudes within this distance of the ribbon's edge taper to zero, so it has no hard rim. */
    edgeTaperDeg: 7
});

/** Bulge light is old, warm stars; the disk away from the centre reads cooler. */
const WARM_TINT = [1.0, 0.88, 0.72];
const COOL_TINT = [0.74, 0.82, 1.0];

/**
 * Deterministic integer hash → [0, 1).
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
function hash2(x, y) {
    let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** @param {number} t */
const fade = (t) => t * t * (3 - 2 * t);

/**
 * Bilinear value noise, 0…1, periodic in x with an integer `period`, so the
 * band's texture meets itself seamlessly at l = 0 / 360.
 * @param {number} x
 * @param {number} y
 * @param {number} period
 * @returns {number}
 */
function periodicValueNoise(x, y, period) {
    const xf = Math.floor(x);
    const yi = Math.floor(y);
    const u = fade(x - xf);
    const v = fade(y - yi);
    const x0 = ((xf % period) + period) % period;
    const x1 = (x0 + 1) % period;
    const top = hash2(x0, yi) + (hash2(x1, yi) - hash2(x0, yi)) * u;
    const bottom = hash2(x0, yi + 1) + (hash2(x1, yi + 1) - hash2(x0, yi + 1)) * u;
    return top + (bottom - top) * v;
}

/**
 * Mottling for the band: a few octaves of value noise, periodic round the
 * galactic equator. Cells are ~6° at the base octave.
 * @param {number} longitudeDeg
 * @param {number} latitudeDeg
 * @returns {number} 0…1
 */
function bandMottle(longitudeDeg, latitudeDeg) {
    let sum = 0;
    let amplitude = 0.5;
    let norm = 0;
    let period = 60;
    for (let octave = 0; octave < 4; octave++) {
        const x = (longitudeDeg / 360) * period;
        const y = (latitudeDeg / 360) * period + octave * 17.3;
        sum += amplitude * periodicValueNoise(x, y, period);
        norm += amplitude;
        amplitude *= 0.5;
        period *= 2;
    }
    return sum / norm;
}

/**
 * Bake the band once: rgb = tint, a = mottled surface brightness. A plain
 * DataTexture rather than a canvas, so it bakes identically in the browser,
 * in workers, and under Vitest.
 * @param {{width?: number, height?: number}} [options]
 * @returns {THREE.DataTexture}
 */
export function createMilkyWayTexture({
    width = MILKY_WAY_CONFIG.textureWidth,
    height = MILKY_WAY_CONFIG.textureHeight
} = {}) {
    const data = new Uint8Array(width * height * 4);
    const half = MILKY_WAY_HALF_WIDTH_DEG;
    const taper = MILKY_WAY_CONFIG.edgeTaperDeg;

    for (let row = 0; row < height; row++) {
        const latitude = -half + ((row + 0.5) / height) * 2 * half;
        const edge = Math.min(1, Math.max(0, (half - Math.abs(latitude)) / taper));
        const edgeFade = edge * edge * (3 - 2 * edge);
        for (let column = 0; column < width; column++) {
            const longitude = ((column + 0.5) / width) * 360;
            const smooth = milkyWayBrightness(longitude, latitude) * edgeFade;
            // Most of the ribbon's area is dark sky; skip the noise there.
            const mottle = smooth > 1 / 512 ? bandMottle(longitude, latitude) : 0;
            const brightness = smooth * (0.45 + 0.85 * mottle * mottle);
            const signed = longitude > 180 ? longitude - 360 : longitude;
            const warm = Math.exp(-(signed * signed) / (2 * 40 * 40));

            const offset = (row * width + column) * 4;
            for (let channel = 0; channel < 3; channel++) {
                const tint = COOL_TINT[channel] + (WARM_TINT[channel] - COOL_TINT[channel]) * warm;
                data[offset + channel] = Math.round(tint * 255);
            }
            data[offset + 3] = Math.round(Math.max(0, Math.min(1, brightness)) * 255);
        }
    }

    const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
}

/**
 * The Milky Way: one ribbon mesh along the galactic equator, on the star
 * sphere, parented to the star field's sky group so the single latitude +
 * sidereal-time rotation carries it with the stars. Its vertices are laid out
 * in the equatorial frame of date and only rewritten when precession moves.
 *
 * One draw call: a single indexed mesh, a single baked texture. No label.
 */
export class MilkyWayBand {
    /**
     * @param {THREE.Object3D} parent - The star field's sky group (equatorial frame).
     * @param {{radius?: number, nodeModules?: {webgpu: typeof import('three/webgpu'), tsl: typeof import('three/tsl')}|null}} [options]
     */
    constructor(parent, options = {}) {
        this.parent = parent;
        this.radius = options.radius ?? 2000;
        this.opacity = 0;
        /** Julian centuries the ribbon was last laid out for. */
        this.layoutCenturies = Number.NaN;
        this._webgpu = false;

        this.texture = createMilkyWayTexture();
        this.geometry = this._buildGeometry();
        /** @type {THREE.ShaderMaterial | import('three/webgpu').MeshBasicNodeMaterial} */
        this.material = createMilkyWayMaterial(this.texture, { intensity: MILKY_WAY_CONFIG.intensity });

        this.mesh = new THREE.Mesh(this.geometry, /** @type {THREE.Material} */ (this.material));
        this.mesh.name = 'milky-way';
        // Behind every star batch (they draw at -1), so stars sit on top of the glow.
        this.mesh.renderOrder = -2;
        // The ribbon spans the whole sky round the origin; culling it saves nothing.
        this.mesh.frustumCulled = false;
        this.mesh.visible = false;
        this.mesh.raycast = () => {};
        this.parent.add(this.mesh);

        if (options.nodeModules) this.initWebGPU(options.nodeModules);
    }

    _buildGeometry() {
        const { longitudeSegments: columns, latitudeRows: rows } = MILKY_WAY_CONFIG;
        const vertexCount = (columns + 1) * (rows + 1);
        const geometry = new THREE.BufferGeometry();
        const uvs = new Float32Array(vertexCount * 2);
        for (let row = 0; row <= rows; row++) {
            for (let column = 0; column <= columns; column++) {
                const i = row * (columns + 1) + column;
                uvs[i * 2] = column / columns;
                uvs[i * 2 + 1] = row / rows;
            }
        }
        const indices = [];
        for (let row = 0; row < rows; row++) {
            for (let column = 0; column < columns; column++) {
                const a = row * (columns + 1) + column;
                const b = a + 1;
                const c = a + columns + 1;
                const d = c + 1;
                indices.push(a, c, b, b, c, d);
            }
        }
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        return geometry;
    }

    /**
     * Lay the ribbon out for a date. Cheap to call every frame: it only
     * rewrites vertices once precession has moved by about a year.
     * @param {Date|number} date
     */
    setDate(date) {
        const centuries = julianCenturies(date);
        if (
            Number.isFinite(this.layoutCenturies) &&
            Math.abs(centuries - this.layoutCenturies) < MILKY_WAY_CONFIG.precessionRebuildCenturies
        ) {
            return;
        }
        this.layoutCenturies = centuries;

        const { longitudeSegments: columns, latitudeRows: rows } = MILKY_WAY_CONFIG;
        const half = MILKY_WAY_HALF_WIDTH_DEG;
        const positions = this.geometry.getAttribute('position');
        for (let row = 0; row <= rows; row++) {
            const latitude = (-half + (row / rows) * 2 * half) * DEG;
            for (let column = 0; column <= columns; column++) {
                const longitude = (column / columns) * 2 * Math.PI;
                const { ra, dec } = galacticToEquatorial(longitude, latitude, centuries);
                const vector = equatorialToVector(ra, dec, this.radius);
                positions.setXYZ(row * (columns + 1) + column, vector.x, vector.y, vector.z);
            }
        }
        positions.needsUpdate = true;
        this.geometry.computeBoundingSphere();
    }

    /**
     * Opacity the band gets from the faint field's opacity (see `contrastExponent`).
     * @param {number} faintOpacity
     * @returns {number}
     */
    static opacityFor(faintOpacity) {
        const opacity = Math.pow(Math.max(0, Math.min(1, faintOpacity)), MILKY_WAY_CONFIG.contrastExponent);
        return opacity < MILKY_WAY_CONFIG.cutoff ? 0 : opacity;
    }

    /**
     * Fade with the sky.
     * @param {number} faintOpacity - The star field's faint-field opacity this frame.
     * @param {boolean} [allowed] - False on quality tiers that cannot afford the band.
     */
    update(faintOpacity, allowed = true) {
        this.opacity = allowed ? MilkyWayBand.opacityFor(faintOpacity) : 0;
        this.mesh.visible = this.opacity > 0;
        const uniforms = this._uniforms();
        uniforms.uOpacity.value = this.opacity;
        uniforms.uHorizonRadius.value = this.radius;
    }

    /** @returns {{uOpacity: {value: number}, uHorizonRadius: {value: number}}} */
    _uniforms() {
        const material = /** @type {any} */ (this.material);
        return material.uniforms ?? material.userData.bandUniforms;
    }

    /**
     * Swap to the TSL material. Synchronous: the star field already holds the
     * loaded node modules by the time it calls this.
     * @param {{webgpu: typeof import('three/webgpu'), tsl: typeof import('three/tsl')}} modules
     */
    initWebGPU(modules) {
        if (this._webgpu) return;
        const next = buildMilkyWayMaterialWebGPU(modules, this.texture, { intensity: MILKY_WAY_CONFIG.intensity });
        this.material.dispose();
        this.material = next;
        this.mesh.material = /** @type {any} */ (next);
        this._webgpu = true;
    }

    /** For `aetherDebug.getNightSkyState()`. */
    getState() {
        return {
            built: true,
            backend: this._webgpu ? 'webgpu' : 'webgl',
            visible: this.mesh.visible,
            opacity: this.opacity,
            layoutCenturies: this.layoutCenturies
        };
    }

    dispose() {
        this.parent.remove(this.mesh);
        this.geometry.dispose();
        this.material.dispose();
        this.texture.dispose();
    }
}
