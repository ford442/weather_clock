// @ts-nocheck
import { calculateMoonPhase } from '../moonPhase.js';
import { drawPressureGauge } from './gauge.js';
import { formatTime12 } from './time-display.js';
import { getUsAqiCategory, getDominantPollen, getAlertSeverityStyle, isPulseSeverity } from '../air-quality.js';

function hexToRgbTriplet(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

let prefersReducedMotion = false;

export function setReducedMotionPreference(reducedMotion) {
    prefersReducedMotion = reducedMotion;
}

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

    if (prefersReducedMotion) {
        el.textContent = newVal + suffix;
        el.dataset.animVal = String(newVal);
        _countState.delete(el);
        return;
    }

    // Flash animation for stat-value elements
    if (el.classList.contains('stat-value')) {
        el.classList.add('value-updating');
        setTimeout(() => el.classList.remove('value-updating'), 150);
    }

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
        const pastWindConverted = weatherService.convertWind(data.past.windSpeed);
        const wind = document.getElementById('past-wind');
        if (wind) {
            if (!prefersReducedMotion) {
                wind.classList.add('value-updating');
                setTimeout(() => wind.classList.remove('value-updating'), 150);
            }
            wind.textContent = `${pastWindConverted.value} ${pastWindConverted.unit}`;
        }
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
    if (data.sunset) setText('sunset-time', formatTime12(new Date(data.sunset)));

    // ── Advanced: historical year-ago ──
    if (data.historicalYearAgo) {
        setTemp('history-temp', data.historicalYearAgo.temp);
        setText('history-desc', data.historicalYearAgo.description);
    }

    // ── Advanced: accuracy ──
    const accuracyDeltaEl = document.getElementById('accuracy-delta');
    const accuracyTabBtn = document.querySelector('.tab-btn[data-tab="accuracy"]');

    if (data.accuracy) {
        // MAE is a temperature *delta*: °C → °F scales by 9/5 with no offset
        const maeDisplay =
            weatherService.unit === 'imperial'
                ? `${((data.accuracy.mae * 9) / 5).toFixed(1)}°F`
                : `${data.accuracy.mae.toFixed(1)}°C`;
        if (accuracyDeltaEl) {
            accuracyDeltaEl.textContent = `±${maeDisplay} over last 24h`;
            accuracyDeltaEl.style.color = '';
            accuracyDeltaEl.style.fontSize = '';
        }
        const accuracyScoreEl = document.getElementById('accuracy-score');
        if (accuracyScoreEl) {
            accuracyScoreEl.textContent = `Score: ${data.accuracy.score}%`;
            accuracyScoreEl.style.color =
                data.accuracy.score >= 90 ? '#22c55e' : data.accuracy.score >= 70 ? '#eab308' : '#ef4444';
        }
        if (accuracyTabBtn) accuracyTabBtn.style.display = '';
    } else {
        if (accuracyDeltaEl) {
            accuracyDeltaEl.textContent = 'No forecast accuracy data for this location.';
            accuracyDeltaEl.style.color = '';
            accuracyDeltaEl.style.fontSize = '14px';
        }
        setText('accuracy-score', '');

        if (accuracyTabBtn) {
            accuracyTabBtn.style.display = 'none';
            if (accuracyTabBtn.classList.contains('active')) {
                accuracyTabBtn.classList.remove('active');
                document.querySelector('.tab-btn[data-tab="history"]')?.classList.add('active');
                document.getElementById('tab-accuracy').classList.remove('active');
                document.getElementById('tab-history').classList.add('active');
            }
        }
    }

    // ── Advanced: regional ──
    if (data.regional) {
        const list = document.getElementById('regional-list');
        if (list) {
            list.innerHTML = '';
            data.regional.forEach((reg) => {
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
    toggle.setAttribute(
        'aria-label',
        `Toggle unit — currently ${weatherService.unit === 'metric' ? 'Celsius' : 'Fahrenheit'}`
    );
}

// ── updateQualityButton ──────────────────────────────────────────────────────
export function updateQualityButton(tier) {
    const btns = document.querySelectorAll('.quality-btn');
    btns.forEach((btn) => {
        if (btn.dataset.quality === tier) {
            btn.classList.add('active');
            btn.setAttribute('aria-pressed', 'true');
        } else {
            btn.classList.remove('active');
            btn.setAttribute('aria-pressed', 'false');
        }
    });

    const badge = document.getElementById('quality-stats-badge');
    if (badge) {
        badge.textContent = `TIER: ${tier.toUpperCase()}`;
    }
}

window.updateQualityButton = updateQualityButton;

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
        panelBg = `rgba(30, 15, 5, ${0.6 + sev * 0.15})`;
        panelBorder = `rgba(220, 140, 40, ${0.25 + sev * 0.1})`;
        headerColor = `hsl(${38 - sev * 15}, ${70 - sev * 20}%, ${65 - sev * 15}%)`;
    } else {
        // Day — sky-blue tint, stormy grey when severe
        panelBg = `rgba(0, 20, 60, ${0.55 + sev * 0.2})`;
        panelBorder = `rgba(100, 180, 255, ${0.15 + sev * 0.1})`;
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

// ── Air quality / pollen chips ───────────────────────────────────────────────
/**
 * @param {{usAqi?: number|null, europeanAqi?: number|null, pollen?: {birch?: number|null, grass?: number|null, ragweed?: number|null}}|null} airQuality
 */
export function updateAirQualityDisplay(airQuality) {
    const aqiEl = document.getElementById('current-aqi');
    if (aqiEl) {
        const category = getUsAqiCategory(airQuality?.usAqi);
        if (category) {
            aqiEl.hidden = false;
            aqiEl.textContent = `AQI ${Math.round(airQuality.usAqi)}`;
            aqiEl.title = category.label;
            aqiEl.style.setProperty('--badge-color', category.color);
            aqiEl.style.setProperty('--badge-rgb', hexToRgbTriplet(category.color));
        } else {
            aqiEl.hidden = true;
        }
    }

    const pollenEl = document.getElementById('current-pollen');
    if (pollenEl) {
        const dominant = getDominantPollen(airQuality?.pollen);
        if (dominant) {
            pollenEl.hidden = false;
            pollenEl.textContent = `Pollen: ${dominant.label}`;
            pollenEl.title = `${dominant.type} pollen: ${dominant.label}`;
            pollenEl.style.setProperty('--badge-color', dominant.color);
            pollenEl.style.setProperty('--badge-rgb', hexToRgbTriplet(dominant.color));
        } else {
            pollenEl.hidden = true;
        }
    }
}

let alertBannerToggleBound = false;

/**
 * @param {Array<{event: string, severity: string, headline: string, description: string}>} alerts
 */
export function updateAlertBanner(alerts) {
    const banner = document.getElementById('alert-banner');
    const headlineEl = document.getElementById('alert-banner-headline');
    const bodyEl = document.getElementById('alert-banner-body');
    const toggleBtn = document.getElementById('alert-banner-toggle');
    if (!banner || !headlineEl || !bodyEl || !toggleBtn) return;

    if (!alerts || alerts.length === 0) {
        banner.hidden = true;
        banner.classList.remove('pulse');
        return;
    }

    // Show the most severe alert as the headline; list the rest in the expandable body.
    const order = ['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown'];
    const sorted = [...alerts].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
    const top = sorted[0];
    const style = getAlertSeverityStyle(top.severity);

    banner.hidden = false;
    banner.classList.toggle('pulse', isPulseSeverity(top.severity));
    banner.style.setProperty('--badge-color', style.color);
    headlineEl.textContent = `${top.event}${sorted.length > 1 ? ` (+${sorted.length - 1} more)` : ''}`;

    // Built via DOM APIs (not innerHTML) since alert text comes from an external
    // feed (NWS) and must not be interpreted as markup.
    bodyEl.replaceChildren(
        ...sorted.map((alert) => {
            const item = document.createElement('div');
            item.className = 'alert-item';
            const strong = document.createElement('strong');
            strong.textContent = alert.event;
            item.append(strong, ` (${alert.severity}) — ${alert.headline || alert.description || ''}`);
            return item;
        })
    );

    if (!alertBannerToggleBound) {
        alertBannerToggleBound = true;
        toggleBtn.addEventListener('click', () => {
            const expanded = toggleBtn.getAttribute('aria-expanded') === 'true';
            toggleBtn.setAttribute('aria-expanded', String(!expanded));
            bodyEl.hidden = expanded;
        });
    }
}
