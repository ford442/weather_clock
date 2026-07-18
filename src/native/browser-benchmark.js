import { renderDailyPreview, disposeDailyPreview } from '../forecast/DailyPreview.js';
import {
    FORECAST_PRIMITIVE,
    generateCloudNoiseJS,
    generateForecastPrimitivesJS,
    stepParticlesJS
} from './js-kernels.js';
import { createJSRuntime, getNativeRuntime } from './native-runtime.js';

const WARMUPS = 10;
const SAMPLES = 25;

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

function measure(callback) {
    for (let i = 0; i < WARMUPS; i++) callback();
    const samples = [];
    for (let i = 0; i < SAMPLES; i++) {
        const start = performance.now();
        callback();
        samples.push(performance.now() - start);
    }
    return median(samples);
}

function initializeParticles(buffers, count) {
    for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        buffers.positions[i3] = -4 + (i % 100) * 0.08;
        buffers.positions[i3 + 1] = 15 - (i % 200) * 0.05;
        buffers.positions[i3 + 2] = -5 + (i % 80) * 0.125;
        buffers.velocities[i3 + 1] = -0.035;
        buffers.offsets[i] = (i * 17) % 100;
    }
}

function createForecastDay() {
    return {
        date: '2026-07-17',
        weatherCode: 65,
        cloudCover: 88,
        visibility: 4200,
        rainSum: 12,
        snowfallSum: 0,
        windSpeedMax: 28,
        windDir: 240,
        hourly: [{ weatherCode: 65, cloudCover: 88, rain: 12, windSpeed: 28, windDirection: 240 }]
    };
}

export function runBrowserNativeBenchmarks() {
    const wasmRuntime = getNativeRuntime();
    if (Object.values(wasmRuntime.backends).some((backend) => backend !== 'wasm-simd')) {
        throw new Error('Run benchmarks with ?native=1 so every WASM kernel is enabled.');
    }
    const jsRuntime = createJSRuntime();
    const width = 512;
    const height = 512;
    const count = 667;

    console.info('[NativeBenchmark] cloud noise');
    const noiseJS = measure(() => generateCloudNoiseJS(width, height, 4, 0xa37e));
    const noiseWasm = measure(() => wasmRuntime.generateCloudNoise(width, height, 4, 0xa37e));

    console.info('[NativeBenchmark] particles');
    const jsParticles = jsRuntime.allocateParticleBuffers(count, 3);
    const wasmParticles = wasmRuntime.allocateParticleBuffers(count, 3);
    initializeParticles(jsParticles, count);
    initializeParticles(wasmParticles, count);
    let jsTime = 0;
    let wasmTime = 0;
    const particleJS = measure(() => {
        jsTime += 1 / 60;
        stepParticlesJS(
            jsParticles.positions,
            jsParticles.velocities,
            jsParticles.offsets,
            count,
            0.02,
            -0.01,
            1 / 60,
            { mode: 0, minX: -4, maxX: 4, time: jsTime }
        );
    });
    console.info('[NativeBenchmark] JavaScript particles complete');
    const particleWasm = measure(() => {
        wasmTime += 1 / 60;
        wasmRuntime.stepParticles(wasmParticles, count, 0.02, -0.01, 1 / 60, {
            mode: 0,
            minX: -4,
            maxX: 4,
            time: wasmTime
        });
    });
    console.info('[NativeBenchmark] WASM particles complete');

    console.info('[NativeBenchmark] forecast layout');
    const forecastInputs = {
        width: 120,
        height: 72,
        cloudCover: 88,
        precipType: FORECAST_PRIMITIVE.RAIN,
        precipIntensity: 1,
        windSpeed: 28,
        windDir: 240,
        timeMs: 5000
    };
    const jsForecastBuffer = jsRuntime.allocateForecastBuffer();
    const wasmForecastBuffer = wasmRuntime.allocateForecastBuffer();
    const forecastJS = measure(() => {
        for (let i = 0; i < 1000; i++) generateForecastPrimitivesJS(jsForecastBuffer.values, forecastInputs);
    });
    const forecastWasm = measure(() => {
        for (let i = 0; i < 1000; i++) wasmRuntime.generateForecastPrimitives(wasmForecastBuffer, forecastInputs);
    });

    console.info('[NativeBenchmark] forecast redraw');
    const canvases = Array.from({ length: 10 }, () => {
        const canvas = document.createElement('canvas');
        canvas.width = 120;
        canvas.height = 72;
        return canvas;
    });
    const day = createForecastDay();
    const date = new Date('2026-07-17T12:00:00');
    const drawBatch = (runtime) => {
        for (const canvas of canvases) renderDailyPreview(canvas, day, date, 40.7, -74, 5000, runtime);
    };
    const forecastDrawJS = measure(() => drawBatch(jsRuntime));
    const forecastDrawWasm = measure(() => drawBatch(wasmRuntime));

    for (const canvas of canvases) disposeDailyPreview(canvas);
    jsParticles.dispose();
    wasmParticles.dispose();
    jsForecastBuffer.dispose();
    wasmForecastBuffer.dispose();

    console.info('[NativeBenchmark] complete');
    const result = (jsMs, wasmMs) => ({ jsMs, wasmMs, speedup: jsMs / wasmMs });
    return {
        environment: {
            userAgent: navigator.userAgent,
            quality: localStorage.getItem('weatherclock_quality') || 'auto',
            warmups: WARMUPS,
            samples: SAMPLES
        },
        cloudNoise: result(noiseJS, noiseWasm),
        particleFrame: result(particleJS, particleWasm),
        forecastLayout1000: result(forecastJS, forecastWasm),
        forecastTenCardRedraw: result(forecastDrawJS, forecastDrawWasm)
    };
}
