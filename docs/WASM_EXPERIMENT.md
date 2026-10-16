# Native SIMD experiment

`native/` is an optional C++17/Emscripten acceleration layer for three pure-math workloads:

- seeded multi-octave cloud-noise generation;
- WebGL fallback rain, snow, and dust stepping;
- primitive layout for the 2D forecast-card canvases.

The experiment is deliberately not a rendering layer. Three.js/WebGL/WebGPU, astronomy, weather data, Canvas 2D state, collision, splashes, and particle respawning remain JavaScript responsibilities.

## Runtime behavior

The generated ES module is loaded with `dynamic import()` only when an adopted kernel needs it or the experiment is forced. Backend selection is per kernel and can be inspected through `window.__NATIVE_BACKENDS__` or `window.aetherDebug.getPerformanceMetrics()`.

- Default: use the adoption table below. All kernels currently resolve to JavaScript.
- `?native=1`: instantiate WASM and force every experimental kernel.
- `?native=0`: force every kernel to JavaScript.

An import, SIMD, instantiation, or allocation failure falls back to the matching JavaScript implementation. The generated module uses fixed 16 MiB memory because Three.js `BufferAttribute` arrays can point directly into its heap. This removes per-frame JS-to-WASM copies; Three.js still uploads changed attributes to the GPU.

Cloud textures now use the same seeded fractal-noise algorithm in both backends. WebGL particle systems use WASM-backed position, velocity, and offset views only under the forced experiment; collision and reset passes remain in JS. Forecast previews move only packed cloud/rain/snow layout math behind the façade and reuse a buffer per canvas.

## ABI

The minimal C ABI exports:

```text
generate_cloud_noise(output, width, height, octaves, seed)
step_particles(positions, velocities, offsets, count, wind_x, wind_z, dt,
               mode, min_x, max_x, min_z, max_z, time_seconds)
generate_forecast_primitives(output, capacity, width, height, cloud_cover,
                             precip_type, precip_intensity, wind_speed,
                             wind_dir, time_ms)
```

Particle mode `0` is snow, `1` is rain line-segment pairs, and `2` is dust. X wraps on the caller's zone (`min_x`/`max_x`) and Z wraps on `SCENE_LAYOUT.volume` (`min_z`/`max_z`), so wind cannot walk particles out of the scene (#151). Any change to this signature or the wrap is a paired change to `stepParticlesJS`, `weather_native.cpp`, and the committed `native/dist/*`; `src/tests/nativeKernels.test.js` holds the two backends together. Forecast output uses six floats per primitive: kind plus five shape parameters. JavaScript callers should use `src/native/native-runtime.js`, not the raw exports.

## Build and verification

Emscripten `6.0.2` is pinned in `.emscripten-version`.

```bash
npm run build:wasm
npm run benchmark:wasm       # quick Node diagnostic; not the adoption gate

# In another terminal:
npm run dev
npm run benchmark:wasm:browser
```

The build uses `-std=c++17 -O3 -msimd128 -Wall -Wextra -Werror -fno-exceptions -fno-rtti`, fixed memory, and no filesystem. `-msimd128` only permits LLVM to autovectorize; the source is scalar C++ with no `<wasm_simd128.h>` intrinsics, so it is an optional compiler flag, not a SIMD implementation. `native/compile_flags.txt` lets clangd/clang-tidy parse the one translation unit (CMake is deliberately absent until a second `.cpp` exists). C++ is formatted by hand; `wasm.yml` runs `clang++ -fsyntax-only` with those flags so a warning cannot land unnoticed. Generated `native/dist/weather-native.mjs` and `weather-native.wasm` are committed, so ordinary CI and deployments do not need Emscripten. `.github/workflows/wasm.yml` rebuilds them whenever the native source, build inputs, or workflow changes and fails on any diff.

The authoritative browser runner creates three fresh low-quality Chromium pages with 4x CPU throttling. Each workload receives ten warmups and 25 measured samples. Adoption requires every session to report at least a 2x median speedup; forecast adoption additionally requires its complete ten-card Canvas redraw to pass.

## Results and decision

Measured 2026-07-18 with Headless Chrome 147, Emscripten 6.0.2, low quality, and 4x CDP CPU throttling:

| Workload                                  | Session speedups    | Median | Adopted |
| ----------------------------------------- | ------------------- | -----: | ------- |
| 512x512 cloud noise, 4 octaves            | 0.86x, 1.64x, 1.25x |  1.25x | No      |
| Snow-style step, 667 particles, one frame | 0.33x, 1.00x, 0.40x |  0.40x | No      |
| Forecast primitive layout, 1,000 calls    | 0.50x, 0.91x, 1.71x |  0.91x | No      |
| Ten-card Canvas redraw                    | 1.80x, 2.00x, 1.75x |  1.80x | No      |

No workload cleared the gate in all three sessions. Production therefore keeps the JavaScript kernels first-class and does not instantiate WASM by default. The complete experiment remains available through `?native=1` for future browser, compiler, or workload reevaluation.

## Language strategy

The app has three layers with hard walls:

1. **JavaScript + JSDoc** (`checkJs`, `tsc --noEmit`) — rendering, astronomy, weather, UI, TSL/WebGPU. Source of truth for behaviour. A TypeScript scene-graph rewrite is out of scope.
2. **TSL compute** — the WebGPU particle path. New GPU work goes here, not into C++.
3. **C++17/WASM** — optional, only the three existing kernels, and only adopted if they clear the 2× gate after a real SIMD rewrite. No astronomy, sky, SGP4, JSON, or DOM code.

JS stays the source of truth: `js-kernels.js` and `weather_native.cpp` are kept in lockstep, `nativeKernels.test.js` compares them, and any kernel change updates both plus the committed artifacts. `NATIVE_ADOPTION` stays false and no fourth kernel is added.
