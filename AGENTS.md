# AGENTS.md

## Scope
This file applies to the entire `weather_clock` repository.

---

## Project Overview

`weather_clock` is a **photorealistic 3D weather clock** built with **Three.js** and **vanilla JavaScript**. It renders a dynamic sky environment that evolves in real-time based on:

- **Local weather data** — fetched from the [Open-Meteo API](https://open-meteo.com/) (free, no API key required).
- **Astronomical calculations** — sun position, moon phases, and twilight transitions via [SunCalc](https://github.com/mourner/suncalc).
- **Particle effects** — rain, snow, wind dust, volumetric-style clouds, stars, and lightning.
- **Time simulation** — runs on a decoupled `simulationTime` with an optional time-warp feature (24-hour cycle in 60 seconds).

The app has two viewing modes:
1. **Clock Mode** — A 3D sundial with analog hands, surrounding sky, and overlaid weather panels.
2. **Timeline Mode** — A 21-day horizontal timeline of weather columns. Toggle with the button in the top-right or press `T`.

---

## Technology Stack

| Layer | Technology | Version / Notes |
|-------|------------|-----------------|
| **Language** | Vanilla JavaScript (ES modules) | `"type": "module"` in `package.json` |
| **3D Engine** | Three.js | `^0.181.2` |
| **Build Tool** | Vite | `^7.2.4` |
| **Unit Tests** | Vitest | `^3.2.4` |
| **Astronomy** | SunCalc | Vendored as ES module in `src/vendor/suncalc.js` |
| **Weather Data** | Open-Meteo API | Forecast + Archive endpoints |
| **Geocoding** | Nominatim (OpenStreetMap) | Used for search & reverse geocoding |
| **Visual Testing** | Python + Playwright | Scripts in `verification/` |

---

## File Structure

### Root
- `index.html` — Entry point. Loads Three.js via an import map and mounts `src/main.js`.
- `package.json` — NPM manifest with Vite/Vitest scripts.
- `deploy.py` — **Security note:** Paramiko SFTP deployment script containing hardcoded server credentials.

### Source (`src/`)
| File | Responsibility |
|------|----------------|
| `main.js` | Application orchestrator. Sets up state, rendering, lights, scene objects, services, animation loop, UI callbacks, and debug API. |
| `rendering.js` | Scene, WebGL renderer, perspective camera, `EffectComposer` + `UnrealBloomPass`, `OrbitControls`, window resize handling. |
| `lights.js` | Ambient light, directional sun light, directional moon light; shadow map configuration. |
| `scene-objects.js` | Factory functions for the `Sky` object, sundial, moon group, and weather effects. |
| `animation.js` | `AnimationController` class. Drives the `requestAnimationFrame` loop, advances `simulationTime`, handles time-warp, throttles UI updates. |
| `ui.js` | All DOM manipulation: time/date displays, weather panel updates, unit toggle, search box, sparkline canvas, pressure gauge, toasts, keyboard shortcuts. |
| `weather-simulation.js` | Weather interpolation over the hourly timeline (`getWeatherAtTime`), plus `getActiveWeatherData` for past/current/forecast snapshots. |
| `weather.js` | `WeatherService` class. Fetches Open-Meteo forecast and archive data, builds hourly timeline, handles geolocation/search, unit conversion, and advanced analytics (historical year-ago, regional offsets, accuracy mock). |
| `astronomy.js` | `AstronomyService` class. Wraps SunCalc to compute sun/moon positions and illumination, converting spherical coordinates to Three.js Cartesian. |
| `weatherEffects.js` | Particle systems: `RainSystem`, `SnowSystem`, `WindDustSystem`, `CloudSystem` (`InstancedMesh` with cumulus/stratus/cirrus types), `StarField`, splash effects, and lightning flashes. |
| `weatherLighting.js` | `updateWeatherLighting()` — calculates day/night factor, weighted cloud cover, severity, fog density, sky shader uniforms, and smoothly interpolates sun/moon/ambient colors and intensities. |
| `shaders.js` | GLSL shader strings used by rain and cloud materials. |
| `sundial.js` | 3D sundial geometry (base, clock face, hour markers, gnomon, analog hands) with an `update(time)` method. |
| `moonPhase.js` | Moon phase math and visual moon mesh creation. |
| `debug.js` | Exposes `window.setDebugWeather(code)`, `window.setDebugTime(hour)`, and `window.aetherDebug` for runtime inspection. |
| `ModeController.js` | Manages switching between Clock and Timeline modes, camera animations, UI visibility toggles, and browser history (`?mode=timeline`). |

### Timeline Subsystem (`src/timeline/`)
- `TimelineController.js` — Manages 21-day 3D column visualization, raycasting, hover/selection states.
- `TimelineUI.js` — DOM overlay for timeline details.
- `DayColumn.js` — Individual 3D column representing one day.
- `TimelineData.js` — Fetches and caches timeline weather data.
- `AnomalyCalculator.js` — Computes weather anomalies for the timeline.
- `index.js` — Re-exports.
- `timeline.css` — Styles for timeline UI.

### Tests (`src/tests/`)
- `astronomy.test.js` — Validates sun/moon position calculations.
- `weather.test.js` — Validates `WeatherService` initialization, unit conversion, and description mapping.

### Visual Verification (`verification/`)
Python + Playwright scripts for screenshot-based regression testing:
- `verify_weather.py`, `verify_date_display.py`, `verify_scene.py`, `verify_sky.py`, `verify_night.py`, `verify_sunny.py`, `verify_changes.py`, etc.

---

## Build and Test Commands

```bash
# Install dependencies
npm install

# Start development server (http://localhost:5173)
npm run dev

# Production build — output goes to dist/
npm run build

# Preview production build locally
npm run preview

# Run unit tests (Vitest)
npm test
```

### Visual Regression Tests
Requires the dev server to be running (`npm run dev` in another terminal) and Python with Playwright installed:

```bash
pip install playwright
playwright install

python3 verification/verify_weather.py
python3 verification/verify_date_display.py
python3 verification/verify_scene.py
```

Screenshots are saved into `verification/` for manual comparison.

---

## Code Style Guidelines

- **ES Modules:** All source code uses native `import`/`export`. Do not use CommonJS.
- **Module Boundaries:** Each module has a single responsibility. `main.js` is the orchestrator; implementation details live in feature modules.
- **Configuration Constants:** Magic numbers are centralized in module-level config objects (e.g., `RENDERING_CONFIG`, `LIGHTS_CONFIG`, `SKY_CONFIG`, `ANIMATION_CONFIG`, `UI_CONFIG`).
- **Animation:** Use `requestAnimationFrame` only. Never use `setInterval` for render-related logic.
- **Memory Management:** When modifying Three.js objects, dispose of geometries, materials, and textures that are being replaced to avoid WebGL memory leaks.
- **Particle Performance:** The app relies on object pooling and `InstancedMesh` for clouds. Do not repeatedly `new` and `dispose` particle objects in the render loop.
- **Shadows:** New 3D objects should `castShadow = true` / `receiveShadow = true` where appropriate.
- **DOM/CSS:** Vanilla DOM and CSS only. No React, Vue, or other UI frameworks.

---

## Testing Instructions

1. **Unit Tests**
   - Run `npm test` before committing.
   - Tests are in `src/tests/` and use Vitest with mocked `fetch` and `navigator.geolocation`.

2. **Visual Verification**
   - Start the dev server: `npm run dev`
   - Run the Python verification scripts in `verification/`.
   - Inspect generated screenshots for regressions in sky color, weather effects, and UI layout.

3. **Interactive Debug Mode**
   - Open the browser console on `http://localhost:5173` and use:
     ```javascript
     window.setDebugWeather(65);   // Force Heavy Rain (0 = Clear, 71 = Snow, 95 = Thunderstorm)
     window.setDebugTime(14.5);    // Jump to 2:30 PM
     window.aetherDebug.getSimulationTime();
     window.aetherDebug.getWeatherData();
     window.aetherDebug.getSunPosition();
     ```

---

## Security Considerations

- **`deploy.py` contains hardcoded SFTP credentials.** Do not run this script blindly, and do not commit modified versions that expose secrets.
- The app fetches data from external APIs (Open-Meteo, Nominatim) over HTTPS. No API keys are required.
- User location and unit preferences are stored in `localStorage` under the keys:
  - `weatherclock_lat`
  - `weatherclock_lon`
  - `weatherclock_location`
  - `weatherclock_unit`
  - `weatherclock_wind_unit`

---

## Architecture Notes for Agents

### Time Decoupling
`state.simulationTime` (a `Date` object) is independent of the system clock. In normal mode it advances 1:1 with real time. In time-warp mode it accelerates by `1440x` (24 hours in 60 seconds). Weather interpolation in `weather-simulation.js` ensures smooth transitions as `simulationTime` moves through the hourly timeline.

### Weather State Pipeline
1. `WeatherService.fetchWeather()` retrieves forecast + archive data and builds an hourly `timeline` array.
2. `getActiveWeatherData(simulationTime, weatherData)` interpolates past, current, and forecast points from the timeline.
3. `AnimationController.update()` passes the active weather to `updateWeatherLighting()` and `weatherEffects.update()`.
4. `weatherLighting.js` computes severity, cloud weighting, and smoothly transitions colors/intensities over ~5 seconds.

### Cloud System
`CloudSystem` uses `THREE.InstancedMesh` with procedurally generated canvas textures (`cumulus`, `stratus`, `cirrus`). Each cloud is composed of multiple puffs arranged in dome, sheet, or streak formations. Clouds billboard toward the camera and drift horizontally with wind.

### Precipitation & Collision
- **Rain:** `LineSegments` with a custom shader. Drops reset when they fall below the ground or collide with the sundial geometry (face, base top, or base slope).
- **Snow:** `Points` with curl-noise turbulence.
- **Splashes:** Small particle bursts spawn on the sundial surface when raindrops hit.

### Mode Switching
`ModeController` transitions the camera between Clock mode (close-up of the sundial) and Timeline mode (elevated overview of 21-day columns). It updates browser history so `?mode=timeline` is shareable. Press `T` to toggle, `Esc` to return to Clock mode.
