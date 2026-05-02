// weather_clock Cloud Lighting — WGSL Compute Pipeline Variant
// Volumetric cloud lighting post-process compatible with image_video_effects pipeline
//
// extraBuffer layout:
// 0: cloudCover (0-100)     1: sunX (-1 to 1)    2: sunY (-1 to 1)
// 3: sunZ (-1 to 1)         4: sunColorR         5: sunColorG
// 6: sunColorB              7: moonX             8: moonY
// 9: moonZ                  10: moonColorR       11: moonColorG
// 12: moonColorB            13: ambientR         14: ambientG
// 15: ambientB              16: stormFactor (0-1)

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

fn noise2D(p: vec2<f32>) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    let a = hash12(i);
    let b = hash12(i + vec2<f32>(1.0, 0.0));
    let c = hash12(i + vec2<f32>(0.0, 1.0));
    let d = hash12(i + vec2<f32>(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

fn fbm2D(p: vec2<f32>, octaves: i32) -> f32 {
    var v = 0.0;
    var a = 0.5;
    var pos = p;
    for (var i: i32 = 0; i < octaves; i = i + 1) {
        v = v + a * noise2D(pos);
        pos = pos * 2.0 + vec2<f32>(100.0);
        a = a * 0.5;
    }
    return v;
}

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let resolution = u.config.zw;
    if (global_id.x >= u32(resolution.x) || global_id.y >= u32(resolution.y)) { return; }
    let uv = vec2<f32>(global_id.xy) / resolution;
    let time = u.config.x;

    let cloudCover = extraBuffer[0] / 100.0;
    let sunDir = normalize(vec3<f32>(extraBuffer[1], extraBuffer[2], extraBuffer[3]));
    let sunColor = vec3<f32>(extraBuffer[4], extraBuffer[5], extraBuffer[6]);
    let moonDir = normalize(vec3<f32>(extraBuffer[7], extraBuffer[8], extraBuffer[9]));
    let moonColor = vec3<f32>(extraBuffer[10], extraBuffer[11], extraBuffer[12]);
    let ambient = vec3<f32>(extraBuffer[13], extraBuffer[14], extraBuffer[15]);
    let stormFactor = extraBuffer[16];

    if (cloudCover < 0.01) {
        textureStore(writeTexture, vec2<i32>(global_id.xy), vec4<f32>(0.0));
        return;
    }

    // Procedural cloud mask using fBM
    let cloudUV = uv * 3.0 + vec2<f32>(time * 0.02, time * 0.01);
    let noiseVal = fbm2D(cloudUV, 4);
    let cloudMask = smoothstep(0.35 + (1.0 - cloudCover) * 0.4, 0.65, noiseVal);

    // Lighting approximations
    let viewDir = vec3<f32>(0.0, 0.0, 1.0);
    let sunDot = dot(sunDir, viewDir);
    let sunScat = pow(max(0.0, sunDot), 12.0) * 1.5;
    let sunDiff = 0.5 + 0.5 * max(0.0, sunDir.y);
    let sunLight = sunColor * (sunDiff * 0.4 + sunScat * 0.8 + 0.1);

    let moonDot = dot(moonDir, viewDir);
    let moonScat = pow(max(0.0, moonDot), 8.0) * 1.0;
    let moonLight = moonColor * (0.1 + moonScat * 0.5);

    let totalLight = ambient * 0.6 + sunLight + moonLight;

    // Vertical gradient (bright top, shadowed bottom)
    let vertGrad = uv.y;
    let topHighlight = vec3<f32>(1.02, 1.02, 1.05);
    let baseShadow   = vec3<f32>(0.72, 0.76, 0.88);
    let heightTint   = mix(baseShadow, topHighlight, vertGrad);

    // Storm darkening
    let stormDarken = 1.0 - stormFactor * 0.35;
    var cloudColor = totalLight * heightTint * stormDarken;

    let alpha = cloudMask * cloudCover * 0.85;
    textureStore(writeTexture, vec2<i32>(global_id.xy), vec4<f32>(cloudColor * alpha, alpha));
}
