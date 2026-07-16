/**
 * DailyPreview.js - Cheap 2D canvas vignette for a forecast day card.
 * No Three.js cost. Uses astro position if passed, else heuristic sun.
 */

import { AstronomyService } from '../astronomy.js';
import { buildDailySceneSnapshot } from '../dailyScene.js';
import { buildWeatherEffectConfig } from '../effects/weather-effects.js';

const astro = new AstronomyService();

export function renderDailyPreview(canvas, dayData, repDate, lat = 40.7, lon = -74, timeMs = 0) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    const w = canvas.width,
        h = canvas.height;

    // Background sky gradient (rough time of day + cloud factor)
    const snap = buildDailySceneSnapshot(dayData, repDate);
    const effectConfig = buildWeatherEffectConfig(snap, 'thumbnail');
    const cloud = snap.cloudCover;
    const code = snap.weatherCode;
    const windRad = ((90 - effectConfig.windDir) * Math.PI) / 180;
    const windX = Math.cos(windRad);
    const windY = -Math.sin(windRad);
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

    // Clouds (density from cover)
    const nCloud = Math.floor(1 + (cloud / 100) * 4);
    ctx.fillStyle = 'rgba(226,232,240,0.75)';
    for (let i = 0; i < nCloud; i++) {
        const windPhase = (timeMs * 0.0008 * Math.max(2, effectConfig.windSpeed)) % 24;
        const windOffset = (windPhase + effectConfig.windSpeed * 0.35 + i * 8) % 24;
        const px = 18 + (i % 3) * 28 + ((i * 7) % 11) + windX * windOffset;
        const py = 18 + Math.floor(i / 3) * 9 + windY * windOffset * 0.35;
        ctx.beginPath();
        ctx.ellipse(px, py, 10 + (i % 2) * 3, 5, windRad * 0.18, 0, Math.PI * 2);
        ctx.fill();
    }

    // Precipitation (simple lines for rain, dots for snow)
    const isRain = effectConfig.precipType === 'rain';
    const isSnow = effectConfig.precipType === 'snow';
    if (isRain || isSnow) {
        ctx.strokeStyle = isSnow ? '#e0f2fe' : '#bae6fd';
        ctx.lineWidth = isSnow ? 1 : 1.5;
        const precipCount = Math.max(
            isSnow ? 8 : 6,
            Math.floor((isSnow ? 12 : 10) * (0.35 + effectConfig.precipIntensity))
        );
        for (let i = 0; i < precipCount; i++) {
            const x = 12 + ((i * 17) % (w - 16));
            const y0 = 26 + ((i * 11) % (h * 0.4));
            if (isSnow) {
                ctx.fillStyle = '#e0f2fe';
                ctx.fillRect(x, y0, 1.5, 1.5);
            } else {
                ctx.beginPath();
                ctx.moveTo(x, y0);
                ctx.lineTo(x + 2 + windX * 5, y0 + 11 + windY * 2);
                ctx.stroke();
            }
        }
    }
}

export default { renderDailyPreview };
