// @ts-nocheck
const UI_CONFIG = {
    timeWarpColorActive: 'rgba(255, 100, 100, 0.8)',
    timeWarpColorInactive: 'rgba(100, 255, 100, 0.4)',
    timeWarpSymbolActive: 'pause',
    timeWarpSymbolInactive: 'play',
    timeWarningColor: '#ffaa44',
    timeWarningGlow: '0 0 10px #ffaa44',
    timeNormalColor: '#ffffff',
    timeNormalGlow: '0 0 5px #000000'
};

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

const PLAY_ICON_SVG = `<polygon points="5,3 13,8 5,13" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linejoin="round"/>`;
const PAUSE_ICON_SVG = `<line x1="6" y1="3" x2="6" y2="13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="10" y1="3" x2="10" y2="13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`;

// ── updateTimelineScrubber ───────────────────────────────────────────────────
export function updateTimelineScrubber(simulationTime, isPlaying, speed) {
    const playIcon = document.getElementById('scrubber-play-icon');
    const timeChip = document.getElementById('scrubber-time-chip');
    const speedChip = document.getElementById('scrubber-speed-chip');
    const playhead = document.getElementById('scrubber-playhead');

    if (!playhead) return;

    // Playhead position: ((simulationTime - startOfDay) / 86400000) * 100%
    const startOfDay = new Date(simulationTime);
    startOfDay.setHours(0, 0, 0, 0);
    const msIntoDay = simulationTime.getTime() - startOfDay.getTime();
    const pct = (msIntoDay / 86400000) * 100;
    playhead.style.left = `${Math.max(0, Math.min(100, pct))}%`;

    if (timeChip) {
        timeChip.textContent = formatTime12(simulationTime);
    }

    if (speedChip) {
        speedChip.textContent = `${speed}×`;
        speedChip.dataset.speed = String(speed);
    }

    if (playIcon) {
        playIcon.innerHTML = isPlaying ? PAUSE_ICON_SVG : PLAY_ICON_SVG;
    }
}

/**
 * Update sunrise and sunset time displays.
 * @param {Date} sunrise
 * @param {Date} sunset
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

export { UI_CONFIG };
