// Photo mode: render one high-resolution frame and export it as a share-card PNG.
import { CAPTURE_CONFIG, computeExportPixelRatio } from './capture-config.js';
import { buildCaptionLines, compositeCaption } from './caption.js';
import { shareOrDownload } from './share.js';
import { t } from '../i18n/strings.js';

/** Read caption inputs from the live UI, with localStorage as location fallback. */
function readCaptionContext(state) {
    const elementText = (id) => document.getElementById(id)?.textContent?.trim() || '';
    let locationName = elementText('location');
    // Ignore transient status strings shown in the location slot.
    if (/detecting|loading|retrying|updating|unavailable/i.test(locationName)) locationName = '';
    if (!locationName) locationName = localStorage.getItem('weatherclock_location') || '';
    return {
        simulationTime: state.simulationTime,
        locationName,
        tempText: elementText('current-temp'),
        descriptionText: elementText('current-description')
    };
}

function formatTimestamp(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/**
 * Capture the current scene at export resolution and save/share it as a PNG
 * with a caption strip. Works on both WebGL and WebGPU pipelines because the
 * blob is read in the same task as an explicit render — no
 * `preserveDrawingBuffer` needed (the drawing buffer is invalidated only once
 * the frame is composited; the async toBlob callback still gets the snapshot).
 * @param {Object} deps
 * @param {any} deps.renderer active Three.js renderer (WebGL or WebGPU)
 * @param {any} deps.pipeline post-processing pipeline ({render, setSize, setPixelRatio})
 * @param {any} deps.state shared application state (uses simulationTime)
 * @param {(message: string, type?: string, durationMs?: number) => void} [deps.showToast]
 */
export async function capturePhoto({ renderer, pipeline, state, showToast = () => {} }) {
    const canvas = renderer.domElement;
    const previousRatio = renderer.getPixelRatio();
    const exportRatio = computeExportPixelRatio(previousRatio);

    // Cosmetic only — the GL canvas never contains DOM, but the brief clean
    // view doubles as a capture preview flash.
    document.body.classList.add('capture-mode');
    try {
        renderer.setPixelRatio(exportRatio);
        renderer.setSize(window.innerWidth, window.innerHeight);
        pipeline.setPixelRatio?.(exportRatio);
        pipeline.setSize(window.innerWidth, window.innerHeight);
        pipeline.render();

        const sceneBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!sceneBlob) throw new Error('canvas.toBlob returned null');

        // The GL buffer may be cleared by now, so composite from the blob,
        // not from the live canvas.
        const bitmap = await createImageBitmap(sceneBlob);
        const lines = buildCaptionLines(readCaptionContext(state));
        const composed = compositeCaption(bitmap, lines, exportRatio);
        bitmap.close?.();

        const pngBlob = await new Promise((resolve) => composed.toBlob(resolve, 'image/png'));
        if (!pngBlob) throw new Error('composited canvas.toBlob returned null');

        const filename = `${CAPTURE_CONFIG.filenamePrefix}-${formatTimestamp(state.simulationTime)}.png`;
        const result = await shareOrDownload(pngBlob, filename);
        if (result === 'downloaded') showToast(t('photoSaved'), 'success', 2500);
        else if (result === 'shared') showToast(t('photoShared'), 'success', 2500);
    } catch (error) {
        console.error('Photo capture failed:', error);
        showToast(t('photoCaptureFailed'), 'error');
    } finally {
        renderer.setPixelRatio(previousRatio);
        renderer.setSize(window.innerWidth, window.innerHeight);
        pipeline.setPixelRatio?.(previousRatio);
        pipeline.setSize(window.innerWidth, window.innerHeight);
        pipeline.render(); // repaint immediately so the resize clear is never visible
        document.body.classList.remove('capture-mode');
    }
}
