// weather_clock Snow — WGSL Compute Pipeline Variant
// Procedural snowflake overlay compatible with image_video_effects pipeline
//
// extraBuffer layout:
// 0: intensity (0-1)   1: windX (-1 to 1)   2: windZ (-1 to 1)
// 3: speed             4: colorR            5: colorG
// 6: colorB            7: turbulence

// --- STANDARD image_video_effects HEADER ---
@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba32float, write>;
@group(0) @binding(3) var<uniform> u: Uniforms;
@group(0) @binding(4) var readDepthTexture: texture_2d<f32>;
@group(0) @binding(5) var non_filtering_sampler: sampler;
@group(0) @binding(6) var writeDepthTexture: texture_storage_2d<r32float, write>;
@group(0) @binding(7) var dataTextureA: texture_storage_2d<rgba32float, write>;
@group(0) @binding(8) var dataTextureB: texture_storage_2d<rgba32float, write>;
@group(0) @binding(9) var dataTextureC: texture_2d<f32>;
@group(0) @binding(10) var<storage, read_write> extraBuffer: array<f32>;
@group(0) @binding(11) var comparison_sampler: sampler_comparison;
@group(0) @binding(12) var<storage, read> plasmaBuffer: array<vec4<f32>>;
// ---------------------------------------------

struct Uniforms {
  config: vec4<f32>,       // x=Time, y=Generic1, z=ResX, w=ResY
  zoom_config: vec4<f32>,  // x=ZoomTime, y=MouseX, z=MouseY, w=Generic2
  zoom_params: vec4<f32>,  // x=Param1, y=Param2, z=Param3, w=Param4
  ripples: array<vec4<f32>, 50>,
};

fn hash12(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3<f32>(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn snowflake(uv: vec2<f32>, seed: f32, size: f32) -> f32 {
    let center = vec2<f32>(0.5);
    let d = length((uv - center) * 2.0);
    let angle = seed * 6.28;
    let c = cos(angle);
    let s = sin(angle);
    let rot = mat2x2<f32>(c, -s, s, c);
    let branch_uv = rot * (uv - center);
    let branch = 1.0 - smoothstep(0.0, 0.1, abs(branch_uv.x) - size * 0.3) *
                         smoothstep(0.0, 0.1, abs(branch_uv.y) - size * 0.8);
    return smoothstep(0.0, 0.02, 1.0 - d) * branch;
}

fn snow_layer(uv: vec2<f32>, layer: u32, speed: f32, density: f32, wind: f32, time: f32) -> f32 {
    let seed = f32(layer) * 3.7;
    let layer_speed = speed * (1.0 + f32(layer) * 0.2);
    let gust = sin(time * 0.1 + seed) * 0.5 + 0.5;
    let turbulence = sin(uv.y * 8.0 + time * 2.0 + seed) * 0.15 * wind * gust;
    let wind_drift = time * layer_speed * wind * 0.3;
    let skewed_uv = vec2<f32>(
        uv.x * (1.0 + f32(layer) * 0.1) + turbulence + wind_drift,
        uv.y * (0.8 + f32(layer) * 0.05) + time * layer_speed
    );
    let cell_size = vec2<f32>(40.0, 40.0) / (1.0 + f32(layer) * 0.3);
    let cell = floor(skewed_uv * cell_size);
    var pos = fract(skewed_uv * cell_size);
    let rnd = hash12(cell + seed);
    if (rnd > density) { return 0.0; }
    let flake_size = 0.08 + rnd * 0.12;
    let rot = mat2x2<f32>(cos(rnd * 6.28), -sin(rnd * 6.28), sin(rnd * 6.28), cos(rnd * 6.28));
    pos = rot * (pos - vec2<f32>(0.5)) + vec2<f32>(0.5);
    let d = length(pos - vec2<f32>(0.5));
    let flake = smoothstep(flake_size, 0.0, d);
    return flake * (0.6 + rnd * 0.4);
}

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let resolution = u.config.zw;
    if (global_id.x >= u32(resolution.x) || global_id.y >= u32(resolution.y)) { return; }
    let uv = vec2<f32>(global_id.xy) / resolution;
    let time = u.config.x;

    let intensity = extraBuffer[0];
    let wind = extraBuffer[1];
    let speed = extraBuffer[3];
    let snowColor = vec3<f32>(extraBuffer[4], extraBuffer[5], extraBuffer[6]);

    if (intensity < 0.001) {
        textureStore(writeTexture, vec2<i32>(global_id.xy), vec4<f32>(0.0));
        return;
    }

    var accum = 0.0;
    let density = 0.25 + intensity * 0.4;
    for (var i: i32 = 0; i < 6; i = i + 1) {
        accum = accum + snow_layer(uv, u32(i), speed, density, wind, time);
    }

    let alpha = clamp(accum * intensity * 0.35, 0.0, 1.0);
    let col = snowColor * alpha;
    textureStore(writeTexture, vec2<i32>(global_id.xy), vec4<f32>(col, alpha));
}
