// weather_clock Rain — WGSL Compute Pipeline Variant
// Procedural rain streak overlay compatible with image_video_effects pipeline
//
// extraBuffer layout:
// 0: intensity (0-1)   1: windX (-1 to 1)   2: windZ (-1 to 1)
// 3: speed             4: colorR            5: colorG
// 6: colorB            7: groundY           8: fadeNear
// 9: fadeFar

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

fn hash13(p: vec3<f32>) -> f32 {
    var p3 = fract(p * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
}

fn rain_layer(uv: vec2<f32>, seed: f32, speed: f32, density: f32, wind: f32, time: f32) -> f32 {
    let skewed_uv = vec2<f32>(uv.x - uv.y * wind * 0.5, uv.y);
    let t = time * speed;
    let st = skewed_uv * vec2<f32>(50.0 + seed * 20.0, 5.0 + seed * 2.0);
    var pos = st + vec2<f32>(0.0, t);
    let cell = floor(pos);
    var f = fract(pos);
    let rand = hash12(cell + seed);
    if (rand > density) { return 0.0; }
    let streak = smoothstep(0.0, 1.0, 1.0 - f.y) * smoothstep(0.0, 0.1, f.y);
    let x_fade = smoothstep(0.0, 0.2, f.x) * smoothstep(1.0, 0.8, f.x);
    return streak * x_fade;
}

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let resolution = u.config.zw;
    if (global_id.x >= u32(resolution.x) || global_id.y >= u32(resolution.y)) { return; }
    let uv = vec2<f32>(global_id.xy) / resolution;
    let time = u.config.x;

    let intensity = extraBuffer[0];
    let windX = extraBuffer[1];
    let speed = extraBuffer[3];
    let rainColor = vec3<f32>(extraBuffer[4], extraBuffer[5], extraBuffer[6]);

    if (intensity < 0.001) {
        textureStore(writeTexture, vec2<i32>(global_id.xy), vec4<f32>(0.0));
        return;
    }

    var accum = 0.0;
    let density = 0.3 + intensity * 0.5;
    for (var i: i32 = 0; i < 5; i = i + 1) {
        let layer = f32(i);
        let seed = layer * 3.7;
        let layerSpeed = speed * (1.0 + layer * 0.3);
        accum = accum + rain_layer(uv, seed, layerSpeed, density, windX, time);
    }

    let alpha = accum * intensity * 0.4;
    let col = rainColor * alpha;
    textureStore(writeTexture, vec2<i32>(global_id.xy), vec4<f32>(col, alpha));
}
