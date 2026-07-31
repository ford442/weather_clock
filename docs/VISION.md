# Vision: Graphical Weather & Astronomical Clock

**Goal**: A mostly graphical representation of weather, light, and sky around a faux sundial. The user should *feel* the passage of environmental and astronomical time rather than primarily reading numbers.

## Core Narrative

- A storm or cold front with rain can be seen leaving off to the **left** (past).
- Predicted temperature, sun, and clearer conditions move up from the **right** (future).
- Nighttime approaches with temperature cooling into the future — expressed through blue-vs-red visual language and rising/falling/steady cues.
- Daylight hours and warm light fade into the past on the left side of the scene.
- Clouds form a continuous graphical scene across past / now / future around the sundial.

## Light & Celestial Contrast

- Delicate contrast between moonlight and sunlight driven by Moon phase, angle, and viewer position.
- Subtle modulation of solar intensity by the current Earth–Sun distance (orbital eccentricity).
- Accurate local constellation positions and major planets for the user’s location and the active simulation time.
- Stars, constellations, and planets respond correctly to twilight, cloud cover, and time of day.

## Environmental Factors as Graphics

- Pressure and moisture (humidity) appear as atmospheric cues (fog density, haze, cloud softness, timeline indicators) rather than only as panel numbers.
- The Timeline and Forecast modes continue the same visual language across days.

## Optional Symbolic Layer

- A toggleable zodiacal / horoscopic overlay for the Moon, planets, and months that does not interfere with the photorealistic atmospheric experience.

## Guiding Principles

1. Prefer pure graphical language over additional HUD text or dense data panels.
2. Build on the existing temporal zones, Timeline columns, weather-effects systems, and AstronomyService.
3. Keep performance first-class (object pooling, quality tiers, shared scenes).
4. The sundial remains the emotional and compositional center.

## Related Issues

- [#113](https://github.com/ford442/weather_clock/issues/113) — Temporal weather narrative
- [#114](https://github.com/ford442/weather_clock/issues/114) — Earth–Sun distance + moonlight/sunlight contrast
- [#115](https://github.com/ford442/weather_clock/issues/115) — Constellations & planets
- [#116](https://github.com/ford442/weather_clock/issues/116) — Graphical pressure & moisture
- [#117](https://github.com/ford442/weather_clock/issues/117) — Optional zodiacal layer

See also [ROADMAP.md](./ROADMAP.md) for the full ordered backlog.
