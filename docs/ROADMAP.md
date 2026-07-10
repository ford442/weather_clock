# Project Roadmap & Health Assessment

*Assessment date: 2026-07-10. This document replaces the fully-completed `docs/plan.md` as the living roadmap. Each item links to a tracked GitHub issue.*

## Where the project stands

The "Aether Architect" vision from `docs/plan.md` is complete: dual WebGL/WebGPU rendering, sky scattering, pooled particle systems, decoupled simulation time, three view modes (clock / 21-day timeline / 10-day forecast), 27 passing unit tests, and CI with visual regression. The codebase is in good shape overall — the effects, timeline, and forecast subsystems are cleanly modular.

**Verdict on "features vs foundation":** shore up the foundation first. A short foundation sprint (roughly issues #77–#86) removes real risk — a committed credential, a shipped duplicate-key bug, a non-reproducible CI install, and a 930 kB entry bundle — and makes every later feature cheaper to land. None of it is a rewrite; it's 1–2 weeks of focused cleanup.

## Phase 1 — Foundation (do first, in roughly this order)

| # | Issue | Why now |
|---|-------|---------|
| [#77](https://github.com/ford442/weather_clock/issues/77) | 🔐 Remove committed SFTP credentials, rotate password | Live credential in git history |
| [#78](https://github.com/ford442/weather_clock/issues/78) | Fix duplicate `onSetQuality` in main.js; live quality switching | Shipped bug |
| [#79](https://github.com/ford442/weather_clock/issues/79) | Commit package-lock.json (`npm ci` needs it) | CI reproducibility |
| [#82](https://github.com/ford442/weather_clock/issues/82) | ESLint + Prettier + CI lint step | Would have caught #78 |
| [#80](https://github.com/ford442/weather_clock/issues/80) | vite.config.js + code splitting (930 kB main chunk) | Load time; WebGL users download the WebGPU pipeline |
| [#81](https://github.com/ford442/weather_clock/issues/81) | Renderer context options + context-loss recovery + DPR cap | Black-canvas failure mode; battery/perf |
| [#85](https://github.com/ford442/weather_clock/issues/85) | Fetch timeouts, request cancellation, unified retry in WeatherService | Hung "Loading…" states |
| [#84](https://github.com/ford442/weather_clock/issues/84) | Split ui.js / ModeController.js monoliths; dedupe main.js | Enables code-splitting boundaries |
| [#83](https://github.com/ford442/weather_clock/issues/83) | TypeScript adoption (JSDoc + checkJs → incremental .ts) | Type safety for uniform/config plumbing |
| [#86](https://github.com/ford442/weather_clock/issues/86) | Repo hygiene: dead files, stale docs, consolidate agent guides | Docs drift across 3 agent guides |

## Phase 2 — Platform & correctness

| # | Issue | Theme |
|---|-------|-------|
| [#95](https://github.com/ford442/weather_clock/issues/95) | Migrate visual regression to @playwright/test; expand unit coverage | Single-toolchain testing |
| [#94](https://github.com/ford442/weather_clock/issues/94) | Implement `getPredictionAccuracy()` via Previous Runs API | Removes last stubbed analytic |
| [#93](https://github.com/ford442/weather_clock/issues/93) | PWA: installable, offline, SW caching, kiosk mode | Distribution |
| [#97](https://github.com/ford442/weather_clock/issues/97) | Accessibility & i18n pass | Reach & correctness |

## Phase 3 — Experience features

| # | Issue | Theme |
|---|-------|-------|
| [#89](https://github.com/ford442/weather_clock/issues/89) | Ambient audio engine (rain / wind / thunder / birdsong) | "Feel the Time" with sound |
| [#90](https://github.com/ford442/weather_clock/issues/90) | Sky phenomena: lightning bolts, rainbows, hail, aurora, shooting stars | Visual drama |
| [#91](https://github.com/ford442/weather_clock/issues/91) | Living environment: snow accumulation, wet reflections, seasons, heat shimmer | Ground realism |
| [#92](https://github.com/ford442/weather_clock/issues/92) | Severe weather alerts + air quality / UV / pollen with scene tinting | Practical value |
| [#96](https://github.com/ford442/weather_clock/issues/96) | Photo mode + time-lapse export (PNG / WebM share cards) | Shareability |

## Phase 4 — Deep tech (research-flavored)

| # | Issue | Theme |
|---|-------|-------|
| [#87](https://github.com/ford442/weather_clock/issues/87) | WebGPU compute particles (wire up or replace orphaned `/shaders/*.wgsl`) | GPU simulation, 5–10× particle budget |
| [#88](https://github.com/ford442/weather_clock/issues/88) | C++ → WebAssembly (Emscripten) noise/particle module experiment | Benchmark-gated; JS fallback stays first-class |

## Language strategy (JS / TS / C++ / WGSL)

- **JavaScript → TypeScript**: incremental, starting with `checkJs` + JSDoc on tested pure-logic modules (#83). No big-bang rewrite.
- **GLSL vs WGSL**: GLSL in `src/shaders.js` remains the WebGL path. The five WGSL files in `/shaders/` are currently dead code written for an external pipeline — #87 decides their fate (recommendation: rewrite as Three.js TSL compute nodes rather than adapt).
- **C++**: none exists today, and that's correct — introduce it only via the scoped WASM experiment (#88), adopted only if benchmarks show ≥2× wins on noise generation / particle stepping.

## Longer-horizon ideas (not yet filed)

Saved multi-location favorites with swipe/cycle; raymarched volumetric clouds (true density field, WebGPU-tier only); "this day last year" comparison mode using the archive API already integrated; live precipitation radar texture projected onto the cloud layer; adaptive quality auto-tuning from a rolling FPS window; WebXR "step outside" viewing mode.
