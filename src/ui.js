// UI management: DOM updates, event listeners, animations
import { calculateMoonPhase } from './moonPhase.js';
import { getWeatherAtTime } from './weather-simulation.js';

/**
 * Convert wind direction degrees to 8-point compass abbreviation
 * @param {number} deg - Wind direction in degrees (0 = North)
 * @returns {string} Compass abbreviation e.g. "NE"
 */
function compassDir(deg) {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

const UI_CONFIG = {
    timeWarpColorActive: 'rgba(255, 100, 100, 0.8)',
    timeWarpColorInactive: 'rgba(100, 255, 100, 0.4)',
    timeWarpSymbolActive: '⏸️',
    timeWarpSymbolInactive: '⏩',
    timeWarningColor: '#ffaa44',
    timeWarningGlow: '0 0 10px #ffaa44',
    timeNormalColor: '#ffffff',
    timeNormalGlow: '0 0 5px #000000',
};

// ── countTo: rAF-driven number animation (800 ms, ease-out cubic) ──────────
const _countState = new Map();

export function countTo(el, newVal, suffix = '') {
    if (!el) return;
    const currentVal = parseFloat(el.dataset.animVal ?? el.textContent) || 0;
    if (Math.abs(currentVal - newVal) < 0.5) {
        el.textContent = newVal + suffix;
        el.dataset.animVal = String(newVal);
        return;
    }

    if (_countState.has(el)) cancelAnimationFrame(_countState.get(el));

    const duration = 800;
    const startTime = performance.now();
    const startVal = currentVal;

    const step = (now) => {
        const t = Math.min((now - startTime) / duration, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        const val = Math.round(startVal + (newVal - startVal) * eased);
        el.textContent = val + suffix;
        el.dataset.animVal = String(val);
        if (t < 1) {
            _countState.set(el, requestAnimationFrame(step));
        } else {
            el.textContent = newVal + suffix;
            el.dataset.animVal = String(newVal);
            _countState.delete(el);
        }
    };
    _countState.set(el, requestAnimationFrame(step));
}

// ── formatTime12 ─────────────────────────────────────────────────────────────
export function formatTime12(date) {
    let hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${hours}:${minutes} ${ampm}`;
}

// ── updateTimeDisplay ────────────────────────────────────────────────────────
export function updateTimeDisplay(simulationTime, isTimeWarping) {
    const timeDisplay = document.getElementById('time-display');
    if (!timeDisplay) return;

    timeDisplay.textContent = formatTime12(simulationTime);

    const dateDisplay = document.getElementById('date-display');
    if (dateDisplay) {
        const options = { weekday: 'short', month: 'short', day: 'numeric' };
        dateDisplay.textContent = simulationTime.toLocaleDateString('en-US', options);
    }

    timeDisplay.style.color = isTimeWarping ? UI_CONFIG.timeWarningColor : UI_CONFIG.timeNormalColor;
    timeDisplay.style.textShadow = isTimeWarping ? UI_CONFIG.timeWarningGlow : UI_CONFIG.timeNormalGlow;

    const pastTime = new Date(simulationTime.getTime() - 3 * 3600 * 1000);
    const forecastTime = new Date(simulationTime.getTime() + 3 * 3600 * 1000);

    const pastDisplay = document.getElementById('past-time-display');
    if (pastDisplay) pastDisplay.textContent = formatTime12(pastTime);

    const forecastDisplay = document.getElementById('forecast-time-display');
    if (forecastDisplay) forecastDisplay.textContent = formatTime12(forecastTime);
}

// ── updateWeatherDisplay ─────────────────────────────────────────────────────
export function updateWeatherDisplay(data, weatherService) {
    if (!data) return;

    const tRaw = (c) => Math.round(weatherService.convertTemp(c));
    const deg = '°';

    // Helper to countTo a temp element
    const setTemp = (id, celsius) => {
        const el = document.getElementById(id);
        if (el && celsius != null) countTo(el, tRaw(celsius), deg);
    };

    // Helper to countTo a plain number element
    const setNum = (id, val, suffix = '') => {
        const el = document.getElementById(id);
        if (el && val != null) countTo(el, Math.round(val), suffix);
    };

    const setText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };

    // ── Location ──
    setText('location', data.location || 'Unknown');

    // ── Current (center) ──
    if (data.current) {
        setText('current-description', data.current.description);
        setTemp('current-temp', data.current.temp);
        setTemp('current-feels-like', data.current.apparentTemp ?? data.current.temp);

        const uvEl = document.getElementById('current-uv');
        if (uvEl) uvEl.textContent = `UV ${Math.round(data.current.uvIndex ?? 0)}`;

        setNum('current-wind', data.current.windSpeed, ' km/h');
        const pastWindConverted = weatherService.convertWind(data.past.windSpeed);
        const wind = document.getElementById('past-wind');
        if (wind) wind.textContent = `${pastWindConverted.value} ${pastWindConverted.unit}`;

        // Wind compass
        if (data.current.windDirection != null) {
            updateWindCompass(data.current.windDirection);
        }
    }

    // ── Past (left panel) ──
    if (data.past) {
        setText('past-description', data.past.description);
        setTemp('past-temp', data.past.temp);
        setTemp('past-feels-like', data.past.apparentTemp ?? data.past.temp);
        setNum('past-wind', data.past.windSpeed, ' km/h');
        setNum('past-humidity', data.past.humidity ?? 0, '%');
        setNum('past-cloud', data.past.cloudCover, '%');
        setNum('past-precip-prob', data.past.precipProb ?? 0, '%');
    }

    // ── Forecast (right panel) ──
    if (data.forecast) {
        setText('forecast-description', data.forecast.description);
        setTemp('forecast-temp', data.forecast.temp);
        setTemp('forecast-feels-like', data.forecast.apparentTemp ?? data.forecast.temp);
        setNum('forecast-wind', data.forecast.windSpeed, ' km/h');
        setNum('forecast-humidity', data.forecast.humidity ?? 0, '%');
        setNum('forecast-cloud', data.forecast.cloudCover, '%');
        setNum('forecast-precip-prob', data.forecast.precipProb ?? 0, '%');
    }

    // ── Moon phase ──
    const mp = calculateMoonPhase();
    setText('moon-phase', mp.phaseName);

    // ── Sunrise / Sunset ──
    if (data.sunrise) setText('sunrise-time', formatTime12(new Date(data.sunrise)));
    if (data.sunset)  setText('sunset-time',  formatTime12(new Date(data.sunset)));

    // ── Advanced: historical year-ago ──
    if (data.historicalYearAgo) {
        setTemp('history-temp', data.historicalYearAgo.temp);
        setText('history-desc', data.historicalYearAgo.description);
    }

    // ── Advanced: accuracy ──
    if (data.accuracy) {
        let delta = data.accuracy.delta;
        if (weatherService.unit === 'imperial') delta *= 1.8;
        const sign = delta > 0 ? '+' : (delta < 0 ? '-' : '');
        const deltaEl = document.getElementById('accuracy-delta');
        if (deltaEl) {
            deltaEl.textContent = `${sign}${Math.abs(delta).toFixed(1)}${deg}`;
            deltaEl.style.color = Math.abs(data.accuracy.delta) < 2 ? '#44ff44' : '#ff4444';
        }
        setText('accuracy-score', `Score: ${data.accuracy.accuracy}%`);
    }

    // ── Advanced: regional ──
    if (data.regional) {
        const list = document.getElementById('regional-list');
        if (list) {
            list.innerHTML = '';
            data.regional.forEach(reg => {
                const div = document.createElement('div');
                div.innerHTML = `<b>${reg.name}:</b> ${tRaw(reg.temp)}${deg}`;
                list.appendChild(div);
            });
        }
    }

    // ── Pressure gauge ──
    if (data.current && data.past && data.forecast) {
        drawPressureGauge(
            data.current.pressure ?? 1013.25,
            data.past.pressure ?? 1013.25,
            data.forecast.pressure ?? 1013.25
        );
    }
}

// ── updateUnitButton ─────────────────────────────────────────────────────────
export function updateUnitButton(weatherService) {
    const toggle = document.getElementById('unit-toggle');
    if (!toggle) return;
    toggle.setAttribute('data-unit', weatherService.unit);
    toggle.setAttribute('aria-label', `Toggle unit — currently ${weatherService.unit === 'metric' ? 'Celsius' : 'Fahrenheit'}`);
}

// ── setupEventListeners ──────────────────────────────────────────────────────
export function setupEventListeners(callbacks) {
    const retryBtn = document.getElementById('retry-location');
    if (retryBtn) retryBtn.addEventListener('click', callbacks.onRetryLocation);

    const unitToggle = document.getElementById('unit-toggle');
    if (unitToggle) {
        unitToggle.addEventListener('click', callbacks.onToggleUnit);
        unitToggle.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                callbacks.onToggleUnit();
            }
        });
    }

    const searchInput = document.getElementById('location-search');
    const searchBtn = document.getElementById('search-btn');

    if (searchBtn) {
        searchBtn.addEventListener('click', () => callbacks.onSearch(searchInput?.value || ''));
    }
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') callbacks.onSearch(searchInput.value);
        });
    }

    const warpBtn = document.getElementById('time-warp-btn');
    if (warpBtn) warpBtn.addEventListener('click', callbacks.onToggleTimeWarp);
}

// ── updateTimeWarpButton ─────────────────────────────────────────────────────
export function updateTimeWarpButton(isActive) {
    const warpBtn = document.getElementById('time-warp-btn');
    if (!warpBtn) return;
    warpBtn.style.background = isActive ? UI_CONFIG.timeWarpColorActive : UI_CONFIG.timeWarpColorInactive;
    warpBtn.textContent = isActive ? UI_CONFIG.timeWarpSymbolActive : UI_CONFIG.timeWarpSymbolInactive;
}

// ── setSearchLoading ──────────────────────────────────────────────────────────
export function setSearchLoading(isLoading) {
    const searchBtn = document.getElementById('search-btn');
    if (searchBtn) searchBtn.textContent = isLoading ? '...' : 'Go';
}

// ── updateWindCompass ────────────────────────────────────────────────────────
export function updateWindCompass(degrees) {
    const arrow = document.getElementById('wind-arrow');
    if (!arrow) return;
    arrow.style.transform = `rotate(${degrees}deg)`;
}

// ── updatePanelTheme ─────────────────────────────────────────────────────────
// dayFactor: -1 = deep night, 0 = dawn/dusk, 1 = noon
// weatherSeverity: 0 = clear, 1 = storm
// tempTrend: -1 = much cooler than year-ago, +1 = much warmer
export function updatePanelTheme(dayFactor, weatherSeverity, tempTrend = 0) {
    const root = document.documentElement;
    const day = Math.max(-1, Math.min(1, dayFactor || 0));
    const sev = Math.max(0, Math.min(1, weatherSeverity || 0));
    const trend = Math.max(-1, Math.min(1, tempTrend || 0));

    let panelBg, panelBorder, headerColor;

    if (day < -0.15) {
        // Night — deep navy glass
        panelBg = `rgba(5, 10, 40, ${0.65 + sev * 0.15})`;
        panelBorder = `rgba(60, 100, 200, ${0.2 + sev * 0.1})`;
        headerColor = `hsl(220, ${60 - sev * 20}%, ${55 - sev * 15}%)`;
    } else if (day < 0.15) {
        // Dawn / Dusk — warm amber tint
        panelBg = `rgba(30, 15, 5, ${0.60 + sev * 0.15})`;
        panelBorder = `rgba(220, 140, 40, ${0.25 + sev * 0.1})`;
        headerColor = `hsl(${38 - sev * 15}, ${70 - sev * 20}%, ${65 - sev * 15}%)`;
    } else {
        // Day — sky-blue tint, stormy grey when severe
        panelBg = `rgba(0, 20, 60, ${0.55 + sev * 0.20})`;
        panelBorder = `rgba(100, 180, 255, ${0.15 + sev * 0.10})`;
        headerColor = `hsl(${200 + sev * 10}, ${80 - sev * 30}%, ${70 - sev * 20}%)`;
    }

    root.style.setProperty('--panel-bg', panelBg);
    root.style.setProperty('--panel-border', panelBorder);
    root.style.setProperty('--header-color', headerColor);

    // Temperature trend — warm (orange) glow when above long-term average, cool (blue) when below
    const strength = Math.abs(trend);
    if (strength > 0.05) {
        const r = trend > 0 ? 255 : 60;
        const g = 120;
        const b = trend > 0 ? 60 : 255;
        root.style.setProperty('--trend-glow', `rgba(${r}, ${g}, ${b}, ${strength * 0.45})`);
    } else {
        root.style.setProperty('--trend-glow', 'transparent');
    }
}

// ── drawSparkline ─────────────────────────────────────────────────────────────
// Draws a ±6 h bezier temperature curve on #sparkline canvas.
export function drawSparkline(simulationTime, weatherData, weatherService) {
    const canvas = document.getElementById('sparkline');
    if (!canvas || !weatherData || !weatherData.timeline) return;

    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const startMs = simulationTime.getTime() - 6 * 3600 * 1000;
    const endMs   = simulationTime.getTime() + 6 * 3600 * 1000;
    const spanMs  = endMs - startMs;

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

    const temps = pts.map(p => p.y);
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

// ── drawPressureGauge ──────────────────────────────────────────────────────────
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
    ctx.moveTo(
        centerX + Math.cos(currentAngle) * 8,
        centerY + Math.sin(currentAngle) * 8
    );
    ctx.lineTo(
        centerX + Math.cos(currentAngle) * (radius - 2),
        centerY + Math.sin(currentAngle) * (radius - 2)
    );
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
    let status = '';
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

/**
 * Update sunrise and sunset time displays
 * @param {Date} sunrise - Sunrise Date object from SunCalc
 * @param {Date} sunset - Sunset Date object from SunCalc
 */
export function updateSunriseSunset(sunrise, sunset) {
    const riseEl = document.getElementById('sunrise-time');
    if (riseEl && sunrise instanceof Date && !isNaN(sunrise)) {
        riseEl.textContent = formatTime12(sunrise);
    }
    const setEl = document.getElementById('sunset-time');
    if (setEl && sunset instanceof Date && !isNaN(sunset)) {
        setEl.textContent = formatTime12(sunset);
    }
}

/**
 * Show a toast notification
 * @param {string} message - Message to display
 * @param {'error'|'info'|'success'} type - Toast type
 * @param {number} durationMs - Auto-dismiss duration in milliseconds
 */
export function showToast(message, type = 'error', durationMs = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => toast.classList.add('toast-visible'));

    setTimeout(() => {
        toast.classList.remove('toast-visible');
        toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    }, durationMs);
}

/**
 * Setup keyboard shortcuts
 * @param {Object} callbacks - Same callbacks object from setupEventListeners
 */
export function setupKeyboardShortcuts(callbacks) {
    document.addEventListener('keydown', (e) => {
        // Don't fire when user is typing in an input
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;

        switch (e.key.toLowerCase()) {
            case 'w':
                callbacks.onToggleTimeWarp();
                break;
            case 'f':
                callbacks.onToggleUnit();
                break;
            case '/':
                e.preventDefault();
                document.getElementById('location-search')?.focus();
                break;
        }
    });
}

export { UI_CONFIG };
