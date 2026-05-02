// weather_clock Star Field — WGSL Compute Pipeline Variant
// Procedural star field with twinkle compatible with image_video_effects pipeline
//
// extraBuffer layout:
// 0: opacity (0-1)       1: twinkleSpeed      2: density
// 3: colorR              4: colorG            5: colorB

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

fn starField(uv: vec2<f32>, scale: f32, t: f32, opacity: f32, speed: f32) -> vec3<f32> {
    let suv = uv * scale;
    let cell = floor(suv);
    let fuv = fract(suv) - vec2<f32>(0.5);
    let rnd = hash12(cell * vec2<f32>(127.1, 311.7) + vec2<f32>(74.7, 29.3));
    let rnd2 = hash12(cell * vec2<f32>(269.5, 183.3));
    if (rnd > 0.35) { return vec3<f32>(0.0); }
    let offset = vec2<f32>(rnd, rnd2) - vec2<f32>(0.5);
    let dist = length(fuv - offset * 0.8);
    let starSize = 0.015 + rnd2 * 0.025;
    let star = smoothstep(starSize, starSize * 0.1, dist);
    let phase = rnd * 6.2832;
    let twinkle = 0.5 + 0.5 * sin(t * speed * (1.5 + rnd2 * 2.5) + phase);
    let starColor = vec3<f32>(0.95, 0.95, 1.0);
    return starColor * star * twinkle * opacity;
}

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let resolution = u.config.zw;
    if (global_id.x >= u32(resolution.x) || global_id.y >= u32(resolution.y)) { return; }
    let uv = vec2<f32>(global_id.xy) / resolution;
    let time = u.config.x;

    let opacity = extraBuffer[0];
    let twinkleSpeed = extraBuffer[1];
    let density = extraBuffer[2];
    let starTint = vec3<f32>(extraBuffer[3], extraBuffer[4], extraBuffer[5]);

    if (opacity < 0.001) {
        textureStore(writeTexture, vec2<i32>(global_id.xy), vec4<f32>(0.0));
        return;
    }

    // Only draw stars in upper portion (sky)
    let skyMask = smoothstep(0.45, 0.15, uv.y);
    if (skyMask < 0.001) {
        textureStore(writeTexture, vec2<i32>(global_id.xy), vec4<f32>(0.0));
        return;
    }

    var stars = starField(uv, 25.0 * density, time, opacity, twinkleSpeed) * 1.0;
    stars = stars + starField(uv + vec2<f32>(13.7, 7.3), 40.0 * density, time, opacity, twinkleSpeed) * 0.6;
    stars = stars + starField(uv + vec2<f32>(31.1, 53.7), 60.0 * density, time, opacity, twinkleSpeed) * 0.3;

    let col = stars * starTint * skyMask;
    let alpha = max(col.r, max(col.g, col.b));
    textureStore(writeTexture, vec2<i32>(global_id.xy), vec4<f32>(col, alpha));
}
