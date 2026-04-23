# Copilot Instructions for Weather Clock

This file documents essential context for Copilot sessions working on the `weather_clock` repository.

---

## Quick Commands

### Build & Run
```bash
npm install              # Install dependencies
npm run dev             # Start dev server (http://localhost:5173)
npm run build           # Production build → dist/
npm run preview         # Preview built output locally
```

### Testing
```bash
npm test                                    # Run all unit tests
npm test -- src/tests/astronomy.test.js   # Run single test file
npm test -- --reporter=verbose            # Verbose output
```

### Visual Verification
Requires dev server running (`npm run dev` in another terminal):
```bash
pip install playwright && playwright install  # One-time setup
python3 verification/verify_weather.py
python3 verification/verify_date_display.py
python3 verification/verify_scene.py
```

---

## Project Overview

**Weather Clock** ("The Aether Architect") is a photorealistic 3D weather visualization built with **Three.js** and **vanilla JavaScript**. It combines:

- **Real-time weather data** from Open-Meteo API (free, no auth required)
- **Astronomical calculations** (sun/moon positions, phases, twilight) via SunCalc
- **Particle effects** (rain, snow, clouds) using WebGL and shader-based rendering
- **Time simulation** with optional time-warp (24-hour cycle in 60 seconds)

The app has two modes:
1. **Clock Mode** — 3D sundial with surrounding sky and overlaid weather panels
2. **Timeline Mode** — 21-day horizontal timeline of weather columns (toggle with `T`)

---

## Architecture: Big Picture

### Layers

| Layer | Key Files | Responsibility |
|-------|-----------|-----------------|
| **Initialization** | `main.js` | Orchestrates setup: creates scene, services, UI, and kicks off animation loop. Central `state` object holds simulation time and weather data. |
| **3D Rendering** | `rendering.js`, `lights.js`, `scene-objects.js` | WebGL renderer setup, camera, lights (sun/moon/ambient), EffectComposer for bloom/HDR. |
| **Astronomy** | `astronomy.js`, `moonPhase.js` | Wraps SunCalc to compute sun/moon positions and illumination. Converts spherical coords (azimuth/altitude) to Three.js Cartesian. |
| **Weather Data** | `weather.js` | `WeatherService` fetches Open-Meteo forecast + archive. Builds hourly timeline. Handles geolocation/search and unit conversion. |
| **Weather Interpolation** | `weather-simulation.js` | `getWeatherAtTime()` interpolates past/current/forecast from hourly timeline. `getActiveWeatherData()` returns snapshot for display. |
| **Visuals** | `weatherEffects.js`, `weatherLighting.js`, `shaders.js` | Particle systems (rain, snow, clouds, wind dust, stars, lightning). Sky shader (Rayleigh/Mie scattering). Dynamic lighting based on time and weather. |
| **Animation Loop** | `animation.js` | `AnimationController` drives `requestAnimationFrame`. Advances `simulationTime`, throttles UI updates, handles time-warp mode. |
| **UI** | `ui.js` | DOM updates: time/date displays, weather panels, unit toggles, search, sparkline canvas, pressure gauge, toasts, keyboard shortcuts. |
| **Modes** | `ModeController.js` | Switches between Clock and Timeline views. Manages camera animation. Updates browser history (`?mode=timeline`). |
| **Timeline Subsystem** | `src/timeline/` | Manages 21-day 3D columns, raycasting for interactivity, DOM overlay for details. |

### Data Flow

```
WeatherService.fetchWeather()
  ↓ (builds hourly timeline)
state.weatherData
  ↓
AnimationController.update()
  ├→ getActiveWeatherData(simulationTime)
  ├→ updateWeatherLighting()    [colors, intensities]
  └→ weatherEffects.update()    [particles]
  ↓
renderer.render()
```

### Time Decoupling (Critical)

- `state.simulationTime` is a `Date` independent of system time
- Normal mode: advances 1:1 with real time
- Time-warp mode: accelerates 1440x (24 hours in 60 seconds)
- Weather interpolation ensures smooth transitions as `simulationTime` moves through the hourly timeline
- Debug: `window.setDebugTime(14.5)` jumps to 2:30 PM

---

## Key Conventions & Patterns

### 1. **ES Modules Only**
- All source uses native `import`/`export` (no CommonJS)
- `"type": "module"` in `package.json`

### 2. **Configuration Constants**
Magic numbers are centralized in module-level config objects:
```javascript
const RENDERING_CONFIG = { ... };
const LIGHTS_CONFIG = { ... };
const SKY_CONFIG = { ... };
const ANIMATION_CONFIG = { ... };
const UI_CONFIG = { ... };
```
Avoid hardcoding values. Add to config if needed.

### 3. **Three.js Memory Management**
- When replacing a geometry/material/texture, **dispose of the old one**
- `geometry.dispose()`, `material.dispose()`, `texture.dispose()`
- Failure to dispose causes WebGL memory leaks

### 4. **Particle Performance: Object Pooling**
- **Never** repeatedly `new` and `dispose` particles in the render loop
- Use `InstancedMesh` for clouds (reuses geometry across instances)
- Rain/snow systems use object pooling with reset semantics
- Example: `cloud.instance.setMatrixAt(index, matrix)` then `updateMatrix()`

### 5. **Animation: requestAnimationFrame Only**
- Use `requestAnimationFrame` for render-related updates
- **Never** use `setInterval` for animation or visual updates
- Exception: event listeners and one-time async operations OK outside loop

### 6. **Shadows**
- New 3D objects should set `castShadow = true` / `receiveShadow = true` where appropriate
- Check `lights.js` for shadow map configuration (size, bias, frustum)

### 7. **Weather Codes → Visual Effects**
Weather codes from Open-Meteo are mapped to visual conditions:
- `0` = Clear
- `45/48` = Fog
- `51–67` = Drizzle/Rain
- `71–77` = Snow
- `80–82` = Showers
- `85–86` = Snow showers
- `95–99` = Thunderstorm

Debug mode to force a code: `window.setDebugWeather(65)` (Heavy Rain)

### 8. **Lighting Blend (Not Simple)**
Lighting is **not** driven by a single data point:
- Past (20%) + Current (50%) + Forecast (30%) weighted average
- Blends color (LERP) and intensity based on Severity and Cloud Cover
- Also accounts for Day/Night cycle (sun altitude)
- Set in `weatherLighting.js`, **not** in `astronomy.js`
- **Important:** Do NOT set `sunLight.position` in `weatherLighting.js`; position is handled in `astronomy.js`

### 9. **Coordinate System Mapping**
SunCalc uses spherical coordinates (Azimuth/Altitude) → converted to Cartesian in `astronomy.js`:
- Azimuth 0° (South) maps to Z-
- Azimuth 90° (East) maps to X+
- Azimuth 270° (West) maps to X-
- North is Z+

### 10. **Shaders Are Modular**
All GLSL shader code lives in `shaders.js`:
- Sky shader (Rayleigh/Mie scattering)
- Rain shader
- Cloud material shader
- Keep shaders there, not scattered across files

### 11. **DOM/CSS: Vanilla Only**
- No React, Vue, or other UI frameworks
- Use vanilla DOM: `document.querySelector()`, `.textContent =`, `.addEventListener()`
- CSS only (no CSS-in-JS)

### 12. **Module Boundaries: Single Responsibility**
Each module has one job:
- `main.js` = orchestrator
- `astronomy.js` = celestial math
- `weather.js` = data fetching + state
- `weatherEffects.js` = particle systems
- `weatherLighting.js` = lighting logic
- etc.

Do not make a module do multiple things; refactor instead.

---

## Common Pitfalls & Hotspots

### Hotspot 1: Particle Boundary Wrapping (weatherEffects.js)
Particles have strict zone boundaries (Past/Present/Future). If you modify particle movement:
- Ensure `position.x` wrapping uses zone boundaries (`zone.minX`, `zone.maxX`)
- Particles must NOT leak between zones
- Example: a rain drop in Past zone must wrap back to left of Past, not into Present

### Hotspot 2: Sky Shader Constants
The sky shader uses hardcoded scattering coefficients for Rayleigh and Mie. Tuning these affects:
- Overall sky color
- Sunset/sunrise appearance
- Horizon intensity
- Located in `shaders.js` under `createSkyMaterial()`

### Hotspot 3: Time Interpolation Edge Cases
`getWeatherAtTime()` interpolates between hourly points. Edge cases:
- When `simulationTime` is before oldest data → uses oldest
- When after newest → uses newest
- During time-warp, ensure interpolation is smooth (not jumpy)

### Hotspot 4: Camera and Mode Switching
`ModeController` transitions camera between Clock and Timeline modes. Ensure:
- Camera animations complete before rendering changes
- Browser history updates correctly (`pushState`)
- UI visibility toggles don't flicker

### Hotspot 5: Geolocation Fallback
If browser geolocation fails (e.g., not HTTPS, user denies), the app falls back to NYC (40.7128, -74.0060). Be aware when testing with mock locations.

---

## Testing Strategy

### Unit Tests (Vitest)
```bash
npm test  # Run all
npm test -- src/tests/astronomy.test.js  # Run one file
```

**What's tested:**
- Sun/moon position calculations (astronomy.test.js)
- Weather state transitions, unit conversion, code mapping (weather.test.js)
- Mocked `fetch` and `navigator.geolocation`

**Before committing:** Always run `npm test`.

### Visual Verification (Python + Playwright)
```bash
# Requires dev server running
python3 verification/verify_weather.py
python3 verification/verify_date_display.py
python3 verification/verify_scene.py
```

Screenshots are saved in `verification/` folder for manual comparison and regression tracking.

### Interactive Debug Mode
Open browser console and use:
```javascript
window.setDebugWeather(65);        // Force Heavy Rain
window.setDebugTime(14.5);         // Jump to 2:30 PM
window.aetherDebug.getSimulationTime();
window.aetherDebug.getWeatherData();
window.aetherDebug.getSunPosition();
window.aetherDebug.getMoonPosition();
```

---

## Security Notes

- **`deploy.py` contains hardcoded SFTP credentials.** Do not run blindly or commit modified versions with exposed secrets.
- User data (location, units) stored in `localStorage`:
  - `weatherclock_lat`, `weatherclock_lon`, `weatherclock_location`
  - `weatherclock_unit`, `weatherclock_wind_unit`
- App fetches from Open-Meteo and Nominatim over HTTPS; no API keys required.

---

## File Structure Reference

```
src/
├── main.js                   # Orchestrator: init() & animate() loop
├── rendering.js              # Scene, renderer, camera, bloom effects
├── lights.js                 # Sun/moon/ambient lighting + shadows
├── scene-objects.js          # Factory functions for sky, sundial, moon, effects
├── animation.js              # AnimationController (requestAnimationFrame loop)
├── astronomy.js              # AstronomyService (SunCalc wrapper)
├── moonPhase.js              # Moon phase calculations & visual mesh
├── weather.js                # WeatherService (fetch, state mgmt)
├── weather-simulation.js     # Time-based interpolation & snapshots
├── weatherEffects.js         # Particle systems (rain, snow, clouds, etc)
├── weatherLighting.js        # Dynamic lighting based on weather & time
├── shaders.js                # GLSL shader definitions
├── sundial.js                # 3D geometry & hands update
├── ui.js                     # DOM manipulation & keyboard shortcuts
├── debug.js                  # Runtime inspection hooks
├── ModeController.js         # Clock ↔ Timeline mode switching
├── vendor/suncalc.js         # SunCalc (ES module version)
├── timeline/                 # Timeline mode subsystem
│   ├── TimelineController.js
│   ├── TimelineUI.js
│   ├── DayColumn.js
│   ├── TimelineData.js
│   ├── AnomalyCalculator.js
│   └── index.js
└── tests/
    ├── astronomy.test.js
    └── weather.test.js

verification/                # Python + Playwright visual tests
├── verify_weather.py
├── verify_date_display.py
└── verify_scene.py
```

---

## When Adding Features

### Add a New Weather Effect
1. Define particle behavior in `weatherEffects.js`
2. Create shader if needed in `shaders.js`
3. Map weather code in `weather.js` if introducing new codes
4. Add test case in `verification/`
5. Test with `window.setDebugWeather(code)` in browser console

### Modify Sky Appearance
1. Edit GLSL in `weatherLighting.js` or `shaders.js`
2. Adjust scattering coefficients for different atmospheric conditions
3. Test across day/night with `window.setDebugTime()`
4. Visual verification: `npm run dev` + screenshot comparison

### Improve Performance
1. Profile with DevTools (`chrome://inspect`)
2. Check particle count (`InstancedMesh` limits)
3. Optimize shader complexity (reduce texture lookups, branching)
4. Consider LOD (Level of Detail) for far-away elements

---

## External Resources

- [Three.js Docs](https://threejs.org/docs/)
- [SunCalc](https://github.com/mourner/suncalc)
- [Open-Meteo API](https://open-meteo.com/en/docs)
- [GLSL Shader Guide](https://www.khronos.org/opengl/wiki/OpenGL_Shading_Language)

