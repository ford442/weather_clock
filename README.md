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
*   **Days:** Moon phases cast varying "silver" light; seasons affect sun altitude.

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

### For Developers

See **[claude.md](./claude.md)** for:
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

### Visual Regression Testing

This project uses **Playwright**, **Python**, and **Pillow** to perform automated visual regression testing. The test suite renders deterministic test scenarios (various times of day and weather codes), takes screenshots, and compares them against committed baselines pixel-by-pixel.

**Prerequisites:**
```bash
pip install playwright Pillow
playwright install chromium
```

**Running Visual Verification:**

Ensure the dev server is running (`npm run dev`), then run the consolidated verification suite:

```bash
# Run all visual tests and compare against baselines
python3 verification/run_all.py

# Run the 10-day forecast focused-view smoke and capture representative days
python3 verification/verify_forecast_view.py
```

If visual regressions are expected or intended (e.g., after updating shaders or lighting), you can update the committed baseline images locally using the `VISUAL_UPDATE` environment flag:

```bash
# Update committed baseline screenshots
VISUAL_UPDATE=1 python3 verification/run_all.py
```

On CI, if the visual regression job fails, PR diffs showing highlighted mismatches are automatically saved and uploaded as a workflow run artifact (`visual-regression-diffs`).

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

Perfect for quickly testing edge cases (midnight snow, sunset storms, etc.) without waiting for real weather.

## 🏗️ Architecture

### Stack
- **Engine:** Three.js (WebGL) — 3D rendering with optimized geometry and materials
- **Data:** [Open-Meteo API](https://open-meteo.com/) — Free weather data (no auth required)
- **Astronomy:** [SunCalc](https://github.com/mourner/suncalc) (patched for ES modules) — Sun/moon positions and twilight calculations
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

1. **Read [claude.md](./claude.md)** for architecture and development guidelines
2. **Run tests locally:** `npm test` and visual verification with `python3 verification/*.py`
3. **Test your changes** across the development, testing, and production workflows
4. **Follow the code style** in existing modules—keep shaders modular, use object pooling for particles, comment complex math

Areas we're looking for help:
- Performance optimization (particle scaling, shader efficiency)
- New weather effects or visual enhancements
- Accessibility improvements
- Mobile responsiveness
- Documentation and examples

## 📚 Learn More

- **Development Setup:** [claude.md](./claude.md) — Architecture, file structure, and contributor guide
- **Three.js Docs:** [threejs.org/docs](https://threejs.org/docs/)
- **SunCalc Calculations:** [suncalc.org](https://suncalc.org/)
- **GLSL Shader Guide:** [Khronos OpenGL/GLSL](https://www.khronos.org/opengl/wiki/OpenGL_Shading_Language)
- **Open-Meteo API:** [open-meteo.com/en/docs](https://open-meteo.com/en/docs)

## License

ISC
