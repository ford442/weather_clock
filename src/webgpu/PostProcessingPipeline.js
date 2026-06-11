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
 * @param {object} [bloomOptions]
 * @returns {Promise<{render: Function, setSize: Function, dispose: Function}>}
 */
export async function createPostProcessingPipeline(
    renderer,
    scene,
    camera,
    isWebGPU,
    bloomOptions = {}
) {
    const strength = bloomOptions.strength ?? 0.5;
    const radius = bloomOptions.radius ?? 0.4;
    const threshold = bloomOptions.threshold ?? 0.85;
    const disableBloom = bloomOptions.disableBloom ?? false;

    if (disableBloom) {
        return {
            render: () => {
                if (isWebGPU) {
                    renderer.render(scene, camera);
                } else {
                    renderer.render(scene, camera);
                }
            },
            setSize: (w, h) => {
                renderer.setSize(w, h);
            },
            dispose: () => {}
        };
    }

    if (isWebGPU) {
        const { PostProcessing } = await import('three/webgpu');
        const { pass, bloom, toneMapping } = await import('three/tsl');

        const pp = new PostProcessing(renderer);
        const bloomNode = bloom(pass(scene, camera), { strength, radius, threshold });
        pp.outputNode = toneMapping(bloomNode, THREE.ACESFilmicToneMapping, 1.0);

        return {
            render: () => pp.render(),
            setSize: (w, h) => pp.setSize(w, h),
            dispose: () => {
                pp.dispose();
            }
        };
    }

    // WebGL path — EffectComposer + UnrealBloomPass
    const { EffectComposer } = await import('three/addons/postprocessing/EffectComposer.js');
    const { RenderPass } = await import('three/addons/postprocessing/RenderPass.js');
    const { UnrealBloomPass } = await import('three/addons/postprocessing/UnrealBloomPass.js');

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));

    const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        1.5,
        0.4,
        0.85
    );
    bloomPass.threshold = threshold;
    bloomPass.strength = strength;
    bloomPass.radius = radius;
    composer.addPass(bloomPass);

    return {
        render: () => composer.render(),
        setSize: (w, h) => composer.setSize(w, h),
        dispose: () => {
            composer.dispose();
        }
    };
}
