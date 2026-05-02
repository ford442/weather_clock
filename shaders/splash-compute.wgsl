// weather_clock Splash Ripples — WGSL Compute Pipeline Variant
// Procedural splash ring overlay compatible with image_video_effects pipeline
//
// extraBuffer layout:
// 0: intensity (0-1)   1: colorR            2: colorG
// 3: colorB            4: expansionSpeed    5: fadeSpeed
// 6..N: ripple centers packed as vec2 per splash (x,y)

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

fn ripple(uv: vec2<f32>, center: vec2<f32>, time: f32, speed: f32, fade: f32) -> f32 {
    let dist = length(uv - center);
    let radius = time * speed;
    let ringWidth = 0.015;
    let ring = smoothstep(radius + ringWidth, radius, dist) -
               smoothstep(radius, radius - ringWidth * 0.5, dist);
    let life = 1.0 - smoothstep(0.0, fade, time);
    return ring * life;
}

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let resolution = u.config.zw;
    if (global_id.x >= u32(resolution.x) || global_id.y >= u32(resolution.y)) { return; }
    let uv = vec2<f32>(global_id.xy) / resolution;
    let time = u.config.x;

    let intensity = extraBuffer[0];
    let splashColor = vec3<f32>(extraBuffer[1], extraBuffer[2], extraBuffer[3]);
    let speed = extraBuffer[4];
    let fade = extraBuffer[5];

    if (intensity < 0.001) {
        textureStore(writeTexture, vec2<i32>(global_id.xy), vec4<f32>(0.0));
        return;
    }

    // Procedural splash centers from hash (mirrors JS random placement)
    var accum = 0.0;
    let splashCount = 8;
    for (var i: i32 = 0; i < splashCount; i = i + 1) {
        let seed = f32(i) * 17.31;
        let cx = hash12(vec2<f32>(seed, 3.71));
        let cy = hash12(vec2<f32>(seed + 1.0, 7.13));
        let center = vec2<f32>(cx, cy);
        let startTime = hash12(vec2<f32>(seed + 2.0, 11.7)) * 10.0;
        let localTime = fract((time + startTime) / 3.0) * 3.0;
        accum = accum + ripple(uv, center, localTime, speed, fade);
    }

    let alpha = clamp(accum * intensity * 0.6, 0.0, 1.0);
    let col = splashColor * alpha;
    textureStore(writeTexture, vec2<i32>(global_id.xy), vec4<f32>(col, alpha));
}
