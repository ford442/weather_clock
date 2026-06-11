/**
 * WebGPU capability detection
 *
 * Provides runtime detection of WebGPU support. Used by the renderer factory
 * to decide between WebGPURenderer and WebGLRenderer.
 */

/**
 * Check whether the browser supports WebGPU and can provide a valid adapter.
 * @returns {Promise<boolean>}
 */
export async function isWebGPUSupported() {
    if (typeof navigator === 'undefined' || !navigator.gpu) {
        return false;
    }
    try {
        const adapter = await navigator.gpu.requestAdapter({
            powerPreference: 'high-performance'
        });
        return !!adapter;
    } catch (e) {
        return false;
    }
}

/**
 * Return the appropriate Three.js entry module specifier.
 * @param {boolean} webgpu
 * @returns {string}
 */
export function getRendererModule(webgpu) {
    return webgpu ? 'three/webgpu' : 'three';
}
