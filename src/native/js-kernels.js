export const NATIVE_KERNELS = Object.freeze({
    CLOUD_NOISE: 'cloudNoise',
    PARTICLES: 'particles',
    FORECAST: 'forecast'
});

export const FORECAST_PRIMITIVE_STRIDE = 6;
export const FORECAST_PRIMITIVE_CAPACITY = 32;
export const FORECAST_PRIMITIVE = Object.freeze({ CLOUD: 0, RAIN: 1, SNOW: 2 });

function hashU32(value) {
    value = (value ^ (value >>> 16)) >>> 0;
    value = Math.imul(value, 0x7feb352d) >>> 0;
    value = (value ^ (value >>> 15)) >>> 0;
    value = Math.imul(value, 0x846ca68b) >>> 0;
    return (value ^ (value >>> 16)) >>> 0;
}

function random01(value) {
    return (hashU32(value) & 0x00ffffff) / 16777215;
}

function smooth(value) {
    return value * value * (3 - 2 * value);
}

function valueNoise(x, y, seed) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = smooth(x - x0);
    const ty = smooth(y - y0);
    const sample = (sx, sy) => random01(Math.imul(sx, 0x1f123bb5) ^ Math.imul(sy, 0x5f356495) ^ seed);
    const a = sample(x0, y0);
    const b = sample(x0 + 1, y0);
    const c = sample(x0, y0 + 1);
    const d = sample(x0 + 1, y0 + 1);
    const top = a + (b - a) * tx;
    const bottom = c + (d - c) * tx;
    return top + (bottom - top) * ty;
}

export function generateCloudNoiseJS(width, height, octaves = 4, seed = 1) {
    const output = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let frequency = 1 / 64;
            let amplitude = 1;
            let total = 0;
            let weight = 0;
            for (let octave = 0; octave < octaves; octave++) {
                total += valueNoise(x * frequency, y * frequency, seed + octave * 1013) * amplitude;
                weight += amplitude;
                frequency *= 2;
                amplitude *= 0.5;
            }
            output[y * width + x] = Math.max(0, Math.min(255, Math.floor((total / weight) * 255)));
        }
    }
    return output;
}

function wrap(value, min, max) {
    const width = max - min;
    if (width <= 0 || !Number.isFinite(value)) return min;
    if (value > max || value < min) {
        value = min + ((((value - min) % width) + width) % width);
    }
    return value;
}

function noiseSample(x, y, z, time) {
    return Math.sin(x * 0.5 + time) * Math.cos(y * 0.3 + time) * Math.sin(z * 0.5);
}

function curlComponents(x, y, z, time) {
    const eps = 0.1;
    return {
        x: (noiseSample(x, y + eps, z, time) - noiseSample(x, y - eps, z, time)) * 0.5,
        z: (noiseSample(x - eps, y, z, time) - noiseSample(x + eps, y, z, time)) * 0.5
    };
}

// mode: 0 = snow points, 1 = rain line-segment pairs, 2 = dust points.
export function stepParticlesJS(positions, velocities, offsets, count, windX, windZ, dt, options = {}) {
    const { mode = 0, minX = -8, maxX = 8, time = 0 } = options;
    const frameScale = Math.max(0, Math.min(3, dt * 60));
    for (let i = 0; i < count; i++) {
        const velocityIndex = i * 3;
        if (mode === 1) {
            const positionIndex = i * 6;
            velocities[velocityIndex] += (windX - velocities[velocityIndex]) * 0.1 * frameScale;
            velocities[velocityIndex + 2] += (windZ - velocities[velocityIndex + 2]) * 0.1 * frameScale;
            const vx = velocities[velocityIndex];
            const vy = velocities[velocityIndex + 1];
            const vz = velocities[velocityIndex + 2];
            positions[positionIndex + 3] = wrap(positions[positionIndex + 3] + vx * frameScale, minX, maxX);
            positions[positionIndex + 4] += vy * frameScale;
            positions[positionIndex + 5] += vz * frameScale;
            positions[positionIndex] = positions[positionIndex + 3] - vx * 4;
            positions[positionIndex + 1] = positions[positionIndex + 4] - vy * 4;
            positions[positionIndex + 2] = positions[positionIndex + 5] - vz * 4;
            continue;
        }

        const positionIndex = i * 3;
        const px = positions[positionIndex];
        const py = positions[positionIndex + 1];
        const pz = positions[positionIndex + 2];
        const phase = time + (offsets?.[i] || 0) * 0.01;
        const coordinateScale = mode === 2 ? 0.2 : 0.1;
        const curl = curlComponents(px * coordinateScale, py * coordinateScale, pz * coordinateScale, phase);

        if (mode === 2) {
            positions[positionIndex] = wrap(px + (windX + curl.x * 0.02) * frameScale, minX, maxX);
            positions[positionIndex + 1] = py + Math.sin(phase * 1.7) * 0.005 * frameScale;
            positions[positionIndex + 2] = pz + (windZ + curl.z * 0.02) * frameScale;
        } else {
            positions[positionIndex] = wrap(
                px + (velocities[velocityIndex] + windX + curl.x * 0.05) * frameScale,
                minX,
                maxX
            );
            positions[positionIndex + 1] = py + velocities[velocityIndex + 1] * frameScale;
            positions[positionIndex + 2] = pz + (velocities[velocityIndex + 2] + windZ + curl.z * 0.05) * frameScale;
        }
    }
}

export function generateForecastPrimitivesJS(output, inputs = {}) {
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
    const capacity = Math.floor(output.length / FORECAST_PRIMITIVE_STRIDE);
    const windRad = ((90 - windDir) * Math.PI) / 180;
    const windX = Math.cos(windRad);
    const windY = -Math.sin(windRad);
    let count = 0;
    let cloudCount = 0;
    let precipitationCount = 0;

    const push = (kind, a, b, c, d, e = 0) => {
        if (count >= capacity) return false;
        const index = count * FORECAST_PRIMITIVE_STRIDE;
        output[index] = kind;
        output[index + 1] = a;
        output[index + 2] = b;
        output[index + 3] = c;
        output[index + 4] = d;
        output[index + 5] = e;
        count += 1;
        return true;
    };

    const desiredClouds = Math.floor(1 + (cloudCover / 100) * 4);
    for (let i = 0; i < desiredClouds; i++) {
        const windPhase = (timeMs * 0.0008 * Math.max(2, windSpeed)) % 24;
        const windOffset = (windPhase + windSpeed * 0.35 + i * 8) % 24;
        const px = 18 + (i % 3) * 28 + ((i * 7) % 11) + windX * windOffset;
        const py = 18 + Math.floor(i / 3) * 9 + windY * windOffset * 0.35;
        if (push(FORECAST_PRIMITIVE.CLOUD, px, py, 10 + (i % 2) * 3, 5, windRad * 0.18)) cloudCount += 1;
    }

    if (precipType === FORECAST_PRIMITIVE.RAIN || precipType === FORECAST_PRIMITIVE.SNOW) {
        const isSnow = precipType === FORECAST_PRIMITIVE.SNOW;
        const desiredPrecipitation = Math.max(
            isSnow ? 8 : 6,
            Math.floor((isSnow ? 12 : 10) * (0.35 + precipIntensity))
        );
        for (let i = 0; i < desiredPrecipitation; i++) {
            const x = 12 + ((i * 17) % Math.max(1, width - 16));
            const y = 26 + ((i * 11) % (height * 0.4));
            const added = isSnow
                ? push(FORECAST_PRIMITIVE.SNOW, x, y, 1.5, 1.5)
                : push(FORECAST_PRIMITIVE.RAIN, x, y, x + 2 + windX * 5, y + 11 + windY * 2);
            if (added) precipitationCount += 1;
        }
    }

    return { count, cloudCount, precipitationCount, data: output.subarray(0, count * FORECAST_PRIMITIVE_STRIDE) };
}
