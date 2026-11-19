import * as THREE from 'three';
import {
    buildStarFieldMaterialWebGPU,
    createStarFieldMaterial,
    loadStarFieldNodeModules
} from '../webgpu/materials/StarFieldMaterial.js';
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
import { MilkyWayBand } from './milky-way.js';
import { AuroraCurtain, AURORA_RENDER_CONFIG } from './aurora.js';
import { auroraVisibility, kpSampleApplies } from '../sky/aurora.js';
import { SCENE_LAYOUT } from '../scene-layout.js';

export const STAR_FIELD_CONFIG = Object.freeze({
    radius: SCENE_LAYOUT.starSphere.radius,
    /** Procedural filler stars, so the catalog's ~190 real ones sit in a believable field. */
    faintStarCount: 2200,
    /** Rebuild catalog positions when precession has moved more than about a year. */
    precessionRebuildCenturies: 0.01,
    /** Planets barely move in a minute of simulated time. */
    planetRecomputeMs: 60000,
    /** Pull live satellite elements at most this often (wall clock); matches the service-worker TTL. */
    satelliteRefreshMs: 6 * 60 * 60 * 1000,
    /** Default location when the app has no fix yet (New York, matching AstronomyService). */
    defaultLatitude: 40.7128,
    defaultLongitude: -74.006
});

/**
 * Whether the satellite layer may pull live elements from Celestrak. Only in a
 * real browser session, never under `?test=1` (Playwright baselines) or in unit
 * tests, which stay on the committed snapshot.
 * @returns {boolean}
 */
function liveSatelliteElementsAllowed() {
    if (typeof window === 'undefined' || !window.location) return false;
    return !new URLSearchParams(window.location.search).has('test');
}

/**
 * How much sky each quality tier can afford.
 *
 * The ~190-star catalog is never trimmed: it is what makes the sky *true*, and
 * 190 points cost nothing. What scales is the procedural filler field — the
 * expensive part — and the constellation scaffolding, which is a second draw
 * call plus a per-frame line rebuild for something that is deliberately drawn
 * at very low opacity anyway. A low-tier machine therefore still gets real
 * stars and real planets in real places, just a thinner sky behind them.
 * The Milky Way band goes with the constellations: it is one draw call, but a
 * large translucent one, and it is never built on a tier that drops it.
 * The aurora curtain follows the same rule.
 *
 * @typedef {{faintStars: number, constellations: boolean, labels: boolean, milkyWay: boolean, aurora: boolean}} SkyQualityTier
 * @type {Readonly<Record<string, SkyQualityTier>>}
 */
export const SKY_QUALITY_TIERS = Object.freeze({
    high: {
        faintStars: STAR_FIELD_CONFIG.faintStarCount,
        constellations: true,
        labels: true,
        milkyWay: true,
        aurora: true
    },
    focused: {
        faintStars: STAR_FIELD_CONFIG.faintStarCount,
        constellations: true,
        labels: true,
        milkyWay: true,
        aurora: true
    },
    medium: { faintStars: 1100, constellations: true, labels: true, milkyWay: true, aurora: true },
    low: { faintStars: 450, constellations: false, labels: false, milkyWay: false, aurora: false },
    thumbnail: { faintStars: 200, constellations: false, labels: false, milkyWay: false, aurora: false }
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
     * @param {{radius?: number, faintStarCount?: number, quality?: EffectQuality, liveSatelliteElements?: boolean}} [options]
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
        this.showSatellites = false;
        this.reducedMotion = false;
        /**
         * The satellite layer is loaded on first use — it and SGP4 live in their
         * own chunk — so this stays null in every session that never turns it on.
         * @type {import('./satellite-layer.js').SatelliteLayer|null}
         */
        this.satellites = null;
        /** @type {Promise<import('./satellite-layer.js').SatelliteLayer|null>|null} */
        this._satelliteLoad = null;
        this._liveSatelliteElements = options.liveSatelliteElements ?? liveSatelliteElementsAllowed();
        this._satelliteRefreshedAt = Number.NEGATIVE_INFINITY;
        this._webgpu = false;
        this._disposed = false;

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
        /**
         * Set by {@link initWebGPU}. Once present, the catalog and planets draw as
         * sized instanced sprites and any rebuilt batch is born that way.
         * @type {import('../webgpu/materials/StarFieldMaterial.js').StarFieldNodeModules|null}
         */
        this._nodeModules = null;
        /**
         * The galactic band. Built on the first dark frame under a tier that can
         * afford it, so daytime and low-tier sessions never bake its texture.
         * @type {MilkyWayBand|null}
         */
        this.milkyWay = null;
        /**
         * The aurora curtain. Local (alt/az), so it hangs off the scene, not the
         * equatorial sky group. Built only once a night passes the Kp floor.
         * @type {AuroraCurtain|null}
         */
        this.aurora = null;
        /** @type {import('../sky/aurora.js').KpSample|null} */
        this.auroraSample = null;
        /**
         * Debug override (`setDebugAurora`); beats the live sample and its time window.
         * @type {number|null}
         */
        this.auroraKpOverride = null;
        /** @type {import('../sky/aurora.js').AuroraVisibility|null} */
        this._auroraVisibility = null;
        this._auroraOpacity = 0;

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

        // `mesh` stays the primary catalog drawable so existing callers that reach
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

        /** CPU-side catalog data; the drawable below reads from it on either backend. */
        this.catalogGeometry = geometry;
        this.catalogMaterial = createStarFieldMaterial();
        this.catalogMaterial.uniforms.uHorizonRadius.value = this.radius;
        /** @type {THREE.Points|THREE.Sprite} */
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

        /** CPU-side planet data; the drawable below reads from it on either backend. */
        this.planetGeometry = geometry;
        if (this._nodeModules) {
            // Rebuilt after WebGPU init (a new planet set): go straight to sprites
            // so a WebGL material never reaches the WebGPU renderer.
            const { drawable, material } = this._createSizedSprites(geometry);
            this.planetMaterial = material;
            this.planetPoints = drawable;
            this.skyGroup.add(drawable);
            return;
        }
        this.planetMaterial = createStarFieldMaterial();
        this.planetMaterial.uniforms.uHorizonRadius.value = this.radius;
        /** @type {THREE.Points|THREE.Sprite} */
        this.planetPoints = new THREE.Points(geometry, this.planetMaterial);
        this.planetPoints.renderOrder = -1;
        this.planetPoints.frustumCulled = false;
        this.skyGroup.add(this.planetPoints);
    }

    /**
     * Wrap a star batch's data geometry in a sized, instanced sprite for the
     * WebGPU backend, where `THREE.Points` can only draw 1-pixel primitives.
     * The geometry's attributes become `InstancedBufferAttribute`s over the same
     * arrays, so the existing setXYZ + `needsUpdate` refreshes feed the sprites
     * directly and the geometry stays the one source of truth.
     * @param {THREE.BufferGeometry} geometry
     * @returns {{drawable: THREE.Sprite, material: import('three/webgpu').PointsNodeMaterial}}
     */
    _createSizedSprites(geometry) {
        const modules = /** @type {import('../webgpu/materials/StarFieldMaterial.js').StarFieldNodeModules} */ (
            this._nodeModules
        );
        /** @param {string} name */
        const instanced = (name) => {
            const current = geometry.getAttribute(name);
            if (/** @type {any} */ (current).isInstancedBufferAttribute) {
                return /** @type {THREE.InstancedBufferAttribute} */ (current);
            }
            const next = new THREE.InstancedBufferAttribute(
                /** @type {Float32Array} */ (current.array),
                current.itemSize
            );
            geometry.setAttribute(name, next);
            return next;
        };
        const material = buildStarFieldMaterialWebGPU(modules, {
            instanced: { position: instanced('position'), size: instanced('size'), color: instanced('aColor') }
        });
        material.userData.starUniforms.uHorizonRadius.value = this.radius;

        const drawable = new THREE.Sprite(/** @type {any} */ (material));
        drawable.count = geometry.getAttribute('position').count;
        drawable.renderOrder = -1;
        // The sprite object sits at the sky's origin; its instances are 2000 units out.
        drawable.frustumCulled = false;
        // Sky dots are not pickable, and Sprite.raycast throws without a camera.
        drawable.raycast = () => {};
        return { drawable, material };
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
        const positions = this.catalogGeometry.getAttribute('position');
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
        this.milkyWay?.setDate(this.observerDate);
        if (this.showSatellites) this._refreshSatellites();
        this._refreshSkyRotation();
    }

    _refreshSatellites() {
        this.satellites?.setDate(this.observerDate, { latitude: this.latitude, longitude: this.longitude });
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

    _ensureMilkyWay() {
        if (this.milkyWay || this._disposed) return;
        // After WebGPU init the band is born on the TSL path, so a WebGL
        // material never reaches the WebGPU renderer.
        this.milkyWay = new MilkyWayBand(this.skyGroup, { radius: this.radius, nodeModules: this._nodeModules });
        this.milkyWay.setDate(this.observerDate);
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

    /**
     * Show or hide the satellite layer. Off by default. The first time it is
     * turned on, the layer and SGP4 are fetched as a separate chunk; the
     * returned promise settles once the layer is drawing (or has failed to
     * load, in which case the toggle quietly stays dark).
     * @param {boolean} visible
     * @returns {Promise<void>}
     */
    async setSatellitesVisible(visible) {
        this.showSatellites = !!visible;
        if (!this.showSatellites) {
            this.satellites?.setVisible(false);
            return;
        }
        const layer = await this._ensureSatelliteLayer();
        // The toggle may have been flipped back off while the chunk loaded.
        if (!layer || !this.showSatellites) return;
        layer.setVisible(true);
        this._refreshSatellites();
        this._refreshLiveSatelliteElements();
    }

    /** @returns {Promise<import('./satellite-layer.js').SatelliteLayer|null>} */
    _ensureSatelliteLayer() {
        if (this.satellites) return Promise.resolve(this.satellites);
        if (!this._satelliteLoad) {
            this._satelliteLoad = import('./satellite-layer.js')
                .then(async ({ SatelliteLayer }) => {
                    const layer = new SatelliteLayer(this.skyGroup, {
                        radius: SCENE_LAYOUT.orbital.radius,
                        reducedMotion: this.reducedMotion
                    });
                    if (this._webgpu) await layer.initWebGPU();
                    if (this._disposed) {
                        layer.dispose();
                        return null;
                    }
                    this.satellites = layer;
                    return layer;
                })
                .catch((error) => {
                    console.warn('Satellite layer failed to load:', error);
                    this._satelliteLoad = null;
                    return null;
                });
        }
        return this._satelliteLoad;
    }

    /**
     * Lay live Celestrak elements over the bundled snapshot, at most once per
     * refresh window. Fire-and-forget: the snapshot is already drawing.
     */
    _refreshLiveSatelliteElements() {
        if (!this._liveSatelliteElements || !this.satellites) return;
        const now = Date.now();
        if (now - this._satelliteRefreshedAt < STAR_FIELD_CONFIG.satelliteRefreshMs) return;
        this._satelliteRefreshedAt = now;
        import('../sky/satelliteCatalog.js')
            .then(({ loadLiveCatalog }) => loadLiveCatalog())
            .then((catalog) => {
                if (catalog.source === 'live') this.satellites?.setCatalog(catalog);
            })
            .catch((error) => console.warn('Satellite elements refresh failed:', error));
    }

    /**
     * Reduced motion drops the ISS trail; the points themselves still move,
     * exactly as the stars still turn.
     * @param {boolean} reducedMotion
     */
    setReducedMotion(reducedMotion) {
        this.reducedMotion = !!reducedMotion;
        this.satellites?.setReducedMotion(this.reducedMotion);
        if (this.showSatellites) this._refreshSatellites();
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
        this._disposeBatch(this.planetPoints, this.planetGeometry);
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

        const positions = this.catalogGeometry.getAttribute('position');
        for (let i = 0; i < STARS.length; i++) {
            const star = STARS[i];
            const { ra, dec } = precessFromJ2000(star.raHours * HOURS_TO_RAD, star.decDeg * DEG, centuries);
            const vector = equatorialToVector(ra, dec, this.radius);
            positions.setXYZ(i, vector.x, vector.y, vector.z);
        }
        positions.needsUpdate = true;
        this.catalogGeometry.computeBoundingSphere();
        this._refreshConstellationGeometry();
        this._refreshConstellationLabelPositions();
    }

    _refreshConstellationGeometry() {
        const starPositions = this.catalogGeometry.getAttribute('position');
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
        const positions = this.planetGeometry.getAttribute('position');
        const sizes = this.planetGeometry.getAttribute('size');
        const colors = this.planetGeometry.getAttribute('aColor');

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
        this.planetGeometry.computeBoundingSphere();
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
            this.milkyWay?.update(0);
            this._updateAurora(0);
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
        // Same twilight × cloud × skyglow product as the faint field; the band
        // is a dimmer surface, so it goes first (see MILKY_WAY_CONFIG).
        if (this._tier.milkyWay && MilkyWayBand.opacityFor(faintOpacity) > 0) this._ensureMilkyWay();
        this.milkyWay?.update(faintOpacity, this._tier.milkyWay);
        this.satellites?.update(this.showSatellites ? brightOpacity : 0);
        this._updateAurora(targetOpacity);
    }

    /** Kp driving the curtain right now, or null when there is none for this instant. */
    _effectiveKp() {
        if (this.auroraKpOverride != null) return this.auroraKpOverride;
        return kpSampleApplies(this.auroraSample, this.observerDate) ? (this.auroraSample?.kp ?? null) : null;
    }

    /**
     * Fade the curtain with twilight and cloud. Cloud is already inside the
     * predicate's intensity, so it snuffs the curtain the way it snuffs stars.
     * @param {number} twilight - The star field's twilight fade, 0…1.
     */
    _updateAurora(twilight) {
        const visibility = auroraVisibility({
            latitudeDeg: this.latitude,
            kp: this._effectiveKp(),
            cloudCover: this.cloudCover / 100
        });
        this._auroraVisibility = visibility;
        const dimming = 1 - AURORA_RENDER_CONFIG.lightPollutionDimming * this.lightPollution;
        const opacity = this._tier.aurora && visibility.visible ? twilight * visibility.intensity * dimming : 0;
        this._auroraOpacity = opacity;
        if (opacity > 0.002 && !this.aurora && !this._disposed) {
            // Born on the TSL path after WebGPU init, like the Milky Way.
            this.aurora = new AuroraCurtain(this.scene, { nodeModules: this._nodeModules });
        }
        this.aurora?.update({ opacity, bearing: visibility.bearing, reducedMotion: this.reducedMotion });
    }

    /**
     * The latest planetary K-index from the live feed, or null after a failed
     * fetch (which hides the curtain).
     * @param {import('../sky/aurora.js').KpSample|null} sample
     */
    setAuroraActivity(sample) {
        this.auroraSample = sample && Number.isFinite(sample.kp) && Number.isFinite(sample.time) ? sample : null;
    }

    /**
     * Force a Kp for debugging (`setDebugAurora`), or clear it with null. The
     * curtain still needs a dark, clear-enough sky, exactly like a real one.
     * @param {number|null} kp
     */
    setAuroraKpOverride(kp) {
        this.auroraKpOverride = kp != null && Number.isFinite(kp) ? Math.max(0, Math.min(9, kp)) : null;
    }

    /**
     * Predicate inputs and drawn opacity, for `aetherDebug.getAuroraState()`.
     * @returns {{inputs: import('../sky/aurora.js').AuroraInputs, source: 'debug'|'swpc'|null, sampleTime: number|null, enabled: boolean, built: boolean, backend: string|null, visible: boolean, intensity: number, bearing: number, kpFloor: number, opacity: number, reducedMotion: boolean}}
     */
    getAuroraState() {
        const kp = this._effectiveKp();
        const inputs = { latitudeDeg: this.latitude, kp, cloudCover: this.cloudCover / 100 };
        const visibility = auroraVisibility(inputs);
        const drawn = this.aurora?.getState();
        return {
            inputs,
            source: this.auroraKpOverride != null ? 'debug' : kp != null ? 'swpc' : null,
            sampleTime: this.auroraSample?.time ?? null,
            enabled: this._tier.aurora,
            built: !!this.aurora,
            backend: drawn?.backend ?? null,
            visible: !!drawn?.visible,
            intensity: visibility.intensity,
            bearing: visibility.bearing,
            kpFloor: visibility.kpFloor,
            opacity: this._auroraOpacity,
            reducedMotion: this.reducedMotion
        };
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

    /**
     * Whether the galactic band is built and how strongly it is drawn right
     * now, for `aetherDebug.getNightSkyState()`.
     * @returns {{enabled: boolean, built: boolean, visible: boolean, opacity: number, backend: string|null}}
     */
    getMilkyWayState() {
        const state = this.milkyWay?.getState();
        return {
            enabled: this._tier.milkyWay,
            built: !!state,
            visible: !!state?.visible,
            opacity: state?.opacity ?? 0,
            backend: state?.backend ?? null
        };
    }

    /** Catalog sizes behind the current sky, for the debug API and tests. */
    getCatalogSummary() {
        const satellites = this.satellites?.getSummary();
        return {
            stars: STARS.length,
            renderedFaintStars: this.getRenderedFaintStarCount(),
            constellations: this._tier.constellations ? CONSTELLATIONS.length : 0,
            quality: this.quality,
            satellites: {
                enabled: this.showSatellites,
                loaded: !!this.satellites,
                tracked: satellites?.tracked ?? 0,
                drawn: this.showSatellites ? (satellites?.drawn ?? 0) : 0,
                source: satellites?.source ?? null,
                epochAgeDays: satellites?.epochAgeDays ?? null
            }
        };
    }

    /**
     * Satellites currently drawn, brightest first — empty while the layer is
     * off or not yet loaded.
     * @returns {import('../sky/satellites.js').SatellitePosition[]}
     */
    getSatellitePositions() {
        return this.showSatellites ? (this.satellites?.getPositions() ?? []) : [];
    }

    /** Current planet solutions, for the debug API and tests. */
    getPlanetPositions() {
        return this._planets.map((planet) => ({ ...planet }));
    }

    /**
     * Swap in the WebGPU materials. The filler field keeps its `THREE.Points`
     * (1-pixel dust, still drawn through a draw range so quality tiers never
     * rebuild it); the catalog and planets move to sized instanced sprites so
     * the bright stars and planets have area rather than just brightness.
     */
    async initWebGPU() {
        if (this._nodeModules) return;
        const modules = await loadStarFieldNodeModules();
        this._nodeModules = modules;

        const faintMaterial = buildStarFieldMaterialWebGPU(modules);
        faintMaterial.userData.starUniforms.uHorizonRadius.value = this.radius;
        this.faintMaterial.dispose();
        this.faintStars.material = /** @type {any} */ (faintMaterial);
        this.faintMaterial = /** @type {any} */ (faintMaterial);

        const catalog = this._createSizedSprites(this.catalogGeometry);
        this._replaceDrawable(this.catalogStars, catalog.drawable);
        this.catalogMaterial.dispose();
        this.catalogStars = catalog.drawable;
        this.catalogMaterial = /** @type {any} */ (catalog.material);

        const planets = this._createSizedSprites(this.planetGeometry);
        this._replaceDrawable(this.planetPoints, planets.drawable);
        this.planetMaterial.dispose();
        this.planetPoints = planets.drawable;
        this.planetMaterial = /** @type {any} */ (planets.material);

        this.mesh = this.catalogStars;
        this.uniforms = this.catalogMaterial.userData.starUniforms;
        this.milkyWay?.initWebGPU(modules);
        this.aurora?.initWebGPU(modules);
        this._webgpu = true;
        await this.satellites?.initWebGPU();
    }

    /**
     * Put `next` where `previous` sat in the sky group, carrying its visibility.
     * @param {THREE.Object3D} previous
     * @param {THREE.Object3D} next
     */
    _replaceDrawable(previous, next) {
        next.visible = previous.visible;
        this.skyGroup.remove(previous);
        this.skyGroup.add(next);
    }

    /**
     * Remove and free one star batch. A sprite's own geometry is Three's shared
     * quad (the text labels use it too), so only the data geometry is disposed.
     * @param {THREE.Object3D & {material: THREE.Material}} drawable
     * @param {THREE.BufferGeometry} geometry
     */
    _disposeBatch(drawable, geometry) {
        this.skyGroup.remove(drawable);
        geometry.dispose();
        drawable.material.dispose();
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
        this.milkyWay?.dispose();
        this.milkyWay = null;
        this.aurora?.dispose();
        this.aurora = null;
        this._disposed = true;
        this.satellites?.dispose();
        this.satellites = null;
        this.showSatellites = false;
        this._disposeBatch(this.catalogStars, this.catalogGeometry);
        this._disposeBatch(this.planetPoints, this.planetGeometry);
        for (const object of [this.faintStars, this.constellationLines]) {
            this._disposeBatch(object, object.geometry);
        }
        this.scene.remove(this.skyGroup);
    }
}
