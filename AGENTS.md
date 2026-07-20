<!-- From: /root/weather_clock/AGENTS.md -->
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

The app has three viewing modes:
1. **Clock Mode** — A 3D sundial with analog hands, surrounding sky, and overlaid weather panels.
2. **Timeline Mode** — A 21-day horizontal timeline of weather columns. Toggle with the button in the top-right or press `T`.
3. **10-Day Forecast View** — Strip of 10 daily vignette cards (2D previews) + click-to-focus live 3D scene with date-specific astronomy, wind, clouds, and precipitation. Time-of-day scrubber per day. Cycle modes with the top-right button.

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
| **Visual Testing** | Python + Playwright + Pillow | Unified suite in `verification/suite/` |

---

## File Structure

### Root
- `index.html` — Entry point. Loads Three.js via an import map and mounts `src/main.js`.
- `package.json` — NPM manifest with Vite/Vitest scripts.
- `deploy.py` — Authenticated bundle deployment script. Configuration comes from environment variables or a gitignored `deploy.config.json`.
- `docs/ROADMAP.md` — Living project roadmap; links to the open GitHub issues that own planned work.

### Source (`src/`)
| File | Responsibility |
|------|----------------|
| `main.js` | Application orchestrator. Sets up state, rendering, lights, scene objects, services, animation loop, UI callbacks, mode controller, and debug API. |
| `rendering.js` | Scene/camera setup, quality tiers, renderer recovery, and the shared interface to the dual WebGL/WebGPU pipeline. |
| `lights.js` | Ambient light, directional sun light, directional moon light; shadow map configuration. |
| `scene-objects.js` | Factory functions for the `Sky` object, sundial, moon group, and weather effects. |
| `animation.js` | `AnimationController` class. Drives the `requestAnimationFrame` loop, advances `simulationTime`, handles time-warp, throttles UI updates. |
| `ui.js`, `ui/` | DOM-facing facade plus focused modules for time/date, weather panels, search, gauges, sparklines, toasts, shortcuts, and event listeners. |
| `weather-simulation.js` | Weather interpolation over the hourly timeline (`getWeatherAtTime`), plus `getActiveWeatherData` for past/current/forecast snapshots. |
| `weather.js` | `WeatherService` class. Fetches Open-Meteo forecast and archive data, builds hourly timelines, handles geolocation/search, unit conversion, and advanced analytics. Forecast accuracy remains an explicit no-data placeholder. |
| `astronomy.js` | `AstronomyService` class. Wraps SunCalc to compute sun/moon positions and illumination, converting spherical coordinates to Three.js Cartesian. |
| `effects/weather-effects.js`, `effects/` | Weather-effect coordinator plus pooled rain, snow, dust, cloud, fog, star, and splash systems. |
| `weatherLighting.js` | `updateWeatherLighting()` — calculates day/night factor, weighted cloud cover, severity, fog density, sky shader uniforms, and smoothly interpolates sun/moon/ambient colors and intensities. |
| `shaders.js` | GLSL shader strings used by rain and cloud materials. |
| `sundial.js` | 3D sundial geometry (base, clock face, hour markers, gnomon, analog hands) with an `update(time)` method. |
| `moonPhase.js` | Moon phase math and visual moon mesh creation. |
| `atmosphereTheme.js` | Updates CSS custom properties (`--accent`, `--glow`, `--trend-glow`, etc.) based on time of day and weather severity. |
| `debug.js` | Exposes `window.setDebugWeather(code)`, `window.setDebugTime(hour)`, and `window.aetherDebug` for runtime inspection. |
| `ModeController.js`, `modes/` | Mode orchestration, adapters, camera transitions, UI visibility, and browser history for Clock, Timeline, and Forecast modes. |
| `forecast/` | ForecastController + ForecastUI + DailyPreview (2D). New mode for immersive future-day vignettes. |
| `webgpu/` | Renderer capability detection/factory, WebGL and WebGPU post-processing adapters, and TSL/WebGPU material adapters. WebGL remains the fallback. |
| `vendor/suncalc.js` | Vendored SunCalc library patched for ES module compatibility. |

### Timeline Subsystem (`src/timeline/`)
- `TimelineController.js` — Manages 21-day 3D column visualization, raycasting, hover/selection states.
- `TimelineUI.js` — DOM overlay for timeline details.
- `DayColumn.js` — Individual 3D column representing one day, with custom GLSL temperature-gradient shaders.
- `TimelineData.js` — Fetches and caches timeline weather data from Open-Meteo.
- `AnomalyCalculator.js` — Computes weather anomalies (z-scores) for the timeline.
- `index.js` — Re-exports.
- `timeline.css` — Style entry point; imports the split timeline core and overlay styles.

### Tests (`src/tests/`)
- Unit tests cover astronomy, weather, forecast logic, rendering quality/recovery, weather effects, and lighting.

### Shaders (`shaders/`)
- Experimental WGSL compute shaders: `rain-compute.wgsl`, `snow-compute.wgsl`, `splash-compute.wgsl`, `cloud-post.wgsl`, `star-field.wgsl`.
- They are not the active WebGPU path. Runtime WebGPU support lives under `src/webgpu/`; WebGL shader strings remain in `src/shaders.js`. Do not wire the standalone WGSL files into production unless explicitly working on issue #87.

### Visual Verification (`verification/suite/`)
- `run_all.py` is the only committed visual/smoke runner.
- `baselines/` contains the reviewed screenshots used for comparison.
- `current/` and `diffs/` are generated locally and ignored by git.
- The runner covers the canonical weather/time screenshots plus UI/debug readiness and forecast-mode smoke checks.

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

python3 verification/suite/run_all.py
```

Use `VISUAL_UPDATE=1 python3 verification/suite/run_all.py` to replace reviewed baselines intentionally. Normal runs write generated images under `verification/suite/current/` and mismatch images under `verification/suite/diffs/`.

Use `python3 verification/suite/run_all.py --smoke-only` for a quick browser check of app readiness, debug hooks, and forecast-mode state without screenshot comparisons.

---

## Code Style Guidelines

- **ES Modules:** All source code uses native `import`/`export`. Do not use CommonJS.
- **Module Boundaries:** Each module has a single responsibility. `main.js` is the orchestrator; implementation details live in feature modules.
- **Configuration Constants:** Magic numbers are centralized in module-level config objects (e.g., `RENDERING_CONFIG`, `LIGHTS_CONFIG`, `SKY_CONFIG`, `ANIMATION_CONFIG`, `UI_CONFIG`, `TIMELINE_CONFIG`).
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
   - Run `python3 verification/suite/run_all.py`.
   - Inspect generated screenshots and diffs for regressions in sky color, weather effects, forecast mode, and UI layout.

3. **Interactive Debug Mode**
   - Open the browser console on `http://localhost:5173` and use:
     ```javascript
     window.setDebugWeather(65);   // Force Heavy Rain (0 = Clear, 71 = Snow, 95 = Thunderstorm)
     window.setDebugTime(14.5);    // Jump to 2:30 PM
     window.aetherDebug.getSimulationTime();
     window.aetherDebug.getWeatherData();
     window.aetherDebug.getSunPosition();
     window.aetherDebug.getMoonPosition();
     ```

---

## Security Considerations

- Deployment credentials must be supplied through environment variables or a gitignored `deploy.config.json`; never commit live tokens or server credentials.
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
3. `AnimationController.update()` passes the active weather to `updateWeatherLighting()` and the coordinator in `effects/weather-effects.js`.
4. `weatherLighting.js` computes severity, cloud weighting, and smoothly transitions colors/intensities over ~5 seconds.

### Three Temporal Zones
The scene is visually divided into three time-offset zones:
- **Past (Left):** `x: -8` — weather from ~3 hours ago
- **Present (Center):** `x: 0` — current weather
- **Future (Right):** `x: 8` — weather from ~3 hours ahead

Particle systems (rain, snow) are constrained to zone boundaries. When modifying particle physics, ensure position wrapping uses the zone's `minX`/`maxX` bounds, not global bounds, or weather will "leak" between time periods.

Lighting is a weighted blend of all three zones: Past (20%), Current (50%), Forecast (30%). Do not set `sunLight.position` in `weatherLighting.js`; position is handled exclusively by `astronomy.js`.

### Coordinate Systems
`SunCalc` uses spherical coordinates (azimuth/altitude). These are converted to Three.js Cartesian in `astronomy.js`. Azimuth 0° (South) maps to Z-, meaning North is Z+.

### Cloud System
`CloudSystem` uses `THREE.InstancedMesh` with procedurally generated canvas textures (`cumulus`, `stratus`, `cirrus`). Each cloud is composed of multiple puffs arranged in dome, sheet, or streak formations. Clouds billboard toward the camera and drift horizontally with wind.

### Precipitation & Collision
- **Rain:** `LineSegments` with a custom shader. Drops reset when they fall below the ground or collide with the sundial geometry (face, base top, or base slope).
- **Snow:** `Points` with curl-noise turbulence.
- **Splashes:** Small particle bursts spawn on the sundial surface when raindrops hit.

### Mode Switching
`ModeController` and the adapters in `src/modes/` coordinate Clock, Timeline, and Forecast mode transitions. Browser history keeps `?mode=timeline` and `?mode=forecast` shareable. Press `T` to cycle modes, `Esc` to return to Clock mode, and `ArrowLeft`/`ArrowRight` to toggle edge drawers.

### Known Limitations
- **Forecast accuracy placeholder:** `WeatherService.getPredictionAccuracy()` and `TimelineData.enrichWithAccuracy()` return no data. Real forecast verification via the Open-Meteo Previous Runs API is planned but not yet implemented.
- **Hardcoded zone offsets:** The visual separation of temporal zones relies on hardcoded X offsets (e.g., `-8`, `0`, `8`) in multiple files. Changing scene scale requires updating these values consistently.

---

## Cursor Cloud specific instructions

Node dependencies are refreshed automatically on startup (`npm install`), so the standard commands in **Build and Test Commands** (`npm run dev`, `npm test`, `npm run lint`, `npm run build`) work out of the box. `npm run dev` serves the app on `http://localhost:5173`; the repo's `.cursor/environment.json` auto-starts it and exposes port **5173** (not the noVNC desktop on 26058). Vite is configured with `server.host: true` so IPv4 port forwarding works.

- **Full CI parity locally:** the CI pipeline runs `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test -- --run`, `npm run build`, and `npm run check:bundle-size`. Run these before committing to match CI.
- **Weather test noise is expected:** `npm test` prints `stderr` warnings about failed/offline fetches for the caching-fallback tests — these are mocked failures, and the suite still passes.
- **Visual regression is optional and NOT covered by the update script.** It needs the dev server running plus a one-time extra setup: `pip install playwright Pillow` and `python3 -m playwright install chromium`. Then run `python3 verification/suite/run_all.py` (or `--smoke-only` for a fast headless check with no screenshot comparison). Baselines were captured on other hardware, so full screenshot comparisons may report GPU/font-driven diffs in this environment; prefer `--smoke-only` for a quick health check.
- **Harmless headless-GL console noise:** in headless Chromium the app logs a `favicon.ico` 404 and `WebGL: INVALID_ENUM: readPixels` / GPU-stall warnings. These do not affect functionality — the 3D scene, weather effects, and mode switching all render correctly.
- **Runtime data needs network:** the app fetches live weather from Open-Meteo and geocoding from Nominatim over HTTPS (no API key). If egress is blocked, live weather/search will fail; use the debug hooks (`window.setDebugWeather(code)`, `window.setDebugTime(hour)`) to exercise the scene offline.
