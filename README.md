# The Aether Architect: Photorealistic Weather Clock ☁️⏳

Transforming a data dashboard into a window to the sky. This project renders a photorealistic 3D environment that evolves in real-time based on local weather data and astronomical calculations.

## 🌟 Core Philosophy: "Feel The Time"

*   **Seconds:** Wind rustles invisible currents, rain splashes on the sundial, lights flicker.
*   **Hours:** The sky gradient shifts smoothly from dawn orange to noon blue to dusk purple via atmospheric scattering.
*   **Days:** Moon phases cast varying "silver" light; seasons affect sun altitude.

## 🚀 Key Features

### 🎨 Atmosphere & Lighting
*   **GLSL Sky Shader:** Implements Rayleigh and Mie scattering for physically accurate sky gradients.
*   **Volumetric Fog:** Dynamic fog density reacting to visibility and cloud cover.
*   **HDR & Bloom:** `EffectComposer` with `UnrealBloomPass` for glowing celestial bodies and high dynamic range lighting.
*   **Civil Twilight:** Smooth lighting transitions handled during dawn and dusk (-6° to 6° elevation).

### 🌧️ Particle Evolution
*   **Volumetric Clouds:** InstancedMesh rendering with noise textures for fluffy, organic cloud formations.
*   **Physics-Based Precipitation:**
    *   **Rain:** Streaks aligned with wind vectors, distance-based fading, and splash collision effects on the ground.
    *   **Snow:** Curl noise turbulence for fluttering motion.
*   **Object Pooling:** Minimized garbage collection by reusing particle instances.

### ⚙️ Time & Simulation
*   **Decoupled Time:** Simulation time is independent of system time, allowing for time-lapse features.
*   **Time Warp:** Fast-forward mode to witness a 24-hour cycle in 60 seconds.
*   **Smooth Interpolation:** Weather state changes (e.g., Clear -> Rain) are interpolated over 5 seconds to prevent visual snapping.

## 🛠️ Setup & Running

1.  **Install Dependencies:**
    ```bash
    npm install
    ```

2.  **Start Development Server:**
    ```bash
    npm run dev
    ```
    Open `http://localhost:5173` in your browser.

## 🧪 Verification & Testing

This project uses **Playwright** and **Python** for visual verification.

### Prerequisites
*   Python 3.x
*   `pip install playwright`
*   `playwright install`

### Running Verification Scripts
Ensure the dev server is running (`npm run dev`), then:

```bash
# Verify Weather Effects (Rain, Snow, Clear)
python3 verification/verify_weather.py

# Verify Date Display
python3 verification/verify_date_display.py

# Verify Scene Composition
python3 verification/verify_scene.py
```
Check the `verification/` folder for generated screenshots.

### Unit Tests
```bash
npm test
```

## 🐞 Debugging Tools

Access these via the browser console:

*   **Force Weather Condition:**
    ```javascript
    window.setDebugWeather(65); // 65 = Heavy Rain, 0 = Clear, 71 = Snow
    ```
*   **Force Time:**
    ```javascript
    window.setDebugTime(12); // Set time to 12:00 PM
    ```
*   **Internal State:**
    ```javascript
    window.aetherDebug.getSimulationTime();
    window.aetherDebug.getWeatherData();
    ```

## 🏗️ Architecture
*   **Engine:** Three.js (WebGL)
*   **Data:** Open-Meteo API
*   **Astronomy:** SunCalc (patched for ES Modules)
*   **Visuals:** Custom ShaderMaterial, InstancedMesh, EffectComposer

## License
ISC
