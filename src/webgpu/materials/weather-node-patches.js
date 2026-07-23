// Small TSL node-material factories for the sundial base (snow) and face
// (frost) under WebGPU, mirroring the onBeforeCompile patches used for the
// WebGL path in `src/effects/material-patches.js`.

/**
 * @param {number} colorHex
 * @param {number} roughness
 * @param {number} metalness
 * @param {import('three').Texture|null} snowNoiseTexture
 */
export async function createSnowNodeMaterial(colorHex, roughness, metalness, snowNoiseTexture) {
    const { MeshStandardNodeMaterial } = await import('three/webgpu');
    const { texture, uniform, mix, smoothstep, uv, color } = await import('three/tsl');

    const material = new MeshStandardNodeMaterial({ color: colorHex, roughness, metalness });
    const uSnowCoverage = uniform(0);
    const noiseSample = snowNoiseTexture ? texture(snowNoiseTexture, uv().mul(3.0)).r : uniform(0.5);
    const snowMix = smoothstep(noiseSample.sub(0.18), noiseSample.add(0.18), uSnowCoverage);
    material.colorNode = mix(color(colorHex), color(0xf2f7ff), snowMix);
    material.userData.groundUniforms = { uSnowCoverage };
    return material;
}

/**
 * @param {number} colorHex
 * @param {number} roughness
 * @param {number} metalness
 */
export async function createFrostNodeMaterial(colorHex, roughness, metalness) {
    const { MeshStandardNodeMaterial } = await import('three/webgpu');
    const { uniform, mix, smoothstep, sin, uv, vec3, color, time } = await import('three/tsl');

    const material = new MeshStandardNodeMaterial({ color: colorHex, roughness, metalness });
    const uCold = uniform(0);
    const uDawn = uniform(0);

    const frostPattern = sin(uv().y.mul(60.0).add(time.mul(1.5))).mul(sin(uv().x.mul(70.0)));
    const frostAmount = smoothstep(0.7, 1.0, frostPattern).mul(0.5).mul(uCold).mul(uDawn);
    material.colorNode = mix(color(colorHex), vec3(0.8, 0.95, 1.0), frostAmount);
    material.userData.groundUniforms = { uCold, uDawn };
    return material;
}
