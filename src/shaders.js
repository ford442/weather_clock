// src/shaders.js

export const rainVertexShader = `
uniform float uOpacity;
varying float vOpacity;

void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    float dist = length(mvPosition.xyz);
    // Fade out if too close (< 2.0) or too far (> 30.0)
    // "Fade out close particles" - prompt requirement
    float alpha = smoothstep(2.0, 5.0, dist) * (1.0 - smoothstep(30.0, 50.0, dist));
    vOpacity = alpha * uOpacity;
}
`;

export const rainFragmentShader = `
uniform vec3 uColor;
varying float vOpacity;

void main() {
    gl_FragColor = vec4(uColor, vOpacity);
}
`;

export const splashVertexShader = `
attribute float life;
varying float vLife;

void main() {
    vLife = life;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // Attenuate size based on distance
    float dist = length(mvPosition.xyz);
    float size = 6.0 * (1.0 + (1.0 - life) * 1.0);
    gl_PointSize = size * (20.0 / max(dist, 1.0));
}
`;

export const splashFragmentShader = `
uniform vec3 uColor;
varying float vLife;

void main() {
    float alpha = vLife;
    if (alpha <= 0.0) discard;

    // Circular particle
    vec2 coord = gl_PointCoord - vec2(0.5);
    float len = length(coord);
    if(len > 0.5) discard;

    // Soft edge
    float softness = 1.0 - smoothstep(0.3, 0.5, len);

    gl_FragColor = vec4(uColor, alpha * 0.8 * softness);
}
`;

// Cloud Shader Logic
// We will use onBeforeCompile to inject this into MeshBasicMaterial
export const cloudShaderInjection = {
    uniforms: {
        uSunPosition: { value: new THREE.Vector3(0, 100, 0) },
        uSunColor: { value: new THREE.Color(0xffffff) },
        uMoonPosition: { value: new THREE.Vector3(0, -100, 0) },
        uMoonColor: { value: new THREE.Color(0x000000) },
        uAmbientColor: { value: new THREE.Color(0xffffff) },
        uCloudColor: { value: new THREE.Color(0xffffff) } // Base cloud tint
    },
    onBeforeCompile: (shader) => {
        // Link uniforms
        Object.assign(shader.uniforms, cloudShaderInjection.uniforms);

        // Inject Vertex Logic to pass World Position
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `
            #include <common>
            varying vec3 vWorldPosition;
            `
        );
        shader.vertexShader = shader.vertexShader.replace(
            '#include <project_vertex>',
            `
            // Calculate world position
            // For InstancedMesh, 'transformed' is already applied with instanceMatrix
            // So we just need to apply modelMatrix
            vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
            vWorldPosition = worldPosition.xyz;
            #include <project_vertex>
            `
        );

        // Inject Fragment Logic for Lighting
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `
            #include <common>
            varying vec3 vWorldPosition;
            uniform vec3 uSunPosition;
            uniform vec3 uSunColor;
            uniform vec3 uMoonPosition;
            uniform vec3 uMoonColor;
            uniform vec3 uAmbientColor;
            uniform vec3 uCloudColor;
            `
        );

        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <map_fragment>',
            `
            #include <map_fragment>

            // --- Volumetric/Lighting Approximation ---
            vec3 viewDir = normalize(cameraPosition - vWorldPosition);

            // Sun Interaction
            vec3 sunDir = normalize(uSunPosition - vWorldPosition);
            float sunDot = dot(sunDir, viewDir);

            // Forward Scattering (Silver Lining) - when looking towards sun (dot > 0)
            // Higher power for sharper rim
            float sunScat = pow(max(0.0, sunDot), 12.0) * 1.5;

            // Back Scattering (Diffuse) - when sun is behind camera (dot < 0)
            // Clouds are bright when fully lit
            float sunDiff = 0.5 + 0.5 * max(0.0, dot(vec3(0.0, 1.0, 0.0), sunDir)); // Simple top-down fake

            // Combine Sun
            vec3 sunLight = uSunColor * (sunDiff * 0.4 + sunScat * 0.8 + 0.1);

            // Moon Interaction (Similar but weaker)
            vec3 moonDir = normalize(uMoonPosition - vWorldPosition);
            float moonDot = dot(moonDir, viewDir);
            float moonScat = pow(max(0.0, moonDot), 8.0) * 1.0;
            vec3 moonLight = uMoonColor * (0.1 + moonScat * 0.5);

            // Ambient
            vec3 ambient = uAmbientColor * 0.6; // Base ambient

            // Final Light
            vec3 totalLight = ambient + sunLight + moonLight;

            // Apply to cloud
            diffuseColor.rgb *= uCloudColor * totalLight;
            `
        );
    }
};

import * as THREE from 'three';
