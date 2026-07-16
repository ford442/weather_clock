// @ts-nocheck
import { getWeatherAtTime } from '../weather-simulation.js';

// Draws a ±6 h bezier temperature curve on #sparkline canvas.
export function drawSparkline(simulationTime, weatherData, weatherService) {
    const canvas = document.getElementById('sparkline');
    if (!canvas || !weatherData || !weatherData.timeline) return;

    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const startMs = simulationTime.getTime() - 6 * 3600 * 1000;
    const endMs = simulationTime.getTime() + 6 * 3600 * 1000;
    const spanMs = endMs - startMs;

    // Sample every 30 min
    const pts = [];
    for (let t = startMs; t <= endMs; t += 30 * 60 * 1000) {
        const w = getWeatherAtTime(new Date(t), weatherData.timeline);
        if (w) {
            const dispTemp = weatherService ? weatherService.convertTemp(w.temp) : w.temp;
            pts.push({ t, y: dispTemp });
        }
    }
    if (pts.length < 2) return;

    const temps = pts.map((p) => p.y);
    const minT = Math.min(...temps) - 2;
    const maxT = Math.max(...temps) + 2;
    const rangeT = maxT - minT || 1;
    const PAD = 10;

    const toX = (ms) => PAD + ((ms - startMs) / spanMs) * (W - PAD * 2);
    const toY = (temp) => H - PAD - ((temp - minT) / rangeT) * (H - PAD * 2);

    // Filled area
    ctx.beginPath();
    ctx.moveTo(toX(pts[0].t), toY(pts[0].y));
    for (let i = 1; i < pts.length; i++) {
        const cpX = (toX(pts[i - 1].t) + toX(pts[i].t)) / 2;
        ctx.bezierCurveTo(cpX, toY(pts[i - 1].y), cpX, toY(pts[i].y), toX(pts[i].t), toY(pts[i].y));
    }
    ctx.lineTo(toX(pts[pts.length - 1].t), H);
    ctx.lineTo(toX(pts[0].t), H);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(100, 200, 255, 0.35)');
    grad.addColorStop(1, 'rgba(100, 200, 255, 0.0)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Stroke
    ctx.beginPath();
    ctx.moveTo(toX(pts[0].t), toY(pts[0].y));
    for (let i = 1; i < pts.length; i++) {
        const cpX = (toX(pts[i - 1].t) + toX(pts[i].t)) / 2;
        ctx.bezierCurveTo(cpX, toY(pts[i - 1].y), cpX, toY(pts[i].y), toX(pts[i].t), toY(pts[i].y));
    }
    ctx.strokeStyle = 'rgba(130, 215, 255, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // "Now" dot
    const nowW = getWeatherAtTime(simulationTime, weatherData.timeline);
    if (nowW) {
        const nx = toX(simulationTime.getTime());
        const ny = toY(weatherService ? weatherService.convertTemp(nowW.temp) : nowW.temp);
        ctx.beginPath();
        ctx.arc(nx, ny, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.strokeStyle = 'rgba(130, 215, 255, 0.9)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    // Endpoint labels
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = `9px Inter, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(`${Math.round(pts[0].y)}°`, 2, toY(pts[0].y) - 3);
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(pts[pts.length - 1].y)}°`, W - 2, toY(pts[pts.length - 1].y) - 3);
}
