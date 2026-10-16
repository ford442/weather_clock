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
 * @typedef {Object} SceneWeatherVolume
 * @property {number} minZ Z wrap/spawn bounds for rain, snow, dust, pollen, and lightning.
 * @property {number} maxZ
 * @property {number} minY Floor: falling particles respawn once below it; also the bottom of the initial fill.
 * @property {number} maxY Top of the initial fill and of the respawn band.
 * @property {number} resetY Bottom of the respawn band `[resetY, maxY]` for particles that hit the floor.
 * @property {number} dustMaxY Wind dust hugs the ground: it lives in `[0, dustMaxY]`.
 * @property {number} lightningY Height of the lightning flash light.
 */

// Precipitation shares fog's Z span so every weather layer occupies the same
// slab; a long wind can only wrap particles around inside it.
const WEATHER_Z = Object.freeze({ minZ: -8, maxZ: 8 });
const VOLUME = Object.freeze(
    /** @type {SceneWeatherVolume} */ ({
        minZ: WEATHER_Z.minZ,
        maxZ: WEATHER_Z.maxZ,
        minY: -5,
        maxY: 20,
        resetY: 15,
        dustMaxY: 8,
        lightningY: 10
    })
);

/**
 * Camera near/far vs sky vs star sphere:
 * `camera.far` (2e6) > `sky.scale` (450000) > `starSphere.radius` (2000) so
 * the star sphere sits inside the sky disc and well away from the sundial.
 * Depth is logarithmic: the in-repo sky material (`webgpu/materials/SkyMaterial.js`)
 * neither tests nor writes depth, so it no longer fights log depth or bloom.
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
    fog: WEATHER_Z,
    /**
     * The only source of Z and spawn-Y for rain, snow, dust, pollen, and
     * lightning (WebGL and WebGPU). X still comes from the zone; Z wraps here
     * the same way X wraps on the zone, so no wind or time-warp can walk a
     * particle out of the scene.
     */
    volume: VOLUME,
    // Lightning only strikes the present (center) zone; Z/Y come from `volume`.
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
        /**
         * Logarithmic depth on both backends — the right fix for a 2e6 far
         * plane. The sky dome is depth-agnostic (no `gl_FragDepth`, no z = w),
         * and every hand-written GLSL shader includes the `LOG_DEPTH_*` chunks
         * from `shaders.js` so it sorts against built-in materials. WebGPU
         * would prefer reverse-Z, but Three r181's `WebGPURenderer` does not
         * expose it; see `RendererFactory.DEFAULT_OPTIONS`.
         */
        mode: /** @type {'linear'|'logarithmic'} */ ('logarithmic')
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
