import * as THREE from 'three';
import {
    DEG,
    eclipticToEquatorial,
    equatorialToVector,
    julianCenturies,
    meanObliquity
} from '../sky/celestialCoordinates.js';
import { SIGN_WIDTH_DEG, ZODIAC_SIGNS, getZodiacState, signCuspLongitudeDeg } from '../sky/zodiac.js';
import { createTextSprite } from './text-sprite.js';

export const ZODIAC_CONFIG = Object.freeze({
    /** Points around the ecliptic circle. 180 keeps it smooth at any FOV. */
    eclipticSegments: 180,
    /** Half-height of a cusp tick, in ecliptic latitude. */
    cuspTickHalfHeightDeg: 2.6,
    /** Ecliptic latitude the sign glyphs float at, clear of the planets on the line. */
    glyphLatitudeDeg: 7.5,
    /** Glyph sprite size as a fraction of the sky radius. */
    glyphScale: 0.055,
    /** Opacity multipliers applied on top of the star field's twilight fade. */
    eclipticOpacity: 0.22,
    cuspOpacity: 0.3,
    glyphOpacity: 0.34,
    /** Extra reach for the sign the Sun or Moon currently occupies. */
    tenantedGlyphOpacity: 0.85,
    /** Re-solve the Sun/Moon placements at most this often in simulated time. */
    recomputeMs: 60000
});

/** Pale gold, a shade off the constellation blue so the two layers stay legible together. */
const LINE_COLOR = 0xc9b183;
const GLYPH_COLOR = 0xc9b183;
/** The sign holding the Sun reads warm; the one holding the Moon reads cool. */
const SUN_SIGN_COLOR = 0xffd9a0;
const MOON_SIGN_COLOR = 0xcfe0ff;

/**
 * The zodiacal overlay: the ecliptic drawn as a thin arc across the sky, the
 * twelve sign cusps ticked along it, and a glyph floating beside each slice —
 * with the slice the Sun sits in and the slice the Moon sits in lit a little
 * brighter than the rest.
 *
 * It is deliberately a *graphical* layer, not a data panel: everything it says
 * it says by where it sits on the real sky. Because it parents into the star
 * field's `skyGroup`, the same single rotation that carries the catalog carries
 * the zodiac too, and the planets already drawn by the star field land on the
 * ecliptic line without either layer knowing about the other.
 */
export class ZodiacOverlay {
    /**
     * @param {THREE.Object3D} parent - The star field's sky group (equatorial frame).
     * @param {{radius?: number, mode?: import('../sky/zodiac.js').ZodiacMode}} [options]
     */
    constructor(parent, options = {}) {
        this.parent = parent;
        this.radius = options.radius ?? 2000;
        /** @type {import('../sky/zodiac.js').ZodiacMode} */
        this.mode = options.mode === 'sidereal' ? 'sidereal' : 'tropical';
        this.visible = false;

        /** Epoch the band geometry was last laid out for, in Julian centuries. */
        this._geometryCenturies = Number.NaN;
        this._geometryMode = '';
        /** Epoch the band geometry was last laid out for, in ms — the ayanamsa depends on it. */
        this._layoutDate = Date.now();
        this._placementsComputedAt = Number.NEGATIVE_INFINITY;
        /** @type {ReturnType<typeof getZodiacState>|null} */
        this._state = null;
        this._sunSignIndex = -1;
        this._moonSignIndex = -1;
        /** @type {THREE.Sprite[]} */
        this._glyphs = [];

        this.group = new THREE.Group();
        this.group.renderOrder = -1;
        this.group.visible = false;
        this.parent.add(this.group);

        this._buildEcliptic();
        this._buildCuspTicks();
    }

    // ── Geometry construction ────────────────────────────────────────────────

    _buildEcliptic() {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
            'position',
            new THREE.BufferAttribute(new Float32Array(ZODIAC_CONFIG.eclipticSegments * 3), 3)
        );
        this.eclipticMaterial = new THREE.LineBasicMaterial({
            color: LINE_COLOR,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            fog: false
        });
        this.eclipticLine = new THREE.LineLoop(geometry, this.eclipticMaterial);
        this.eclipticLine.renderOrder = -1;
        this.eclipticLine.frustumCulled = false;
        this.group.add(this.eclipticLine);
    }

    _buildCuspTicks() {
        const geometry = new THREE.BufferGeometry();
        // Two endpoints per sign boundary.
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ZODIAC_SIGNS.length * 2 * 3), 3));
        this.cuspMaterial = new THREE.LineBasicMaterial({
            color: LINE_COLOR,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            fog: false
        });
        this.cuspTicks = new THREE.LineSegments(geometry, this.cuspMaterial);
        this.cuspTicks.renderOrder = -1;
        this.cuspTicks.frustumCulled = false;
        this.group.add(this.cuspTicks);
    }

    /**
     * Glyph sprites are built lazily, so a session that never turns the layer on
     * never pays for twelve canvas textures.
     */
    _ensureGlyphs() {
        if (this._glyphs.length || typeof document === 'undefined') return;
        const size = this.radius * ZODIAC_CONFIG.glyphScale;

        for (let i = 0; i < ZODIAC_SIGNS.length; i++) {
            const sign = ZODIAC_SIGNS[i];
            // Drawn white so the highlight can tint through `material.color`.
            const sprite = createTextSprite(sign.glyph, '#ffffff', {
                width: 96,
                height: 96,
                font: '400 66px "Segoe UI Symbol", "Noto Sans Symbols 2", "Apple Symbols", system-ui, sans-serif'
            });
            sprite.scale.set(size, size, 1);
            sprite.material.color.setHex(GLYPH_COLOR);
            sprite.userData.signIndex = i;
            this._glyphs.push(sprite);
            this.group.add(sprite);
        }
        this._positionGlyphs();
    }

    // ── Time driven refreshes ────────────────────────────────────────────────

    /**
     * Lay the band out for a date. Only redone when precession has actually
     * moved the ecliptic or the tropical/sidereal convention changed — the band
     * is fixed against the stars otherwise.
     * @param {Date|number} date
     */
    _refreshGeometry(date) {
        const centuries = julianCenturies(date);
        if (this._geometryMode === this.mode && Math.abs(centuries - this._geometryCenturies) < 0.01) return;
        this._geometryCenturies = centuries;
        this._geometryMode = this.mode;
        this._layoutDate = date instanceof Date ? date.getTime() : Number(date);

        const obliquity = meanObliquity(centuries);
        const positions = this.eclipticLine.geometry.getAttribute('position');
        for (let i = 0; i < ZODIAC_CONFIG.eclipticSegments; i++) {
            const longitude = (i / ZODIAC_CONFIG.eclipticSegments) * 360;
            const vector = this._eclipticVector(longitude, 0, obliquity);
            positions.setXYZ(i, vector.x, vector.y, vector.z);
        }
        positions.needsUpdate = true;
        this.eclipticLine.geometry.computeBoundingSphere();

        const half = ZODIAC_CONFIG.cuspTickHalfHeightDeg;
        const cuspPositions = this.cuspTicks.geometry.getAttribute('position');
        for (let i = 0; i < ZODIAC_SIGNS.length; i++) {
            const longitude = signCuspLongitudeDeg(i, { mode: this.mode, date });
            const below = this._eclipticVector(longitude, -half, obliquity);
            const above = this._eclipticVector(longitude, half, obliquity);
            cuspPositions.setXYZ(i * 2, below.x, below.y, below.z);
            cuspPositions.setXYZ(i * 2 + 1, above.x, above.y, above.z);
        }
        cuspPositions.needsUpdate = true;
        this.cuspTicks.geometry.computeBoundingSphere();

        this._positionGlyphs();
    }

    _positionGlyphs() {
        if (!this._glyphs.length) return;
        const centuries = Number.isFinite(this._geometryCenturies) ? this._geometryCenturies : 0;
        const obliquity = meanObliquity(centuries);
        const date = this._layoutDate;
        for (const sprite of this._glyphs) {
            const index = sprite.userData.signIndex;
            // Mid-sign, so the glyph names the slice rather than a boundary.
            const longitude = signCuspLongitudeDeg(index, { mode: this.mode, date }) + SIGN_WIDTH_DEG / 2;
            const vector = this._eclipticVector(longitude, ZODIAC_CONFIG.glyphLatitudeDeg, obliquity);
            sprite.position.set(vector.x, vector.y, vector.z);
        }
    }

    /**
     * A point on the sky sphere from ecliptic coordinates, in the same
     * equatorial-of-date frame the star catalog is precessed into.
     * @param {number} longitudeDeg
     * @param {number} latitudeDeg
     * @param {number} obliquityRad
     * @returns {{x: number, y: number, z: number}}
     */
    _eclipticVector(longitudeDeg, latitudeDeg, obliquityRad) {
        const { ra, dec } = eclipticToEquatorial(longitudeDeg * DEG, latitudeDeg * DEG, obliquityRad);
        return equatorialToVector(ra, dec, this.radius);
    }

    /**
     * Re-solve which signs the Sun and Moon occupy. Both move far too slowly to
     * need this more than once a simulated minute.
     * @param {Date|number} date
     * @param {boolean} [force]
     */
    _refreshPlacements(date, force = false) {
        const when = date instanceof Date ? date.getTime() : Number(date);
        if (!force && Math.abs(when - this._placementsComputedAt) < ZODIAC_CONFIG.recomputeMs) return;
        this._placementsComputedAt = when;

        this._state = getZodiacState(when, { mode: this.mode });
        this._sunSignIndex = this._state.sun.signIndex;
        this._moonSignIndex = this._state.moon.signIndex;

        for (const sprite of this._glyphs) {
            const index = sprite.userData.signIndex;
            const color =
                index === this._sunSignIndex
                    ? SUN_SIGN_COLOR
                    : index === this._moonSignIndex
                      ? MOON_SIGN_COLOR
                      : GLYPH_COLOR;
            sprite.material.color.setHex(color);
        }
    }

    // ── Public surface ───────────────────────────────────────────────────────

    /** @param {boolean} visible */
    setVisible(visible) {
        this.visible = !!visible;
        if (this.visible) this._ensureGlyphs();
    }

    /**
     * Switch between the equinox-anchored (tropical) and star-anchored
     * (sidereal) conventions. Forces a relayout, since the whole ring shifts.
     * @param {import('../sky/zodiac.js').ZodiacMode} mode
     * @param {Date|number} [date]
     */
    setMode(mode, date = Date.now()) {
        const next = mode === 'sidereal' ? 'sidereal' : 'tropical';
        if (next === this.mode) return;
        this.mode = next;
        this._refreshGeometry(date);
        this._refreshPlacements(date, true);
    }

    /**
     * Point the overlay at an instant. Cheap to call whenever the star field
     * updates its observer — both refreshes below short-circuit when nothing
     * meaningful has moved.
     * @param {Date|number} date
     */
    setDate(date) {
        this._refreshGeometry(date);
        this._refreshPlacements(date);
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
        this.eclipticMaterial.opacity = baseOpacity * ZODIAC_CONFIG.eclipticOpacity;
        this.cuspMaterial.opacity = baseOpacity * ZODIAC_CONFIG.cuspOpacity;

        for (const sprite of this._glyphs) {
            const index = sprite.userData.signIndex;
            const tenanted = index === this._sunSignIndex || index === this._moonSignIndex;
            const scale = tenanted ? ZODIAC_CONFIG.tenantedGlyphOpacity : ZODIAC_CONFIG.glyphOpacity;
            sprite.material.opacity = baseOpacity * scale;
            sprite.visible = sprite.material.opacity > 0.02;
        }
    }

    /** The current placements, for the debug API and tests. */
    getState() {
        return this._state;
    }

    dispose() {
        for (const sprite of this._glyphs) {
            this.group.remove(sprite);
            sprite.material.map?.dispose();
            sprite.material.dispose();
        }
        this._glyphs = [];
        for (const object of [this.eclipticLine, this.cuspTicks]) {
            this.group.remove(object);
            object.geometry.dispose();
            object.material.dispose();
        }
        this.parent.remove(this.group);
    }
}
