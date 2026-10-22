/**
 * Stand-in for satellite.js's optional WASM propagators (`#wasm-single-thread`
 * and `#wasm-multi-thread`), aliased in `vite.config.js`. The satellite layer
 * only ever uses the library's JS SGP4 — per #152 no native kernel is added
 * without earning it — so the Emscripten builds (one of which spawns a pthread
 * worker) are kept out of the bundle entirely.
 * @returns {never}
 */
export default function createWasmModule() {
    throw new Error('satellite.js WASM propagation is not bundled; use the JS propagate().');
}
