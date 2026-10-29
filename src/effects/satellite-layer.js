import * as THREE from 'three';
import { createStarFieldMaterial, createStarFieldMaterialWebGPU } from '../webgpu/materials/StarFieldMaterial.js';
import { equatorialToVector } from '../sky/celestialCoordinates.js';
import { SATELLITE_CONFIG, getSatellitePositions, propagateSatellite } from '../sky/satellites.js';
import { getSnapshotCatalog } from '../sky/satelliteCatalog.js';
import { magnitudeToBrightness, magnitudeToPointSize } from './star-field.js';

export const SATELLITE_LAYER_CONFIG = Object.freeze({
    /**
     * Re-solve at most this often in *simulated* time. The ISS crosses the sky
     * at up to ~1°/s overhead, so a quarter second keeps it smooth at 1:1 while
     * a time-warp frame (≈24 simulated s) always re-solves.
     */
    recomputeMs: 250,
    /** ISS trail: samples, and how far back in simulated time they reach. */
    trailSamples: 24,
    trailSpanMs: 90000,
    /** Peak trail brightness, on top of the sky's twilight fade. */
    trailOpacity: 0.5,
    /** Trail vertices fade in over this band above the horizon, in degrees. */
    trailHorizonFadeDeg: 4,
    /** Brightness kept by an eclipsed ISS trail. */
    eclipsedTrailFactor: 0.25,
    /** The ISS stays findable among the other points. */
    issSizeBoost: 1.5
});

/** Sunlight off aluminium and solar panels: near-white, the ISS a touch warm. */
const ISS_COLOR = [1.0, 0.94, 0.82];
const SATELLITE_COLOR = [0.86, 0.9, 0.96];

/**
 * The optional satellite layer: naked-eye satellites as steady moving points on
 * the star sphere, brightest first, with a short fading trail behind the ISS.
 *
 * Like the zodiac overlay it parents into the star field's `skyGroup`, so the
 * single latitude + sidereal-time rotation carries it, and it fades with the
 * same twilight × cloud factor as the bright stars. Each satellite's RA/Dec is
 * topocentric, so where it lands among the stars is where the observer would
 * actually see it.
 *
 * Everything is driven by the simulation instant handed to {@link setDate}, so
 * time-warp, `setDebugTime`, photos, and time-lapse all see the same ephemeris.
 */
export class SatelliteLayer {
    /**
     * @param {THREE.Object3D} parent - The star field's sky group (equatorial frame).
     * @param {{
     *   radius?: number,
     *   catalog?: import('../sky/satelliteCatalog.js').SatelliteCatalog,
     *   reducedMotion?: boolean
     * }} [options]
     */
    constructor(parent, options = {}) {
        this.parent = parent;
        this.radius = options.radius ?? 2000;
        this.reducedMotion = !!options.reducedMotion;
        this.visible = false;

        /** @type {import('../sky/satelliteCatalog.js').SatelliteCatalog} */
        this.catalog = options.catalog ?? getSnapshotCatalog();
        /** @type {import('../sky/satellites.js').SatellitePosition[]} */
        this._positions = [];
        this._date = Number.NaN;
        this._solvedAt = Number.NaN;
        this._observerKey = '';
        /** @type {import('../sky/satellites.js').SatelliteObserver} */
        this._observer = { latitude: 0, longitude: 0 };
        this._trailVertices = 0;

        this.group = new THREE.Group();
        this.group.renderOrder = -1;
        this.group.visible = false;
        this.parent.add(this.group);

        this._buildPoints();
        this._buildTrail();
    }

    // ── Geometry construction ────────────────────────────────────────────────

    _buildPoints() {
        const capacity = Math.max(1, this.catalog.satellites.length);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(new Float32Array(capacity), 1));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
        geometry.setDrawRange(0, 0);

        /** @type {THREE.Material} */
        this.material = this.material ?? createStarFieldMaterial({ twinkle: false });
        this._setUniform('uHorizonRadius', this.radius);
        this.points = new THREE.Points(geometry, this.material);
        this.points.renderOrder = -1;
        this.points.frustumCulled = false;
        this.group.add(this.points);
    }

    _buildTrail() {
        const count = SATELLITE_LAYER_CONFIG.trailSamples;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
        geometry.setDrawRange(0, 0);
        // Additive, with the fade carried in the vertex colour: a tail that
        // dims to black adds nothing, on either backend, without needing
        // per-vertex alpha.
        this.trailMaterial = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            fog: false
        });
        this.trail = new THREE.Line(geometry, this.trailMaterial);
        this.trail.renderOrder = -1;
        this.trail.frustumCulled = false;
        this.trail.visible = false;
        this.group.add(this.trail);
    }

    /**
     * Write a uniform through whichever block the active backend exposes.
     * @param {'uOpacity'|'uHorizonRadius'} name
     * @param {number} value
     */
    _setUniform(name, value) {
        const material = /** @type {any} */ (this.material);
        const uniforms = material.uniforms || material.userData?.starUniforms;
        if (uniforms?.[name]) uniforms[name].value = value;
    }

    // ── Data ─────────────────────────────────────────────────────────────────

    /**
     * Swap in a new set of orbital elements (e.g. a live pull replacing the
     * snapshot). Regrows the point buffer if the catalog got bigger and forces
     * a re-solve on the next {@link setDate}.
     * @param {import('../sky/satelliteCatalog.js').SatelliteCatalog} catalog
     */
    setCatalog(catalog) {
        if (!catalog?.satellites?.length) return;
        this.catalog = catalog;
        const capacity = this.points.geometry.getAttribute('size').count;
        if (catalog.satellites.length > capacity) {
            this.group.remove(this.points);
            this.points.geometry.dispose();
            this._buildPoints();
        }
        this._solvedAt = Number.NaN;
        if (Number.isFinite(this._date)) this.setDate(this._date, this._observer);
    }

    /** @param {boolean} reducedMotion */
    setReducedMotion(reducedMotion) {
        this.reducedMotion = !!reducedMotion;
        if (this.reducedMotion) this.trail.visible = false;
        // Re-solve so the trail is rebuilt (or dropped) for the new setting.
        this._solvedAt = Number.NaN;
    }

    /**
     * Point the layer at an instant and an observer. Cheap to call every frame:
     * nothing is re-solved until the simulated clock has moved by
     * `recomputeMs` or the observer has moved.
     * @param {Date|number} date
     * @param {import('../sky/satellites.js').SatelliteObserver} observer
     */
    setDate(date, observer) {
        const when = date instanceof Date ? date.getTime() : Number(date);
        if (!Number.isFinite(when)) return;
        this._date = when;
        this._observer = { latitude: observer.latitude, longitude: observer.longitude, heightKm: observer.heightKm };
        const observerKey = `${observer.latitude.toFixed(4)},${observer.longitude.toFixed(4)}`;
        if (
            observerKey === this._observerKey &&
            Number.isFinite(this._solvedAt) &&
            Math.abs(when - this._solvedAt) < SATELLITE_LAYER_CONFIG.recomputeMs
        ) {
            return;
        }
        this._observerKey = observerKey;
        this._solvedAt = when;
        this._solve(when);
    }

    /** @param {number} when */
    _solve(when) {
        this._positions = getSatellitePositions(this.catalog.satellites, when, this._observer);

        const geometry = this.points.geometry;
        const positions = geometry.getAttribute('position');
        const sizes = geometry.getAttribute('size');
        const colors = geometry.getAttribute('aColor');
        const drawn = Math.min(this._positions.length, sizes.count);

        for (let i = 0; i < drawn; i++) {
            const satellite = this._positions[i];
            const vector = equatorialToVector(satellite.ra, satellite.dec, this.radius);
            positions.setXYZ(i, vector.x, vector.y, vector.z);
            sizes.setX(
                i,
                magnitudeToPointSize(satellite.magnitude) + (satellite.isIss ? SATELLITE_LAYER_CONFIG.issSizeBoost : 0)
            );
            const [r, g, b] = satellite.isIss ? ISS_COLOR : SATELLITE_COLOR;
            const brightness = magnitudeToBrightness(satellite.magnitude);
            colors.setXYZ(i, r * brightness, g * brightness, b * brightness);
        }
        geometry.setDrawRange(0, drawn);
        positions.needsUpdate = true;
        sizes.needsUpdate = true;
        colors.needsUpdate = true;

        this._solveTrail(when);
    }

    /**
     * The ISS trail is solved, not remembered: each vertex is the ISS's own
     * position a moment earlier in simulated time. That keeps it deterministic
     * (a photo or time-lapse frame draws the same tail) and means a jump in
     * time cannot leave a streak across the sky.
     * @param {number} when
     */
    _solveTrail(when) {
        const iss = this._positions.find((satellite) => satellite.isIss);
        const elements = iss ? this.catalog.satellites.find((entry) => entry.id === SATELLITE_CONFIG.issId) : null;
        if (this.reducedMotion || !iss || !elements) {
            this._trailVertices = 0;
            this.trail.geometry.setDrawRange(0, 0);
            return;
        }

        const { trailSamples, trailSpanMs, trailHorizonFadeDeg, eclipsedTrailFactor } = SATELLITE_LAYER_CONFIG;
        const positions = this.trail.geometry.getAttribute('position');
        const colors = this.trail.geometry.getAttribute('color');
        let count = 0;
        for (let k = 0; k < trailSamples; k++) {
            const sample =
                k === 0
                    ? iss
                    : propagateSatellite(elements, when - (k / (trailSamples - 1)) * trailSpanMs, this._observer);
            if (!sample) break;
            const vector = equatorialToVector(sample.ra, sample.dec, this.radius);
            positions.setXYZ(count, vector.x, vector.y, vector.z);
            const age = 1 - k / (trailSamples - 1);
            const horizon = Math.max(0, Math.min(1, sample.altitudeDeg / trailHorizonFadeDeg));
            const light = sample.sunlit ? 1 : eclipsedTrailFactor;
            const fade = age * age * horizon * light;
            colors.setXYZ(count, ISS_COLOR[0] * fade, ISS_COLOR[1] * fade, ISS_COLOR[2] * fade);
            count++;
        }
        this._trailVertices = count;
        this.trail.geometry.setDrawRange(0, count);
        positions.needsUpdate = true;
        colors.needsUpdate = true;
    }

    // ── Public surface ───────────────────────────────────────────────────────

    /** @param {boolean} visible */
    setVisible(visible) {
        this.visible = !!visible;
        if (!this.visible) this.group.visible = false;
    }

    /**
     * Fade with the sky around it.
     * @param {number} baseOpacity - The star field's current bright-star opacity.
     */
    update(baseOpacity) {
        if (!this.visible || baseOpacity <= 0.02) {
            this.group.visible = false;
            return;
        }
        this.group.visible = true;
        this._setUniform('uOpacity', baseOpacity);
        this._setUniform('uHorizonRadius', this.radius);
        this.points.visible = this.points.geometry.drawRange.count > 0;
        this.trailMaterial.opacity = baseOpacity * SATELLITE_LAYER_CONFIG.trailOpacity;
        this.trail.visible = !this.reducedMotion && this._trailVertices > 1;
    }

    /**
     * The satellites currently drawn, brightest first, for the debug API.
     * @returns {import('../sky/satellites.js').SatellitePosition[]}
     */
    getPositions() {
        return this._positions.map((satellite) => ({ ...satellite }));
    }

    /**
     * How much is behind the layer and how fresh it is.
     * @returns {{tracked: number, drawn: number, source: 'snapshot'|'live', epochAgeDays: number|null}}
     */
    getSummary() {
        const age =
            Number.isFinite(this._date) && Number.isFinite(this.catalog.newestEpochMs)
                ? (this._date - this.catalog.newestEpochMs) / 86400000
                : null;
        return {
            tracked: this.catalog.satellites.length,
            drawn: this.points.geometry.drawRange.count,
            source: this.catalog.source,
            epochAgeDays: age
        };
    }

    async initWebGPU() {
        const material = await createStarFieldMaterialWebGPU({ twinkle: false });
        const oldMaterial = this.material;
        this.material = material;
        this.points.material = material;
        this._setUniform('uHorizonRadius', this.radius);
        oldMaterial?.dispose?.();
    }

    dispose() {
        for (const object of [this.points, this.trail]) {
            this.group.remove(object);
            object.geometry.dispose();
        }
        this.material.dispose();
        this.trailMaterial.dispose();
        this.parent.remove(this.group);
    }
}
