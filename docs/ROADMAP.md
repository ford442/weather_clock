# Roadmap

This is the living index of planned work for Weather Clock. GitHub issues own requirements, discussion, and completion state; this page only groups the currently open work into a useful order.

- [All open issues](https://github.com/ford442/weather_clock/issues?q=is%3Aissue%20state%3Aopen)
- Last reconciled with the issue tracker: 2026-11-19

When an issue closes, remove it from this document. Add new work to the issue tracker before adding it here so this file does not become a second backlog.

The previous batch (issues 150–155) is closed. The in-repo sky and logarithmic depth (#150), Z-wrapped precipitation (#151), the JS-source-of-truth kernel freeze (#152), the true sundial (#154, landed under #168), and the satellite layer (#155) are on `main`. #153 closed with its work on `examine/sundial-starfield`; #169 landed the star half (WebGPU catalog and planets as sized sprites). Do not reopen those tickets.

## P1 — Next sky layers

- [#170 — Milky Way band on the star sphere](https://github.com/ford442/weather_clock/issues/170): pure galactic-pole math in `src/sky/`, one mesh parented to `StarField.skyGroup` on the star sphere, fading with twilight, cloud, and light pollution. No label.
- [#172 — Satellites on their own orbital radius](https://github.com/ford442/weather_clock/issues/172): one `SCENE_LAYOUT.orbital.radius` between the star sphere and the sky, so a pass occludes stars under log depth. Same SGP4 path and `skyGroup` rotation as the layer already on `main`; no native kernel.

## P2 — Content bets

- [#171 — Aurora curtains from the planetary K-index](https://github.com/ford442/weather_clock/issues/171): NOAA SWPC Kp, latitude-gated, snuffed by cloud, with the curtain as the only readout. After #170.

Intent still lives in [VISION.md](./VISION.md).
