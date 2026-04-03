// UI management: DOM updates and event listeners
import { calculateMoonPhase } from './moonPhase.js';

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

/**
 * Format time in 12-hour format
 * @param {Date} date - Date to format
 * @returns {string} Formatted time string (e.g., "3:45 PM")
 */
export function formatTime12(date) {
    let hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${hours}:${minutes} ${ampm}`;
}

/**
 * Update time and date displays
 * @param {Date} simulationTime - Current simulation time
 * @param {boolean} isTimeWarping - Whether time warp is active
 */
export function updateTimeDisplay(simulationTime, isTimeWarping) {
    const timeDisplay = document.getElementById('time-display');
    if (!timeDisplay) return;

    timeDisplay.textContent = formatTime12(simulationTime);

    // Update date display
    const dateDisplay = document.getElementById('date-display');
    if (dateDisplay) {
        const options = { weekday: 'short', month: 'short', day: 'numeric' };
        dateDisplay.textContent = simulationTime.toLocaleDateString('en-US', options);
    }

    // Visual feedback for time warp
    if (isTimeWarping) {
        timeDisplay.style.color = UI_CONFIG.timeWarningColor;
        timeDisplay.style.textShadow = UI_CONFIG.timeWarningGlow;
    } else {
        timeDisplay.style.color = UI_CONFIG.timeNormalColor;
        timeDisplay.style.textShadow = UI_CONFIG.timeNormalGlow;
    }

    // Update past and forecast time headers
    const pastTime = new Date(simulationTime.getTime() - 3 * 3600 * 1000);
    const forecastTime = new Date(simulationTime.getTime() + 3 * 3600 * 1000);

    const pastDisplay = document.getElementById('past-time-display');
    if (pastDisplay) {
        pastDisplay.textContent = formatTime12(pastTime);
    }

    const forecastDisplay = document.getElementById('forecast-time-display');
    if (forecastDisplay) {
        forecastDisplay.textContent = formatTime12(forecastTime);
    }
}

/**
 * Update weather display panels
 * @param {Object} data - Weather data
 * @param {Object} weatherService - WeatherService instance for temperature conversion
 */
export function updateWeatherDisplay(data, weatherService) {
    if (!data) return;

    const t = (c) => Math.round(weatherService.convertTemp(c));
    const deg = '°';

    // Center panel (current)
    const locationEl = document.getElementById('location');
    if (locationEl) {
        locationEl.textContent = data.location || 'Unknown';
    }

    if (data.current) {
        const desc = document.getElementById('current-description');
        if (desc) desc.textContent = data.current.description;

        const temp = document.getElementById('current-temp');
        if (temp) temp.textContent = `${t(data.current.temp)}${deg}`;

        const feelsLike = document.getElementById('feels-like-temp');
        if (feelsLike && data.current.feelsLike != null) {
            feelsLike.textContent = `Feels like ${t(data.current.feelsLike)}${deg}`;
        }

        const humidity = document.getElementById('current-humidity');
        if (humidity && data.current.humidity != null) {
            humidity.textContent = `${Math.round(data.current.humidity)}%`;
        }

        const windConverted = weatherService.convertWind(data.current.windSpeed);
        const wind = document.getElementById('current-wind');
        if (wind) wind.textContent = `${windConverted.value} ${windConverted.unit}`;

        const windDir = document.getElementById('current-wind-dir');
        if (windDir && data.current.windDirection != null) {
            windDir.textContent = compassDir(data.current.windDirection);
        }
    }

    // Left panel (past)
    if (data.past) {
        const desc = document.getElementById('past-description');
        if (desc) desc.textContent = data.past.description;

        const temp = document.getElementById('past-temp');
        if (temp) temp.textContent = `${t(data.past.temp)}${deg}`;

        const pastWindConverted = weatherService.convertWind(data.past.windSpeed);
        const wind = document.getElementById('past-wind');
        if (wind) wind.textContent = `${pastWindConverted.value} ${pastWindConverted.unit}`;

        const cloud = document.getElementById('past-cloud');
        if (cloud) cloud.textContent = `${Math.round(data.past.cloudCover)}%`;
    }

    // Right panel (forecast)
    if (data.forecast) {
        const desc = document.getElementById('forecast-description');
        if (desc) desc.textContent = data.forecast.description;

        const temp = document.getElementById('forecast-temp');
        if (temp) temp.textContent = `${t(data.forecast.temp)}${deg}`;

        const forecastWindConverted = weatherService.convertWind(data.forecast.windSpeed);
        const wind = document.getElementById('forecast-wind');
        if (wind) wind.textContent = `${forecastWindConverted.value} ${forecastWindConverted.unit}`;

        const cloud = document.getElementById('forecast-cloud');
        if (cloud) cloud.textContent = `${Math.round(data.forecast.cloudCover)}%`;
    }

    // Moon phase
    const mp = calculateMoonPhase();
    const moonPhaseEl = document.getElementById('moon-phase');
    if (moonPhaseEl) {
        moonPhaseEl.textContent = mp.phaseName;
    }

    // Advanced panel: historical
    if (data.historicalYearAgo) {
        const histTemp = document.getElementById('history-temp');
        if (histTemp) histTemp.textContent = `${t(data.historicalYearAgo.temp)}${deg}`;

        const histDesc = document.getElementById('history-desc');
        if (histDesc) histDesc.textContent = data.historicalYearAgo.description;
    }

    // Advanced panel: accuracy
    if (data.accuracy) {
        let delta = data.accuracy.delta;
        if (weatherService.unit === 'imperial') {
            delta = delta * 1.8;
        }

        const sign = delta > 0 ? '+' : (delta < 0 ? '-' : '');
        const deltaEl = document.getElementById('accuracy-delta');
        if (deltaEl) {
            deltaEl.textContent = `${sign}${Math.abs(delta).toFixed(1)}${deg}`;
            const color = Math.abs(data.accuracy.delta) < 2 ? '#44ff44' : '#ff4444';
            deltaEl.style.color = color;
        }

        const scoreEl = document.getElementById('accuracy-score');
        if (scoreEl) {
            scoreEl.textContent = `Score: ${data.accuracy.accuracy}%`;
        }
    }

    // Regional data
    if (data.regional) {
        const list = document.getElementById('regional-list');
        if (list) {
            list.innerHTML = '';
            data.regional.forEach(reg => {
                const div = document.createElement('div');
                div.innerHTML = `<b>${reg.name}:</b> ${t(reg.temp)}${deg}`;
                list.appendChild(div);
            });
        }
    }
}

/**
 * Update unit toggle button text
 * @param {Object} weatherService - WeatherService instance
 */
export function updateUnitButton(weatherService) {
    const btn = document.getElementById('unit-toggle');
    if (!btn) return;

    const nextUnit = weatherService.unit === 'metric' ? '°F' : '°C';
    btn.textContent = `Switch to ${nextUnit}`;
}

/**
 * Setup all event listeners
 * @param {Object} callbacks - Object with callback functions
 */
export function setupEventListeners(callbacks) {
    // Retry location button
    const retryBtn = document.getElementById('retry-location');
    if (retryBtn) {
        retryBtn.addEventListener('click', callbacks.onRetryLocation);
    }

    // Unit toggle button
    const unitBtn = document.getElementById('unit-toggle');
    if (unitBtn) {
        unitBtn.addEventListener('click', callbacks.onToggleUnit);
    }

    // Location search
    const searchInput = document.getElementById('location-search');
    const searchBtn = document.getElementById('search-btn');

    if (searchBtn) {
        searchBtn.addEventListener('click', () => {
            callbacks.onSearch(searchInput?.value || '');
        });
    }

    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                callbacks.onSearch(searchInput.value);
            }
        });
    }

    // Time warp button
    const warpBtn = document.getElementById('time-warp-btn');
    if (warpBtn) {
        warpBtn.addEventListener('click', callbacks.onToggleTimeWarp);
    }
}

/**
 * Update time warp button appearance
 * @param {boolean} isActive - Whether time warp is active
 */
export function updateTimeWarpButton(isActive) {
    const warpBtn = document.getElementById('time-warp-btn');
    if (!warpBtn) return;

    warpBtn.style.background = isActive
        ? UI_CONFIG.timeWarpColorActive
        : UI_CONFIG.timeWarpColorInactive;
    warpBtn.textContent = isActive
        ? UI_CONFIG.timeWarpSymbolActive
        : UI_CONFIG.timeWarpSymbolInactive;
}

/**
 * Set search button loading state
 * @param {boolean} isLoading - Whether search is in progress
 */
export function setSearchLoading(isLoading) {
    const searchBtn = document.getElementById('search-btn');
    if (searchBtn) {
        searchBtn.textContent = isLoading ? '...' : 'Go';
    }
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
