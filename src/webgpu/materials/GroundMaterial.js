// TSL node material for the ground disc under WebGPU: snow albedo mix (edge-first
// via a reused noise texture), wetness-driven metalness/roughness, and a
// screen-space sample of the wet-ground reflection render target.
/**
 * @param {import('three').Texture|null} snowNoiseTexture
 * @param {import('three').Texture|null} reflectionTexture
 */
export async function createGroundMaterialWebGPU(snowNoiseTexture, reflectionTexture) {
    const { MeshStandardNodeMaterial } = await import('three/webgpu');
    const { texture, uniform, mix, smoothstep, uv, screenUV, vec3, color } = await import('three/tsl');

    const material = new MeshStandardNodeMaterial({
        color: 0x4a5a3a,
        roughness: 0.9,
        metalness: 0.05
    });

    const uSnowCoverage = uniform(0);
    const uWetness = uniform(0);
    const uReflectionEnabled = uniform(0);

    const noiseSample = snowNoiseTexture ? texture(snowNoiseTexture, uv().mul(3.0)).r : uniform(0.5);
    const snowMix = smoothstep(noiseSample.sub(0.18), noiseSample.add(0.18), uSnowCoverage);
    const baseColor = color(0x4a5a3a);
    const snowColor = color(0xf2f7ff);

    material.colorNode = mix(baseColor, snowColor, snowMix);
    material.roughnessNode = mix(uniform(0.9), uniform(0.15), uWetness);
    material.metalnessNode = mix(uniform(0.05), uniform(0.6), uWetness);

    if (reflectionTexture) {
        const reflSample = texture(reflectionTexture, screenUV).rgb;
        const reflectionMix = uWetness.mul(uReflectionEnabled).clamp(0, 1).mul(0.6);
        material.emissiveNode = mix(vec3(0, 0, 0), reflSample, reflectionMix);
    }

    material.userData.groundUniforms = { uSnowCoverage, uWetness, uReflectionEnabled };
    return material;
}
