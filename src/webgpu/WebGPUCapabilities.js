/**
 * WebGPU capability detection
 *
 * Provides runtime detection of WebGPU support. Used by the renderer factory
 * to decide between WebGPURenderer and WebGLRenderer.
 *
 * Adapter `features` / `limits` are inspected before `WebGPURenderer.init()`
 * so a low-limit adapter cannot start then fail on compute particles or 2K shadows.
 */

/**
 * Conservative floors for the GPU rain/snow/splash path (three zones of
 * instanced storage buffers at the high-tier 5× budget) plus 2048² shadows.
 * These sit well below the WebGPU spec minima so a conforming adapter always
 * passes; they exist to reject broken / stub adapters.
 */
export const GPU_PARTICLE_REQUIRED_LIMITS = Object.freeze({
    maxStorageBuffersPerShaderStage: 8,
    maxStorageBufferBindingSize: 1 << 20,
    maxBufferSize: 1 << 21,
    maxComputeWorkgroupSizeX: 64,
    maxComputeInvocationsPerWorkgroup: 64,
    maxTextureDimension2D: 2048
});

/**
 * @typedef {Object} WebGPUAdapterInspection
 * @property {boolean} supported
 * @property {boolean} meetsParticleLimits
 * @property {string[]} failedLimits
 * @property {string[]} features
 * @property {Record<string, number>} limits
 * @property {{vendor?: string, architecture?: string, device?: string, description?: string}|null} info
 * @property {GPUAdapter|null} adapter
 */

/**
 * @param {GPUAdapter} adapter
 * @returns {string[]}
 */
export function listFailedParticleLimits(adapter) {
    /** @type {string[]} */
    const failed = [];
    const limits = /** @type {Record<string, number>} */ (/** @type {unknown} */ (adapter.limits));
    for (const [key, min] of Object.entries(GPU_PARTICLE_REQUIRED_LIMITS)) {
        const value = limits[key];
        if (typeof value === 'number' && value < min) {
            failed.push(`${key}: ${value} < ${min}`);
        }
    }
    return failed;
}

/**
 * Request a high-performance adapter and inspect features/limits.
 * Does not call `requestDevice`.
 * @returns {Promise<WebGPUAdapterInspection>}
 */
export async function inspectWebGPUAdapter() {
    const empty = {
        supported: false,
        meetsParticleLimits: false,
        failedLimits: /** @type {string[]} */ ([]),
        features: /** @type {string[]} */ ([]),
        limits: /** @type {Record<string, number>} */ ({}),
        info: null,
        adapter: /** @type {GPUAdapter|null} */ (null)
    };

    if (typeof navigator === 'undefined' || !navigator.gpu) {
        return empty;
    }

    try {
        const adapter = await navigator.gpu.requestAdapter({
            powerPreference: 'high-performance'
        });
        if (!adapter) return empty;

        const failedLimits = listFailedParticleLimits(adapter);
        const rawLimits = /** @type {Record<string, number>} */ (/** @type {unknown} */ (adapter.limits));
        const limits = /** @type {Record<string, number>} */ ({});
        for (const key of Object.keys(GPU_PARTICLE_REQUIRED_LIMITS)) {
            limits[key] = rawLimits[key];
        }

        const infoSource =
            /** @type {{info?: {vendor?: string, architecture?: string, device?: string, description?: string}}} */ (
                adapter
            ).info || null;

        return {
            supported: true,
            meetsParticleLimits: failedLimits.length === 0,
            failedLimits,
            features: Array.from(adapter.features || []),
            limits,
            info: infoSource
                ? {
                      vendor: infoSource.vendor,
                      architecture: infoSource.architecture,
                      device: infoSource.device,
                      description: infoSource.description
                  }
                : null,
            adapter
        };
    } catch {
        return empty;
    }
}

/**
 * Check whether the browser supports WebGPU and can host the GPU particle path.
 * @returns {Promise<boolean>}
 */
export async function isWebGPUSupported() {
    const inspection = await inspectWebGPUAdapter();
    return inspection.supported && inspection.meetsParticleLimits;
}

/**
 * Return the appropriate Three.js entry module specifier.
 * @param {boolean} webgpu
 * @returns {string}
 */
export function getRendererModule(webgpu) {
    return webgpu ? 'three/webgpu' : 'three';
}
