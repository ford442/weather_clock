# Project Plan: The Aether Architect (3D Weather & Time)

## Vision
Transform `weather_clock` from a data dashboard into a **photorealistic window to the sky**. The user should "Feel the Time" through atmospheric rendering, particle evolution, and simulation logic.

## Core Directives
- **Atmosphere**: GLSL Sky Shader, Volumetric Fog, Bloom (Implemented).
- **Time**: Decoupled simulation time, Time-Lapse/Fast Forward (Implemented).
- **Weather**: Particle systems for rain/snow/clouds, wind influence (Implemented).

## Implementation Status

### 1. Atmosphere & Lighting (Completed)
- [x] **Sky Upgrade**: `three/addons/objects/Sky.js` implemented with Rayleigh/Mie scattering.
- [x] **Volumetric Fog**: `THREE.FogExp2` with dynamic density based on weather.
- [x] **Post-Processing**: `EffectComposer` with `UnrealBloomPass` for intense sun/moon glow.
- [x] **Lighting**: Dynamic sun/moon intensity and color based on cloud cover and elevation.

### 2. Particle Evolution (Completed)
- [x] **Clouds**: `InstancedMesh` with noise textures and volumetric shader injection.
- [x] **Precipitation**: `RainSystem` and `SnowSystem` using object pooling.
- [x] **Interaction**: Rain splashes on sundial (Collision detection implemented and verified).
- [x] **Wind**: Particles respond to wind speed.
- [x] **Visual Polish**: Rain fades close to camera, correct geometry collision.

### 3. Time Logic (Completed)
- [x] **Decouple Time**: `simulationTime` variable drives sun/moon position.
- [x] **Time-Lapse**: `WARP_SCALE` (1440x) implemented.
- [x] **True Weather Simulation**: Weather conditions interpolated from 24h timeline during fast-forward.

## Next Steps
- [ ] **Performance Tuning**: Monitor FPS on lower-end devices.
- [ ] **Advanced Features**: Seasonal sun altitude adjustments (currently relies on SunCalc which handles this naturally).

## Developer Notes
- `src/weatherLighting.js` handles all lighting transitions.
- `src/weatherEffects.js` manages particle systems.
- `src/astronomy.js` handles celestial positioning.
