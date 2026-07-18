/**
 * DailyPreview.js - Cheap 2D canvas vignette for a forecast day card.
 * No Three.js cost. Uses astro position if passed, else heuristic sun.
 */

import { AstronomyService } from '../astronomy.js';
import { buildDailySceneSnapshot } from '../dailyScene.js';
import { buildWeatherEffectConfig } from '../effects/weather-effects.js';
import { FORECAST_PRIMITIVE, FORECAST_PRIMITIVE_CAPACITY, FORECAST_PRIMITIVE_STRIDE } from '../native/js-kernels.js';
import { getNativeRuntime } from '../native/native-runtime.js';

const astro = new AstronomyService();
const previewBuffers = new WeakMap();

function getPreviewBuffer(canvas, runtime) {
    let entry = previewBuffers.get(canvas);
    if (!entry || entry.buffer.disposed || entry.runtime !== runtime) {
        entry?.buffer.dispose?.();
        entry = { runtime, buffer: runtime.allocateForecastBuffer(FORECAST_PRIMITIVE_CAPACITY) };
        previewBuffers.set(canvas, entry);
    }
    return entry.buffer;
}

export function disposeDailyPreview(canvas) {
    const entry = previewBuffers.get(canvas);
    entry?.buffer.dispose?.();
    previewBuffers.delete(canvas);
}

export function renderDailyPreview(
    canvas,
    dayData,
    repDate,
    lat = 40.7,
    lon = -74,
    timeMs = 0,
    runtime = getNativeRuntime()
) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    const w = canvas.width,
        h = canvas.height;

    // Background sky gradient (rough time of day + cloud factor)
    const snap = buildDailySceneSnapshot(dayData, repDate);
    const effectConfig = buildWeatherEffectConfig(snap, 'thumbnail');
    const cloud = snap.cloudCover;
    const code = snap.weatherCode;
    const isNight = (repDate && (repDate.getHours() < 6 || repDate.getHours() > 20)) || false;

    let top = isNight ? '#0b1020' : '#1e3a8a';
    let bot = isNight ? '#0a0e1a' : '#60a5fa';
    if (cloud > 65) {
        top = '#334155';
        bot = '#64748b';
    }
    if (code >= 61) {
        top = '#1f2937';
        bot = '#475569';
    } // rainier
    if (code >= 71) {
        top = '#0f172a';
        bot = '#475569';
    } // snow

    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, top);
    g.addColorStop(1, bot);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // Simple horizon ground
    ctx.fillStyle = cloud > 50 ? '#1f2937' : '#166534';
    ctx.fillRect(0, h * 0.72, w, h * 0.28);

    // Sun/moon disk (use astro if repDate)
    let sunAlt = 0.6,
        sunAz = 0; // normalized
    try {
        if (repDate) {
            const res = astro.update(repDate, lat, lon, 1);
            const sy = res.sunPosition.y; // -1..1-ish in our mapping
            sunAlt = Math.max(-0.2, Math.min(1.1, (sy + 1) * 0.6 + 0.3));
            sunAz = 0.5; // for 2d projection we fake east-west
        }
    } catch (_) {
        // Keep the deterministic fallback projection when astronomy data is unavailable.
    }

    const cx = w * (0.35 + (sunAz - 0.5) * 0.3);
    const cy = h * (0.58 - sunAlt * 0.38);
    const r = isNight ? 3 : 5;

    if (isNight) {
        ctx.fillStyle = '#e0e7ff';
        ctx.beginPath();
        ctx.arc(cx + 10, cy - 6, 2.5, 0, Math.PI * 2);
        ctx.fill(); // moon
    } else {
        ctx.fillStyle = cloud > 60 ? '#f1f5f9' : '#fde047';
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        if (cloud < 40) {
            ctx.fillStyle = 'rgba(253,224,71,0.35)';
            ctx.beginPath();
            ctx.arc(cx, cy, r * 1.6, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    const precipType =
        effectConfig.precipType === 'rain'
            ? FORECAST_PRIMITIVE.RAIN
            : effectConfig.precipType === 'snow'
              ? FORECAST_PRIMITIVE.SNOW
              : 0;
    const primitiveLayout = runtime.generateForecastPrimitives(getPreviewBuffer(canvas, runtime), {
        width: w,
        height: h,
        cloudCover: cloud,
        precipType,
        precipIntensity: effectConfig.precipIntensity,
        windSpeed: effectConfig.windSpeed,
        windDir: effectConfig.windDir,
        timeMs
    });

    // Canvas drawing remains in JavaScript; only primitive layout is native-eligible.
    ctx.fillStyle = 'rgba(226,232,240,0.75)';
    for (let i = 0; i < primitiveLayout.count; i++) {
        const index = i * FORECAST_PRIMITIVE_STRIDE;
        if (primitiveLayout.data[index] !== FORECAST_PRIMITIVE.CLOUD) continue;
        ctx.beginPath();
        ctx.ellipse(
            primitiveLayout.data[index + 1],
            primitiveLayout.data[index + 2],
            primitiveLayout.data[index + 3],
            primitiveLayout.data[index + 4],
            primitiveLayout.data[index + 5],
            0,
            Math.PI * 2
        );
        ctx.fill();
    }

    // Precipitation (simple lines for rain, dots for snow)
    const isRain = precipType === FORECAST_PRIMITIVE.RAIN;
    const isSnow = precipType === FORECAST_PRIMITIVE.SNOW;
    if (isRain || isSnow) {
        ctx.strokeStyle = isSnow ? '#e0f2fe' : '#bae6fd';
        ctx.lineWidth = isSnow ? 1 : 1.5;
        for (let i = 0; i < primitiveLayout.count; i++) {
            const index = i * FORECAST_PRIMITIVE_STRIDE;
            const kind = primitiveLayout.data[index];
            if (kind === FORECAST_PRIMITIVE.SNOW) {
                ctx.fillStyle = '#e0f2fe';
                ctx.fillRect(
                    primitiveLayout.data[index + 1],
                    primitiveLayout.data[index + 2],
                    primitiveLayout.data[index + 3],
                    primitiveLayout.data[index + 4]
                );
            } else if (kind === FORECAST_PRIMITIVE.RAIN) {
                ctx.beginPath();
                ctx.moveTo(primitiveLayout.data[index + 1], primitiveLayout.data[index + 2]);
                ctx.lineTo(primitiveLayout.data[index + 3], primitiveLayout.data[index + 4]);
                ctx.stroke();
            }
        }
    }
}

export default { renderDailyPreview };
