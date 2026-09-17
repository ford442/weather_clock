import { afterEach, describe, expect, it, vi } from 'vitest';

const constructors = [];
let throwOnCaveat = false;
let rendererName = 'NVIDIA GeForce';

vi.mock('three', async () => {
    const actual = await vi.importActual('three');
    class MockWebGLRenderer {
        constructor(params) {
            constructors.push(params);
            if (throwOnCaveat && params.failIfMajorPerformanceCaveat) {
                throw new Error('WEBGL_fail_if_major_performance_caveat');
            }
            this.domElement = { nodeName: 'CANVAS' };
            this.shadowMap = {};
            this.params = params;
        }
        setClearColor() {}
        setSize() {}
        getContext() {
            return {
                RENDERER: 0x1f01,
                getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 0x9246 }),
                getParameter: () => rendererName,
                getContextAttributes: () => ({
                    alpha: false,
                    depth: true,
                    stencil: false,
                    antialias: true,
                    premultipliedAlpha: true,
                    preserveDrawingBuffer: false,
                    failIfMajorPerformanceCaveat: !!this.params.failIfMajorPerformanceCaveat,
                    powerPreference: 'high-performance'
                })
            };
        }
    }
    return { ...actual, WebGLRenderer: MockWebGLRenderer };
});

import {
    GPU_PARTICLE_REQUIRED_LIMITS,
    inspectWebGPUAdapter,
    isWebGPUSupported,
    listFailedParticleLimits
} from '../webgpu/WebGPUCapabilities.js';
import { createRenderer, DEFAULT_OPTIONS, getRendererInfo } from '../webgpu/RendererFactory.js';

function limits(overrides = {}) {
    return { ...GPU_PARTICLE_REQUIRED_LIMITS, ...overrides };
}

describe('WebGPU adapter inspection', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('rejects adapters whose limits cannot host GPU particles or 2K shadows', async () => {
        const adapter = {
            features: new Set(['timestamp-query']),
            limits: limits({ maxTextureDimension2D: 1024, maxStorageBufferBindingSize: 256 }),
            info: { vendor: 'stub', description: 'Low-limit adapter' }
        };
        expect(listFailedParticleLimits(adapter).length).toBeGreaterThan(0);
        vi.stubGlobal('navigator', {
            gpu: { requestAdapter: vi.fn().mockResolvedValue(adapter) }
        });
        const inspection = await inspectWebGPUAdapter();
        expect(inspection.supported).toBe(true);
        expect(inspection.meetsParticleLimits).toBe(false);
        expect(await isWebGPUSupported()).toBe(false);
    });

    it('accepts a conforming adapter and reports features/limits/info', async () => {
        const adapter = {
            features: new Set(['float32-filterable']),
            limits: limits(),
            info: { vendor: 'test', architecture: 'mock', device: 'gpu0', description: 'Mock GPU' }
        };
        vi.stubGlobal('navigator', {
            gpu: { requestAdapter: vi.fn().mockResolvedValue(adapter) }
        });
        const inspection = await inspectWebGPUAdapter();
        expect(inspection.meetsParticleLimits).toBe(true);
        expect(inspection.features).toContain('float32-filterable');
        expect(inspection.info?.description).toBe('Mock GPU');
        expect(inspection.limits.maxTextureDimension2D).toBe(2048);
        expect(await isWebGPUSupported()).toBe(true);
    });
});

describe('RendererFactory context flags', () => {
    afterEach(() => {
        constructors.length = 0;
        throwOnCaveat = false;
        rendererName = 'NVIDIA GeForce';
        vi.unstubAllGlobals();
    });

    it('documents preserveDrawingBuffer false, linear depth, and premultiplied alpha', () => {
        expect(DEFAULT_OPTIONS.preserveDrawingBuffer).toBe(false);
        expect(DEFAULT_OPTIONS.logarithmicDepthBuffer).toBe(false);
        expect(DEFAULT_OPTIONS.premultipliedAlpha).toBe(true);
        expect(DEFAULT_OPTIONS.depth).toBe(true);
        expect(DEFAULT_OPTIONS.failIfMajorPerformanceCaveat).toBe(true);
        expect(DEFAULT_OPTIONS.stencil).toBe(false);
        expect(DEFAULT_OPTIONS.alpha).toBe(false);
    });

    it('retries without failIfMajorPerformanceCaveat and marks software WebGL', async () => {
        throwOnCaveat = true;
        rendererName = 'SwiftShader';
        vi.stubGlobal('window', {
            innerWidth: 800,
            innerHeight: 600,
            location: { search: '' }
        });
        vi.stubGlobal('navigator', {});
        vi.stubGlobal('sessionStorage', {
            getItem: () => null,
            setItem: vi.fn(),
            removeItem: vi.fn()
        });

        const result = await createRenderer(null);
        expect(result.isWebGPU).toBe(false);
        expect(result.softwareRenderer).toBe(true);
        expect(constructors[0].failIfMajorPerformanceCaveat).toBe(true);
        expect(constructors[1].failIfMajorPerformanceCaveat).toBe(false);
        expect(constructors[0].logarithmicDepthBuffer).toBe(false);
        expect(constructors[0].preserveDrawingBuffer).toBe(false);
        expect(constructors[0].premultipliedAlpha).toBe(true);
        expect(constructors[0].depth).toBe(true);
        expect(getRendererInfo()?.backend).toBe('webgl');
        expect(getRendererInfo()?.softwareRenderer).toBe(true);
        expect(getRendererInfo()?.preserveDrawingBuffer).toBe(false);
    });

    it('does not apply the performance caveat in ?test=1 so SwiftShader baselines keep quality', async () => {
        throwOnCaveat = true;
        rendererName = 'Google SwiftShader';
        vi.stubGlobal('window', {
            innerWidth: 800,
            innerHeight: 600,
            location: { search: '?test=1' }
        });
        vi.stubGlobal('navigator', {});
        vi.stubGlobal('sessionStorage', {
            getItem: () => null,
            setItem: vi.fn(),
            removeItem: vi.fn()
        });

        const result = await createRenderer(null);
        expect(constructors).toHaveLength(1);
        expect(constructors[0].failIfMajorPerformanceCaveat).toBe(false);
        expect(result.softwareRenderer).toBe(false);
    });
});
