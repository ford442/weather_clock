import { describe, it, expect } from 'vitest';
import {
    CAPTURE_CONFIG,
    TIMELAPSE_CONFIG,
    computeExportPixelRatio,
    getTimelapseFrameCount
} from '../capture/capture-config.js';
import { buildCaptionLines } from '../capture/caption.js';
import { pickSupportedMimeType } from '../capture/timelapse.js';

describe('capture config', () => {
    it('doubles the pixel ratio and clamps to the maximum', () => {
        expect(computeExportPixelRatio(1)).toBe(2);
        expect(computeExportPixelRatio(1.5)).toBe(3);
        expect(computeExportPixelRatio(3)).toBe(CAPTURE_CONFIG.maxExportPixelRatio);
    });

    it('spans exactly 24 sim-hours at a fixed frame count', () => {
        const frames = getTimelapseFrameCount();
        expect(frames).toBe(720);
        expect(frames * TIMELAPSE_CONFIG.simSecondsPerFrame).toBe(24 * 3600);
        // 720 frames at 60 fps ~= 12 s of output at full render speed
        expect(frames / TIMELAPSE_CONFIG.fps).toBe(TIMELAPSE_CONFIG.outputSeconds);
    });
});

describe('buildCaptionLines', () => {
    const simulationTime = new Date(2026, 6, 30, 14, 32);

    it('combines location, time, condition, and temperature', () => {
        const lines = buildCaptionLines({
            simulationTime,
            locationName: 'Reykjavik',
            tempText: '18°C',
            descriptionText: 'Heavy rain'
        });
        expect(lines.title).toContain('Reykjavik');
        expect(lines.title).toContain('Jul');
        expect(lines.subtitle).toBe('Heavy rain · 18°C');
    });

    it('falls back when the location is missing', () => {
        const lines = buildCaptionLines({ simulationTime, locationName: '' });
        expect(lines.title).toContain('Unknown location');
    });

    it('omits placeholder condition/temp strings from the subtitle', () => {
        const lines = buildCaptionLines({
            simulationTime,
            locationName: 'Oslo',
            tempText: '--°',
            descriptionText: 'Loading...'
        });
        expect(lines.subtitle).toBe('');
    });

    it('trims and joins only the parts that exist', () => {
        const lines = buildCaptionLines({
            simulationTime,
            locationName: '  Oslo  ',
            tempText: ' 4°C ',
            descriptionText: ''
        });
        expect(lines.title).toContain('Oslo —');
        expect(lines.subtitle).toBe('4°C');
    });
});

describe('pickSupportedMimeType', () => {
    it('returns the first supported candidate', () => {
        const isTypeSupported = (type) => type.includes('vp8');
        expect(pickSupportedMimeType(TIMELAPSE_CONFIG.mimeCandidates, isTypeSupported)).toBe('video/webm;codecs=vp8');
    });

    it('prefers vp9 when everything is supported', () => {
        expect(pickSupportedMimeType(TIMELAPSE_CONFIG.mimeCandidates, () => true)).toBe('video/webm;codecs=vp9');
    });

    it('returns null when nothing is supported', () => {
        expect(pickSupportedMimeType(TIMELAPSE_CONFIG.mimeCandidates, () => false)).toBeNull();
    });
});
