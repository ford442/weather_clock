# Roadmap

This is the living index of planned work for Weather Clock. GitHub issues own requirements, discussion, and completion state; this page only groups the currently open work into a useful order.

- [All open issues](https://github.com/ford442/weather_clock/issues?q=is%3Aissue%20state%3Aopen)
- Last reconciled with the issue tracker: 2026-09-17

When an issue closes, remove it from this document. Add new work to the issue tracker before adding it here so this file does not become a second backlog.

The previous index (issues 86–117) is closed. Do not treat those tickets as living work; the batch below is the tracker.

## P0 — Land this first

- [#138 — Restore CI green and stop docs/tracker drift](https://github.com/ford442/weather_clock/issues/138): keep `lint` / `typecheck` / `format:check` green, and keep this file plus `AGENTS.md` aligned with open issues only.
- [#139 — Centralize `SCENE_LAYOUT` and fix renderer context / depth contract](https://github.com/ford442/weather_clock/issues/139): `src/scene-layout.js` exists; remaining work is using it everywhere particles/fog/lightning/ground still fall back to literals, plus WebGL/WebGPU context flags, adapter limits, and a depth strategy that can host a distant celestial sphere. Must land before large sky-scale work ([#143](https://github.com/ford442/weather_clock/issues/143)).

## P1 — Platform and correctness

- [#140 — Make JSDoc/`checkJs` contracts real](https://github.com/ford442/weather_clock/issues/140): stay on vanilla JS + JSDoc; no `@ts-nocheck` theater, no scene-graph rewrite to TypeScript.
- [#141 — WebGPU material/compute parity and adapter-aware renderer init](https://github.com/ford442/weather_clock/issues/141): finish WebGPU stubs, inspect adapter features/limits before `init()`, and cover gaps Playwright’s SwiftShader WebGL path cannot see.
- [#142 — Wire timeline accuracy rings to Previous Runs — shared weather domain module](https://github.com/ford442/weather_clock/issues/142): clock-mode accuracy and `TimelineData.enrichWithAccuracy()` already exist; remaining work is one shared weather-domain module so clock and timeline cannot drift, and rings/detail UI stay populated from that module.

## P2 — Next content bet

- [#143 — Celestial clock: real stars, planets, Earth–Sun distance](https://github.com/ford442/weather_clock/issues/143): JS-first astronomy (WASM only if measured, and nothing has yet earned the 2× gate). The catalog, the constellation figures, the naked-eye planet ephemeris, the Earth–Sun irradiance term, and the per-tier sky budget are in `src/sky/` and `src/effects/star-field.js`; `aetherDebug.getSkyBodies()` reports the whole sky in one call. Remaining: the optional satellite layer, and whatever [#141](https://github.com/ford442/weather_clock/issues/141) still owes WebGPU star points. Intent still lives in [VISION.md](./VISION.md).
