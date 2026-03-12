# Claude Development Guide: Weather Clock

## Project Overview

**The Aether Architect** is a photorealistic 3D weather clock built with Three.js. It renders a dynamic sky environment that evolves in real-time based on:
- **Local weather data** (from Open-Meteo API)
- **Astronomical calculations** (sun position, moon phases, twilight transitions)
- **Particle effects** (rain, snow, clouds, wind interactions)
- **Time simulation** (with optional time-warp for 24-hour cycles)

## Quick Start

```bash
# Install dependencies
npm install

# Start dev server
npm run dev
# Open http://localhost:5173
```

## Project Structure

### Core Source Files (`src/`)
- **`index.html`** - Entry point; loads Three.js scene
- **`main.js`** - Initializes renderer, scene, and animation loop
- **`astronomy.js`** - Sun/moon position calculations (wraps SunCalc)
- **`weather.js`** - Fetches Open-Meteo data and manages weather state
- **`weatherEffects.js`** - Particle system for rain, snow, clouds
- **`weatherLighting.js`** - Sky shaders, lighting, bloom post-processing
- **`moonPhase.js`** - Moon phase calculations and visual rendering
- **`sundial.js`** - Ground plane and sundial geometry
- **`shaders.js`** - GLSL shader definitions (sky scattering, particle shaders)
- **`vendor/suncalc.js`** - Patched SunCalc library (converted to ES modules)

### Test & Verification
- **`src/tests/`** - Unit tests for astronomy and weather modules (Vitest)
- **`verification/`** - Python + Playwright visual regression tests
  - `verify_weather.py` - Tests rain/snow/clear transitions
  - `verify_date_display.py` - Date rendering verification
  - `verify_scene.py` - Full scene composition test

## Key Development Concepts

### 1. **Time Decoupling**
- Simulation time is independent of system time
- `simulationTime` can be fast-forwarded or paused
- Time interpolation ensures smooth transitions between weather states

### 2. **Weather State Machine**
- Weather codes from Open-Meteo API mapped to visual effects
- Smooth 5-second interpolations between weather states prevent visual snapping
- Debug mode: `window.setDebugWeather(code)` forces a specific condition

### 3. **Shader-Based Sky**
- Custom GLSL shader implements Rayleigh and Mie scattering
- Physically accurate atmosphere based on sun angle
- HDR + Bloom for glowing sun and moon

### 4. **Particle Pooling**
- InstancedMesh reuses particle geometry to minimize garbage collection
- Object pooling pattern for rain/snow drops
- Wind vector influences particle trajectories

## Testing & Verification

### Unit Tests
```bash
npm test
```
Tests cover:
- Sun/moon position calculations
- Weather state transitions
- Astronomy calculations (declination, azimuth, etc.)

### Visual Verification
Requires running dev server (`npm run dev`):
```bash
# Install Python dependencies (one-time)
pip install playwright
playwright install

# Run verification tests
python3 verification/verify_weather.py
python3 verification/verify_date_display.py
python3 verification/verify_scene.py
```
Screenshots are saved in `verification/` folder for comparison.

## Debugging in Browser

Open browser console and use:

**Force a weather condition:**
```javascript
window.setDebugWeather(65);  // 65=Heavy Rain, 0=Clear, 71=Snow, etc.
```

**Force a time:**
```javascript
window.setDebugTime(14.5);  // 2:30 PM
```

**Inspect internal state:**
```javascript
window.aetherDebug.getSimulationTime();
window.aetherDebug.getWeatherData();
window.aetherDebug.getSunPosition();
window.aetherDebug.getMoonPosition();
```

## Common Tasks

### Add a New Weather Effect
1. Define particle behavior in `weatherEffects.js`
2. Create shader if needed in `shaders.js`
3. Map weather code in `weather.js`
4. Add test case in `verification/`

### Modify Sky Appearance
1. Edit GLSL in `weatherLighting.js` (sky shader)
2. Adjust scattering coefficients for different atmospheric conditions
3. Test with `window.setDebugTime()` to see effects across day/night

### Improve Performance
1. Profile with DevTools (chrome://inspect)
2. Check particle count and instance limits
3. Optimize shader complexity
4. Consider LOD (Level of Detail) for far-away elements

## Build & Deployment

```bash
# Production build
npm run build

# Preview built output locally
npm run preview
```

Output is in `dist/` folder - ready for deployment to any static host.

## Dependencies

- **Three.js** ^0.181.2 - 3D rendering
- **SunCalc** ^1.9.0 - Astronomy calculations
- **Vite** ^7.2.4 - Build tool
- **Vitest** ^3.2.4 - Unit testing
- **Playwright** (Python) - Visual testing

## Architecture Decisions

- **ES Modules:** All code uses modern JavaScript modules
- **InstancedMesh:** Efficient particle rendering
- **Post-Processing:** EffectComposer for bloom/HDR effects
- **No Framework:** Vanilla Three.js for minimal overhead
- **Open-Meteo API:** Free, no-auth weather data source

## Notes for Contributors

- Keep shader code modular in `shaders.js`
- Use `requestAnimationFrame` for animation - never `setInterval`
- Test weather transitions with debug mode before committing
- Verify visual output matches screenshots in `verification/`
- Comment complex math (especially astronomy calculations)

## Resources

- [Three.js Docs](https://threejs.org/docs/)
- [SunCalc](https://github.com/mourner/suncalc)
- [Open-Meteo API](https://open-meteo.com/en/docs)
- [GLSL Shader References](https://www.khronos.org/opengl/wiki/OpenGL_Shading_Language)
