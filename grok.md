# Grok Development Guide: Weather Clock

## Project Overview

`weather_clock` (also known as **The Aether Architect**) is a photorealistic 3D weather clock built with **Three.js** and **vanilla JavaScript**. It renders a dynamic sky environment that evolves in real-time based on:

- **Local weather data** — fetched from the [Open-Meteo API](https://open-meteo.com/) (free, no API key required).
- **Astronomical calculations** — sun position, moon phases, and twilight transitions via [SunCalc](https://github.com/mourner/suncalc).
- **Particle effects** — rain, snow, wind dust, volumetric-style clouds, stars, and lightning.
- **Time simulation** — runs on a decoupled `simulationTime` with an optional time-warp feature (24-hour cycle in 60 seconds).

The app has two viewing modes:
1. **Clock Mode** — A 3D sundial with analog hands, surrounding sky, and overlaid weather panels.
2. **Timeline Mode** — A 21-day horizontal timeline of weather columns. Toggle with the button in the top-right or press `T`.

## Quick Start

```bash
# Install dependencies
npm install

# Start dev server
npm run dev
# Open http://localhost:5173
```

## Project Structure

See `AGENTS.md` for the most comprehensive and up-to-date file structure and responsibilities. Key highlights:

### Root Files
- `index.html` — Entry point
- `package.json`, `deploy.py`
- `README.md`, `AGENTS.md`, `claude.md`, `grok.md` (this file)

### Core Source (`src/`)
- `main.js` — Application orchestrator
- `rendering.js`, `lights.js`, `scene-objects.js`, `animation.js`, `ui.js`
- `weather.js`, `weather-simulation.js`, `astronomy.js`
- `weatherEffects.js`, `weatherLighting.js`, `shaders.js`
- `sundial.js`, `moonPhase.js`, `atmosphereTheme.js`, `debug.js`
- `ModeController.js`
- `vendor/suncalc.js`
- Timeline subsystem in `src/timeline/`

### Tests
- `src/tests/` (Vitest)
- `verification/` (Python + Playwright visual tests)

### Other
- `shaders/` (WGSL for future WebGPU)
- `.github/`, `docs/`, `scripts/`

## Key Development Concepts

### Time Decoupling
- `simulationTime` is independent of system time.
- Supports normal mode and time-warp (1440x speed).
- Weather interpolation ensures smooth transitions.

### Weather Pipeline
1. `WeatherService` fetches and builds hourly timeline.
2. `getActiveWeatherData` interpolates past/current/forecast.
3. Animation and lighting update based on active data.

### Three Temporal Zones
Visual separation: Past (x: -8), Present (x: 0), Future (x: 8). Lighting is a weighted blend.

### Particle & Cloud Systems
- Uses `InstancedMesh` for efficiency.
- Custom shaders for rain, snow, clouds.
- Wind affects trajectories.

### Mode Switching
`ModeController` handles Clock ↔ Timeline transitions with camera animations and history API.

## Testing & Verification

```bash
npm test                 # Unit tests (Vitest)
npm run dev              # Start dev server for visual tests
python3 verification/verify_*.py  # Visual regression (requires Playwright)
```

## Debugging in Browser

```javascript
window.setDebugWeather(65);  // e.g. 0=Clear, 65=Heavy Rain, 71=Snow
window.setDebugTime(14.5);   // 2:30 PM
window.aetherDebug.getSimulationTime();
window.aetherDebug.getWeatherData();
window.aetherDebug.getSunPosition();
window.aetherDebug.getMoonPosition();
```

## Common Tasks

- **Add weather effect**: Update `weatherEffects.js`, map in `weather.js`, add verification test.
- **Modify sky/lighting**: Edit `weatherLighting.js` and shaders.
- **Change UI**: Work in `ui.js` and CSS.
- **Timeline features**: Edit files in `src/timeline/`.

## Build & Deployment

```bash
npm run build
npm run preview
```

Output in `dist/`. Set `DEPLOY_TOKEN` in the environment before running `python3 deploy.py`, or use `python3 deploy.py --dry-run` to build the zip without uploading.

## Code Style & Best Practices

- ES Modules only.
- Use `requestAnimationFrame` for animations.
- Dispose Three.js resources properly to avoid memory leaks.
- Centralize config in module-level objects.
- Test visually with verification scripts before committing significant changes.
- Comment complex astronomy and shader math.

## Working with Grok on this Project

- **Inspection**: I can use GitHub tools to read files, search code, list branches, etc.
- **Modifications**: I can create/update files via `create_or_update_file` or `push_files`, create branches, and open PRs when needed.
- **Debugging help**: Describe console output, errors, or share screenshots; I can suggest precise fixes or new debug commands.
- **Verification**: After changes, I can guide running tests or propose verification script updates.
- **Architecture questions**: Ask about data flow, coordinate systems, or performance — I can trace through the modular structure.
- **Grok advantages**: Strong code reasoning, real-time tool use for repo ops, and creative suggestions for visual/3D enhancements.

## Resources

- [Three.js Docs](https://threejs.org/docs/)
- [SunCalc](https://github.com/mourner/suncalc)
- [Open-Meteo API](https://open-meteo.com/en/docs)
- [AGENTS.md](./AGENTS.md) — Full agent reference
- [claude.md](./claude.md) — Claude-specific guide
