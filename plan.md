# Project Plan: The Aether Architect (3D Weather & Time)

## Vision
Transform `weather_clock` from a data dashboard into a **photorealistic window to the sky**. The user should "Feel the Time" through atmospheric rendering, particle evolution, and simulation logic.

## Core Directives
- **Atmosphere**: GLSL Sky Shader, Volumetric Fog, Bloom (Implemented).
- **Time**: Decoupled simulation time, Time-Lapse/Fast Forward (Implemented, refining).
- **Weather**: Particle systems for rain/snow/clouds, wind influence (Implemented, refining).

## Implementation Status

### 1. Atmosphere & Lighting (Completed)
- [x] **Sky Upgrade**: `three/addons/objects/Sky.js` implemented with Rayleigh/Mie scattering.
- [x] **Volumetric Fog**: `THREE.FogExp2` with dynamic density based on weather.
- [x] **Post-Processing**: `EffectComposer` with `UnrealBloomPass` for intense sun/moon glow.
- [x] **Lighting**: Dynamic sun/moon intensity and color based on cloud cover and elevation.

### 2. Particle Evolution (Completed & Polishing)
- [x] **Clouds**: `InstancedMesh` with noise textures.
- [x] **Precipitation**: `RainSystem` and `SnowSystem` using object pooling.
- [x] **Interaction**: Rain splashes on sundial (Collision detection implemented).
- [x] **Wind**: Particles respond to wind speed.
- [ ] **Polish**: Fix Raycaster range for splashes.

### 3. Time Logic (Refining)
- [x] **Decouple Time**: `simulationTime` variable drives sun/moon position.
- [x] **Time-Lapse**: `WARP_SCALE` (1440x) implemented.
- [ ] **True Weather Simulation**: Ensure weather *conditions* (rain, clouds) change according to `simulationTime` during fast-forward, not just static "current" weather.

## Next Steps (The Aether Polish)
1.  **True Time-Lapse Weather**:
    - Modify `WeatherService` to expose a full 24h timeline of hourly weather.
    - Update `main.js` to sample this timeline based on `simulationTime`.
2.  **Visual Polish**:
    - Fix collision detection range for rain splashes.
    - Ensure smooth interpolation between hourly weather data points.

## Developer Notes
- `src/weatherLighting.js` handles all lighting transitions.
- `src/weatherEffects.js` manages particle systems.
- `src/astronomy.js` handles celestial positioning.
