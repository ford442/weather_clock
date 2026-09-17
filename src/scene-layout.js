// Single source of truth for the spatial layout of the 3-zone weather scene
// and the camera/sky/depth numbers that have to stay consistent with it.
// Particle systems, fog, lightning, ground, sky scale, and the star sphere
// all read from here instead of hardcoding X/Z/radius — see #109 / this issue.

/**
 * @typedef {Object} SceneZoneBounds
 * @property {number} minX
 * @property {number} maxX
 */

const PAST = Object.freeze(/** @type {SceneZoneBounds} */ ({ minX: -12, maxX: -4 }));
const CURRENT = Object.freeze(/** @type {SceneZoneBounds} */ ({ minX: -4, maxX: 4 }));
const FUTURE = Object.freeze(/** @type {SceneZoneBounds} */ ({ minX: 4, maxX: 12 }));

/**
 * Camera near/far vs sky vs star sphere:
 * logarithmic depth (WebGL + WebGPU) keeps the sundial (~1 unit) from
 * z-fighting a 2000-unit star sphere even while the procedural sky disc
 * sits at 450000 and `far` is 2e6. Do not drop log-depth without shrinking
 * `sky.scale` and `camera.far` together.
 *
 * Shadow cameras stay tight around the sundial on purpose — weather volumes
 * and the sky disc live far outside `shadows.cameraFar`.
 */
export const SCENE_LAYOUT = Object.freeze({
    zones: Object.freeze({
        past: PAST,
        current: CURRENT,
        future: FUTURE
    }),
    /** Inclusive X span of all three zones (cloud default when no zone is given). */
    sceneSpan: Object.freeze({ minX: PAST.minX, maxX: FUTURE.maxX }),
    // Z-axis wrap bounds shared by fog planes drifting within a zone.
    fog: Object.freeze({ minZ: -8, maxZ: 8 }),
    // Lightning only strikes the present (center) zone.
    lightning: CURRENT,
    ground: Object.freeze({ radius: 3.6, y: -0.02 }),
    camera: Object.freeze({
        near: 0.1,
        far: 2_000_000,
        fov: 75,
        position: Object.freeze({ x: 0, y: 5, z: 8 }),
        lookAt: Object.freeze({ x: 0, y: 0, z: 0 })
    }),
    sky: Object.freeze({ scale: 450000 }),
    starSphere: Object.freeze({ radius: 2000 }),
    depth: Object.freeze({
        /** Shared strategy for WebGL and WebGPU; see RendererFactory. */
        mode: /** @type {'logarithmic'} */ ('logarithmic')
    }),
    shadows: Object.freeze({
        cameraNear: 0.5,
        cameraFar: 50
    })
});

/**
 * @param {string|undefined} zoneName
 * @returns {SceneZoneBounds}
 */
export function getZoneBounds(zoneName) {
    if (zoneName === 'past') return SCENE_LAYOUT.zones.past;
    if (zoneName === 'future') return SCENE_LAYOUT.zones.future;
    return SCENE_LAYOUT.zones.current;
}
