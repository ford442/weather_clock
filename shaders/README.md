# Weather Clock shader architecture

The obsolete standalone WGSL files were removed. They targeted an unrelated 13-binding texture pipeline and were never part of this application's render path.

The active implementations are:

- WebGPU rain, snow, and splash simulation: Three.js TSL compute nodes in `src/effects/gpu-*-system.js`.
- WebGPU materials and post-processing adapters: `src/webgpu/`.
- WebGL fallback simulation: CPU particle systems in `src/effects/`.
- WebGL material shaders: GLSL strings in `src/shaders.js`.

Keep renderer-specific particle variants behind the shared system API used by `weather-effects.js`. Do not add raw WGSL here unless a feature cannot be expressed through the Three.js r181 TSL compute API.
