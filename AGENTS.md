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

| Layer                    | Technology                           | Version / Notes                                                   |
| ------------------------ | ------------------------------------ | ----------------------------------------------------------------- |
| **Language**             | Vanilla JavaScript (ES modules)      | `"type": "module"` in `package.json`                              |
| **3D Engine**            | Three.js                             | `^0.181.2`                                                        |
| **Build Tool**           | Vite                                 | `^7.2.4`                                                          |
| **Unit Tests**           | Vitest                               | `^3.2.4`                                                          |
| **Astronomy**            | SunCalc                              | npm `suncalc`                                                     |
| **Weather Data**         | Open-Meteo API                       | Forecast + Archive endpoints                                      |
| **Geocoding**            | Nominatim (OpenStreetMap)            | Used for search & reverse geocoding                               |
| **PWA / Offline**        | `vite-plugin-pwa` + Workbox          | Precached app shell; runtime caching for Open-Meteo and Nominatim |
| **Visual / E2E Testing** | Playwright Test (`@playwright/test`) | Unified suite in `e2e/`; see `playwright.config.js`               |

---

## File Structure

### Root

- `index.html` — Markup shell. Offline pill bootstrap is an inline module; drawer/tab chrome and `aetherDebug` live in `src/ui/` and `src/debug.js`.
- `package.json` — NPM manifest with Vite/Vitest scripts. `"main"` points at `src/main.js`.
- `deploy.py` — Authenticated bundle deployment script. Configuration comes from environment variables or a gitignored `deploy.config.json`.
- `docs/ROADMAP.md` — Living project roadmap; links to the open GitHub issues that own planned work.
- `docs/WEBGPU_ARCHITECTURE.md` — How the dual WebGL/WebGPU path is split, which class owns which backend, and where the two differ visually.

### Source (`src/`)

| File                                     | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main.js`                                | Application orchestrator. Sets up state, rendering, lights, scene objects, services, animation loop, UI callbacks, mode controller, debug API, offline status, and kiosk/wake-lock mode.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `registerSW.js`                          | Registers the Vite PWA service worker and shows the update-available toast prompt. Skips registration when `?test=1` is present.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `rendering.js`                           | Scene/camera setup, quality tiers, renderer recovery, and the shared interface to the dual WebGL/WebGPU pipeline.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `lights.js`                              | Ambient light, directional sun light, directional moon light; shadow map configuration.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `scene-objects.js`                       | Factory functions for the `Sky` object, sundial, moon group, and weather effects.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `animation.js`                           | `AnimationController` class. Drives the `requestAnimationFrame` loop, advances `simulationTime`, handles time-warp, throttles UI updates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `ui.js`, `ui/`                           | DOM-facing facade plus focused modules for time/date, weather panels, search, gauges, sparklines, toasts, shortcuts, event listeners, and clock chrome (advanced tabs/drawers). |
| `weather-simulation.js`                  | Weather interpolation over the hourly timeline (`getWeatherAtTime`), plus `getActiveWeatherData` for past/current/forecast snapshots.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `weather.js`                             | `WeatherService` class. Fetches Open-Meteo forecast and archive data, builds hourly timelines, handles geolocation/search, unit conversion, and advanced analytics. Forecast accuracy (`getPredictionAccuracy`) compares Previous Runs API predictions against observed temperatures (cached once per day per location) using the shared math in `accuracy.js`.                                                                                                                                                                                                                                                                                                                                           |
| `accuracy.js`                            | Shared forecast-accuracy math used by both `weather.js` (clock mode) and `timeline/TimelineData.js` (timeline mode): mean-absolute-error pairing/gating, MAE+RMSE+skill-vs-persistence scoring, and the once-per-day cache TTL/key suffix — kept in one place so the two modes never compute accuracy differently.                                                                                                                                                                                                                                                                                                                                                                                        |
| `astronomy.js`                           | `AstronomyService` class. Wraps SunCalc to compute sun/moon positions and illumination, converting spherical coordinates to Three.js Cartesian. Also returns the `sunlight`/`moonlight` models from `celestialLighting.js` for the instant it was asked about.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `celestialLighting.js`                   | Pure physical models for the sun/moon light contrast: Earth–Sun distance from orbital elements (SunCalc has no such field) and its ~±3.4% irradiance swing, Allen's lunar brightness law (a half moon is ~1/11th of a full moon, not 1/2), the super/micromoon distance factor, and Kasten–Young atmospheric extinction + reddening. No Three.js, no DOM.                                                                                                                                                                                                                                                                                                                                                 |
| `effects/weather-effects.js`, `effects/` | Weather-effect coordinator plus pooled rain, snow, dust, cloud, fog, star, and splash systems.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `weatherLighting.js`                     | `updateWeatherLighting()` — calculates day/night factor, weighted cloud cover, severity, fog density, sky shader uniforms, and smoothly interpolates sun/moon/ambient colors and intensities. Applies the `celestialLighting.js` models on top of the weather terms, so clock, forecast, and timeline modes all share one lighting formula.                                                                                                                                                                                                                                                                                                                                                               |
| `shaders.js`                             | GLSL shader strings used by rain and cloud materials.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `sundial.js`                             | 3D sundial geometry (base, clock face, hour markers, gnomon, analog hands) with an `update(time)` method.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `moonPhase.js`                           | Moon phase math and the moon mesh/terminator shader. `updateMoonVisuals()` drives the disk's Lommel–Seeliger photometry, earthshine, horizon warmth, and apparent size from the current `MoonlightModel`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `atmosphereTheme.js`                     | Updates CSS custom properties (`--accent`, `--glow`, `--trend-glow`, etc.) based on time of day and weather severity.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `debug.js`                               | Exposes `window.setDebugWeather(code)`, `window.setDebugTime(hour)`, and `window.aetherDebug` for runtime inspection.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `ModeController.js`, `modes/`            | Mode orchestration, adapters, camera transitions, UI visibility, and browser history for Clock, Timeline, and Forecast modes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `forecast/`                              | ForecastController + ForecastUI + DailyPreview (2D). New mode for immersive future-day vignettes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `capture/`                               | Photo mode + time-lapse export. `photo.js` renders one frame at 2× pixel ratio and captures it via same-task `canvas.toBlob()` (no `preserveDrawingBuffer`), composites a caption strip (`caption.js`), and shares/downloads (`share.js`). `timelapse.js` records a deterministic 00:00→24:00 sweep (720 fixed-timestep frames) via `MediaRecorder` on `canvas.captureStream()`. Shortcuts: `P` = photo, `L` = time-lapse (hidden under reduced motion). `ModeController.setLocked()` blocks mode switching while recording.                                                                                                                                                                              |
| `webgpu/`                                | Renderer capability detection/factory, WebGL and WebGPU post-processing adapters, and TSL/WebGPU material adapters. WebGL remains the fallback. Rain/snow/splash are the exception: they are separate per-backend classes, not dual-material adapters — see `docs/WEBGPU_ARCHITECTURE.md`.                                                                                                                                                                                                                                                                                                                                                                                                                |
| `sky/`                                   | Night-sky astronomy, all pure math with no Three.js: `celestialCoordinates.js` (Julian dates, sidereal time, IAU 1976 precession, equatorial↔ecliptic with the obliquity of date, and the single rotation matrix that maps the whole equatorial catalog into the scene frame), `starCatalog.js` (~190 bright stars at J2000 plus 37 stylized constellation figures and B–V→RGB tinting), `planets.js` (JPL approximate Keplerian elements for Mercury–Neptune, geocentric RA/Dec and apparent magnitude, accurate to well under 1°), and `zodiac.js` (the twelve signs, a truncated ELP-2000 lunar longitude, the Lahiri ayanamsa, and tropical/sidereal sign assignment for the Sun, Moon, and planets). |
| `effects/star-field.js`                  | The night-sky layer. Real stars in true positions, constellation lines, and the naked-eye planets, all parented to one group whose matrix carries observer latitude + local sidereal time — so per-star alt/az is never recomputed. Fades with twilight, cloud cover, and a light-pollution knob; constellations/labels toggle with `C`. Owns the zodiac overlay as a child of the same group.                                                                                                                                                                                                                                                                                                            |
| `effects/zodiac-overlay.js`              | The optional zodiacal band: the ecliptic as a thin arc, a tick at each of the twelve sign cusps, and a glyph beside each slice, with the Sun's and Moon's signs lit brighter. Parents into the star field's `skyGroup`, so one rotation carries it and the planets land on its line for free. Off by default; `Z` cycles off → tropical → sidereal.                                                                                                                                                                                                                                                                                                                                                       |
| `effects/text-sprite.js`                 | Shared canvas-texture label sprite used by the star field's planet/constellation names and the zodiac glyphs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

### Timeline Subsystem (`src/timeline/`)

- `TimelineController.js` — Manages 21-day 3D column visualization, raycasting, hover/selection states.
- `TimelineUI.js` — DOM overlay for timeline details.
- `DayColumn.js` — Individual 3D column representing one day, with custom GLSL temperature-gradient shaders.
- `TimelineData.js` — Fetches and caches timeline weather data from Open-Meteo. `enrichWithAccuracy()` scores historical days against the Open-Meteo Previous Runs API's one-day-ahead forecast (MAE/RMSE/skill vs. a persistence baseline, via the shared `../accuracy.js` math, cached once per day per location), populating `day.accuracy` for the timeline's accuracy rings and detail panel when coverage exists.
- `AnomalyCalculator.js` — Computes weather anomalies (z-scores) for the timeline.
- `index.js` — Re-exports.
- `timeline.css` — Style entry point; imports the split timeline core and overlay styles.

### Tests (`src/tests/`)

- Unit tests cover astronomy, weather, forecast logic, rendering quality/recovery, weather effects, and lighting.
- `zodiac.test.js` cross-checks the zodiac layer the same way: the Sun reaching λ=0/90/180/270 within arcminutes of the published 2024 equinox and solstice instants, the Moon against Meeus' worked example 47.a and against SunCalc's independent lunar series via the illuminated fraction, an equatorial↔ecliptic round trip, and the drawn band's cusps measuring exactly 30° apart once projected back off the sky sphere.
- `nightSky.test.js` cross-checks the star/planet astronomy against independent references: the Sun's ecliptic longitude at known equinox/solstice instants (within ~1.5 arcminutes), SunCalc's own sun position, Polaris sitting at the observer's latitude, and the scene rotation matrix agreeing with the alt/az formula to 12 decimals.

### Shaders (`shaders/`)

- Experimental WGSL compute shaders: `rain-compute.wgsl`, `snow-compute.wgsl`, `splash-compute.wgsl`, `cloud-post.wgsl`, `star-field.wgsl`.
- They are not the active WebGPU path. Runtime WebGPU support lives under `src/webgpu/`; WebGL shader strings remain in `src/shaders.js`. Do not wire the standalone WGSL files into production (TSL compute is the canonical WebGPU particle path; see `docs/WEBGPU_ARCHITECTURE.md`). Remaining WebGPU parity is tracked in [#141](https://github.com/ford442/weather_clock/issues/141).

### Visual & Functional E2E (`e2e/`)

- Specs use the `.e2e.js` suffix (Playwright `testMatch`) so Vitest never picks them up.
- `visual.e2e.js` covers the canonical weather/time screenshot matrix plus UI/debug readiness and forecast-mode smoke checks.
- `functional.e2e.js` covers behavior flows (mode cycling, unit/search/quality persistence) with all external APIs mocked.
- Committed baselines live in `e2e/visual.e2e.js-snapshots/` (Playwright's per-platform naming).
- `test-results/` and `playwright-report/` are generated locally and ignored by git.
- Screenshots are compared via `page.screenshot()` + `toMatchSnapshot()` — `toHaveScreenshot()` cannot be used because its stability check requires identical consecutive frames, which the live WebGL loop never produces.

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

### Visual Regression & E2E Tests

Requires a one-time browser install (`npx playwright install chromium`). Playwright starts the dev server automatically via the `webServer` config:

```bash
npm run test:e2e            # full suite: screenshots + smoke + functional
npm run test:e2e:update     # recapture baselines intentionally
npx playwright test e2e/functional.e2e.js   # functional specs only (fast)
```

Mismatch artifacts land in `test-results/` and the HTML report in `playwright-report/` (both gitignored).

The specs append `?test=1` to every URL so the service worker is disabled during visual regression, keeping screenshots deterministic. Launch flags force SwiftShader (software WebGL) so baselines match CI's renderer.

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

## TypeScript / Typing Conventions

The runtime language is vanilla JavaScript; types come from JSDoc annotations checked by `tsc --noEmit` (`npm run typecheck`), not from `.ts` files. `tsconfig.json` has `allowJs`/`checkJs` on and `strictNullChecks` on; `strict` (the rest of the strict-mode family — `noImplicitAny`, `strictFunctionTypes`, etc.) is still off.

- **Every file under `src/` is type-checked.** `@ts-nocheck` is not used anywhere in `src/` (excluding `src/tests/` and any leftover `src/vendor/`, which stay excluded via `tsconfig.json`). Do not reintroduce it as a way to silence errors — fix the types or, if a type is genuinely unknowable at that point, use a narrow `/** @type {T} */ (expr)` cast with a one-line comment explaining why it's safe.
- **JSDoc is required on public exports.** Callers of `WeatherService`, `TimelineData`, `ModeController`, `AstronomyService`, and friends consume those annotations through `checkJs`. `.ts` files are allowed only when JSDoc cannot express a new module cleanly (generics, discriminated unions); do not rewrite the Three.js scene graph to TypeScript. Measured C++/WASM kernels stay behind `src/native/` / `native/` and are excluded from `tsc`.
- **Add JSDoc types when you touch a function/method**, even if the surrounding file predates this convention and is loosely typed elsewhere. At minimum: `@param` types for anything non-obvious, and a `@returns` type for anything a caller will branch on. Public methods on shared classes (`WeatherService`, `TimelineData`, `ModeController`, `AstronomyService`, and friends) should have complete `@param`/`@returns` JSDoc — callers rely on it and `tsc` enforces it.
- **Shared data shapes live in `src/types.d.ts`** as global ambient `interface`/`type` declarations (`WeatherSnapshot`, `WeatherData`, `AppState`, `TimelineDayData`, `DailyForecastDay`, etc.) — no import needed, just reference the type name in JSDoc. Add a new shape there when it's used across more than one or two files; keep genuinely file-local shapes as a local `@typedef` instead.
- **Common `strictNullChecks` fixes, in priority order:**
    1. A `let x = null;` or `const obj = { field: null, ... }` with no annotation infers the literal type `null` (not `T|null`) from that single assignment — this is the single most common cause of a cascading "possibly null" or "does not exist on type never" error far from the actual bug. Fix at the declaration: `/** @type {T|null} */ let x = null;`.
    2. A value that's null-typed but provably non-null at a given point by program logic TS can't see (e.g. two variables gated by the same upstream `if`, narrowing lost across an `await`, or lost inside a hoisted `function` declaration nested in a narrowed block) — bind a local non-null `const` right after the guard and use that, rather than repeating casts at every use site.
    3. A value that can never actually be null in practice (e.g. `canvas.getContext('2d')` on a freshly-created canvas) — cast once at that point: `/** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'))`.
    4. Real optionality (DOM query results, optional numeric/string fields, optional callbacks) — use a guard clause, `?.`, or a `?? default`, matching whatever pattern is already used nearby in the same file.
    5. Never use TypeScript's `!` non-null assertion operator here — it doesn't parse the same way in a `.js`+JSDoc file. Use the `/** @type {T} */ (expr)` cast form instead.
- **`.ts` files are allowed** only when JSDoc cannot express a new module cleanly (generics, discriminated unions). None exist yet; do not rewrite the Three.js scene graph to TypeScript.
- **Generated native glue stays excluded** from typechecking (`native/dist` in `tsconfig.json`'s `exclude`). Measured C++/WASM kernels live under `native/` / `src/native/` and are not the JSDoc runtime.

---

## Testing Instructions

1. **Unit Tests**
    - Run `npm test` before committing.
    - Tests are in `src/tests/` and use Vitest with mocked `fetch` and `navigator.geolocation`.

2. **Visual & Functional E2E**
    - One-time setup: `npx playwright install chromium`
    - Run `npm run test:e2e` (the dev server starts automatically).
    - Inspect `test-results/` diffs and `playwright-report/` for regressions in sky color, weather effects, forecast mode, and UI layout.

3. **PWA / Offline Verification**
    - Run `npm run build && npm run preview` to exercise the production service worker.
    - Open DevTools → Application → Service Workers and confirm `/sw.js` is registered.
    - Enable offline in DevTools, reload, and confirm the app shell still renders and the `#offline-status` pill appears.
    - The web app manifest (`/manifest.webmanifest`) uses `display: fullscreen` and the dusk palette theme color (`#2E1A47`).

4. **Interactive Debug Mode**
    - Open the browser console on `http://localhost:5173` and use:
        ```javascript
        window.setDebugWeather(65); // Force Heavy Rain (0 = Clear, 71 = Snow, 95 = Thunderstorm)
        window.setDebugTime(14.5); // Jump to 2:30 PM
        window.aetherDebug.getSimulationTime();
        window.aetherDebug.getWeatherData();
        window.aetherDebug.getSunPosition();
        window.aetherDebug.getMoonPosition();
        window.aetherDebug.getPlanetPositions(); // RA/Dec + apparent magnitude per planet
        window.aetherDebug.getNightSkyState(); // observer, cloud cover, overlay toggles
        window.aetherDebug.getZodiacState(); // Sun/Moon/planet signs under the active convention
        ```

window.aetherDebug.setLightPollution(0.8); // wash the faint stars out
window.aetherDebug.getSceneLayout(); // zone bounds, camera, sky, star sphere, depth
window.aetherDebug.getRendererInfo(); // backend, adapter, limits, context attributes

```

5. **CI must stay green**
  - `npm run lint`, `npm run typecheck`, and `npm run format:check` are required CI gates in addition to `npm test`. Run all four locally before pushing — a change that adds a new export, parameter, or field (e.g. to `WeatherSnapshot` or a post-processing adapter) must update `src/types.d.ts` and remove/underscore-prefix any now-unused parameters in the same commit.

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
 - `weatherclock_night_sky`
 - `weatherclock_zodiac`

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
The scene is visually divided into three time-offset zones, defined as the single source of truth in `src/scene-layout.js`'s `SCENE_LAYOUT.zones`:
- **Past (Left):** `x: -12 to -4` — weather from ~3 hours ago
- **Present (Center):** `x: -4 to 4` — current weather
- **Future (Right):** `x: 4 to 12` — weather from ~3 hours ahead

Particle systems (rain, snow, dust, fog) are constrained to zone boundaries. When modifying particle physics, ensure position wrapping uses the zone's `minX`/`maxX` bounds, not global bounds, or weather will "leak" between time periods. Lightning strikes only spawn in `SCENE_LAYOUT.lightning`, which matches the present zone. Fog wraps on `SCENE_LAYOUT.fog` (`minZ`/`maxZ` = ±8). Ground radius is `SCENE_LAYOUT.ground.radius` (3.6). Camera near/far/FOV, sky scale (450000), and star-sphere radius (2000) live on the same object. Depth is linear (`SCENE_LAYOUT.depth.mode`) while the current Sky+bloom stack is in use — logarithmic depth is documented as the follow-on once that sky is replaced. Nested radii stay `far` > sky > stars so a 2000-unit star sphere cannot occupy the sundial's depth. Shadow cameras stay at `SCENE_LAYOUT.shadows.cameraFar = 50` (sundial only). Import from `src/scene-layout.js` rather than hardcoding — call `aetherDebug.getSceneLayout()` and `aetherDebug.getRendererInfo()` live.

Lighting is a weighted blend of all three zones: Past (20%), Current (50%), Forecast (30%). Do not set `sunLight.position` in `weatherLighting.js`; position is handled exclusively by `astronomy.js`.

### Temporal Narrative (the past/present/future visual grammar)
`src/temporal-narrative.js` turns the three zone snapshots into the numbers every "time" visual shares, so clock mode and timeline mode tell the same story:

- **Time flows leftward.** Every zone's `drift` is negative — weather departs through the past zone (fastest) and eases in from the future zone (slowest), scaled by `changeRate`. Anything new that moves with time should drift toward −X; never toward +X.
- **Temperature is colour.** `warmth` / `tint` map temperature onto one blue→red ramp (`coldAnchorC`…`hotAnchorC`). Cold time reads blue, warm time reads red, in the clouds, the band, and the timeline columns alike.
- **Trend is motion.** `tempTrend` / `trendDirection` (rising / falling / steady) drive chevrons: they tilt up while warming, down while cooling, and a steady stretch shows none at all.

Consumers: `effects/weather-effects.js` feeds each zone's slice to that zone's `CloudSystem`s via `setNarrative()` and to `effects/temporal-band.js` (the horizon backdrop carrying the gradient, the chevrons, and the warm dusk shoulder that fades into the past); `timeline/DayColumn.js` renders the same chevron language per day from `trendDelta`. Inspect it live with `aetherDebug.getTemporalNarrative()`.

Cloud fields deliberately overlap their zone bounds by `CLOUD_ZONE_OVERLAP` and fade at those overlap edges, so the sky reads as one continuous scene rather than three cut-off blocks. Precipitation and fog still wrap on the hard zone bounds — only clouds overlap.

Prefer graphical language over HUD text for anything in this vocabulary.

### Celestial Lighting Model
`celestialLighting.js` holds the physics (pure functions, no Three.js): the Earth–Sun distance and its ~±3.4% irradiance swing, the lunar phase curve (Allen's law — the opposition surge makes a full moon ~11× a half moon, which a naive `illuminatedFraction` multiplier gets wrong), the Earth–Moon distance factor from SunCalc's own `moonPosition.distance`, and Kasten–Young airmass for extinction/reddening. `AstronomyService.update()` attaches the resulting `SunlightModel`/`MoonlightModel` to every astro snapshot; `weatherLighting.js` multiplies them into the light intensities and colours, and `moonPhase.js#updateMoonVisuals()` feeds the moon disk's shader uniforms from them.

Keep the modulations small and continuous — the point is nuance, not drama. Scene-level tuning constants belong in `CELESTIAL_LIGHT_CONFIG` (weatherLighting.js) or `MOON_DISK_CONFIG` (moonPhase.js); the physics constants stay in `CELESTIAL_CONFIG`. Because every mode reaches the lights through `updateSingleWeatherLighting()`, a change here lands in clock, forecast, and timeline modes at once.

### Zodiacal Overlay (the optional symbolic layer)
The zodiac is a *cultural* layer sitting on top of the astronomy, and the split in the code says so: `src/sky/zodiac.js` is pure math with no opinion about rendering, and `src/effects/zodiac-overlay.js` draws it with no ephemeris of its own.

- **It adds one ephemeris and nothing else.** The Sun and the planets come from `sky/planets.js`, precessed to the date and converted with `equatorialToEcliptic`. Only the Moon needed a new series — a truncated ELP-2000/82 (Meeus ch. 47), good to ~0.01°, two orders of magnitude finer than a 30° sign.
- **Both conventions are real.** `tropical` slices from the vernal equinox of date; `sidereal` subtracts the Lahiri ayanamsa so the signs stay on the constellations. Neither is "the" zodiac — the overlay draws whichever is selected and the cusps move visibly between them.
- **It rides the star field's rotation.** `ZodiacOverlay` parents into `StarField.skyGroup`, so the single latitude + LST matrix carries it, and the planets the star field already draws land on the ecliptic line without either layer coordinating. Geometry is relaid out only when precession has moved or the convention changed.
- **Off by default, and it never touches the scientific sky.** `Z` cycles off → tropical → sidereal through `setSkyLayers({ zodiac, zodiacMode })`, persisted under `weatherclock_zodiac`. The band fades with the same twilight/cloud opacity the bright stars get, so it is gone in daylight like everything else up there.
- **Graphical, not a panel.** The only emphasis it uses is light: the slice holding the Sun glows warm, the slice holding the Moon glows cool, the other ten stay quiet. Resist adding degrees, aspects, or houses as text — that is the HUD the vision explicitly rules out.

### Coordinate Systems
`SunCalc` uses spherical coordinates (azimuth/altitude). These are converted to Three.js Cartesian in `astronomy.js`. Azimuth 0° (South) maps to Z-, meaning North is Z+.

### Cloud System
`CloudSystem` uses `THREE.InstancedMesh` with procedurally generated canvas textures (`cumulus`, `stratus`, `cirrus`). Each cloud is composed of multiple puffs arranged in dome, sheet, or streak formations. Clouds billboard toward the camera and drift horizontally with wind.

### Precipitation & Collision
_WebGL path. Under WebGPU these are simulated by TSL compute nodes in `src/effects/gpu-*-system.js`; see `docs/WEBGPU_ARCHITECTURE.md`._

- **Rain:** `LineSegments` with a custom shader. Drops reset when they fall below the ground or collide with the sundial geometry (face, base top, or base slope).
- **Snow:** `Points` with curl-noise turbulence.
- **Splashes:** Small particle bursts spawn on the sundial surface when raindrops hit.

### Mode Switching
`ModeController` and the adapters in `src/modes/` coordinate Clock, Timeline, and Forecast mode transitions. Browser history keeps `?mode=timeline` and `?mode=forecast` shareable. Press `T` to cycle modes, `Esc` to return to Clock mode, and `ArrowLeft`/`ArrowRight` to toggle edge drawers. Press `C` to cycle the constellation overlay, `Z` to cycle the zodiacal band (off → tropical → sidereal). Press `P` to save a photo (share-card PNG) and `L` to export a 24-hour time-lapse WebM (`src/capture/`); while a time-lapse records, `ModeController.setLocked(true)` blocks all mode switching.

### Known Issues / Blockers
_Last verified 2026-09-17 by running `lint`, `typecheck`, `format:check`, `test`, and `build` directly. Those commands plus `vite build` are green on this tree._

Only currently open issues belong here. The previous backlog (issues 86–117) is closed and is not living work.

- **[#139](https://github.com/ford442/weather_clock/issues/139) — Scene layout / renderer depth** — `src/scene-layout.js` exists; leftover particle/fog/lightning literals and the WebGL/WebGPU context + far-plane contract remain. Block large celestial-scale work until this lands.
- **[#140](https://github.com/ford442/weather_clock/issues/140) — JSDoc/`checkJs` contracts** — keep vanilla JS; finish domain types rather than reintroducing `@ts-nocheck`.
- **[#141](https://github.com/ford442/weather_clock/issues/141) — WebGPU parity** — material/compute stubs and adapter-aware init. Playwright CI is SwiftShader WebGL only (`?forceWebGL=1` for local comparison). Three's WebGPU backend still renders `THREE.Points` as 1-pixel primitives and ignores `sizeNode`, so per-star size is folded into brightness; sized stars would need instanced `Sprite`s.
- **[#142](https://github.com/ford442/weather_clock/issues/142) — Shared weather-domain accuracy** — clock MAE and `TimelineData.enrichWithAccuracy()` exist; the remaining risk is two code paths drifting.
- **[#143](https://github.com/ford442/weather_clock/issues/143) — Celestial clock** — next content epic (JS first). Depends on #139.

---

## Cursor Cloud specific instructions

Node dependencies are refreshed automatically on startup (`npm install`), so the standard commands in **Build and Test Commands** (`npm run dev`, `npm test`, `npm run lint`, `npm run build`) work out of the box. `npm run dev` serves the app on `http://localhost:5173`; the repo's `.cursor/environment.json` auto-starts it and exposes port **5173** (not the noVNC desktop on 26058). Vite is configured with `server.host: true` so IPv4 port forwarding works.

- **Full CI parity locally:** the CI pipeline runs `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test -- --run`, `npm run build`, and `npm run check:bundle-size`, plus the separate e2e job (`npx playwright test`, needs `npx playwright install chromium` once). Run these before committing to match CI.
- **Weather test noise is expected:** `npm test` prints `stderr` warnings about failed/offline fetches for the caching-fallback tests — these are mocked failures, and the suite still passes.
- **E2E / visual regression is optional and NOT covered by the update script.** One-time setup: `npx playwright install chromium`. Then run `npm run test:e2e` (Playwright auto-starts the dev server). For a fast health check without screenshots, run only the functional specs: `npx playwright test e2e/functional.e2e.js`. Baselines are captured with SwiftShader (software WebGL) for cross-machine stability, but GPU/font-driven diffs can still occur on unusual hardware.
- **Harmless headless-GL console noise:** in headless Chromium the app logs a `favicon.ico` 404 and `WebGL: INVALID_ENUM: readPixels` / GPU-stall warnings. These do not affect functionality — the 3D scene, weather effects, and mode switching all render correctly.
- **Runtime data needs network:** the app fetches live weather from Open-Meteo and geocoding from Nominatim over HTTPS (no API key). If egress is blocked, live weather/search will fail; use the debug hooks (`window.setDebugWeather(code)`, `window.setDebugTime(hour)`) to exercise the scene offline.
```
