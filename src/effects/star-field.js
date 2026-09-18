import * as THREE from 'three';
import { createStarFieldMaterial, createStarFieldMaterialWebGPU } from '../webgpu/materials/StarFieldMaterial.js';
import {
    DEG,
    HOURS_TO_RAD,
    equatorialToSceneMatrix,
    equatorialToVector,
    julianCenturies,
    localSiderealTime,
    precessFromJ2000
} from '../sky/celestialCoordinates.js';
import { CONSTELLATIONS, STARS, STAR_INDEX, colorFromBV, getConstellationLineIndices } from '../sky/starCatalog.js';
import { NAKED_EYE_PLANETS, getPlanetPositions } from '../sky/planets.js';
import { createTextSprite } from './text-sprite.js';
import { ZodiacOverlay } from './zodiac-overlay.js';
import { SCENE_LAYOUT } from '../scene-layout.js';

export const STAR_FIELD_CONFIG = Object.freeze({
    radius: SCENE_LAYOUT.starSphere.radius,
    /** Procedural filler stars, so the catalog's ~190 real ones sit in a believable field. */
    faintStarCount: 2200,
    /** Rebuild catalog positions when precession has moved more than about a year. */
    precessionRebuildCenturies: 0.01,
    /** Planets barely move in a minute of simulated time. */
    planetRecomputeMs: 60000,
    /** Default location when the app has no fix yet (New York, matching AstronomyService). */
    defaultLatitude: 40.7128,
    defaultLongitude: -74.006
});

/**
 * How much sky each quality tier can afford.
 *
 * The ~190-star catalog is never trimmed: it is what makes the sky *true*, and
 * 190 points cost nothing. What scales is the procedural filler field — the
 * expensive part — and the constellation scaffolding, which is a second draw
 * call plus a per-frame line rebuild for something that is deliberately drawn
 * at very low opacity anyway. A low-tier machine therefore still gets real
 * stars and real planets in real places, just a thinner sky behind them.
 *
 * @typedef {{faintStars: number, constellations: boolean, labels: boolean}} SkyQualityTier
 * @type {Readonly<Record<string, SkyQualityTier>>}
 */
export const SKY_QUALITY_TIERS = Object.freeze({
    high: { faintStars: STAR_FIELD_CONFIG.faintStarCount, constellations: true, labels: true },
    focused: { faintStars: STAR_FIELD_CONFIG.faintStarCount, constellations: true, labels: true },
    medium: { faintStars: 1100, constellations: true, labels: true },
    low: { faintStars: 450, constellations: false, labels: false },
    thumbnail: { faintStars: 200, constellations: false, labels: false }
});

/**
 * @param {string|null|undefined} quality
 * @returns {SkyQualityTier}
 */
export function getSkyQualityTier(quality) {
    return SKY_QUALITY_TIERS[String(quality)] ?? SKY_QUALITY_TIERS.high;
}

const PLANET_COLORS = {
    mercury: [0.92, 0.9, 0.82],
    venus: [1.0, 0.98, 0.9],
    mars: [1.0, 0.58, 0.4],
    jupiter: [1.0, 0.93, 0.78],
    saturn: [1.0, 0.9, 0.66],
    uranus: [0.62, 0.9, 1.0],
    neptune: [0.55, 0.7, 1.0]
};

/**
 * Point size in pixels for an apparent magnitude. Linear in magnitude rather
 * than in flux: real flux ratios (Sirius is ~100× Vega's faintest neighbours)
 * would make bright stars into blobs.
 * @param {number} magnitude
 * @returns {number}
 */
export function magnitudeToPointSize(magnitude) {
    return Math.max(1, Math.min(9, 6.5 - 1.25 * magnitude));
}

/**
 * Relative brightness 0…1 for an apparent magnitude, used to scale star colour.
 * @param {number} magnitude
 * @returns {number}
 */
export function magnitudeToBrightness(magnitude) {
    return Math.max(0.25, Math.min(1, 1 - (magnitude + 1.5) / 7));
}

/** Deterministic PRNG so the filler star field is identical across reloads and screenshots. */
function mulberry32(seed) {
    let a = seed >>> 0;
    return function random() {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * The night sky layer: real bright stars in their true positions, stylized
 * constellation figures, and the major planets, all parented to one group whose
 * matrix carries the observer's latitude and local sidereal time.
 *
 * Because that single rotation maps the whole equatorial catalog into the
 * scene, per-star alt/az never has to be recomputed — the geometry is static
 * and only the group's matrix changes as time and location do.
 */
export class StarField {
    /**
     * @param {THREE.Scene} scene
     * @param {{radius?: number, faintStarCount?: number, quality?: EffectQuality}} [options]
     */
    constructor(scene, options = {}) {
        this.scene = scene;
        this.radius = options.radius ?? STAR_FIELD_CONFIG.radius;
        this._faintStarCount = options.faintStarCount ?? STAR_FIELD_CONFIG.faintStarCount;
        /** @type {EffectQuality} */
        this.quality = options.quality ?? 'high';
        this._tier = getSkyQualityTier(this.quality);

        this.observerDate = new Date();
        /** @type {number} */
        this.latitude = STAR_FIELD_CONFIG.defaultLatitude;
        /** @type {number} */
        this.longitude = STAR_FIELD_CONFIG.defaultLongitude;
        this.cloudCover = 0;
        this.lightPollution = 0;

        this.showConstellations = true;
        this.showPlanets = true;
        this.showLabels = false;
        this.showZodiac = false;
        /** @type {import('../sky/zodiac.js').ZodiacMode} */
        this.zodiacMode = 'tropical';

        this._opacity = 0;
        /**
         * Julian centuries the catalog geometry was last precessed to. Positions
         * are allowed to lag the observer's date by up to
         * `precessionRebuildCenturies`, which is a year of precession — about
         * 50 arcseconds, well under a pixel.
         */
        this.catalogEpochCenturies = Number.NaN;
        this._planetsComputedAt = Number.NEGATIVE_INFINITY;
        /** @type {import('../sky/planets.js').PlanetPosition[]} */
        this._planets = [];
        this._planetIds = NAKED_EYE_PLANETS.slice();
        /** @type {THREE.Sprite[]} */
        this._planetLabels = [];
        /** @type {THREE.Sprite[]} */
        this._constellationLabels = [];
        this._labelsBuilt = false;
        /** Flat [from, to] star-index pairs backing the constellation LineSegments. */
        this._lineIndices = getConstellationLineIndices();

        this.skyGroup = new THREE.Group();
        this.skyGroup.matrixAutoUpdate = false;
        this.skyGroup.renderOrder = -1;
        this.scene.add(this.skyGroup);

        this._buildCatalogStars();
        this._buildFaintStars();
        this._buildConstellationLines();
        this._buildPlanetPoints();
        // The zodiac lives in the same equatorial group, so the single sky
        // rotation carries it and the planets already land on its ecliptic line.
        this.zodiac = new ZodiacOverlay(this.skyGroup, { radius: this.radius, mode: this.zodiacMode });

        // `mesh` stays the primary Points object so existing callers that reach
        // for it (quality tiers, disposal helpers) keep working.
        this.mesh = this.catalogStars;
        this.uniforms = this.catalogMaterial.uniforms;

        this._applyQualityTier();
        this._refreshCatalogPositions(this.observerDate);
        this._refreshPlanets(this.observerDate, true);
        this.zodiac.setDate(this.observerDate);
        this._refreshSkyRotation();
    }

    // ── Geometry construction ────────────────────────────────────────────────

    _buildCatalogStars() {
        const count = STARS.length;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const colors = new Float32Array(count * 3);

        for (let i = 0; i < count; i++) {
            const star = STARS[i];
            sizes[i] = magnitudeToPointSize(star.mag);
            const [r, g, b] = colorFromBV(star.bv);
            const brightness = magnitudeToBrightness(star.mag);
            colors[i * 3] = r * brightness;
            colors[i * 3 + 1] = g * brightness;
            colors[i * 3 + 2] = b * brightness;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

        this.catalogMaterial = createStarFieldMaterial();
        this.catalogMaterial.uniforms.uHorizonRadius.value = this.radius;
        this.catalogStars = new THREE.Points(geometry, this.catalogMaterial);
        this.catalogStars.renderOrder = -1;
        this.catalogStars.frustumCulled = false;
        this.skyGroup.add(this.catalogStars);
    }

    _buildFaintStars() {
        const count = this._faintStarCount;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const colors = new Float32Array(count * 3);
        const random = mulberry32(0x5eed51);

        for (let i = 0; i < count; i++) {
            // Uniform on the sphere, in the equatorial frame so the filler
            // rotates with the catalog rather than sliding against it.
            const theta = 2 * Math.PI * random();
            const phi = Math.acos(2 * random() - 1);
            const sinPhi = Math.sin(phi);
            positions[i * 3] = this.radius * sinPhi * Math.cos(theta);
            positions[i * 3 + 1] = this.radius * sinPhi * Math.sin(theta);
            positions[i * 3 + 2] = this.radius * Math.cos(phi);

            const magnitude = 4 + random() * 2.2;
            sizes[i] = magnitudeToPointSize(magnitude);
            const brightness = magnitudeToBrightness(magnitude);
            const [r, g, b] = colorFromBV(random() * 1.2 - 0.2);
            colors[i * 3] = r * brightness;
            colors[i * 3 + 1] = g * brightness;
            colors[i * 3 + 2] = b * brightness;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

        this.faintMaterial = createStarFieldMaterial();
        this.faintMaterial.uniforms.uHorizonRadius.value = this.radius;
        this.faintStars = new THREE.Points(geometry, this.faintMaterial);
        this.faintStars.renderOrder = -1;
        this.faintStars.frustumCulled = false;
        this.skyGroup.add(this.faintStars);
    }

    _buildConstellationLines() {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this._lineIndices.length * 3), 3));

        this.constellationMaterial = new THREE.LineBasicMaterial({
            color: 0x7fa8d8,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            fog: false
        });
        this.constellationLines = new THREE.LineSegments(geometry, this.constellationMaterial);
        this.constellationLines.renderOrder = -1;
        this.constellationLines.frustumCulled = false;
        this.skyGroup.add(this.constellationLines);
    }

    _buildPlanetPoints() {
        const count = this._planetIds.length;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(new Float32Array(count), 1));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(count * 3), 3));

        this.planetMaterial = createStarFieldMaterial();
        this.planetMaterial.uniforms.uHorizonRadius.value = this.radius;
        this.planetPoints = new THREE.Points(geometry, this.planetMaterial);
        this.planetPoints.renderOrder = -1;
        this.planetPoints.frustumCulled = false;
        this.skyGroup.add(this.planetPoints);
    }

    _ensureLabels() {
        if (this._labelsBuilt || typeof document === 'undefined') return;
        this._labelsBuilt = true;
        const labelScale = this.radius * 0.075;

        for (const id of this._planetIds) {
            const [r, g, b] = PLANET_COLORS[id] || [1, 1, 1];
            const css = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
            const sprite = createTextSprite(id.charAt(0).toUpperCase() + id.slice(1), css);
            sprite.scale.set(labelScale * 2, labelScale * 0.5, 1);
            sprite.userData.planetId = id;
            this._planetLabels.push(sprite);
            this.skyGroup.add(sprite);
        }

        for (const constellation of CONSTELLATIONS) {
            const centroid = this._constellationCentroid(constellation);
            if (!centroid) continue;
            const sprite = createTextSprite(constellation.name, 'rgb(150, 180, 220)');
            sprite.scale.set(labelScale * 2, labelScale * 0.5, 1);
            sprite.position.copy(centroid);
            sprite.userData.constellation = constellation.abbr;
            this._constellationLabels.push(sprite);
            this.skyGroup.add(sprite);
        }
    }

    /**
     * Mean direction of a figure's stars, pushed back out to the sky radius.
     * @param {import('../sky/starCatalog.js').Constellation} constellation
     * @returns {THREE.Vector3|null}
     */
    _constellationCentroid(constellation) {
        const positions = this.catalogStars.geometry.getAttribute('position');
        const sum = new THREE.Vector3();
        let used = 0;
        for (const [fromId, toId] of constellation.lines) {
            for (const id of [fromId, toId]) {
                const index = STAR_INDEX.get(id);
                if (index === undefined) continue;
                sum.x += positions.getX(index);
                sum.y += positions.getY(index);
                sum.z += positions.getZ(index);
                used++;
            }
        }
        if (!used || sum.lengthSq() === 0) return null;
        return sum.normalize().multiplyScalar(this.radius);
    }

    // ── Time / location driven refreshes ─────────────────────────────────────

    /**
     * Point the sky at an observer. Cheap to call every frame: the heavy
     * catalog rebuild only happens when precession has actually moved, and
     * planets are re-solved at most once a simulated minute.
     * @param {{date?: Date|number|string, latitude?: number|null, longitude?: number|null, cloudCover?: number|null}} observer
     */
    setObserver({ date, latitude, longitude, cloudCover } = {}) {
        if (date != null) {
            const when = date instanceof Date ? date : new Date(date);
            if (Number.isFinite(when.getTime())) this.observerDate = when;
        }
        if (latitude != null && Number.isFinite(latitude)) this.latitude = latitude;
        if (longitude != null && Number.isFinite(longitude)) this.longitude = longitude;
        if (cloudCover != null && Number.isFinite(cloudCover)) {
            this.cloudCover = Math.max(0, Math.min(100, cloudCover));
        }

        this._refreshCatalogPositions(this.observerDate);
        this._refreshPlanets(this.observerDate);
        this.zodiac.setDate(this.observerDate);
        this._refreshSkyRotation();
    }

    /**
     * Re-budget the sky for a quality tier. The filler field is allocated once
     * at full size and then drawn partially, so switching tiers costs a draw
     * range rather than a geometry rebuild — which also means the WebGPU
     * materials swapped in by {@link initWebGPU} survive the change.
     * @param {EffectQuality} quality
     */
    setQuality(quality) {
        this.quality = quality;
        this._tier = getSkyQualityTier(quality);
        this._applyQualityTier();
    }

    _applyQualityTier() {
        const drawn = Math.max(0, Math.min(this._faintStarCount, this._tier.faintStars));
        this.faintStars.geometry.setDrawRange(0, drawn);
    }

    /** How many filler stars the active tier actually draws. */
    getRenderedFaintStarCount() {
        return Math.max(0, Math.min(this._faintStarCount, this._tier.faintStars));
    }

    /**
     * How much the sky is washed out by artificial light, 0 (dark site) to 1
     * (inner city). Dims the faint filler field far harder than the named
     * stars, which is how light pollution actually erases a sky.
     * @param {number} amount
     */
    setLightPollution(amount) {
        this.lightPollution = Math.max(0, Math.min(1, Number(amount) || 0));
    }

    /** @param {boolean} visible */
    setConstellationsVisible(visible) {
        this.showConstellations = !!visible;
    }

    /** @param {boolean} visible */
    setPlanetsVisible(visible) {
        this.showPlanets = !!visible;
    }

    /**
     * Show or hide the zodiacal band. Off by default — it is a cultural layer
     * over the astronomy, not part of it.
     * @param {boolean} visible
     */
    setZodiacVisible(visible) {
        this.showZodiac = !!visible;
        this.zodiac.setVisible(this.showZodiac);
    }

    /**
     * Pick the zodiac convention: `tropical` anchors the signs to the equinox,
     * `sidereal` keeps them on the constellations.
     * @param {import('../sky/zodiac.js').ZodiacMode} mode
     */
    setZodiacMode(mode) {
        this.zodiacMode = mode === 'sidereal' ? 'sidereal' : 'tropical';
        this.zodiac.setMode(this.zodiacMode, this.observerDate);
    }

    /** @param {boolean} visible */
    setLabelsVisible(visible) {
        this.showLabels = !!visible;
        if (this.showLabels && this._tier.labels) this._ensureLabels();
    }

    /**
     * Which planets to place. Defaults to the five naked-eye planets; pass
     * `ALL_PLANETS` to include Uranus and Neptune.
     * @param {string[]} ids
     */
    setPlanetSet(ids) {
        if (!Array.isArray(ids) || ids.length === 0) return;
        this._planetIds = ids.slice();
        this._disposeLabels();
        this.skyGroup.remove(this.planetPoints);
        this.planetPoints.geometry.dispose();
        this.planetMaterial.dispose();
        this._buildPlanetPoints();
        this._refreshPlanets(this.observerDate, true);
        // Labels were torn down along with the old planet set; rebuild them if
        // they were on, so the toggle state survives the swap.
        if (this.showLabels && this._tier.labels) this._ensureLabels();
    }

    _refreshCatalogPositions(date) {
        const centuries = julianCenturies(date);
        if (
            Number.isFinite(this.catalogEpochCenturies) &&
            Math.abs(centuries - this.catalogEpochCenturies) < STAR_FIELD_CONFIG.precessionRebuildCenturies
        ) {
            return;
        }
        this.catalogEpochCenturies = centuries;

        const positions = this.catalogStars.geometry.getAttribute('position');
        for (let i = 0; i < STARS.length; i++) {
            const star = STARS[i];
            const { ra, dec } = precessFromJ2000(star.raHours * HOURS_TO_RAD, star.decDeg * DEG, centuries);
            const vector = equatorialToVector(ra, dec, this.radius);
            positions.setXYZ(i, vector.x, vector.y, vector.z);
        }
        positions.needsUpdate = true;
        this.catalogStars.geometry.computeBoundingSphere();
        this._refreshConstellationGeometry();
        this._refreshConstellationLabelPositions();
    }

    _refreshConstellationGeometry() {
        const starPositions = this.catalogStars.geometry.getAttribute('position');
        const linePositions = this.constellationLines.geometry.getAttribute('position');
        for (let i = 0; i < this._lineIndices.length; i++) {
            const starIndex = this._lineIndices[i];
            linePositions.setXYZ(
                i,
                starPositions.getX(starIndex),
                starPositions.getY(starIndex),
                starPositions.getZ(starIndex)
            );
        }
        linePositions.needsUpdate = true;
        this.constellationLines.geometry.computeBoundingSphere();
    }

    _refreshConstellationLabelPositions() {
        if (!this._constellationLabels.length) return;
        const byAbbr = new Map(CONSTELLATIONS.map((c) => [c.abbr, c]));
        for (const sprite of this._constellationLabels) {
            const constellation = byAbbr.get(sprite.userData.constellation);
            const centroid = constellation ? this._constellationCentroid(constellation) : null;
            if (centroid) sprite.position.copy(centroid);
        }
    }

    _refreshPlanets(date, force = false) {
        const when = date instanceof Date ? date.getTime() : Number(date);
        if (!force && Math.abs(when - this._planetsComputedAt) < STAR_FIELD_CONFIG.planetRecomputeMs) return;
        this._planetsComputedAt = when;

        this._planets = getPlanetPositions(when, this._planetIds);
        const centuries = julianCenturies(when);
        const positions = this.planetPoints.geometry.getAttribute('position');
        const sizes = this.planetPoints.geometry.getAttribute('size');
        const colors = this.planetPoints.geometry.getAttribute('aColor');

        for (let i = 0; i < this._planetIds.length; i++) {
            const planet = this._planets[i];
            if (!planet) continue;
            const { ra, dec } = precessFromJ2000(planet.ra, planet.dec, centuries);
            const vector = equatorialToVector(ra, dec, this.radius);
            positions.setXYZ(i, vector.x, vector.y, vector.z);
            // Planets shine steadily rather than twinkling, so they are drawn a
            // touch larger than a star of the same magnitude to stay findable.
            sizes.setX(i, magnitudeToPointSize(planet.magnitude) + 1.5);
            const [r, g, b] = PLANET_COLORS[planet.id] || [1, 1, 1];
            const brightness = magnitudeToBrightness(planet.magnitude);
            colors.setXYZ(i, r * brightness, g * brightness, b * brightness);

            const label = this._planetLabels.find((sprite) => sprite.userData.planetId === planet.id);
            if (label) label.position.set(vector.x, vector.y + this.radius * 0.045, vector.z);
        }
        positions.needsUpdate = true;
        sizes.needsUpdate = true;
        colors.needsUpdate = true;
        this.planetPoints.geometry.computeBoundingSphere();
    }

    _refreshSkyRotation() {
        const lst = localSiderealTime(this.observerDate, this.longitude);
        const m = equatorialToSceneMatrix(lst, this.latitude);
        this.skyGroup.matrix.set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1);
        this.skyGroup.matrixWorldNeedsUpdate = true;
    }

    // ── Per-frame visibility ─────────────────────────────────────────────────

    /**
     * Fade factor for the sun's height above the horizon. Stars are full
     * strength below nautical twilight and gone by civil twilight.
     * @param {number} sunY - Sun's scene-space height (the scene places it 20 units out).
     * @returns {number}
     */
    static twilightFade(sunY) {
        const fadeStart = -4.2; // ~-12° at radius 20 (nautical twilight)
        const fadeEnd = -2.1; // ~-6° at radius 20 (civil twilight)
        if (sunY < fadeStart) return 1;
        if (sunY >= fadeEnd) return 0;
        return 1 - (sunY - fadeStart) / (fadeEnd - fadeStart);
    }

    /**
     * @param {THREE.Vector3|null} [sunPos]
     */
    update(sunPos) {
        if (!sunPos) return;

        const targetOpacity = StarField.twilightFade(sunPos.y);

        if (targetOpacity <= 0.01) {
            this._opacity = 0;
            this.skyGroup.visible = false;
            return;
        }

        // Cloud deck and skyglow both cut stars, and both hit the faint field
        // hardest — an overcast or city sky keeps only the brightest handful.
        const cloudFactor = 1 - 0.92 * Math.pow(this.cloudCover / 100, 1.4);
        const brightOpacity = targetOpacity * cloudFactor * (1 - 0.35 * this.lightPollution);
        const faintOpacity = targetOpacity * Math.pow(cloudFactor, 1.8) * (1 - 0.85 * this.lightPollution);

        this._opacity = brightOpacity;
        this.skyGroup.visible = true;
        this._refreshSkyRotation();

        const time = Date.now() * 0.001;
        this._setStarUniforms(this.catalogMaterial, time, brightOpacity);
        this._setStarUniforms(this.faintMaterial, time, faintOpacity);
        this._setStarUniforms(this.planetMaterial, time, this.showPlanets ? brightOpacity : 0);

        this.faintStars.visible = faintOpacity > 0.01 && this.getRenderedFaintStarCount() > 0;
        this.planetPoints.visible = this.showPlanets;

        this.constellationLines.visible = this._tier.constellations && this.showConstellations && brightOpacity > 0.05;
        this.constellationMaterial.opacity = brightOpacity * 0.28;

        this._updateLabelOpacity(brightOpacity);
        this.zodiac.update(brightOpacity);
    }

    /**
     * Write the twinkle/fade values through whichever uniform block the active
     * backend exposes.
     * @param {THREE.Material} material
     * @param {number} time
     * @param {number} opacity
     */
    _setStarUniforms(material, time, opacity) {
        const uniforms = /** @type {any} */ (material).uniforms || /** @type {any} */ (material).userData?.starUniforms;
        if (!uniforms) return;
        uniforms.uTime.value = time;
        uniforms.uOpacity.value = opacity;
        if (uniforms.uHorizonRadius) uniforms.uHorizonRadius.value = this.radius;
    }

    _updateLabelOpacity(baseOpacity) {
        if (!this._labelsBuilt) return;
        const labelsAllowed = this.showLabels && this._tier.labels;
        const planetOpacity = labelsAllowed && this.showPlanets ? Math.min(1, baseOpacity * 1.2) : 0;
        for (const sprite of this._planetLabels) {
            sprite.visible = planetOpacity > 0.02;
            sprite.material.opacity = planetOpacity;
        }
        const constellationOpacity =
            labelsAllowed && this.showConstellations && this._tier.constellations ? baseOpacity * 0.7 : 0;
        for (const sprite of this._constellationLabels) {
            sprite.visible = constellationOpacity > 0.02;
            sprite.material.opacity = constellationOpacity;
        }
    }

    /** Catalog sizes behind the current sky, for the debug API and tests. */
    getCatalogSummary() {
        return {
            stars: STARS.length,
            renderedFaintStars: this.getRenderedFaintStarCount(),
            constellations: this._tier.constellations ? CONSTELLATIONS.length : 0,
            quality: this.quality
        };
    }

    /** Current planet solutions, for the debug API and tests. */
    getPlanetPositions() {
        return this._planets.map((planet) => ({ ...planet }));
    }

    async initWebGPU() {
        for (const key of ['catalogMaterial', 'faintMaterial', 'planetMaterial']) {
            const target =
                key === 'catalogMaterial'
                    ? this.catalogStars
                    : key === 'faintMaterial'
                      ? this.faintStars
                      : this.planetPoints;
            const material = await createStarFieldMaterialWebGPU();
            material.userData.starUniforms.uHorizonRadius.value = this.radius;
            const oldMaterial = target.material;
            target.material = material;
            this[key] = material;
            oldMaterial?.dispose?.();
        }
        this.uniforms = this.catalogMaterial.userData.starUniforms;
    }

    _disposeLabels() {
        for (const sprite of [...this._planetLabels, ...this._constellationLabels]) {
            this.skyGroup.remove(sprite);
            sprite.material.map?.dispose();
            sprite.material.dispose();
        }
        this._planetLabels = [];
        this._constellationLabels = [];
        this._labelsBuilt = false;
    }

    dispose() {
        this._disposeLabels();
        this.zodiac.dispose();
        for (const object of [this.catalogStars, this.faintStars, this.constellationLines, this.planetPoints]) {
            this.skyGroup.remove(object);
            object.geometry.dispose();
            object.material.dispose();
        }
        this.scene.remove(this.skyGroup);
    }
}
