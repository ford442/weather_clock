// Capture/export configuration constants

export const CAPTURE_CONFIG = {
    exportPixelRatioScale: 2, // render at 2x the active (tier-capped) ratio
    maxExportPixelRatio: 4,
    captionStripHeightPx: 72, // at 1x; scales with the export ratio
    captionPaddingPx: 24,
    filenamePrefix: 'aether'
};

export const TIMELAPSE_CONFIG = {
    fps: 60,
    outputSeconds: 12, // target wall-clock duration at full render speed
    simSecondsPerFrame: 120, // 24h / (60fps x 12s) = 720 frames
    videoBitsPerSecond: 12_000_000,
    mimeCandidates: ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
};

/** Total frames for a full 00:00 -> 24:00 sweep. */
export function getTimelapseFrameCount() {
    return Math.round((24 * 3600) / TIMELAPSE_CONFIG.simSecondsPerFrame);
}

/** Export pixel ratio for photo captures, clamped to the configured maximum. */
export function computeExportPixelRatio(currentRatio) {
    return Math.min(currentRatio * CAPTURE_CONFIG.exportPixelRatioScale, CAPTURE_CONFIG.maxExportPixelRatio);
}
