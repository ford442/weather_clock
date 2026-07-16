# weather_clock WGSL Compute Shaders

These are standalone WebGPU compute-pipeline experiments related to the active GLSL shaders in `src/shaders.js` and weather systems under `src/effects/`. They use the `image_video_effects` 13-binding layout, but they are not wired into the Weather Clock runtime.

## Files

| File | Description | extraBuffer Layout |
|------|-------------|-------------------|
| `rain-compute.wgsl` | Procedural rain streak overlay | `[intensity, windX, windZ, speed, colorR, colorG, colorB, groundY, fadeNear, fadeFar]` |
| `snow-compute.wgsl` | Procedural snowflake overlay | `[intensity, windX, windZ, speed, colorR, colorG, colorB, turbulence]` |
| `splash-compute.wgsl` | Procedural splash ripple rings | `[intensity, colorR, colorG, colorB, expansionSpeed, fadeSpeed]` |
| `cloud-post.wgsl` | Volumetric cloud lighting post-process | `[cloudCover, sunX, sunY, sunZ, sunColorR, sunColorG, sunColorB, moonX, moonY, moonZ, moonColorR, moonColorG, moonColorB, ambientR, ambientG, ambientB, stormFactor]` |
| `star-field.wgsl` | Procedural star field with twinkle | `[opacity, twinkleSpeed, density, colorR, colorG, colorB]` |

## Usage

The active dual-renderer implementation lives under `src/webgpu/`: WebGPU uses Three.js TSL/material adapters, while WebGL uses the GLSL strings in `src/shaders.js`. Issue #87 owns the decision to adapt these standalone compute files or replace them with TSL compute nodes.

All shaders use the standard `image_video_effects` binding layout:
```wgsl
@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba32float, write>;
@group(0) @binding(3) var<uniform> u: Uniforms;
// ... bindings 4-12
```

Project-specific parameters are passed via `extraBuffer` (`@binding(10)`) to maintain cross-shader compatibility.
