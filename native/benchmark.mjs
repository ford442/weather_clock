import { performance } from 'node:perf_hooks';
import {
    FORECAST_PRIMITIVE,
    generateCloudNoiseJS,
    generateForecastPrimitivesJS,
    stepParticlesJS
} from '../src/native/js-kernels.js';
import { initializeNativeRuntime } from '../src/native/native-runtime.js';

function measure(iterations, callback, samples = 7) {
    for (let i = 0; i < Math.min(10, iterations); i++) callback();
    const timings = [];
    for (let sample = 0; sample < samples; sample++) {
        const start = performance.now();
        for (let i = 0; i < iterations; i++) callback();
        timings.push((performance.now() - start) / iterations);
    }
    timings.sort((a, b) => a - b);
    return timings[Math.floor(timings.length / 2)];
}

const runtime = await initializeNativeRuntime({ kernels: ['cloudNoise', 'particles', 'forecast'] });
if (runtime.backend !== 'wasm-simd') throw new Error(`WASM benchmark unavailable: ${runtime.error || 'init failed'}`);
console.error('Benchmarking 512x512 cloud noise...');

const width = 512;
const height = 512;
const noiseJS = measure(2, () => generateCloudNoiseJS(width, height, 4, 0xa37e));
const noiseWasm = measure(5, () => runtime.generateCloudNoise(width, height, 4, 0xa37e));
console.error('Benchmarking low-tier particle stepping...');

const count = 667;
const jsBuffers = {
    positions: new Float32Array(count * 3),
    velocities: new Float32Array(count * 3),
    offsets: new Float32Array(count)
};
const wasmBuffers = runtime.allocateParticleBuffers(count, 3);
for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    jsBuffers.positions[i3] = wasmBuffers.positions[i3] = -4 + (i % 100) * 0.08;
    jsBuffers.positions[i3 + 1] = wasmBuffers.positions[i3 + 1] = 15 - (i % 200) * 0.05;
    jsBuffers.positions[i3 + 2] = wasmBuffers.positions[i3 + 2] = -5 + (i % 80) * 0.125;
    jsBuffers.velocities[i3 + 1] = wasmBuffers.velocities[i3 + 1] = -0.035;
    jsBuffers.offsets[i] = wasmBuffers.offsets[i] = (i * 17) % 100;
}
let jsTime = 0;
let wasmTime = 0;
const particleJS = measure(30, () => {
    jsTime += 1 / 60;
    stepParticlesJS(
        jsBuffers.positions,
        jsBuffers.velocities,
        jsBuffers.offsets,
        count,
        0.02,
        -0.01,
        1 / 60,
        { mode: 0, minX: -4, maxX: 4, time: jsTime }
    );
});
console.error('JavaScript particle sample complete.');
const particleWasm = measure(30, () => {
    wasmTime += 1 / 60;
    runtime.stepParticles(wasmBuffers, count, 0.02, -0.01, 1 / 60, {
        mode: 0,
        minX: -4,
        maxX: 4,
        time: wasmTime
    });
});
console.error('WASM particle sample complete.');
console.error('Benchmarking forecast primitive layout...');

const inputs = {
    width: 120,
    height: 72,
    cloudCover: 88,
    precipType: FORECAST_PRIMITIVE.RAIN,
    precipIntensity: 1,
    windSpeed: 28,
    windDir: 240,
    timeMs: 5000
};
const jsForecast = new Float32Array(32 * 6);
const wasmForecast = runtime.allocateForecastBuffer();
const forecastJS = measure(1000, () => generateForecastPrimitivesJS(jsForecast, inputs));
const forecastWasm = measure(1000, () => runtime.generateForecastPrimitives(wasmForecast, inputs));
console.error('Benchmark complete.');

const result = (jsMs, wasmMs) => ({ jsMs, wasmMs, speedup: jsMs / wasmMs });
console.log(JSON.stringify({
    environment: { node: process.version, backend: runtime.backend, particleCount: count },
    cloudNoise: result(noiseJS, noiseWasm),
    particles: result(particleJS, particleWasm),
    forecastLayout: result(forecastJS, forecastWasm)
}, null, 2));

wasmBuffers.dispose();
wasmForecast.dispose();
process.exit(0);
