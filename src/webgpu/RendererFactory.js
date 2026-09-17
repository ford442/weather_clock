/**
 * Renderer factory — creates the best-available renderer for the current browser.
 *
 * - Tries WebGPU first (via three/webgpu → WebGPURenderer) after inspecting
 *   adapter features/limits.
 * - Falls back to native WebGLRenderer if WebGPU is unavailable, the adapter
 *   cannot host compute particles, or init fails.
 *
 * IMPORTANT: WebGPURenderer requires `await renderer.init()` before first use.
 * Also, WebGPURenderer in WebGL fallback mode is significantly slower than
 * native WebGLRenderer, so we always fall back to native WebGLRenderer.
 */

import * as THREE from 'three';
import { inspectWebGPUAdapter, GPU_PARTICLE_REQUIRED_LIMITS } from './WebGPUCapabilities.js';
import { SCENE_LAYOUT } from '../scene-layout.js';

/**
 * Every GPU-context flag we pass, documented in one place so photo capture
 * and celestial-sky work do not "fix" them independently.
 *
 * - `preserveDrawingBuffer` stays false: `src/capture/photo.js` captures via
 *   same-task `canvas.toBlob()` and does not need a preserved buffer.
 * - `failIfMajorPerformanceCaveat` is true on the first WebGL attempt so
 *   SwiftShader / software GL does not silently look like a discrete GPU.
 *   Production then retries without the flag and reports `softwareRenderer`.
 *   `?test=1` skips the caveat so Playwright's SwiftShader baselines stay on
 *   the quality tier they were captured with.
 * - `premultipliedAlpha` / `depth` are explicit so WebGPU matches WebGL.
 * - `logarithmicDepthBuffer` follows `SCENE_LAYOUT.depth.mode`. It stays false
 *   while the Three.js `Sky` addon + bloom path is active (log depth over-blooms
 *   the disc). Camera far > sky scale > star sphere still keeps a 2000-unit
 *   star sphere from colliding with the sundial in clip space.
 * - `outputColorSpace` is sRGB; Three r181 configures the WebGL drawing-buffer
 *   color space and the WebGPU `GPUCanvasContext` from this property.
 */
/**
 * @typedef {Object} RendererFactoryOptions
 * @property {boolean} antialias
 * @property {boolean} alpha
 * @property {boolean} premultipliedAlpha
 * @property {boolean} depth
 * @property {boolean} stencil
 * @property {boolean} preserveDrawingBuffer
 * @property {boolean} failIfMajorPerformanceCaveat
 * @property {boolean} logarithmicDepthBuffer
 * @property {'high-performance'|'low-power'|'default'} powerPreference
 * @property {number} clearColor
 * @property {import('three').ColorSpace} outputColorSpace
 * @property {import('three').ToneMapping} toneMapping
 * @property {number} toneMappingExposure
 * @property {import('three').ShadowMapType} shadowMapType
 */

export const DEFAULT_OPTIONS = Object.freeze(
    /** @type {RendererFactoryOptions} */ ({
        antialias: true,
        alpha: false,
        premultipliedAlpha: true,
        depth: true,
        stencil: false,
        preserveDrawingBuffer: false,
        failIfMajorPerformanceCaveat: true,
        logarithmicDepthBuffer: SCENE_LAYOUT.depth.mode !== 'linear',
        powerPreference: 'high-performance',
        clearColor: 0x000000,
        outputColorSpace: THREE.SRGBColorSpace,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 0.5,
        shadowMapType: THREE.PCFSoftShadowMap
    })
);

/**
 * @typedef {Object} RendererInfo
 * @property {'webgpu'|'webgl'} backend
 * @property {boolean} softwareRenderer
 * @property {boolean} logarithmicDepthBuffer
 * @property {boolean} preserveDrawingBuffer
 * @property {boolean} failIfMajorPerformanceCaveat
 * @property {boolean} premultipliedAlpha
 * @property {boolean} depth
 * @property {boolean} stencil
 * @property {boolean} alpha
 * @property {string|null} adapterName
 * @property {string[]|null} features
 * @property {Record<string, number>|null} limits
 * @property {Record<string, boolean|number|string>|null} contextAttributes
 */

/** @type {RendererInfo|null} */
let lastRendererInfo = null;

/** @returns {RendererInfo|null} */
export function getRendererInfo() {
    return lastRendererInfo;
}

function isTestMode() {
    if (typeof window === 'undefined' || !window.location) return false;
    try {
        return new URLSearchParams(window.location.search).get('test') === '1';
    } catch {
        return false;
    }
}

/**
 * @param {THREE.WebGLRenderer} renderer
 * @returns {boolean}
 */
function detectSoftwareWebGL(renderer) {
    try {
        const gl = renderer.getContext();
        if (!gl) return false;
        const debugInfo = gl.getExtension?.('WEBGL_debug_renderer_info');
        const rendererName = debugInfo
            ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '')
            : String(gl.getParameter(gl.RENDERER) || '');
        return /swiftshader|llvmpipe|softpipe|microsoft basic render|cpu rasterizer|software/i.test(rendererName);
    } catch {
        return false;
    }
}

/**
 * @param {RendererFactoryOptions} options
 * @param {boolean} failIfMajorPerformanceCaveat
 */
function webglConstructorParams(options, failIfMajorPerformanceCaveat) {
    return {
        antialias: options.antialias,
        alpha: options.alpha,
        premultipliedAlpha: options.premultipliedAlpha,
        depth: options.depth,
        stencil: options.stencil,
        preserveDrawingBuffer: options.preserveDrawingBuffer,
        powerPreference: options.powerPreference,
        failIfMajorPerformanceCaveat,
        logarithmicDepthBuffer: options.logarithmicDepthBuffer
    };
}

/**
 * @param {THREE.WebGLRenderer|import('three/webgpu').WebGPURenderer} renderer
 * @param {RendererFactoryOptions} options
 */
function applySharedRendererState(renderer, options) {
    renderer.setClearColor(options.clearColor);
    renderer.outputColorSpace = options.outputColorSpace;
    renderer.toneMapping = options.toneMapping;
    renderer.toneMappingExposure = options.toneMappingExposure;
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = options.shadowMapType;
}

/**
 * Create a renderer and append its canvas to the given container.
 * @param {HTMLElement|null} canvasContainer
 * @param {Partial<RendererFactoryOptions>} [userOptions]
 * @returns {Promise<{renderer: THREE.WebGLRenderer|import('three/webgpu').WebGPURenderer, isWebGPU: boolean, softwareRenderer: boolean, info: RendererInfo}>}
 */
export async function createRenderer(canvasContainer, userOptions = {}) {
    const options = /** @type {RendererFactoryOptions} */ ({ ...DEFAULT_OPTIONS, ...userOptions });
    const forceWebGL = hasForceWebGLParam() || consumeWebGLFallbackRequest();
    const testMode = isTestMode();

    /** @type {import('./WebGPUCapabilities.js').WebGPUAdapterInspection|null} */
    let inspection = null;
    if (!forceWebGL) {
        inspection = await inspectWebGPUAdapter();
        if (inspection.supported && !inspection.meetsParticleLimits) {
            console.warn(
                '[RendererFactory] WebGPU adapter rejected for GPU particles:',
                inspection.failedLimits,
                inspection.limits
            );
        } else if (inspection.supported) {
            console.log('[RendererFactory] WebGPU adapter', {
                info: inspection.info,
                features: inspection.features,
                limits: inspection.limits,
                requiredLimits: GPU_PARTICLE_REQUIRED_LIMITS
            });
        }
    }

    if (!forceWebGL && inspection?.supported && inspection.meetsParticleLimits) {
        try {
            const { WebGPURenderer } = await import('three/webgpu');
            const renderer = new WebGPURenderer({
                antialias: options.antialias,
                alpha: options.alpha,
                premultipliedAlpha: options.premultipliedAlpha,
                depth: options.depth,
                stencil: options.stencil,
                preserveDrawingBuffer: options.preserveDrawingBuffer,
                powerPreference: options.powerPreference,
                logarithmicDepthBuffer: options.logarithmicDepthBuffer,
                requiredLimits: { ...GPU_PARTICLE_REQUIRED_LIMITS }
            });

            await renderer.init();

            applySharedRendererState(renderer, options);

            if (canvasContainer) {
                canvasContainer.appendChild(renderer.domElement);
            }

            lastRendererInfo = {
                backend: 'webgpu',
                softwareRenderer: false,
                logarithmicDepthBuffer: !!options.logarithmicDepthBuffer,
                preserveDrawingBuffer: false,
                failIfMajorPerformanceCaveat: false,
                premultipliedAlpha: !!options.premultipliedAlpha,
                depth: !!options.depth,
                stencil: !!options.stencil,
                alpha: !!options.alpha,
                adapterName: inspection.info?.description || inspection.info?.device || null,
                features: inspection.features,
                limits: inspection.limits,
                contextAttributes: {
                    outputColorSpace: String(options.outputColorSpace),
                    logarithmicDepthBuffer: !!options.logarithmicDepthBuffer
                }
            };

            console.log('[RendererFactory] Using WebGPU renderer');
            return { renderer, isWebGPU: true, softwareRenderer: false, info: lastRendererInfo };
        } catch (err) {
            console.warn('[RendererFactory] WebGPU init failed, falling back to WebGL:', err);
        }
    }

    const tryCaveat = options.failIfMajorPerformanceCaveat && !testMode;
    /** @type {THREE.WebGLRenderer} */
    let renderer;
    let usedCaveat = tryCaveat;
    let softwareRenderer = false;

    try {
        renderer = new THREE.WebGLRenderer(webglConstructorParams(options, tryCaveat));
    } catch (err) {
        console.warn(
            '[RendererFactory] Hardware WebGL unavailable (failIfMajorPerformanceCaveat); retrying software path:',
            err
        );
        renderer = new THREE.WebGLRenderer(webglConstructorParams(options, false));
        usedCaveat = false;
        softwareRenderer = true;
    }

    if (!softwareRenderer && detectSoftwareWebGL(renderer) && !testMode) {
        softwareRenderer = true;
        console.warn('[RendererFactory] Software WebGL detected; session quality should drop to low.');
    }

    applySharedRendererState(renderer, options);

    if (canvasContainer) {
        canvasContainer.appendChild(renderer.domElement);
    }

    const gl = renderer.getContext?.();
    const contextAttributes = gl?.getContextAttributes?.() || null;

    lastRendererInfo = {
        backend: 'webgl',
        softwareRenderer,
        logarithmicDepthBuffer: !!options.logarithmicDepthBuffer,
        preserveDrawingBuffer: false,
        failIfMajorPerformanceCaveat: usedCaveat,
        premultipliedAlpha: !!options.premultipliedAlpha,
        depth: !!options.depth,
        stencil: !!options.stencil,
        alpha: !!options.alpha,
        adapterName: null,
        features: null,
        limits: null,
        contextAttributes: contextAttributes
            ? {
                  alpha: contextAttributes.alpha,
                  depth: contextAttributes.depth,
                  stencil: contextAttributes.stencil,
                  antialias: contextAttributes.antialias,
                  premultipliedAlpha: contextAttributes.premultipliedAlpha,
                  preserveDrawingBuffer: contextAttributes.preserveDrawingBuffer,
                  failIfMajorPerformanceCaveat: contextAttributes.failIfMajorPerformanceCaveat,
                  powerPreference: contextAttributes.powerPreference
              }
            : null
    };

    console.log('[RendererFactory] Using WebGL renderer', softwareRenderer ? '(software)' : '');
    return { renderer, isWebGPU: false, softwareRenderer, info: lastRendererInfo };
}

const FORCE_WEBGL_ONCE_KEY = 'weatherclock_force_webgl_once';

/**
 * `?forceWebGL=1` pins the session to the native WebGL renderer.
 *
 * Unlike the one-shot sessionStorage request below, this is sticky for as long as
 * the parameter is in the URL, so the WebGL path can be compared side by side with
 * the default (WebGPU-first) path on the same machine.
 */
function hasForceWebGLParam() {
    if (typeof window === 'undefined' || !window.location) return false;
    try {
        return new URLSearchParams(window.location.search).get('forceWebGL') === '1';
    } catch (error) {
        console.warn('[RendererFactory] Could not read forceWebGL parameter:', error);
        return false;
    }
}

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
