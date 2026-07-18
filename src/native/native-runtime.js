import {
    FORECAST_PRIMITIVE_CAPACITY,
    FORECAST_PRIMITIVE_STRIDE,
    NATIVE_KERNELS,
    generateCloudNoiseJS,
    generateForecastPrimitivesJS,
    stepParticlesJS
} from './js-kernels.js';

// Flip individual entries only after the authoritative throttled-browser gate
// documented in docs/WASM_EXPERIMENT.md clears 2x in every measured run.
export const NATIVE_ADOPTION = Object.freeze({
    [NATIVE_KERNELS.CLOUD_NOISE]: false,
    [NATIVE_KERNELS.PARTICLES]: false,
    [NATIVE_KERNELS.FORECAST]: false
});

const ALL_KERNELS = Object.freeze(Object.values(NATIVE_KERNELS));
let activeRuntime = createJSRuntime();

function createJSAllocation(count, positionStride) {
    return {
        backend: 'js',
        positions: new Float32Array(count * positionStride),
        velocities: new Float32Array(count * 3),
        offsets: new Float32Array(count),
        disposed: false,
        dispose() {
            this.disposed = true;
        }
    };
}

function createJSForecastBuffer(capacity) {
    return {
        backend: 'js',
        capacity,
        values: new Float32Array(capacity * FORECAST_PRIMITIVE_STRIDE),
        disposed: false,
        dispose() {
            this.disposed = true;
        }
    };
}

export function createJSRuntime(error = null) {
    const backends = Object.fromEntries(ALL_KERNELS.map((kernel) => [kernel, 'js']));
    return {
        backend: 'js',
        backends,
        error,
        isEnabled() {
            return false;
        },
        generateCloudNoise: generateCloudNoiseJS,
        allocateParticleBuffers: createJSAllocation,
        stepParticles(buffers, count, windX, windZ, dt, options) {
            stepParticlesJS(buffers.positions, buffers.velocities, buffers.offsets, count, windX, windZ, dt, options);
        },
        allocateForecastBuffer: createJSForecastBuffer,
        generateForecastPrimitives(buffer, inputs) {
            return generateForecastPrimitivesJS(buffer.values, inputs);
        }
    };
}

function createWasmRuntime(module, enabledKernels) {
    const enabled = new Set(enabledKernels);
    const allocations = new Set();
    const backends = Object.fromEntries(
        ALL_KERNELS.map((kernel) => [kernel, enabled.has(kernel) ? 'wasm-simd' : 'js'])
    );

    const allocate = (byteLength) => {
        const pointer = module._malloc(byteLength);
        if (!pointer) throw new Error(`WASM allocation failed for ${byteLength} bytes`);
        return pointer;
    };

    const release = (allocation, pointers) => {
        if (!allocations.delete(allocation)) return;
        for (const pointer of pointers) module._free(pointer);
        allocation.disposed = true;
    };

    return {
        backend: enabled.size > 0 ? 'wasm-simd' : 'js',
        backends,
        error: null,
        isEnabled(kernel) {
            return enabled.has(kernel);
        },
        generateCloudNoise(width, height, octaves = 4, seed = 1) {
            if (!enabled.has(NATIVE_KERNELS.CLOUD_NOISE)) {
                return generateCloudNoiseJS(width, height, octaves, seed);
            }
            const byteLength = width * height;
            const pointer = allocate(byteLength);
            try {
                module._generate_cloud_noise(pointer, width, height, octaves, seed >>> 0);
                return module.HEAPU8.slice(pointer, pointer + byteLength);
            } finally {
                module._free(pointer);
            }
        },
        allocateParticleBuffers(count, positionStride = 3) {
            if (!enabled.has(NATIVE_KERNELS.PARTICLES)) return createJSAllocation(count, positionStride);
            const positionPointer = allocate(count * positionStride * 4);
            const velocityPointer = allocate(count * 3 * 4);
            const offsetPointer = allocate(count * 4);
            const allocation = {
                backend: 'wasm-simd',
                positionPointer,
                velocityPointer,
                offsetPointer,
                positions: new Float32Array(module.HEAPF32.buffer, positionPointer, count * positionStride),
                velocities: new Float32Array(module.HEAPF32.buffer, velocityPointer, count * 3),
                offsets: new Float32Array(module.HEAPF32.buffer, offsetPointer, count),
                disposed: false,
                dispose() {
                    release(allocation, [positionPointer, velocityPointer, offsetPointer]);
                }
            };
            allocations.add(allocation);
            return allocation;
        },
        stepParticles(buffers, count, windX, windZ, dt, options = {}) {
            if (buffers.backend !== 'wasm-simd') {
                stepParticlesJS(
                    buffers.positions,
                    buffers.velocities,
                    buffers.offsets,
                    count,
                    windX,
                    windZ,
                    dt,
                    options
                );
                return;
            }
            module._step_particles(
                buffers.positionPointer,
                buffers.velocityPointer,
                buffers.offsetPointer,
                count,
                windX,
                windZ,
                dt,
                options.mode || 0,
                options.minX ?? -8,
                options.maxX ?? 8,
                options.time || 0
            );
        },
        allocateForecastBuffer(capacity = FORECAST_PRIMITIVE_CAPACITY) {
            if (!enabled.has(NATIVE_KERNELS.FORECAST)) return createJSForecastBuffer(capacity);
            const pointer = allocate(capacity * FORECAST_PRIMITIVE_STRIDE * 4);
            const allocation = {
                backend: 'wasm-simd',
                pointer,
                capacity,
                values: new Float32Array(module.HEAPF32.buffer, pointer, capacity * FORECAST_PRIMITIVE_STRIDE),
                disposed: false,
                dispose() {
                    release(allocation, [pointer]);
                }
            };
            allocations.add(allocation);
            return allocation;
        },
        generateForecastPrimitives(buffer, inputs = {}) {
            if (buffer.backend !== 'wasm-simd') return generateForecastPrimitivesJS(buffer.values, inputs);
            const {
                width = 120,
                height = 72,
                cloudCover = 0,
                precipType = 0,
                precipIntensity = 0,
                windSpeed = 0,
                windDir = 0,
                timeMs = 0
            } = inputs;
            const count = module._generate_forecast_primitives(
                buffer.pointer,
                buffer.capacity,
                width,
                height,
                cloudCover,
                precipType,
                precipIntensity,
                windSpeed,
                windDir,
                timeMs
            );
            let cloudCount = 0;
            let precipitationCount = 0;
            for (let i = 0; i < count; i++) {
                if (buffer.values[i * FORECAST_PRIMITIVE_STRIDE] === 0) cloudCount += 1;
                else precipitationCount += 1;
            }
            return {
                count,
                cloudCount,
                precipitationCount,
                data: buffer.values.subarray(0, count * FORECAST_PRIMITIVE_STRIDE)
            };
        }
    };
}

export function getRequestedNativeKernels(search = globalThis.location?.search || '') {
    const override = new URLSearchParams(search).get('native');
    if (override === '1') return [...ALL_KERNELS];
    if (override === '0') return [];
    return ALL_KERNELS.filter((kernel) => NATIVE_ADOPTION[kernel]);
}

/**
 * @param {{kernels?: string[], loader?: (() => Promise<{default: Function}>)}} [options]
 */
export async function initializeNativeRuntime(options = {}) {
    const { kernels = getRequestedNativeKernels(), loader } = options;
    if (kernels.length === 0) {
        activeRuntime = createJSRuntime();
        return activeRuntime;
    }
    try {
        const load = loader || (() => import('../../native/dist/weather-native.mjs'));
        const { default: createWeatherNative } = await load();
        const module = await createWeatherNative();
        activeRuntime = createWasmRuntime(module, kernels);
    } catch (error) {
        console.warn('[NativeRuntime] WASM unavailable; using JavaScript kernels.', error);
        activeRuntime = createJSRuntime(error);
    }
    return activeRuntime;
}

export function getNativeRuntime() {
    return activeRuntime;
}

export function resetNativeRuntimeForTests() {
    activeRuntime = createJSRuntime();
}
