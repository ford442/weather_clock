# weather_clock WGSL Compute Shaders

These shaders are WebGPU compute-pipeline variants of the existing GLSL shaders in `src/shaders.js` and `src/weatherEffects.js`. They are designed to be compatible with the `image_video_effects` WGSL compute pipeline and use the standard 13-binding header.

## Files

| File | Description | extraBuffer Layout |
|------|-------------|-------------------|
| `rain-compute.wgsl` | Procedural rain streak overlay | `[intensity, windX, windZ, speed, colorR, colorG, colorB, groundY, fadeNear, fadeFar]` |
| `snow-compute.wgsl` | Procedural snowflake overlay | `[intensity, windX, windZ, speed, colorR, colorG, colorB, turbulence]` |
| `splash-compute.wgsl` | Procedural splash ripple rings | `[intensity, colorR, colorG, colorB, expansionSpeed, fadeSpeed]` |
| `cloud-post.wgsl` | Volumetric cloud lighting post-process | `[cloudCover, sunX, sunY, sunZ, sunColorR, sunColorG, sunColorB, moonX, moonY, moonZ, moonColorR, moonColorG, moonColorB, ambientR, ambientG, ambientB, stormFactor]` |
| `star-field.wgsl` | Procedural star field with twinkle | `[opacity, twinkleSpeed, density, colorR, colorG, colorB]` |

## Usage

These shaders are intended for future WebGPU support. The existing GLSL shaders in `src/shaders.js` remain the primary render path for WebGL/Three.js.

All shaders use the standard `image_video_effects` binding layout:
```wgsl
@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba32float, write>;
@group(0) @binding(3) var<uniform> u: Uniforms;
// ... bindings 4-12
```

Project-specific parameters are passed via `extraBuffer` (`@binding(10)`) to maintain cross-shader compatibility.
