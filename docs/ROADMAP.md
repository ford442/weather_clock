# Roadmap

This is the living index of planned work for Weather Clock. GitHub issues own requirements, discussion, and completion state; this page only groups the currently open work into a useful order.

- [All open issues](https://github.com/ford442/weather_clock/issues?q=is%3Aissue%20state%3Aopen)
- Last reconciled with the issue tracker: 2026-07-30

When an issue closes, remove it from this document. Add new work to the issue tracker before adding it here so this file does not become a second backlog.

## Maintenance in progress

- [#86 — Repository hygiene and documentation alignment](https://github.com/ford442/weather_clock/issues/86): remove dead files, consolidate agent guidance, and make the visual verification layout intentional.

## Platform and correctness

- [#95 — Migrate visual regression to `@playwright/test` and expand unit coverage](https://github.com/ford442/weather_clock/issues/95) — implemented: `e2e/` Playwright specs (visual matrix + smoke + functional) replaced the Python suite; unit coverage added for `atmosphereTheme.js`, `AnomalyCalculator.js`, and `getQualityTier()`.
- [#94 — Implement forecast accuracy with the Open-Meteo Previous Runs API](https://github.com/ford442/weather_clock/issues/94) — partially implemented: `WeatherService.getPredictionAccuracy()` computes day-1/day-3 MAE and shows it in the Advanced drawer's Accuracy tab; timeline-mode accuracy rings (`TimelineData.enrichWithAccuracy()`) remain open.
- [#93 — Add installable/offline PWA support](https://github.com/ford442/weather_clock/issues/93)
- [#97 — Accessibility and internationalization pass](https://github.com/ford442/weather_clock/issues/97)

## Experience

- [#89 — Ambient weather audio engine](https://github.com/ford442/weather_clock/issues/89)
- [#90 — New sky and severe-weather phenomena](https://github.com/ford442/weather_clock/issues/90)
- [#91 — Living environment and surface response](https://github.com/ford442/weather_clock/issues/91)
- [#92 — Alerts, air quality, UV, and pollen](https://github.com/ford442/weather_clock/issues/92)
- [#96 — Photo mode and time-lapse export](https://github.com/ford442/weather_clock/issues/96)

## Astronomical & Environmental Graphics Vision

See the high-level [VISION.md](./VISION.md) for the overall intent.

These items deepen the core philosophy of a mostly graphical representation of weather, light, and sky around the faux sundial. Prefer visual language over additional numeric HUD.

- [#113 — Temporal weather narrative: storm leaving left, conditions arriving from right, day/night temperature cues](https://github.com/ford442/weather_clock/issues/113)
  - Strengthen past/present/future storytelling so storms and cold leave to the left while warmer/clearer conditions and predicted temperature move in from the right.
  - Nighttime approaching shows cooling with clear blue-vs-red cues; rising/falling/steady trends indicated graphically.
  - Clouds form a continuous scene across the temporal zones.

- [#114 — Earth–Sun distance modulation + refined moonlight / sunlight contrast](https://github.com/ford442/weather_clock/issues/114)
  - Subtle modulation of solar intensity by current Earth–Sun distance.
  - More delicate, phase- and angle-aware moonlight vs sunlight contrast.

- [#115 — Accurate constellation and planet positions for the user's location](https://github.com/ford442/weather_clock/issues/115)
  - Real constellation positions and major planets placed correctly for location + simulation time.
  - Fade with daylight, twilight, and cloud cover.

- [#116 — Graphical pressure and moisture visualization in scene + timeline](https://github.com/ford442/weather_clock/issues/116)
  - Drive fog, haze, cloud softness, and timeline indicators from humidity and pressure so these factors are readable without relying solely on panels.

- [#117 — Optional zodiacal / horoscopic layer for Moon, planets, and months](https://github.com/ford442/weather_clock/issues/117)
  - Toggleable symbolic overlay (off by default) that can show traditional signs without compromising the photorealistic atmospheric experience.
  - Shipped: the ecliptic arc, sign cusps, and glyphs render in `src/effects/zodiac-overlay.js` on top of `src/sky/zodiac.js`; `Z` cycles off → tropical → sidereal.

## Research and performance experiments

- [#87 — WebGPU compute particles](https://github.com/ford442/weather_clock/issues/87): decide whether to wire up the standalone WGSL experiments or replace them with TSL compute nodes. TSL compute is now the canonical WebGPU particle path (`docs/WEBGPU_ARCHITECTURE.md`); the `shaders/*.wgsl` files remain unwired.
- [#88 — Benchmark a scoped C++/WebAssembly particle/noise module](https://github.com/ford442/weather_clock/issues/88): keep the JavaScript path first-class unless measurements justify the added toolchain.
