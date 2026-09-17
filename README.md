# The Aether Architect: Photorealistic Weather Clock ☁️⏳

**Transforming a data dashboard into a window to the sky.** This project renders a photorealistic 3D environment that evolves in real-time based on local weather data and astronomical calculations.

> *Built with Three.js, SunCalc, and Open-Meteo API. No frameworks, no clutter—just pure rendering magic.*

## 📖 Table of Contents

- [Core Philosophy](#-core-philosophy-feel-the-time)
- [Key Features](#-key-features)
- [Quick Start](#-quick-start)
- [Setup & Running](#-setup--running)
- [Testing & Verification](#-testing--verification)
- [Debugging Tools](#-debugging-tools)
- [Architecture](#-architecture)
- [Contributing](#-contributing)

## 🌟 Core Philosophy: "Feel The Time"

Instead of reading a clock, *witness* time passing through nature. Every scale of time has visual meaning:

*   **Seconds:** Wind rustles invisible currents, rain splashes on the sundial, lights flicker.
*   **Hours:** The sky gradient shifts smoothly from dawn orange to noon blue to dusk purple via atmospheric scattering.
*   **Days:** Moon phases cast varying "silver" light — the lunar phase curve, the perigee/apogee distance swing, and atmospheric extinction all feed it, so a full moon is far brighter than a half and a setting moon fades to amber. Seasons affect sun altitude, and Earth's orbital eccentricity subtly brightens the January sun over the July one.

The goal: make time *visible* and *tactile*—a living, breathing environment instead of static data.

## 🚀 Key Features

### 🎨 Atmosphere & Lighting

- **GLSL Sky Shader** — Implements Rayleigh and Mie scattering for physically accurate sky gradients that match real-world atmospheric optics.
- **Volumetric Fog** — Dynamic fog density reacting to visibility and cloud cover, creating depth and mood.
- **HDR & Bloom** — `EffectComposer` with `UnrealBloomPass` for glowing celestial bodies and high dynamic range lighting that adapts to time of day.
- **Civil Twilight** — Smooth lighting transitions during dawn and dusk (-6° to 6° sun elevation) with natural color temperature shifts.

### 🌧️ Particle Evolution

- **Volumetric Clouds** — InstancedMesh rendering with Perlin noise textures for fluffy, organic cloud formations that move with wind.
- **Physics-Based Precipitation**
  - **Rain:** Streaks aligned with wind vectors, distance-based fading, and splash collision effects on the sundial ground plane.
  - **Snow:** Curl noise turbulence for realistic fluttering and accumulation behavior.
- **Object Pooling** — Minimized garbage collection by reusing particle instances across frames—scales to thousands of drops/flakes.

### ⚙️ Time & Simulation

- **Decoupled Time** — Simulation time is independent of system time, enabling time-lapse and "rewind" features without touching the clock.
- **Time Warp** — Fast-forward mode to witness a full 24-hour cycle in 60 seconds, perfect for understanding daily weather patterns.
- **Smooth Interpolation** — Weather state changes (e.g., Clear → Rain) are interpolated over 5 seconds to prevent visual snapping and jarring transitions.
- **10-Day Forecast View** — Toggle (or press through modes) to a strip of 10 animated canvas vignette cards. Click, tap, or keyboard-focus any day to drive one shared high-quality 3D `DailyScene` with accurate future-date sun/moon position, wind-directed clouds, precipitation, and a time-of-day scrubber.

### 🌌 Real Night Sky

- **True star positions** — A ~190-star bright catalog (J2000 RA/Dec, IAU 1976 precession to the simulated date) is rotated into the scene by a single matrix built from the observer's latitude and local sidereal time, so constellations rise, culminate, and set exactly where they should for the active location and time.
- **Constellation figures** — 37 stylized stick figures with optional names. Press `C` to cycle off → lines → lines + labels; the choice persists to `localStorage`.
- **Naked-eye planets** — Mercury through Saturn (Uranus and Neptune available) are solved from JPL's approximate Keplerian elements with apparent-magnitude and phase-angle terms, accurate to well under a degree — a few hundred bytes of constants instead of a VSOP87 series.
- **Physically motivated fading** — Stars fade out between nautical and civil twilight, dim under cloud cover, and wash out under a light-pollution knob that erases the faint field long before the named stars.
- **Everywhere it's night** — Clock, Timeline, and Forecast modes all drive the same layer; forecast vignettes get the sky for the day and hour being scrubbed.

### ♈ Zodiacal Overlay (optional)

- **The ecliptic, drawn on the real sky** — a thin gold arc along the Sun's path with a tick at each of the twelve sign cusps and a glyph floating beside every slice. Because it shares the star field's equatorial group, the naked-eye planets already land on the line without either layer knowing about the other.
- **Off by default** — press `Z` to cycle off → tropical → sidereal; the choice persists to `localStorage`. Nothing about the scientific sky changes when it is hidden.
- **Both conventions, honestly** — *tropical* signs are 30° slices from the vernal equinox of date (what a Western sun sign means); *sidereal* signs are shifted back by the Lahiri ayanamsa so they sit on the constellations they are named after. Switching between them visibly slides the glyphs by ~24°, which is precession made legible.
- **The Sun's sign and the Moon's sign are lit** — the slice holding the Sun glows warm, the one holding the Moon glows cool, and the other ten stay quiet. The layer says what it has to say by where it sits, not with a data panel.

### 🔊 Ambient Audio

- **Generative, asset-free ambience** — `src/audio/AmbienceEngine.js` synthesizes rain, wind, distant thunder, and a diurnal bird/cricket bed entirely from filtered Web Audio noise nodes. There are no sample files to download, so the feature adds a few KB of JS (no bundled media) and has zero impact on the critical boot chunk.
- **Gesture-gated autoplay** — no `AudioContext` is created until the ambience toggle button is clicked, satisfying browser autoplay policies and never blocking bootstrap.
- **Intensity-linked mixing** — gain and filter cutoffs track `rainIntensity`, `windSpeed`, and sun altitude from `AstronomyService` via small pure functions in `src/audio/gain-curves.js` (unit tested in `src/tests/ambienceGainCurves.test.js`), crossfaded with `setTargetAtTime` so weather/time-warp changes never pop or click.
- **Respects reduced motion & mute** — `prefers-reduced-motion` heavily attenuates the ambience bed, and the mute toggle's state persists to `localStorage`.

## 🛠️ Setup & Running

### For Users

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Start Development Server:**
   ```bash
   npm run dev
   ```
   Open `http://localhost:5173` in your browser and allow location access for local weather.

3. **Build for Production:**
   ```bash
   npm run build
   ```
   Output lands in `dist/` folder—ready to deploy.

4. **Deploy to the project host (optional):**
   ```bash
   cp deploy.config.example.json deploy.config.json
   # Edit deploy.config.json and set your deploy token (never commit this file)
   npm run build
   python3 deploy.py
   ```
   `deploy.py` defaults to `https://storage.noahcohn.com` for this project. You can override
   settings with environment variables such as `DEPLOY_TOKEN` and `DEPLOY_BASE_URL`.

### For Developers

See **[AGENTS.md](./AGENTS.md)** for:
- Project architecture and file structure
- How to modify shaders, effects, and simulation
- Debugging hooks and development commands
- Contributing guidelines

## 🧪 Verification & Testing

### Unit Tests

Test astronomy and weather logic:
```bash
npm test
```

Tests cover sun/moon position calculations, weather state transitions, and atmospheric physics.

### Visual Regression & Functional E2E Testing

This project uses **[Playwright Test](https://playwright.dev/)** for both visual regression and functional end-to-end testing (see `e2e/`). The suite renders deterministic scenarios (various times of day and weather codes), takes screenshots, and compares them against committed baselines pixel-by-pixel, alongside functional specs for mode cycling, unit/search/quality persistence, and forecast-mode smoke checks.

**Prerequisites (one-time):**
```bash
npx playwright install chromium
```

**Running Verification:**

Playwright starts the dev server automatically, so no separate `npm run dev` step is needed:

```bash
# Run the full suite: screenshots + smoke + functional specs
npm run test:e2e

# Run only the fast functional specs (no screenshots)
npx playwright test e2e/functional.e2e.js
```

If visual regressions are expected or intended (e.g., after updating shaders or lighting), update the committed baselines with:

```bash
npm run test:e2e:update
```

On CI, if the visual regression job fails, the Playwright HTML report and diff artifacts are automatically uploaded as a workflow run artifact (`playwright-report`). See [AGENTS.md](./AGENTS.md#visual--functional-e2e-e2e) for more detail.

## 🐞 Debugging Tools

Open your browser console and use:

**Force a specific weather condition:**
```javascript
window.setDebugWeather(65);  // 65 = Heavy Rain, 0 = Clear, 71 = Snow, etc.
```

**Jump to a specific time of day:**
```javascript
window.setDebugTime(14.5);  // 2:30 PM
```

**Inspect internal simulation state:**
```javascript
window.aetherDebug.getSimulationTime();    // Current simulation time
window.aetherDebug.getWeatherData();       // Fetched weather payload
window.aetherDebug.getSunPosition();       // Sun azimuth/elevation
window.aetherDebug.getMoonPosition();      // Moon azimuth/elevation
window.aetherDebug.getPerformanceMetrics();      // FPS, quality tier, active mode
window.aetherDebug.getForecastPreviewMetrics();  // 10-day canvas preview budget
```

**Inspect and force the ambient audio bed:**
```javascript
window.aetherDebug.getPlanetPositions();     // geocentric RA/Dec + apparent magnitude per planet
window.aetherDebug.getNightSkyState();       // observer, cloud cover, overlay toggles
window.aetherDebug.setLightPollution(0.8);   // wash the faint stars out
window.aetherDebug.getAudioState();          // { started, muted, volume, reducedMotion, rainGain, windGain, ... }
window.aetherDebug.forceAudioMute(false);    // starts the AudioContext (gesture-equivalent) and unmutes
window.aetherDebug.forceAudioWeather({ rainIntensity: 1, windSpeed: 40 });  // pin a synthetic weather bed
window.aetherDebug.clearForcedAudioWeather(); // release the override, resume following real weather
```

Perfect for quickly testing edge cases (midnight snow, sunset storms, etc.) without waiting for real weather.

## 🏗️ Architecture

### Stack
- **Engine:** Three.js (WebGL) — 3D rendering with optimized geometry and materials
- **Data:** [Open-Meteo API](https://open-meteo.com/) — Free weather data (no auth required)
- **Astronomy:** [SunCalc](https://github.com/mourner/suncalc) (npm `suncalc`) — Sun/moon positions and twilight calculations
- **Visuals:** Custom GLSL shaders, InstancedMesh for particles, EffectComposer for post-processing

### Key Design Decisions
- **No UI Frameworks** — Vanilla DOM and CSS for minimal overhead
- **ES Modules** — All source code uses native JavaScript modules
- **Shader-First** — Complex visuals (sky, lighting) are handled in GLSL, not CPU logic
- **Object Pooling** — Particles are reused to minimize garbage collection
- **Decoupled Simulation** — Time runs independently of renderer, enabling time-warp and replays
- **Forecast Rendering Budget** — The 10-day strip uses cheap 2D canvas previews throttled to ~10 fps and paused for hidden/reduced-motion states. The focused forecast view reuses one full Three.js scene through `DailyScene`; do not add per-card WebGL renderers.

### 10-Day Forecast Architecture

- `src/dailyScene.js` owns the focused forecast scene adapter. It accepts a day, representative time/hour, location, quality preset, and existing renderer scene resources.
- `src/forecast/DailyPreview.js` renders card previews on 2D canvas using the same daily snapshot/effect mapping as the focused scene.
- `src/effects/weather-effects.js` exposes `buildWeatherEffectConfig()` for forecast-specific cloud, wind, rain, snow, and quality-tier mapping.
- `src/weatherLighting.js` exposes `deriveDailyAtmosphere()` for future-date sky uniforms and per-day light color/intensity.
- `ForecastUI` keeps thumbnails cheap: visible-card-only redraw, hidden-tab pause, reduced-motion static fallback, and a single shared RAF.

## 🤝 Contributing

We welcome contributions! Here's how to get started:

1. **Read [AGENTS.md](./AGENTS.md)** for architecture and development guidelines
2. **Run tests locally:** `npm test` and visual/functional verification with `npm run test:e2e`
3. **Test your changes** across the development, testing, and production workflows
4. **Follow the code style** in existing modules—keep shaders modular, use object pooling for particles, comment complex math

Areas we're looking for help:
- Performance optimization (particle scaling, shader efficiency)
- New weather effects or visual enhancements
- Accessibility improvements
- Mobile responsiveness
- Documentation and examples

## 📚 Learn More

- **Development Setup:** [AGENTS.md](./AGENTS.md) — Architecture, file structure, and contributor guide
- **Three.js Docs:** [threejs.org/docs](https://threejs.org/docs/)
- **SunCalc Calculations:** [suncalc.org](https://suncalc.org/)
- **GLSL Shader Guide:** [Khronos OpenGL/GLSL](https://www.khronos.org/opengl/wiki/OpenGL_Shading_Language)
- **Open-Meteo API:** [open-meteo.com/en/docs](https://open-meteo.com/en/docs)

## License

ISC
