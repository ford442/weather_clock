// @ts-nocheck
// Draws a circular pressure gauge on #pressure-gauge canvas with past/current/future arcs
export function drawPressureGauge(currentPressure, pastPressure, futurePressure) {
    const canvas = document.getElementById('pressure-gauge');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const centerX = W / 2;
    const centerY = H / 2;
    const radius = Math.min(W, H) / 2 - 8;

    ctx.clearRect(0, 0, W, H);

    // Pressure range constants
    const MIN_PRESSURE = 980;
    const MAX_PRESSURE = 1050;
    const IDEAL_MIN = 1010;
    const IDEAL_MAX = 1030;

    // Convert pressure to angle (0 = 180deg (left), 180deg = 0deg (right))
    const pressureToAngle = (p) => {
        const clamped = Math.max(MIN_PRESSURE, Math.min(MAX_PRESSURE, p));
        const normalized = (clamped - MIN_PRESSURE) / (MAX_PRESSURE - MIN_PRESSURE);
        return Math.PI + normalized * Math.PI;
    };

    // Draw background circle with grid lines
    ctx.strokeStyle = 'rgba(100, 180, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Draw pressure range arc (min to max)
    ctx.strokeStyle = 'rgba(100, 180, 255, 0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius - 4, Math.PI, Math.PI * 2);
    ctx.stroke();

    // Draw color zones
    // Red zone (extreme low: <985)
    const redLowAngle = pressureToAngle(985);
    ctx.strokeStyle = 'rgba(255, 100, 100, 0.4)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius - 10, Math.PI, redLowAngle);
    ctx.stroke();

    // Yellow zone (acceptable low: 985-1010)
    const yellowLowStart = pressureToAngle(985);
    const yellowLowEnd = pressureToAngle(1010);
    ctx.strokeStyle = 'rgba(255, 200, 100, 0.4)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius - 10, yellowLowStart, yellowLowEnd);
    ctx.stroke();

    // Green zone (ideal: 1010-1030)
    const greenStart = pressureToAngle(1010);
    const greenEnd = pressureToAngle(1030);
    ctx.strokeStyle = 'rgba(100, 255, 100, 0.5)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius - 10, greenStart, greenEnd);
    ctx.stroke();

    // Yellow zone (acceptable high: 1030-1050)
    const yellowHighStart = pressureToAngle(1030);
    const yellowHighEnd = pressureToAngle(1050);
    ctx.strokeStyle = 'rgba(255, 200, 100, 0.4)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius - 10, yellowHighStart, yellowHighEnd);
    ctx.stroke();

    // Red zone (extreme high: >1050)
    const redHighStart = pressureToAngle(1050);
    ctx.strokeStyle = 'rgba(255, 100, 100, 0.4)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius - 10, redHighStart, Math.PI * 2);
    ctx.stroke();

    // Draw three pressure indicators (past, current, future) as small arcs
    const arcRadius = radius - 18;
    const arcThickness = 3;

    // Past pressure (inner arc, dimmer)
    const pastAngle = pressureToAngle(pastPressure);
    ctx.strokeStyle = 'rgba(130, 215, 255, 0.3)';
    ctx.lineWidth = arcThickness;
    ctx.beginPath();
    ctx.arc(centerX, centerY, arcRadius - 4, pastAngle - 0.08, pastAngle + 0.08);
    ctx.stroke();

    // Future pressure (inner arc, dimmer)
    const futureAngle = pressureToAngle(futurePressure);
    ctx.strokeStyle = 'rgba(130, 215, 255, 0.3)';
    ctx.lineWidth = arcThickness;
    ctx.beginPath();
    ctx.arc(centerX, centerY, arcRadius + 4, futureAngle - 0.08, futureAngle + 0.08);
    ctx.stroke();

    // Current pressure (main needle, bright)
    const currentAngle = pressureToAngle(currentPressure);
    ctx.strokeStyle = 'rgba(130, 215, 255, 0.9)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(centerX + Math.cos(currentAngle) * 8, centerY + Math.sin(currentAngle) * 8);
    ctx.lineTo(centerX + Math.cos(currentAngle) * (radius - 2), centerY + Math.sin(currentAngle) * (radius - 2));
    ctx.stroke();

    // Center dot
    ctx.fillStyle = 'rgba(130, 215, 255, 0.8)';
    ctx.beginPath();
    ctx.arc(centerX, centerY, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Current pressure value (center text)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.font = `13px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.round(currentPressure)}`, centerX, centerY - 8);

    // Unit label
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = `9px Inter, sans-serif`;
    ctx.fillText('hPa', centerX, centerY + 6);

    // Pressure status indicator (deviation from ideal)
    const ideal = (IDEAL_MIN + IDEAL_MAX) / 2;
    const deviation = currentPressure - ideal;
    let status;
    if (Math.abs(deviation) < 5) {
        status = 'Ideal';
        ctx.fillStyle = 'rgba(100, 255, 100, 0.7)';
    } else if (Math.abs(deviation) < 20) {
        status = deviation > 0 ? 'High' : 'Low';
        ctx.fillStyle = 'rgba(255, 200, 100, 0.7)';
    } else {
        status = deviation > 0 ? 'Very High' : 'Very Low';
        ctx.fillStyle = 'rgba(255, 100, 100, 0.7)';
    }
    ctx.font = `8px Inter, sans-serif`;
    ctx.fillText(status, centerX, centerY + 18);
}
