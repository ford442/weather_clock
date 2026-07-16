# Roadmap

This is the living index of planned work for Weather Clock. GitHub issues own requirements, discussion, and completion state; this page only groups the currently open work into a useful order.

- [All open issues](https://github.com/ford442/weather_clock/issues?q=is%3Aissue%20state%3Aopen)
- Last reconciled with the issue tracker: 2026-07-16

When an issue closes, remove it from this document. Add new work to the issue tracker before adding it here so this file does not become a second backlog.

## Maintenance in progress

- [#86 — Repository hygiene and documentation alignment](https://github.com/ford442/weather_clock/issues/86): remove dead files, consolidate agent guidance, and make the visual verification layout intentional.

## Platform and correctness

- [#95 — Migrate visual regression to `@playwright/test` and expand unit coverage](https://github.com/ford442/weather_clock/issues/95)
- [#94 — Implement forecast accuracy with the Open-Meteo Previous Runs API](https://github.com/ford442/weather_clock/issues/94)
- [#93 — Add installable/offline PWA support](https://github.com/ford442/weather_clock/issues/93)
- [#97 — Accessibility and internationalization pass](https://github.com/ford442/weather_clock/issues/97)

## Experience

- [#89 — Ambient weather audio engine](https://github.com/ford442/weather_clock/issues/89)
- [#90 — New sky and severe-weather phenomena](https://github.com/ford442/weather_clock/issues/90)
- [#91 — Living environment and surface response](https://github.com/ford442/weather_clock/issues/91)
- [#92 — Alerts, air quality, UV, and pollen](https://github.com/ford442/weather_clock/issues/92)
- [#96 — Photo mode and time-lapse export](https://github.com/ford442/weather_clock/issues/96)

## Research and performance experiments

- [#87 — WebGPU compute particles](https://github.com/ford442/weather_clock/issues/87): decide whether to wire up the standalone WGSL experiments or replace them with TSL compute nodes.
- [#88 — Benchmark a scoped C++/WebAssembly particle/noise module](https://github.com/ford442/weather_clock/issues/88): keep the JavaScript path first-class unless measurements justify the added toolchain.
