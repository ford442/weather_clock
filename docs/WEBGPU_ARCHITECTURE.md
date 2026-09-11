# WebGPU Architecture

How the dual WebGL / WebGPU rendering path is organised, which files own which
backend, and which visual features differ between the two.

Backend selection happens once, at startup, in `src/webgpu/RendererFactory.js`
(capability probing in `WebGPUCapabilities.js`). Everything downstream receives an
`isWebGPU` flag; there is no per-frame branching on backend.

---

## Two shapes of backend support

### 1. One class, two materials (the common case)

Clouds, stars, ground, sundial base/face and the moon are a single class that
builds a WebGL material in its constructor and swaps in a TSL node material from
an `async initWebGPU()` when the WebGPU backend is active.
`WeatherEffects.initWebGPU()` awaits all of them once, after renderer detection.

| Feature | Class | WebGL material | WebGPU material |
|---------|-------|----------------|-----------------|
| Clouds | `effects/cloud-system.js` | `createCloudMaterial` (`onBeforeCompile` injection) | `createCloudMaterialWebGPU` (TSL) |
| Stars | `effects/star-field.js` | `createStarFieldMaterial` | `createStarFieldMaterialWebGPU` (TSL) |
| Ground | `ground.js` / `effects/ground-effects.js` | `MeshStandardMaterial` + patches | `createGroundMaterialWebGPU` (TSL) |
| Sundial snow/frost | `effects/material-patches.js` | `onBeforeCompile` patches | `webgpu/materials/weather-node-patches.js` |
| Moon | `moonPhase.js` | `createMoonMaterial` | `createMoonMaterialWebGPU` |

Materials in this group live in `src/webgpu/materials/`, one file per feature,
exporting both factories side by side.

### 2. Two classes, one per backend (particles)

**Rain, snow and splashes are the exception.** Their simulation, not just their
shading, differs by backend, so they are separate classes chosen by the factory
in `src/scene-objects.js` and injected into `WeatherEffects` as `gpuClasses`:

| Feature | WebGL class (CPU simulation) | WebGPU class (TSL compute) |
|---------|------------------------------|----------------------------|
| Rain | `effects/rain-system.js` | `effects/gpu-rain-system.js` |
| Snow | `effects/snow-system.js` | `effects/gpu-snow-system.js` |
| Splashes | `effects/splash-system.js` | `effects/gpu-splash-system.js` |

**TSL compute nodes are the canonical WebGPU particle path.** The `GPU*` classes
own their node materials directly — they do not go through
`src/webgpu/materials/`. Correspondingly, `RainMaterial.js` and
`SplashMaterial.js` export a WebGL factory only, and the WebGL `RainSystem` /
`SplashSystem` have no `initWebGPU()`: in WebGPU mode they are never constructed.
Do not add WebGPU material adapters for these — extend the compute systems instead.

`shaders/*.wgsl` are standalone experiments (issue #87) and are not wired into
either path.

---

## Feature parity

| Feature | WebGL | WebGPU | Notes |
|---------|-------|--------|-------|
| Cloud volumetric lighting | ✅ | ✅ | Same sun forward-scatter / moon lobe / ambient / height-tint model, ported to TSL. |
| Star twinkle | ✅ | ✅ | Same position hash and twinkle curve. |
| Star point size | ✅ per-star `size` | ⚠️ 1 px | Three's WebGPU backend renders `THREE.Points` as 1-pixel primitives and ignores `sizeNode`; size is folded into brightness instead. Sized sprites would require switching the star field to instanced `Sprite`s. |
| Rain / snow / splashes | CPU (native kernels) | GPU compute | Different simulations by design; the WebGPU path also gets a 5× particle budget at the high tier. |
| Heat shimmer | ✅ `ShaderPass` | ✅ TSL `PostProcessing` | Both behind the `setHeatShimmer` member of the `PostProcessingPipeline` contract. |
| Bloom | ✅ `UnrealBloomPass` | ✅ `bloom()` node | |
| Wet-ground reflection | ✅ | ✅ | Screen-space sample of the reflection target. |

`src/webgpu/PostProcessingPipeline.js` defines the `PostProcessingPipeline`
typedef: `render`, `setSize`, `setPixelRatio`, `setBloom`, `setHeatShimmer`,
`dispose`. Every branch — including the WebGPU fallback used when bloom setup
throws — returns all six, so call sites do not need to feature-detect.

---

## Testing

Playwright visual baselines run under SwiftShader, which is **WebGL-only**: the
WebGPU path is not exercised in CI, and WebGPU-specific regressions will not be
caught there. Node-level unit tests (`src/tests/webgpuMaterials.test.js`) cover
the parts that can run headless — that the TSL graphs build, and that the
backend split in `scene-objects.js` stays unambiguous. Anything beyond that needs
a manual pass in a WebGPU-capable browser; `?forceWebGL=1` forces the fallback
path for side-by-side comparison.
