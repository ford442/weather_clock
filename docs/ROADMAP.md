# Roadmap

This is the living index of planned work for Weather Clock. GitHub issues own requirements, discussion, and completion state; this page only groups the currently open work into a useful order.

- [All open issues](https://github.com/ford442/weather_clock/issues?q=is%3Aissue%20state%3Aopen)
- Last reconciled with the issue tracker: 2026-09-21

When an issue closes, remove it from this document. Add new work to the issue tracker before adding it here so this file does not become a second backlog.

The previous index (issues 138–143) is closed. Do not treat those tickets as living work; the batch below is the tracker.

## P0 — Land this first

- [#150 — Replace Three.js Sky and unlock a real depth contract](https://github.com/ford442/weather_clock/issues/150): the Preetham `Sky` addon plus bloom still forces `SCENE_LAYOUT.depth.mode = 'linear'`. A dual-backend atmosphere material has to land before logarithmic / reverse-Z depth, and before any sky that lives farther out than today's 2000-unit star sphere (Milky Way, aurora, a distinct orbital radius).
- [#151 — Precipitation volume: wrap Z, kill leftover spawn literals](https://github.com/ford442/weather_clock/issues/151): `SCENE_LAYOUT` owns zone X and fog Z; rain/snow/dust/lightning still spawn and drift on magic Z numbers and wrap **X only**. Wind plus time-warp walks precipitation out of the scene. JS kernel, C++ kernel, and committed WASM stay in lockstep.

## P1 — Platform and correctness

- [#152 — Native C++/WASM toolchain: compile database, real SIMD, or a JS-source-of-truth freeze](https://github.com/ford442/weather_clock/issues/152): production does not use WASM (`NATIVE_ADOPTION` is all false; nothing cleared the 2× gate). There is no `compile_commands.json` / `compile_flags.txt`, no `-Wall`, and `-msimd128` is a compiler flag over scalar loops. Decide freeze vs SIMD before any new C++ kernel. Vanilla JS + JSDoc stays the runtime; no scene-graph rewrite to TypeScript.
- [#153 — WebGPU sized stars via instanced sprites](https://github.com/ford442/weather_clock/issues/153): Three's WebGPU backend draws `THREE.Points` as 1-pixel primitives and ignores `sizeNode`. Catalog and planets should be instanced sprites so magnitude is area, not just brightness. Playwright CI cannot see this (SwiftShader WebGL only).

## P2 — Next content bets

- [#154 — True celestial sundial](https://github.com/ford442/weather_clock/issues/154): the namesake object is still analog hands plus a decorative gnomon that yaws on `Date.now()`. Latitude-aligned style, solar hour lines, equation of time as graphics, shadow as the clock. Independent of #150.
- [#155 — Optional orbital layer (ISS and bright satellites)](https://github.com/ford442/weather_clock/issues/155): TLE + `satellite.js` SGP4, parented into `StarField.skyGroup`, off by default, same twilight/cloud fade as the stars. Can live on the current star sphere; a distinct orbital radius waits on #150.

Intent still lives in [VISION.md](./VISION.md).
