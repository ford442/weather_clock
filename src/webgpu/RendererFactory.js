/**
 * Renderer factory — creates the best-available renderer for the current browser.
 *
 * - Tries WebGPU first (via three/webgpu → WebGPURenderer).
 * - Falls back to native WebGLRenderer if WebGPU is unavailable or fails to init.
 *
 * IMPORTANT: WebGPURenderer requires `await renderer.init()` before first use.
 * Also, WebGPURenderer in WebGL fallback mode is significantly slower than
 * native WebGLRenderer, so we always fall back to native WebGLRenderer.
 */

import * as THREE from 'three';
import { isWebGPUSupported } from './WebGPUCapabilities.js';

const DEFAULT_OPTIONS = {
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
    stencil: false,
    clearColor: 0x000000,
    outputColorSpace: THREE.SRGBColorSpace,
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 0.5,
    shadowMapType: THREE.PCFSoftShadowMap
};

/**
 * Create a renderer and append its canvas to the given container.
 * @param {HTMLElement|null} canvasContainer
 * @param {object} [userOptions]
 * @returns {Promise<{renderer: THREE.WebGLRenderer|import('three/webgpu').WebGPURenderer, isWebGPU: boolean}>}
 */
export async function createRenderer(canvasContainer, userOptions = {}) {
    const options = { ...DEFAULT_OPTIONS, ...userOptions };
    const forceWebGL = consumeWebGLFallbackRequest();
    const hasWebGPU = !forceWebGL && (await isWebGPUSupported());

    if (hasWebGPU) {
        try {
            const { WebGPURenderer } = await import('three/webgpu');
            const renderer = new WebGPURenderer({
                antialias: options.antialias,
                alpha: options.alpha,
                powerPreference: options.powerPreference,
                stencil: options.stencil
            });

            // Mandatory async initialisation for WebGPU
            await renderer.init();

            renderer.setClearColor(options.clearColor);
            renderer.outputColorSpace = options.outputColorSpace;
            renderer.toneMapping = options.toneMapping;
            renderer.toneMappingExposure = options.toneMappingExposure;
            renderer.setSize(window.innerWidth, window.innerHeight);
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = options.shadowMapType;

            if (canvasContainer) {
                canvasContainer.appendChild(renderer.domElement);
            }

            console.log('[RendererFactory] Using WebGPU renderer');
            return { renderer, isWebGPU: true };
        } catch (err) {
            console.warn('[RendererFactory] WebGPU init failed, falling back to WebGL:', err);
        }
    }

    // Native WebGL fallback — faster than WebGPURenderer in forced-WebGL mode
    const renderer = new THREE.WebGLRenderer({
        antialias: options.antialias,
        alpha: options.alpha,
        powerPreference: options.powerPreference,
        stencil: options.stencil
    });

    renderer.setClearColor(options.clearColor);
    renderer.outputColorSpace = options.outputColorSpace;
    renderer.toneMapping = options.toneMapping;
    renderer.toneMappingExposure = options.toneMappingExposure;
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = options.shadowMapType;

    if (canvasContainer) {
        canvasContainer.appendChild(renderer.domElement);
    }

    console.log('[RendererFactory] Using WebGL renderer');
    return { renderer, isWebGPU: false };
}

const FORCE_WEBGL_ONCE_KEY = 'weatherclock_force_webgl_once';

function consumeWebGLFallbackRequest() {
    if (typeof sessionStorage === 'undefined') return false;
    try {
        const requested = sessionStorage.getItem(FORCE_WEBGL_ONCE_KEY) === '1';
        if (requested) sessionStorage.removeItem(FORCE_WEBGL_ONCE_KEY);
        return requested;
    } catch (error) {
        console.warn('[RendererFactory] Could not read WebGL fallback request:', error);
        return false;
    }
}

/** Reload once with native WebGL after an unrecoverable WebGPU device loss. */
export function requestWebGLFallback() {
    sessionStorage.setItem(FORCE_WEBGL_ONCE_KEY, '1');
    window.location.reload();
}
