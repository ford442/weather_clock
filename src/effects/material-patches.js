// onBeforeCompile shader patches shared by the ground disc and sundial materials
// (WebGL path). Each patch returns a plain uniforms bag created up-front, so
// callers can always safely mutate `.value` regardless of whether the material
// has compiled its shader program yet — onBeforeCompile just merges the same
// object reference into `shader.uniforms`.

const SNOW_VERTEX_INJECT = `
#include <common>
varying vec2 vGroundUv;
`;

const SNOW_VERTEX_BEGIN = `
#include <begin_vertex>
vGroundUv = uv;
`;

const SNOW_FRAGMENT_INJECT = `
#include <common>
varying vec2 vGroundUv;
uniform float uSnowCoverage;
uniform sampler2D uSnowNoiseMap;
`;

const SNOW_FRAGMENT_COLOR = `
#include <color_fragment>
{
    float snowNoise = texture2D( uSnowNoiseMap, vGroundUv * 3.0 ).r;
    float snowMix = smoothstep( snowNoise - 0.18, snowNoise + 0.18, uSnowCoverage );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.95, 0.97, 1.0 ), snowMix );
}
`;

/**
 * Snow-only patch (used for the sundial base — no reflection needed there).
 * @param {import('three').Material} material
 * @param {import('three').Texture|null} snowNoiseTexture
 */
export function applySnowPatch(material, snowNoiseTexture) {
    const uniforms = {
        uSnowCoverage: { value: 0 },
        uSnowNoiseMap: { value: snowNoiseTexture }
    };

    material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', SNOW_VERTEX_INJECT)
            .replace('#include <begin_vertex>', SNOW_VERTEX_BEGIN);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', SNOW_FRAGMENT_INJECT)
            .replace('#include <color_fragment>', SNOW_FRAGMENT_COLOR);
    };
    material.customProgramCacheKey = () => 'ground-snow-patch';

    return uniforms;
}

const GROUND_VERTEX_INJECT = `
#include <common>
varying vec2 vGroundUv;
varying vec4 vReflectUv;
uniform mat4 uTextureMatrix;
`;

const GROUND_VERTEX_BEGIN = `
#include <begin_vertex>
vGroundUv = uv;
vReflectUv = uTextureMatrix * modelMatrix * vec4( transformed, 1.0 );
`;

const GROUND_FRAGMENT_INJECT = `
#include <common>
varying vec2 vGroundUv;
varying vec4 vReflectUv;
uniform float uSnowCoverage;
uniform sampler2D uSnowNoiseMap;
uniform float uWetness;
uniform float uReflectionEnabled;
uniform sampler2D uReflectionMap;
`;

const GROUND_FRAGMENT_COLOR = `
#include <color_fragment>
{
    float snowNoise = texture2D( uSnowNoiseMap, vGroundUv * 3.0 ).r;
    float snowMix = smoothstep( snowNoise - 0.18, snowNoise + 0.18, uSnowCoverage );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.95, 0.97, 1.0 ), snowMix );
}
`;

const GROUND_FRAGMENT_OUTPUT = `
{
    if ( uReflectionEnabled > 0.5 && uWetness > 0.001 && vReflectUv.w > 0.0 ) {
        vec2 reflectUv = vReflectUv.xy / vReflectUv.w;
        vec3 reflColor = texture2D( uReflectionMap, reflectUv ).rgb;
        outgoingLight = mix( outgoingLight, reflColor, clamp( uWetness, 0.0, 1.0 ) * 0.6 );
    }
}
#include <opaque_fragment>
`;

/**
 * Full ground patch: snow albedo mix + wetness-gated reflection sample.
 * Metalness/roughness themselves are lerped as plain material properties by
 * the caller each frame (cheap, no shader patch needed for that part).
 * @param {import('three').Material} material
 * @param {import('three').Texture|null} snowNoiseTexture
 */
export function applyGroundPatch(material, snowNoiseTexture) {
    const uniforms = {
        uSnowCoverage: { value: 0 },
        uSnowNoiseMap: { value: snowNoiseTexture },
        uWetness: { value: 0 },
        uReflectionEnabled: { value: 0 },
        uReflectionMap: { value: null },
        uTextureMatrix: { value: null }
    };

    material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', GROUND_VERTEX_INJECT)
            .replace('#include <begin_vertex>', GROUND_VERTEX_BEGIN);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', GROUND_FRAGMENT_INJECT)
            .replace('#include <color_fragment>', GROUND_FRAGMENT_COLOR)
            .replace('#include <opaque_fragment>', GROUND_FRAGMENT_OUTPUT);
    };
    material.customProgramCacheKey = () => 'ground-patch';

    return uniforms;
}

const FROST_VERTEX_INJECT = `
#include <common>
varying vec2 vFrostUv;
`;

const FROST_VERTEX_BEGIN = `
#include <begin_vertex>
vFrostUv = uv;
`;

const FROST_FRAGMENT_INJECT = `
#include <common>
varying vec2 vFrostUv;
uniform float uCold;
uniform float uDawn;
uniform float uFrostTime;
`;

const FROST_FRAGMENT_OUTPUT = `
{
    float frostAmount = uCold * uDawn;
    if ( frostAmount > 0.001 ) {
        float frost = sin( vFrostUv.y * 60.0 + uFrostTime * 1.5 ) * sin( vFrostUv.x * 70.0 );
        frost = smoothstep( 0.7, 1.0, frost ) * 0.5 * frostAmount;
        outgoingLight += vec3( 0.8, 0.95, 1.0 ) * frost;
    }
}
#include <opaque_fragment>
`;

/**
 * Frost-sparkle patch for the sundial clock face.
 * @param {import('three').Material} material
 */
export function applyFrostPatch(material) {
    const uniforms = {
        uCold: { value: 0 },
        uDawn: { value: 0 },
        uFrostTime: { value: 0 }
    };

    material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', FROST_VERTEX_INJECT)
            .replace('#include <begin_vertex>', FROST_VERTEX_BEGIN);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', FROST_FRAGMENT_INJECT)
            .replace('#include <opaque_fragment>', FROST_FRAGMENT_OUTPUT);
    };
    material.customProgramCacheKey = () => 'frost-patch';

    return uniforms;
}
