# DEVELOPER_CONTEXT

## 1. High-Level Architecture & Intent

*   **Core Purpose:** `weather_clock` is a 3D interactive weather visualization application. It renders a real-time 3D scene combining a working sundial, astronomically correct sun/moon positions, and particle-based weather effects. Uniquely, it splits the visual space into three temporal zones: Past (Left), Present (Center), and Future (Right), each rendering weather conditions for that specific time offset (-3h, Now, +3h).
*   **Tech Stack:**
    *   **Core:** Vanilla JavaScript (ES Modules).
    *   **Rendering:** Three.js (^0.181.2).
    *   **Build Tool:** Vite (^7.2.4).
    *   **Astronomy:** SunCalc (^1.9.0) for celestial positioning.
    *   **Data Source:** Open-Meteo API (Free, no key required).
*   **Design Patterns:**
    *   **Orchestrator:** `src/main.js` acts as the central controller, initializing services and running the main `animate()` loop.
    *   **Service-Oriented:** Distinct services for fetching data (`WeatherService`), calculating positions (`AstronomyService`), and managing visuals (`WeatherEffects`, `WeatherLighting`).
    *   **State-Driven Rendering:** The `animate()` loop reads from a central `weatherData` state object, allowing decoupled updates from async fetch operations.

## 2. Feature Map

*   **Entry Point:** `src/main.js` - `init()` function.
*   **3D Scene & Rendering:**
    *   `src/main.js`: Sets up Scene, Camera, Renderer, and Lights.
    *   `src/sundial.js`: Generates the 3D geometry for the clock/sundial.
*   **Weather Data Fetching:**
    *   `src/weather.js` (`WeatherService`): Fetches Current, Forecast (+3h), and Historical (-3h) weather. Also fetches "1 Year Ago" historical data and Regional data (North/South/East/West offsets).
    *   *Note:* Uses `navigator.geolocation` with a fallback to NYC coordinates.
*   **Weather Visualization (The "Three Zones"):**
    *   `src/weatherEffects.js`: Manages particle systems (Rain, Snow, Clouds). It explicitly divides the X-axis into three zones:
        *   **Past:** `x: -8` (Left)
        *   **Present:** `x: 0` (Center)
        *   **Future:** `x: 8` (Right)
*   **Celestial Mechanics:**
    *   `src/astronomy.js`: Calculates Sun and Moon positions using `SunCalc`. Positions are mapped to a 3D dome radius of 20 units.
    *   `src/moonPhase.js`: Calculates visual phase (shadows) and phase name.
*   **Dynamic Lighting:**
    *   `src/weatherLighting.js`: Adjusts global illumination (Sun color/intensity, Ambient light, Background color) based on a weighted average of weather conditions across all three time zones.

## 3. Complexity Hotspots

*   **Temporal Zone Management (`src/weatherEffects.js`):**
    *   **Logic:** Particle systems (Rain/Snow) are not global. They are instantiated per-zone or updated with strict boundary checks.
    *   **Why it's complex:** Particles must "wrap" around their specific zone (e.g., if a rain drop in the "Past" zone moves too far right, it must wrap back to the left of the *Past* zone, not into the *Present* zone).
    *   **Agent Watchout:** When modifying particle physics, ensure `position.x` wrapping logic uses the `zone` boundaries (`zone.minX`, `zone.maxX`), not global bounds. Failure to do so will cause weather to "leak" between time periods.
*   **Lighting State Machine (`src/weatherLighting.js`):**
    *   **Logic:** Lighting is not driven by a single data point. It is a weighted average of Past (20%), Current (50%), and Forecast (30%) weather.
    *   **Why it's complex:** It blends color (LERP) and intensity based on "Severity" and "Cloud Cover" scores, while *also* accounting for Day/Night cycles (Sun altitude).
    *   **Agent Watchout:** Do not try to set `sunLight.position` here; it is strictly for *color/intensity*. Position is handled in `astronomy.js`.
*   **Coordinate Systems (Astronomy vs. Scene):**
    *   **Logic:** `SunCalc` uses spherical coordinates (Azimuth/Altitude). These are converted to Cartesian (X, Y, Z) in `astronomy.js`.
    *   **Why it's complex:** Mapping "North" in the real world to "Z+" or "Z-" in Three.js requires careful attention. Currently, Azimuth 0 (South) maps to Z-, meaning North is Z+.

## 4. Inherent Limitations & "Here be Dragons"

*   **Mocked Data:**
    *   **Accuracy Score:** The "Prediction Accuracy" in `WeatherService.getPredictionAccuracy` is **mocked** using `Math.random()`. It does *not* persist or verify against real past predictions.
*   **Hardcoded Values:**
    *   **Zone Widths:** The visual separation of zones (Left/Center/Right) relies on hardcoded offsets (e.g., `-8`, `0`, `8`) in `main.js` and `weatherEffects.js`. Changing the scene scale requires updating these "magic numbers" in multiple files.
*   **No Unit Tests:**
    *   The project has no configured test runner. `npm test` does nothing. Verification is purely visual (Manual or Playwright).
    *   **Constraint:** Do not assume tests will catch regressions. You must verify changes visually.
*   **Browser Geolocation:**
    *   Requires HTTPS or `localhost`. If deployed to an insecure HTTP origin, geolocation will fail silently or throw errors, falling back to the default location (NYC).

## 5. Dependency Graph & Key Flows

**Core Loop (Frame Rendering):**
`animate()` (main.js)
   -> `sundial.update()` (Rotate hands)
   -> `astronomyService.update()` (Calc Sun/Moon pos) -> Updates `sunLight` position
   -> `updateWeatherLighting()` (Calc Color/Intensity) -> Updates `sunLight` color
   -> `weatherEffects.update()` (Move particles) -> Checks `weatherData` state
   -> `renderer.render()`

**Data Flow (Initialization):**
`init()` (main.js)
   -> `weatherService.initialize()`
      -> `navigator.geolocation` (or fallback)
      -> `fetch(Open-Meteo Forecast)`
      -> `fetch(Open-Meteo Archive)`
      -> Resolves `weatherData` object
   -> `updateWeatherDisplay(weatherData)` (DOM Manipulation)
