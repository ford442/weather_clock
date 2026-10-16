import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SCENE_LAYOUT } from '../scene-layout.js';
import {
    FORECAST_PRIMITIVE,
    generateCloudNoiseJS,
    generateForecastPrimitivesJS,
    stepParticlesJS
} from '../native/js-kernels.js';
import {
    getRequestedNativeKernels,
    initializeNativeRuntime,
    resetNativeRuntimeForTests
} from '../native/native-runtime.js';

afterEach(() => {
    resetNativeRuntimeForTests();
    vi.restoreAllMocks();
});

describe('native kernel JavaScript contracts', () => {
    it('generates deterministic single-channel fractal cloud noise', () => {
        const first = generateCloudNoiseJS(16, 8, 3, 42);
        const second = generateCloudNoiseJS(16, 8, 3, 42);
        expect(first).toEqual(second);
        expect(first).toHaveLength(128);
        expect(new Set(first).size).toBeGreaterThan(10);
    });

    it('steps point particles in place with zone wrapping', () => {
        const positions = new Float32Array([3.99, 2, 0]);
        const velocities = new Float32Array([0.1, -0.05, 0]);
        const offsets = new Float32Array([0]);
        stepParticlesJS(positions, velocities, offsets, 1, 0.1, 0, 1 / 60, {
            mode: 0,
            minX: -4,
            maxX: 4,
            time: 1
        });
        expect(positions[0]).toBeLessThan(0);
        expect(positions[1]).toBeLessThan(2);
    });

    it('defaults the Z wrap to SCENE_LAYOUT.volume', () => {
        const positions = new Float32Array([0, 2, SCENE_LAYOUT.volume.maxZ - 0.01]);
        const velocities = new Float32Array([0, 0, 0]);
        stepParticlesJS(positions, velocities, null, 1, 0, 0.5, 1 / 60, { mode: 0 });
        expect(positions[2]).toBeGreaterThanOrEqual(SCENE_LAYOUT.volume.minZ);
        expect(positions[2]).toBeLessThan(SCENE_LAYOUT.volume.minZ + 1);
    });

    it('packs deterministic cloud and precipitation primitives', () => {
        const output = new Float32Array(32 * 6);
        const result = generateForecastPrimitivesJS(output, {
            width: 120,
            height: 72,
            cloudCover: 100,
            precipType: FORECAST_PRIMITIVE.RAIN,
            precipIntensity: 1,
            windSpeed: 20,
            windDir: 180,
            timeMs: 1000
        });
        expect(result.cloudCount).toBe(5);
        expect(result.precipitationCount).toBe(13);
        expect(result.count).toBe(18);
        expect(result.data[0]).toBe(FORECAST_PRIMITIVE.CLOUD);
        expect(result.data[5 * 6]).toBe(FORECAST_PRIMITIVE.RAIN);
    });
});

describe('native runtime facade', () => {
    it('honors URL overrides independently of adoption defaults', () => {
        expect(getRequestedNativeKernels('?native=0')).toEqual([]);
        expect(getRequestedNativeKernels('?native=1')).toEqual(['cloudNoise', 'particles', 'forecast']);
        expect(getRequestedNativeKernels('')).toEqual([]);
    });

    it('falls back to JavaScript when the dynamic import fails', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const runtime = await initializeNativeRuntime({
            kernels: ['cloudNoise', 'particles', 'forecast'],
            loader: () => Promise.reject(new Error('blocked'))
        });
        expect(runtime.backend).toBe('js');
        expect(runtime.error.message).toBe('blocked');
        expect(runtime.generateCloudNoise(4, 4, 2, 1)).toHaveLength(16);
    });

    it('uses zero-copy heap views and matches the JS kernels', async () => {
        const runtime = await initializeNativeRuntime({ kernels: ['cloudNoise', 'particles', 'forecast'] });
        expect(runtime.backends).toEqual({
            cloudNoise: 'wasm-simd',
            particles: 'wasm-simd',
            forecast: 'wasm-simd'
        });

        expect(runtime.generateCloudNoise(32, 16, 3, 42)).toEqual(generateCloudNoiseJS(32, 16, 3, 42));

        const wasmBuffers = runtime.allocateParticleBuffers(4, 3);
        const jsPositions = new Float32Array([3.9, 2, 1, -2, 8, -1, 0, 5, 3, 1, 4, -2]);
        const jsVelocities = new Float32Array([0.1, -0.05, 0, 0, -0.03, 0.02, -0.1, -0.04, 0, 0, -0.02, 0.03]);
        const jsOffsets = new Float32Array([0, 10, 20, 30]);
        wasmBuffers.positions.set(jsPositions);
        wasmBuffers.velocities.set(jsVelocities);
        wasmBuffers.offsets.set(jsOffsets);
        const attribute = new THREE.BufferAttribute(wasmBuffers.positions, 3);
        expect(attribute.array).toBe(wasmBuffers.positions);

        const options = { mode: 0, minX: -4, maxX: 4, time: 2 };
        stepParticlesJS(jsPositions, jsVelocities, jsOffsets, 4, 0.02, -0.01, 1 / 60, options);
        runtime.stepParticles(wasmBuffers, 4, 0.02, -0.01, 1 / 60, options);
        for (let i = 0; i < jsPositions.length; i++) {
            expect(wasmBuffers.positions[i]).toBeCloseTo(jsPositions[i], 4);
        }

        const inputs = {
            width: 120,
            height: 72,
            cloudCover: 88,
            precipType: FORECAST_PRIMITIVE.SNOW,
            precipIntensity: 0.8,
            windSpeed: 20,
            windDir: 240,
            timeMs: 5000
        };
        const jsForecast = new Float32Array(32 * 6);
        const jsResult = generateForecastPrimitivesJS(jsForecast, inputs);
        const wasmForecast = runtime.allocateForecastBuffer();
        const wasmResult = runtime.generateForecastPrimitives(wasmForecast, inputs);
        expect(wasmResult.count).toBe(jsResult.count);
        for (let i = 0; i < jsResult.data.length; i++) {
            expect(wasmResult.data[i]).toBeCloseTo(jsResult.data[i], 3);
        }

        // Lockstep on the Z wrap too: push every mode across the volume edge.
        for (const mode of [0, 1, 2]) {
            const stride = mode === 1 ? 6 : 3;
            const jsBuffers = {
                positions: new Float32Array(4 * stride),
                velocities: new Float32Array(12),
                offsets: new Float32Array([0, 10, 20, 30])
            };
            for (let i = 0; i < 4; i++) {
                for (let k = 0; k < stride; k += 3) {
                    jsBuffers.positions[i * stride + k] = -3 + i;
                    jsBuffers.positions[i * stride + k + 1] = 4 + i;
                    jsBuffers.positions[i * stride + k + 2] = 7.9 - i * 5.3;
                }
                jsBuffers.velocities[i * 3 + 1] = -0.01;
            }
            const zBuffers = runtime.allocateParticleBuffers(4, stride);
            zBuffers.positions.set(jsBuffers.positions);
            zBuffers.velocities.set(jsBuffers.velocities);
            zBuffers.offsets.set(jsBuffers.offsets);
            const zOptions = { mode, minX: -4, maxX: 4, minZ: -8, maxZ: 8, time: 3 };
            for (let frame = 0; frame < 30; frame++) {
                stepParticlesJS(
                    jsBuffers.positions,
                    jsBuffers.velocities,
                    jsBuffers.offsets,
                    4,
                    0.03,
                    0.4,
                    0.05,
                    zOptions
                );
                runtime.stepParticles(zBuffers, 4, 0.03, 0.4, 0.05, zOptions);
            }
            for (let i = 0; i < jsBuffers.positions.length; i++) {
                expect(zBuffers.positions[i]).toBeCloseTo(jsBuffers.positions[i], 3);
            }
            zBuffers.dispose();
        }

        wasmBuffers.dispose();
        wasmBuffers.dispose();
        wasmForecast.dispose();
        expect(wasmBuffers.disposed).toBe(true);
        expect(wasmForecast.disposed).toBe(true);
    });
});

describe('particle volume containment under wind and time-warp (#151)', () => {
    const { minZ, maxZ } = SCENE_LAYOUT.volume;
    const zone = SCENE_LAYOUT.zones.past;

    /**
     * @param {{positions: Float32Array, velocities: Float32Array, offsets: Float32Array}} buffers
     * @param {(windZ: number, options: object) => void} step
     * @param {number} mode
     */
    function runGale(buffers, step, mode) {
        const stride = mode === 1 ? 6 : 3;
        const count = buffers.offsets.length;
        for (let i = 0; i < count; i++) {
            const x = zone.minX + ((i * 0.37) % (zone.maxX - zone.minX));
            const z = minZ + ((i * 1.13) % (maxZ - minZ));
            for (let k = 0; k < stride; k += 3) {
                buffers.positions[i * stride + k] = x;
                buffers.positions[i * stride + k + 1] = 5;
                buffers.positions[i * stride + k + 2] = z;
            }
            buffers.offsets[i] = i;
        }
        const options = { mode, minX: zone.minX, maxX: zone.maxX, minZ, maxZ, time: 0 };
        // 3600 frames at a time-warp-sized dt (frameScale clamps at 3) with a
        // strong +Z wind, then the same pushing -Z.
        for (const windZ of [0.6, -0.6]) {
            for (let frame = 0; frame < 3600; frame++) {
                options.time = frame * 0.05;
                step(windZ, options);
            }
            for (let i = 0; i < count; i++) {
                const head = mode === 1 ? 3 : 0;
                const x = buffers.positions[i * stride + head];
                const z = buffers.positions[i * stride + head + 2];
                expect(Number.isFinite(z)).toBe(true);
                expect(x).toBeGreaterThanOrEqual(zone.minX);
                expect(x).toBeLessThanOrEqual(zone.maxX);
                expect(z).toBeGreaterThanOrEqual(minZ);
                expect(z).toBeLessThanOrEqual(maxZ);
            }
        }
    }

    for (const mode of [0, 1, 2]) {
        it(`JS kernel keeps mode ${mode} inside the zone X and volume Z`, () => {
            const stride = mode === 1 ? 6 : 3;
            const buffers = {
                positions: new Float32Array(64 * stride),
                velocities: new Float32Array(64 * 3),
                offsets: new Float32Array(64)
            };
            runGale(
                buffers,
                (windZ, options) =>
                    stepParticlesJS(
                        buffers.positions,
                        buffers.velocities,
                        buffers.offsets,
                        64,
                        0.05,
                        windZ,
                        0.05,
                        options
                    ),
                mode
            );
        });

        it(`WASM kernel keeps mode ${mode} inside the zone X and volume Z`, async () => {
            const runtime = await initializeNativeRuntime({ kernels: ['particles'] });
            expect(runtime.backends.particles).toBe('wasm-simd');
            const buffers = runtime.allocateParticleBuffers(64, mode === 1 ? 6 : 3);
            try {
                runGale(
                    buffers,
                    (windZ, options) => runtime.stepParticles(buffers, 64, 0.05, windZ, 0.05, options),
                    mode
                );
            } finally {
                buffers.dispose();
            }
        });
    }
});
