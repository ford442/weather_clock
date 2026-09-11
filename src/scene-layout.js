// Single source of truth for the spatial layout of the 3-zone weather scene.
// Every particle system, fog effect, lightning spawn, and ground mesh should
// read its bounds from here instead of hardcoding X/Z offsets — see #109.
export const SCENE_LAYOUT = Object.freeze({
    zones: Object.freeze({
        past: Object.freeze({ minX: -12, maxX: -4 }),
        current: Object.freeze({ minX: -4, maxX: 4 }),
        future: Object.freeze({ minX: 4, maxX: 12 })
    }),
    // Z-axis wrap bounds shared by fog planes drifting within a zone.
    fog: Object.freeze({ minZ: -8, maxZ: 8 }),
    // Lightning only strikes the present (center) zone.
    lightning: Object.freeze({ minX: -4, maxX: 4 }),
    ground: Object.freeze({ radius: 3.6, y: -0.02 }),
    camera: Object.freeze({
        near: 0.1,
        far: 2000000,
        fov: 75,
        position: Object.freeze({ x: 0, y: 5, z: 8 }),
        lookAt: Object.freeze({ x: 0, y: 0, z: 0 })
    })
});
