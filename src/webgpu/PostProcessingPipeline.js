/**
 * Post-processing pipeline abstraction.
 *
 * Hides the difference between WebGL (EffectComposer + UnrealBloomPass) and
 * WebGPU (TSL-based PostProcessing + bloom node).
 *
 * Usage:
 *   const pipeline = await createPostProcessingPipeline(renderer, scene, camera, isWebGPU);
 *   pipeline.render();
 *   pipeline.setSize(width, height);
 */

import * as THREE from 'three';

/**
 * Build a post-processing pipeline appropriate for the active renderer.
 *
 * @param {THREE.WebGLRenderer|import('three/webgpu').WebGPURenderer} renderer
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 * @param {boolean} isWebGPU
 * @param {{strength?: number, radius?: number, threshold?: number, disableBloom?: boolean}} [bloomOptions]
 * @returns {Promise<{render: Function, setSize: Function, setPixelRatio: Function, setBloom: Function, dispose: Function}>}
 */
export async function createPostProcessingPipeline(renderer, scene, camera, isWebGPU, bloomOptions = {}) {
    const strength = bloomOptions.strength ?? 0.5;
    const radius = bloomOptions.radius ?? 0.4;
    const threshold = bloomOptions.threshold ?? 0.85;
    const disableBloom = bloomOptions.disableBloom ?? false;

    if (isWebGPU) {
        try {
            const { PostProcessing } = await import('three/webgpu');
            const { pass, uniform, uv, vec2, sin, time, smoothstep } = await import('three/tsl');
            const { bloom } = await import('three/addons/tsl/display/BloomNode.js');

            const pp = new PostProcessing(renderer);
            const scenePass = pass(scene, camera);
            const scenePassColor = scenePass.getTextureNode('output');

            const shimmerEnabled = uniform(0);
            const shimmerIntensity = uniform(0);
            const groundMask = smoothstep(0.0, 0.4, uv().y.oneMinus());
            const shimmerOffset = sin(uv().x.mul(40.0).add(time.mul(3.0)))
                .mul(0.004)
                .mul(shimmerIntensity)
                .mul(shimmerEnabled)
                .mul(groundMask);
            const shimmeredUv = uv().add(vec2(shimmerOffset, 0));
            const shimmeredScenePassColor = scenePassColor.uv(shimmeredUv);

            const bloomPass = bloom(scenePassColor, strength, radius, threshold);
            pp.outputNode = shimmeredScenePassColor.add(bloomPass);
            let bloomEnabled = !disableBloom;

            return {
                render: () => (bloomEnabled ? pp.render() : renderer.render(scene, camera)),
                setSize: (w, h) => {
                    renderer.setSize(w, h);
                    pp.needsUpdate = true;
                },
                setPixelRatio: () => {
                    pp.needsUpdate = true;
                },
                setBloom: (options = {}) => {
                    bloomEnabled = options.enabled ?? bloomEnabled;
                    if (options.strength != null) bloomPass.strength.value = options.strength;
                    if (options.radius != null) bloomPass.radius.value = options.radius;
                    if (options.threshold != null) bloomPass.threshold.value = options.threshold;
                },
                setHeatShimmer: (options = {}) => {
                    if (options.enabled != null) shimmerEnabled.value = options.enabled ? 1 : 0;
                    if (options.intensity != null) shimmerIntensity.value = options.intensity;
                },
                dispose: () => {
                    pp.dispose();
                }
            };
        } catch (err) {
            console.warn('[PostProcessingPipeline] WebGPU bloom setup failed, using direct render:', err);
            return {
                render: () => renderer.render(scene, camera),
                setSize: (w, h) => renderer.setSize(w, h),
                setPixelRatio: () => {},
                setBloom: () => {},
                setHeatShimmer: () => {},
                dispose: () => {}
            };
        }
    }

    // WebGL path — EffectComposer + UnrealBloomPass + heat-shimmer ShaderPass
    const { EffectComposer } = await import('three/addons/postprocessing/EffectComposer.js');
    const { RenderPass } = await import('three/addons/postprocessing/RenderPass.js');
    const { ShaderPass } = await import('three/addons/postprocessing/ShaderPass.js');
    const { UnrealBloomPass } = await import('three/addons/postprocessing/UnrealBloomPass.js');

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));

    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloomPass.threshold = threshold;
    bloomPass.strength = strength;
    bloomPass.radius = radius;
    composer.addPass(bloomPass);
    let bloomEnabled = !disableBloom;

    const heatShimmerShader = {
        uniforms: {
            tDiffuse: { value: null },
            uTime: { value: 0 },
            uEnabled: { value: 0 },
            uIntensity: { value: 0 }
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
            }
        `,
        fragmentShader: `
            uniform sampler2D tDiffuse;
            uniform float uTime;
            uniform float uEnabled;
            uniform float uIntensity;
            varying vec2 vUv;
            void main() {
                float groundMask = smoothstep(0.0, 0.4, 1.0 - vUv.y);
                float offset = sin(vUv.x * 40.0 + uTime * 3.0) * 0.004 * uIntensity * uEnabled * groundMask;
                vec2 distortedUv = vUv + vec2(offset, 0.0);
                gl_FragColor = texture2D(tDiffuse, distortedUv);
            }
        `
    };
    const heatShimmerPass = new ShaderPass(heatShimmerShader);
    composer.addPass(heatShimmerPass);

    let shimmerClockMs = 0;

    return {
        render: () => {
            shimmerClockMs = performance.now();
            heatShimmerPass.uniforms.uTime.value = shimmerClockMs * 0.001;
            return bloomEnabled ? composer.render() : renderer.render(scene, camera);
        },
        setSize: (w, h) => composer.setSize(w, h),
        setPixelRatio: (pixelRatio) => composer.setPixelRatio(pixelRatio),
        setBloom: (options = {}) => {
            bloomEnabled = options.enabled ?? bloomEnabled;
            if (options.strength != null) bloomPass.strength = options.strength;
            if (options.radius != null) bloomPass.radius = options.radius;
            if (options.threshold != null) bloomPass.threshold = options.threshold;
        },
        setHeatShimmer: (options = {}) => {
            if (options.enabled != null) heatShimmerPass.uniforms.uEnabled.value = options.enabled ? 1 : 0;
            if (options.intensity != null) heatShimmerPass.uniforms.uIntensity.value = options.intensity;
        },
        dispose: () => {
            composer.dispose();
        }
    };
}
