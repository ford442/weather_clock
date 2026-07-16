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
            const { pass } = await import('three/tsl');
            const { bloom } = await import('three/addons/tsl/display/BloomNode.js');

            const pp = new PostProcessing(renderer);
            const scenePass = pass(scene, camera);
            const scenePassColor = scenePass.getTextureNode('output');
            const bloomPass = bloom(scenePassColor, strength, radius, threshold);
            pp.outputNode = scenePassColor.add(bloomPass);
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
                dispose: () => {}
            };
        }
    }

    // WebGL path — EffectComposer + UnrealBloomPass
    const { EffectComposer } = await import('three/addons/postprocessing/EffectComposer.js');
    const { RenderPass } = await import('three/addons/postprocessing/RenderPass.js');
    const { UnrealBloomPass } = await import('three/addons/postprocessing/UnrealBloomPass.js');

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));

    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloomPass.threshold = threshold;
    bloomPass.strength = strength;
    bloomPass.radius = radius;
    composer.addPass(bloomPass);
    let bloomEnabled = !disableBloom;

    return {
        render: () => (bloomEnabled ? composer.render() : renderer.render(scene, camera)),
        setSize: (w, h) => composer.setSize(w, h),
        setPixelRatio: (pixelRatio) => composer.setPixelRatio(pixelRatio),
        setBloom: (options = {}) => {
            bloomEnabled = options.enabled ?? bloomEnabled;
            if (options.strength != null) bloomPass.strength = options.strength;
            if (options.radius != null) bloomPass.radius = options.radius;
            if (options.threshold != null) bloomPass.threshold = options.threshold;
        },
        dispose: () => {
            composer.dispose();
        }
    };
}
