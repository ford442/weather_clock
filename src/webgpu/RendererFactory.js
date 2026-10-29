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
 * - `logarithmicDepthBuffer` follows `SCENE_LAYOUT.depth.mode` ('logarithmic'
 *   on both backends since the in-repo sky material replaced the Three.js `Sky`
 *   addon; that material never touches depth). Reverse-Z is not used: Three
 *   r181's `WebGPURenderer` has no `reversedDepthBuffer` option (only
 *   `WebGLRenderer` does, behind `EXT_clip_control`), so WebGPU runs log depth
 *   too. `reversedDepthBuffer` is reported as false for that reason. Camera
 *   far > sky scale > star sphere still holds.
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
 * @property {boolean} reversedDepthBuffer
 * @property {'linear'|'logarithmic'} depthMode
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
 * Probe, on a throwaway canvas, whether the browser will hand out a WebGL context under
 * `failIfMajorPerformanceCaveat: true` (i.e. hardware-backed). Lets us skip constructing a
 * `THREE.WebGLRenderer` that is doomed to fail: when `getContext` returns null three keeps
 * building and dies on an uninitialised internal with a misleading `TypeError`.
 *
 * Returns `true` when it cannot tell (no DOM), so the constructor's own try/catch still applies.
 * @returns {boolean}
 */
function canCreateHardwareWebGLContext() {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return true;
    try {
        const probe = document.createElement('canvas');
        if (typeof probe.getContext !== 'function') return true;
        const attrs = { failIfMajorPerformanceCaveat: true };
        const gl = probe.getContext('webgl2', attrs) || probe.getContext('webgl', attrs);
        if (!gl) return false;
        /** @type {WEBGL_lose_context|null} */
        const lose = /** @type {any} */ (gl).getExtension?.('WEBGL_lose_context') ?? null;
        lose?.loseContext();
        return true;
    } catch {
        return true;
    }
}

/**
 * A fresh canvas for the retry, so nothing from the failed attempt (a context already bound
 * with different attributes) leaks into it. `undefined` lets three create its own.
 * @returns {HTMLCanvasElement|undefined}
 */
function freshCanvas() {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return undefined;
    return document.createElement('canvas');
}

/**
 * @param {HTMLElement|null} container
 */
function showWebGLUnavailable(container) {
    if (!container || typeof document === 'undefined') return;
    const msg = document.createElement('div');
    msg.setAttribute('role', 'alert');
    msg.className = 'webgl-unavailable';
    msg.style.cssText =
        'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
        'padding:24px;text-align:center;color:#fff;font:16px system-ui,sans-serif;';
    msg.textContent = 'WebGL is unavailable in this browser, so the 3D weather clock cannot be shown.';
    container.appendChild(msg);
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
                logarithmicDepthBuffer: !!(renderer.logarithmicDepthBuffer ?? options.logarithmicDepthBuffer),
                reversedDepthBuffer: false,
                depthMode: SCENE_LAYOUT.depth.mode,
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

    // Only ask for a caveat-enforced context if the probe says one can exist; otherwise go
    // straight to the software path instead of letting three build a renderer that must fail.
    const tryCaveat = options.failIfMajorPerformanceCaveat && !testMode && canCreateHardwareWebGLContext();
    /** @type {THREE.WebGLRenderer} */
    let renderer;
    let usedCaveat = tryCaveat;
    let softwareRenderer = false;

    if (options.failIfMajorPerformanceCaveat && !testMode && !tryCaveat) {
        console.info('[RendererFactory] Hardware WebGL unavailable; using software WebGL');
        softwareRenderer = true;
    }

    try {
        renderer = new THREE.WebGLRenderer(webglConstructorParams(options, tryCaveat));
    } catch (err) {
        if (!tryCaveat) {
            showWebGLUnavailable(canvasContainer);
            throw new Error('WebGL unavailable: could not create a WebGL context', { cause: err });
        }
        console.info('[RendererFactory] Hardware WebGL unavailable; using software WebGL');
        try {
            renderer = new THREE.WebGLRenderer({
                ...webglConstructorParams(options, false),
                canvas: freshCanvas()
            });
        } catch (retryErr) {
            showWebGLUnavailable(canvasContainer);
            throw new Error('WebGL unavailable: could not create a WebGL context', { cause: retryErr });
        }
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
        logarithmicDepthBuffer: !!(renderer.capabilities?.logarithmicDepthBuffer ?? options.logarithmicDepthBuffer),
        reversedDepthBuffer: !!renderer.capabilities?.reversedDepthBuffer,
        depthMode: SCENE_LAYOUT.depth.mode,
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
