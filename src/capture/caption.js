// Caption strip: pure text builder plus 2D compositing for share-card captures.
import { CAPTURE_CONFIG } from './capture-config.js';
import { formatDate, formatTime } from '../i18n/strings.js';

const FALLBACK_LOCATION = 'Unknown location';

/**
 * Build the two caption lines for a share card.
 * Pure function — unit-testable without a DOM.
 * @param {{simulationTime: Date, locationName?: string, tempText?: string, descriptionText?: string}} context
 * @returns {{title: string, subtitle: string}}
 */
export function buildCaptionLines({ simulationTime, locationName, tempText, descriptionText }) {
    const location = (locationName || '').trim() || FALLBACK_LOCATION;
    const date = simulationTime instanceof Date ? simulationTime : new Date(simulationTime);
    const time = formatTime(date);
    const day = formatDate(date, { weekday: 'short', day: 'numeric', month: 'short' });
    const title = `${location} — ${time}, ${day}`;

    const parts = [];
    if (descriptionText?.trim() && descriptionText.trim() !== 'Loading...') {
        parts.push(descriptionText.trim());
    }
    if (tempText?.trim() && tempText.trim() !== '--°') {
        parts.push(tempText.trim());
    }
    return { title, subtitle: parts.join(' · ') };
}

/**
 * Draw the captured scene onto a new 2D canvas with a subtle caption strip.
 * @param {HTMLCanvasElement|ImageBitmap} source captured scene at export resolution
 * @param {{title: string, subtitle: string}} lines
 * @param {number} scale caption scale factor (export pixel ratio)
 * @returns {HTMLCanvasElement}
 */
export function compositeCaption(source, lines, scale = 1) {
    const width = source.width;
    const height = source.height;
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d');
    ctx.drawImage(source, 0, 0);

    const stripHeight = CAPTURE_CONFIG.captionStripHeightPx * scale;
    const padding = CAPTURE_CONFIG.captionPaddingPx * scale;

    // Soft gradient scrim so the text reads over bright skies.
    const gradient = ctx.createLinearGradient(0, height - stripHeight * 1.6, 0, height);
    gradient.addColorStop(0, 'rgba(8, 8, 16, 0)');
    gradient.addColorStop(1, 'rgba(8, 8, 16, 0.65)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, height - stripHeight * 1.6, width, stripHeight * 1.6);

    const titleSize = Math.round(20 * scale);
    const subtitleSize = Math.round(15 * scale);
    const baseline = height - padding;

    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 4 * scale;
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${titleSize}px Inter, system-ui, sans-serif`;
    ctx.fillText(lines.title, padding, lines.subtitle ? baseline - subtitleSize - 6 * scale : baseline);

    if (lines.subtitle) {
        ctx.font = `400 ${subtitleSize}px Inter, system-ui, sans-serif`;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.fillText(lines.subtitle, padding, baseline);
    }
    return out;
}
