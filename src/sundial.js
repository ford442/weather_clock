// The sundial: a horizontal dial whose style is parallel to Earth's axis, so
// the real sun's shadow is the clock. The face carries solar hour lines laid
// out for the observer's latitude; a faint ghost line shows where a mean-time
// sun would throw that shadow (the equation of time, drawn rather than
// printed); and when the sun is down a dim 24-hour civil pointer takes over so
// the object still reads as a clock. All motion follows the time passed to
// update() — the simulation clock — never the wall clock.
import * as THREE from 'three';
import {
    apparentSolarTime,
    getSolarTimeTerms,
    hourLineSegment,
    hoursToHourAngle,
    layoutGnomon,
    localMeanSolarTime,
    maxSunlitHourAngle,
    solarAltitude
} from './sundial-astronomy.js';
import { TEMPORAL_NARRATIVE_CONFIG } from './temporal-narrative.js';

export const SUNDIAL_DIMENSIONS = {
    base: {
        radiusTop: 3.0,
        radiusBottom: 3.2,
        height: 0.3,
        y: 0
    },
    face: {
        radius: 2.8,
        height: 0.1,
        y: 0.2
    }
};

/** The face's top surface — the plane every dial mark and every shadow reading lives on. */
const FACE_TOP_Y = SUNDIAL_DIMENSIONS.face.y + SUNDIAL_DIMENSIONS.face.height / 2;
const DEG = Math.PI / 180;

export const SUNDIAL_CONFIG = Object.freeze({
    /** Same fallback observer as AstronomyService, so the style matches the sun before geolocation lands. */
    defaultLatitude: 40.7128,
    defaultLongitude: -74.006,
    /** Smallest latitude change (degrees) that relays the gnomon and hour lines. */
    relayoutThresholdDeg: 0.01,
    gnomon: Object.freeze({
        rootOffset: 0.55,
        plateReach: 2.15,
        maxStyleHeight: 1.3,
        minStyleHeight: 0.5,
        minPlateWeb: 0.22,
        thickness: 0.06,
        color: 0x7a5a32,
        metalness: 0.75,
        roughness: 0.35
    }),
    hourLines: Object.freeze({
        radius: 2.25,
        rootGap: 0.3,
        width: 0.022,
        halfHourWidth: 0.012,
        halfHourLength: 0.2,
        /** Inlay strips rise this far above the face and sink `inset` below it, so no face is coplanar. */
        height: 0.004,
        inset: 0.002,
        color: 0x3b3026
    }),
    /** Raised blocks at the outer end of each whole-hour line, as [width, length]. */
    hourMarkers: Object.freeze({
        noon: Object.freeze([0.075, 0.16]),
        quarter: Object.freeze([0.055, 0.12]),
        hour: Object.freeze([0.04, 0.085]),
        height: 0.028,
        color: 0x2e251d
    }),
    /** The night clock's 24-hour chapter, engraved lighter than the solar inlay. */
    civilRing: Object.freeze({
        innerRadius: 2.5,
        outerRadius: 2.6,
        majorInnerRadius: 2.44,
        majorOuterRadius: 2.66,
        width: 0.012,
        majorWidth: 0.022,
        color: 0xa1977f
    }),
    nightClock: Object.freeze({
        /** Sun altitude (degrees) where the night clock begins to show, and where it is fully lit. */
        fadeStartDeg: 2,
        fadeEndDeg: -4,
        /** Long enough to read from the default camera, short enough to clear the gnomon plate. */
        pointerInnerRadius: 1.7,
        pointerOuterRadius: 2.72,
        pointerWidth: 0.13,
        pointerThickness: 0.018,
        /** Floats above the hour blocks, as a clock hand sits above its dial. */
        lift: 0.034,
        beadRadius: 2.74,
        beadSize: 0.032,
        color: 0xf2ecd8,
        emissive: 0xbcd4ff,
        emissiveIntensity: 1.2,
        maxOpacity: 0.95
    }),
    /** The mean-sun ghost line: where the shadow would fall if the sun kept clock time. */
    ghost: Object.freeze({
        width: 0.016,
        height: 0.002,
        lift: 0.006,
        /** |equation of time| (minutes) at which the warm/cool tint saturates — the annual extreme. */
        saturationMinutes: 16.5,
        maxOpacity: 0.6,
        emissiveIntensity: 0.7
    }),
    /** Instance budget for hour lines, half-hour ticks, hour blocks, and the civil ring. */
    maxMarks: 160
});

/**
 * @typedef {Object} SundialObserver
 * @property {number|null} [latitude] Degrees; the gnomon and hour lines relay when it changes.
 * @property {number|null} [longitude] Degrees east; sets apparent and mean solar time.
 * @property {number} [sunAltitude] Radians. Pass AstronomyService's value so the night clock fades with the lighting.
 */

/**
 * @typedef {Object} SundialHourLine
 * @property {number} hour Apparent solar hour the line marks (0–23).
 * @property {number} hourAngleRad
 * @property {number} edgeOffset East offset of the plate edge whose shadow the line is drawn for.
 * @property {{x: number, z: number}} start
 * @property {{x: number, z: number}} end
 */

/**
 * @typedef {Object} SundialState
 * @property {number} latitude
 * @property {number} longitude
 * @property {1|-1} poleSign +1 when the style climbs toward +Z (north), −1 toward −Z.
 * @property {number} styleAngleDeg Inclination of the style above the face.
 * @property {{start: {x: number, y: number, z: number}, end: {x: number, y: number, z: number}}} style
 *   The style edge in sundial-local coordinates (the sundial sits unrotated at the scene origin).
 * @property {{x: number, z: number}|null} root Where the style line meets the face.
 * @property {number} faceY Height of the face plane.
 * @property {number} plateThickness
 * @property {SundialHourLine[]} hourLines Whole-hour lines as drawn (noon appears twice: one per plate face).
 * @property {number|null} apparentSolarHours What the shadow reads.
 * @property {number|null} localMeanHours What the ghost line reads.
 * @property {number|null} equationOfTimeMin
 * @property {number|null} civilHours Local clock time shown by the night pointer.
 * @property {number} nightFactor 0 by day, 1 once the sun is well down.
 * @property {boolean} ghostVisible
 */

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
const finiteOr = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

const smoothstep = (edge0, edge1, x) => {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
};

/**
 * Extrude the gnomon's convex meridian profile into a plate `thickness` wide,
 * centred on the meridian plane (x = 0). Flat-shaded and wound outward.
 * @param {{n: number, y: number}[]} profile
 * @param {number} thickness
 * @returns {THREE.BufferGeometry}
 */
function buildPlateGeometry(profile, thickness) {
    const half = thickness / 2;
    const centroid = { n: 0, y: 0 };
    for (const point of profile) {
        centroid.n += point.n / profile.length;
        centroid.y += point.y / profile.length;
    }

    /** @type {number[]} */
    const positions = [];
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const vertex = (point, x) => new THREE.Vector3(x, FACE_TOP_Y + point.y, point.n);
    const pushTriangle = (a, b, c, outward) => {
        normal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
        const [second, third] = normal.dot(outward) < 0 ? [c, b] : [b, c];
        positions.push(a.x, a.y, a.z, second.x, second.y, second.z, third.x, third.y, third.z);
    };

    for (const x of [-half, half]) {
        const outward = new THREE.Vector3(Math.sign(x), 0, 0);
        for (let i = 1; i < profile.length - 1; i++) {
            pushTriangle(vertex(profile[0], x), vertex(profile[i], x), vertex(profile[i + 1], x), outward);
        }
    }
    for (let i = 0; i < profile.length; i++) {
        const p = profile[i];
        const q = profile[(i + 1) % profile.length];
        // The profile is convex, so "away from the centroid" is outward.
        const outward = new THREE.Vector3(0, (p.y + q.y) / 2 - centroid.y, (p.n + q.n) / 2 - centroid.n);
        const a = vertex(p, -half);
        const b = vertex(q, -half);
        const c = vertex(q, half);
        const d = vertex(p, half);
        pushTriangle(a, b, c, outward);
        pushTriangle(a, c, d, outward);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    return geometry;
}

/**
 * Build the sundial. The returned `update(time, observer)` is the only thing
 * that moves it, so time-warp, scrubbing, photo, and time-lapse all freeze or
 * sweep the shadow, the ghost line, and the night pointer together.
 */
export function createSundial() {
    const group = new THREE.Group();
    group.name = 'sundial';

    // Create base/platform
    const baseGeometry = new THREE.CylinderGeometry(
        SUNDIAL_DIMENSIONS.base.radiusTop,
        SUNDIAL_DIMENSIONS.base.radiusBottom,
        SUNDIAL_DIMENSIONS.base.height,
        32
    );
    const baseMaterial = new THREE.MeshStandardMaterial({
        color: 0x8b7355,
        metalness: 0.3,
        roughness: 0.7
    });
    const base = new THREE.Mesh(baseGeometry, baseMaterial);
    base.position.y = SUNDIAL_DIMENSIONS.base.y; // Explicitly set
    base.receiveShadow = true;
    base.castShadow = true;
    group.add(base);

    // Create clock face
    const faceGeometry = new THREE.CylinderGeometry(
        SUNDIAL_DIMENSIONS.face.radius,
        SUNDIAL_DIMENSIONS.face.radius,
        SUNDIAL_DIMENSIONS.face.height,
        64
    );
    const faceMaterial = new THREE.MeshStandardMaterial({
        color: 0xf5f5dc,
        metalness: 0.1,
        roughness: 0.5
    });
    const face = new THREE.Mesh(faceGeometry, faceMaterial);
    face.position.y = SUNDIAL_DIMENSIONS.face.y;
    face.receiveShadow = true;
    face.castShadow = true;
    group.add(face);

    // ── Gnomon: a bronze plate whose top edge is the style ──
    const gnomonConfig = SUNDIAL_CONFIG.gnomon;
    const gnomon = new THREE.Mesh(
        new THREE.BufferGeometry(),
        new THREE.MeshStandardMaterial({
            color: gnomonConfig.color,
            metalness: gnomonConfig.metalness,
            roughness: gnomonConfig.roughness
        })
    );
    gnomon.name = 'sundial-gnomon';
    gnomon.castShadow = true;
    gnomon.receiveShadow = true;
    group.add(gnomon);

    // ── Dial marks: hour lines, half-hour ticks, hour blocks, civil ring ──
    // One instanced unit strip (x ∈ [−½, ½], y ∈ [0, 1], z ∈ [0, 1]) laid along
    // each mark, coloured per instance. Plain MeshStandardMaterial, so the
    // WebGPU renderer converts it like any other built-in material.
    const unitStrip = new THREE.BoxGeometry(1, 1, 1);
    unitStrip.translate(0, 0.5, 0.5);
    const marks = new THREE.InstancedMesh(
        unitStrip,
        new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.45, roughness: 0.55 }),
        SUNDIAL_CONFIG.maxMarks
    );
    marks.name = 'sundial-marks';
    marks.receiveShadow = true;
    marks.count = 0;
    group.add(marks);

    const lineColor = new THREE.Color(SUNDIAL_CONFIG.hourLines.color);
    const markerColor = new THREE.Color(SUNDIAL_CONFIG.hourMarkers.color);
    const ringColor = new THREE.Color(SUNDIAL_CONFIG.civilRing.color);

    // ── Ghost line: the shadow a mean-time sun would cast ──
    const ghostConfig = SUNDIAL_CONFIG.ghost;
    const ghostMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xffffff,
        emissiveIntensity: ghostConfig.emissiveIntensity,
        metalness: 0,
        roughness: 0.6,
        transparent: true,
        opacity: 0,
        depthWrite: false
    });
    const ghost = new THREE.Mesh(unitStrip, ghostMaterial);
    ghost.name = 'sundial-ghost';
    ghost.visible = false;
    group.add(ghost);
    const ghostColor = new THREE.Color();
    const [neutralR, neutralG, neutralB] = TEMPORAL_NARRATIVE_CONFIG.neutralTint;

    // ── Night clock: a 24-hour civil pointer plus a minute bead on the rim ──
    const nightConfig = SUNDIAL_CONFIG.nightClock;
    const nightMaterial = new THREE.MeshStandardMaterial({
        color: nightConfig.color,
        emissive: nightConfig.emissive,
        emissiveIntensity: nightConfig.emissiveIntensity,
        metalness: 0.1,
        roughness: 0.4,
        transparent: true,
        opacity: 0,
        depthWrite: false
    });
    const hourPivot = new THREE.Group();
    hourPivot.name = 'sundial-night-hour';
    hourPivot.position.y = FACE_TOP_Y + nightConfig.lift;
    // A four-sided cylinder is a square prism with its corners on ±X/±Z: a lozenge once scaled.
    const hourPointer = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 4), nightMaterial);
    const pointerLength = nightConfig.pointerOuterRadius - nightConfig.pointerInnerRadius;
    hourPointer.scale.set(nightConfig.pointerWidth, nightConfig.pointerThickness, pointerLength);
    hourPointer.position.set(0, nightConfig.pointerThickness / 2, nightConfig.pointerInnerRadius + pointerLength / 2);
    hourPivot.add(hourPointer);
    group.add(hourPivot);

    const minutePivot = new THREE.Group();
    minutePivot.name = 'sundial-night-minute';
    minutePivot.position.y = FACE_TOP_Y + nightConfig.lift;
    const minuteBead = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), nightMaterial);
    minuteBead.scale.setScalar(nightConfig.beadSize);
    minuteBead.position.set(0, nightConfig.beadSize * 0.5, nightConfig.beadRadius);
    minutePivot.add(minuteBead);
    group.add(minutePivot);
    hourPivot.visible = false;
    minutePivot.visible = false;

    // ── Mutable state ──
    /** @type {import('./sundial-astronomy.js').GnomonLayout} */
    let layout = layoutGnomon(SUNDIAL_CONFIG.defaultLatitude, gnomonConfig);
    /** @type {number} */
    let longitude = SUNDIAL_CONFIG.defaultLongitude;
    /** @type {SundialHourLine[]} */
    let hourLines = [];
    /** @type {number|null} */
    let apparentSolarHours = null;
    /** @type {number|null} */
    let localMeanHours = null;
    /** @type {number|null} */
    let equationOfTimeMin = null;
    /** @type {number|null} */
    let civilHours = null;
    let nightFactor = 0;

    const markMatrix = new THREE.Matrix4();
    const markPosition = new THREE.Vector3();
    const markQuaternion = new THREE.Quaternion();
    const markScale = new THREE.Vector3();
    const upAxis = new THREE.Vector3(0, 1, 0);

    /**
     * Yaw that turns local +Z toward a dial direction (e, n).
     * @param {number} e
     * @param {number} n
     */
    const yawToward = (e, n) => Math.atan2(e, n);

    /**
     * Civil dial direction for a fraction of a turn: 0 points where the noon
     * shadow points (toward the elevated pole), and the pointer turns the same
     * way the shadow does.
     * @param {number} turns
     */
    const civilYaw = (turns) => {
        const angle = turns * 2 * Math.PI;
        return yawToward(Math.sin(angle), layout.poleSign * Math.cos(angle));
    };

    function layoutMarks() {
        const { radius, rootGap, width, halfHourWidth, halfHourLength, height, inset } = SUNDIAL_CONFIG.hourLines;
        const markers = SUNDIAL_CONFIG.hourMarkers;
        const ring = SUNDIAL_CONFIG.civilRing;
        const halfPlate = gnomonConfig.thickness / 2;
        const baseY = FACE_TOP_Y - inset;
        const maxHourAngle = maxSunlitHourAngle(layout.latitudeDeg) + 1e-9;
        let count = 0;

        /**
         * @param {{e: number, n: number}} start
         * @param {{e: number, n: number}} end
         * @param {number} stripWidth
         * @param {number} stripHeight
         * @param {THREE.Color} color
         */
        const place = (start, end, stripWidth, stripHeight, color) => {
            if (count >= SUNDIAL_CONFIG.maxMarks) return;
            const de = end.e - start.e;
            const dn = end.n - start.n;
            markPosition.set(start.e, baseY, start.n);
            markQuaternion.setFromAxisAngle(upAxis, yawToward(de, dn));
            markScale.set(stripWidth, stripHeight + inset, Math.max(Math.hypot(de, dn), 1e-6));
            marks.setMatrixAt(count, markMatrix.compose(markPosition, markQuaternion, markScale));
            marks.setColorAt(count, color);
            count++;
        };

        hourLines = [];
        for (let k = -11; k <= 12; k++) {
            const hourAngleRad = k * 15 * DEG;
            if (Math.abs(hourAngleRad) > maxHourAngle) continue;

            // Morning lines are drawn for the plate's west face, afternoon lines
            // for its east face; noon gets both — the split noon line.
            const edges = k === 0 ? [-halfPlate, halfPlate] : [k < 0 ? -halfPlate : halfPlate];
            for (const edgeOffset of edges) {
                const segment = hourLineSegment(layout, hourAngleRad, { radius, rootGap, edgeOffset });
                if (!segment) continue;
                place(segment.start, segment.end, width, height, lineColor);
                hourLines.push({
                    hour: (12 + k) % 24,
                    hourAngleRad,
                    edgeOffset,
                    start: { x: segment.start.e, z: segment.start.n },
                    end: { x: segment.end.e, z: segment.end.n }
                });
            }

            const centre = hourLineSegment(layout, hourAngleRad, { radius, rootGap });
            if (!centre) continue;
            const [markerWidth, markerLength] = k === 0 ? markers.noon : k % 3 === 0 ? markers.quarter : markers.hour;
            const de = centre.end.e - centre.start.e;
            const dn = centre.end.n - centre.start.n;
            const length = Math.hypot(de, dn);
            const back = Math.min(markerLength, length) / length;
            const markerStart = { e: centre.end.e - de * back, n: centre.end.n - dn * back };
            place(markerStart, centre.end, markerWidth, markers.height, markerColor);
        }

        for (let k = -12; k < 12; k++) {
            const hourAngleRad = (k + 0.5) * 15 * DEG;
            if (Math.abs(hourAngleRad) > maxHourAngle) continue;
            const edgeOffset = hourAngleRad < 0 ? -halfPlate : halfPlate;
            const segment = hourLineSegment(layout, hourAngleRad, { radius, rootGap, edgeOffset });
            if (!segment) continue;
            const de = segment.end.e - segment.start.e;
            const dn = segment.end.n - segment.start.n;
            const length = Math.hypot(de, dn);
            const from = Math.max(0, length - halfHourLength) / length;
            place(
                { e: segment.start.e + de * from, n: segment.start.n + dn * from },
                segment.end,
                halfHourWidth,
                height,
                lineColor
            );
        }

        for (let hour = 0; hour < 24; hour++) {
            const major = hour % 6 === 0;
            const angle = ((hour - 12) / 24) * 2 * Math.PI;
            const e = Math.sin(angle);
            const n = layout.poleSign * Math.cos(angle);
            const inner = major ? ring.majorInnerRadius : ring.innerRadius;
            const outer = major ? ring.majorOuterRadius : ring.outerRadius;
            place(
                { e: e * inner, n: n * inner },
                { e: e * outer, n: n * outer },
                major ? ring.majorWidth : ring.width,
                height,
                ringColor
            );
        }

        marks.count = count;
        marks.instanceMatrix.needsUpdate = true;
        if (marks.instanceColor) marks.instanceColor.needsUpdate = true;
        marks.computeBoundingSphere();
    }

    /**
     * Re-lay the gnomon and every hour line for a latitude. Cheap, but only
     * done when the latitude really moves (relocation, not every frame).
     * @param {number} latitudeDeg
     * @returns {boolean} Whether anything was rebuilt.
     */
    function setLatitude(latitudeDeg) {
        const latitude = clamp(finiteOr(latitudeDeg, SUNDIAL_CONFIG.defaultLatitude), -90, 90);
        if (hourLines.length && Math.abs(latitude - layout.latitudeDeg) < SUNDIAL_CONFIG.relayoutThresholdDeg) {
            return false;
        }
        layout = layoutGnomon(latitude, gnomonConfig);
        const previous = gnomon.geometry;
        gnomon.geometry = buildPlateGeometry(layout.profile, gnomonConfig.thickness);
        previous.dispose();
        layoutMarks();
        return true;
    }

    /**
     * Advance the instrument to `time`. The shadow itself is the real sun's
     * shadow map; this moves everything else that tells time.
     * @param {Date|number|string} time The simulation instant.
     * @param {SundialObserver} [observer] Pass the AstroSnapshot for this instant.
     */
    function update(time, observer = {}) {
        const when = time instanceof Date ? time : new Date(time);
        if (!Number.isFinite(when.getTime())) return;

        setLatitude(finiteOr(observer.latitude, layout.latitudeDeg));
        longitude = finiteOr(observer.longitude, longitude);

        const { equationOfTimeMin: eot } = getSolarTimeTerms(when);
        equationOfTimeMin = eot;
        apparentSolarHours = apparentSolarTime(when, longitude, eot);
        localMeanHours = localMeanSolarTime(when, longitude);

        // Only fall back to our own series when no AstronomyService snapshot was passed.
        const sunAltitude =
            typeof observer.sunAltitude === 'number' && Number.isFinite(observer.sunAltitude)
                ? observer.sunAltitude
                : solarAltitude(when, layout.latitudeDeg, longitude);
        nightFactor = 1 - smoothstep(nightConfig.fadeEndDeg, nightConfig.fadeStartDeg, sunAltitude / DEG);
        const dayFactor = 1 - nightFactor;

        // Night clock: browser-local civil time, the same clock the digital display shows.
        civilHours =
            when.getHours() + when.getMinutes() / 60 + when.getSeconds() / 3600 + when.getMilliseconds() / 3600000;
        const showNight = nightFactor > 0.003;
        hourPivot.visible = showNight;
        minutePivot.visible = showNight;
        nightMaterial.opacity = nightFactor * nightConfig.maxOpacity;
        hourPivot.rotation.y = civilYaw((civilHours - 12) / 24);
        minutePivot.rotation.y = civilYaw(civilHours % 1);

        // Ghost: the hour line for local mean time. Its gap to the real shadow is
        // the equation of time — warm while the sun runs ahead of the clock, cool
        // while it lags, the same palette as the temporal band.
        const meanHourAngle = hoursToHourAngle(localMeanHours);
        const halfPlate = gnomonConfig.thickness / 2;
        const segment =
            dayFactor > 0.003
                ? hourLineSegment(layout, meanHourAngle, {
                      radius: SUNDIAL_CONFIG.hourLines.radius,
                      rootGap: SUNDIAL_CONFIG.hourLines.rootGap,
                      edgeOffset: Math.sign(meanHourAngle) * halfPlate
                  })
                : null;
        ghost.visible = !!segment;
        if (segment) {
            const de = segment.end.e - segment.start.e;
            const dn = segment.end.n - segment.start.n;
            ghost.position.set(segment.start.e, FACE_TOP_Y + ghostConfig.lift, segment.start.n);
            ghost.rotation.set(0, yawToward(de, dn), 0);
            ghost.scale.set(ghostConfig.width, ghostConfig.height, Math.hypot(de, dn));

            const amount = clamp(Math.abs(eot) / ghostConfig.saturationMinutes, 0, 1);
            const [r, g, b] = eot >= 0 ? TEMPORAL_NARRATIVE_CONFIG.warmTint : TEMPORAL_NARRATIVE_CONFIG.coolTint;
            ghostColor.setRGB(
                neutralR + (r - neutralR) * amount,
                neutralG + (g - neutralG) * amount,
                neutralB + (b - neutralB) * amount
            );
            ghostMaterial.color.copy(ghostColor);
            ghostMaterial.emissive.copy(ghostColor);
            ghostMaterial.opacity = dayFactor * ghostConfig.maxOpacity * (0.3 + 0.7 * amount);
        }
    }

    /** @returns {SundialState} */
    function getState() {
        const toLocal = (point) => ({ x: point.e, y: FACE_TOP_Y + point.y, z: point.n });
        return {
            latitude: layout.latitudeDeg,
            longitude,
            poleSign: layout.poleSign,
            styleAngleDeg: layout.styleAngleRad / DEG,
            style: { start: toLocal(layout.styleStart), end: toLocal(layout.styleEnd) },
            root: layout.root ? { x: layout.root.e, z: layout.root.n } : null,
            faceY: FACE_TOP_Y,
            plateThickness: gnomonConfig.thickness,
            hourLines: hourLines.map((line) => ({ ...line, start: { ...line.start }, end: { ...line.end } })),
            apparentSolarHours,
            localMeanHours,
            equationOfTimeMin,
            civilHours,
            nightFactor,
            ghostVisible: ghost.visible
        };
    }

    setLatitude(SUNDIAL_CONFIG.defaultLatitude);

    return {
        group,
        base,
        face,
        gnomon,
        update,
        setLatitude,
        getState
    };
}
