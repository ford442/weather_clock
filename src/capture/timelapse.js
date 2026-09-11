// Time-lapse export: deterministic 00:00 -> 24:00 sweep recorded via MediaRecorder.
import { TIMELAPSE_CONFIG, CAPTURE_CONFIG, getTimelapseFrameCount } from './capture-config.js';
import { shareOrDownload } from './share.js';
import { t } from '../i18n/strings.js';

/**
 * Pick the first MIME type the browser can record, or null.
 * Pure (the support check is injected) so it is unit-testable.
 */
export function pickSupportedMimeType(candidates, isTypeSupported) {
    return candidates.find((type) => isTypeSupported(type)) || null;
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

export class TimelapseRecorder {
    /**
     * @param {Object} deps
     * @param {any} deps.state shared application state
     * @param {any} deps.animationController AnimationController (suspend/resume/update)
     * @param {any} deps.modeController ModeController (getMode/switchMode/setLocked)
     * @param {HTMLCanvasElement} deps.canvas the renderer's canvas
     * @param {(message: string, type?: string, durationMs?: number) => void} [deps.showToast]
     */
    constructor({ state, animationController, modeController, canvas, showToast = () => {} }) {
        this.state = state;
        this.animationController = animationController;
        this.modeController = modeController;
        this.canvas = canvas;
        this.showToast = showToast;
        this._recording = false;
        this._cancelled = false;
        this._savedState = null;
        this._stream = null;
        this._lastPercent = -1;
    }

    get isRecording() {
        return this._recording;
    }

    async start() {
        if (this._recording) return;
        if (this.state.reducedMotion) {
            this.showToast(t('timelapseDisabledReducedMotion'), 'info', 3000);
            return;
        }
        if (typeof MediaRecorder === 'undefined' || typeof this.canvas.captureStream !== 'function') {
            this.showToast(t('videoRecordingUnsupported'), 'error');
            return;
        }
        const mimeType = pickSupportedMimeType(TIMELAPSE_CONFIG.mimeCandidates, (type) =>
            MediaRecorder.isTypeSupported(type)
        );
        if (!mimeType) {
            this.showToast(t('noWebmCodec'), 'error');
            return;
        }

        this._recording = true;
        this._cancelled = false;
        try {
            if (this.modeController.getMode?.() !== 'clock') {
                await this.modeController.switchMode('clock');
            }
            this.modeController.setLocked(true);
            this.animationController.suspend('timelapse');

            this._savedState = {
                simulationTime: this.state.simulationTime,
                isTimeWarping: this.state.isTimeWarping,
                timeSpeed: this.state.timeSpeed
            };
            // Each update(1/fps) then advances the sim by exactly simSecondsPerFrame.
            this.state.isTimeWarping = true;
            this.state.timeSpeed = TIMELAPSE_CONFIG.simSecondsPerFrame * TIMELAPSE_CONFIG.fps;
            const startOfDay = new Date(this.state.simulationTime);
            startOfDay.setHours(0, 0, 0, 0);
            this.state.simulationTime = startOfDay;

            this._stream = this.canvas.captureStream(TIMELAPSE_CONFIG.fps);
            const recorder = new MediaRecorder(this._stream, {
                mimeType,
                videoBitsPerSecond: TIMELAPSE_CONFIG.videoBitsPerSecond
            });
            const chunks = [];
            recorder.ondataavailable = (event) => {
                if (event.data?.size) chunks.push(event.data);
            };
            const stopped = new Promise((resolve) => {
                recorder.onstop = resolve;
            });

            this._setProgressVisible(true);
            this._lastPercent = -1;
            recorder.start();

            // Fixed internal timestep: exactly getTimelapseFrameCount() frames
            // spanning 24 sim-hours, so the recorded sweep is always identical.
            // Wall-clock duration scales with render speed (~12 s at 60 fps).
            // Note: rAF stalls while the tab is hidden, pausing the export.
            const totalFrames = getTimelapseFrameCount();
            const frameDelta = 1 / TIMELAPSE_CONFIG.fps;
            for (let frame = 0; frame < totalFrames; frame++) {
                if (this._cancelled) break;
                await nextFrame();
                if (this._cancelled) break;
                this.animationController.update(frameDelta);
                this._updateProgress((frame + 1) / totalFrames);
            }

            recorder.stop();
            await stopped;

            if (this._cancelled) {
                this.showToast(t('timelapseCancelled'), 'info', 2500);
            } else {
                const blob = new Blob(chunks, { type: mimeType.split(';')[0] });
                if (blob.size > 0) {
                    const date = this._savedState.simulationTime;
                    const pad = (n) => String(n).padStart(2, '0');
                    const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
                    const filename = `${CAPTURE_CONFIG.filenamePrefix}-timelapse-${stamp}.webm`;
                    const result = await shareOrDownload(blob, filename);
                    if (result !== 'aborted') this.showToast(t('timelapseSaved'), 'success', 3000);
                } else {
                    this.showToast(t('timelapseNoData'), 'error');
                }
            }
        } catch (error) {
            console.error('Time-lapse export failed:', error);
            this.showToast(t('timelapseExportFailed'), 'error');
        } finally {
            this._cleanup();
        }
    }

    cancel() {
        if (this._recording) this._cancelled = true;
    }

    _cleanup() {
        if (this._savedState) {
            this.state.simulationTime = this._savedState.simulationTime;
            this.state.isTimeWarping = this._savedState.isTimeWarping;
            this.state.timeSpeed = this._savedState.timeSpeed;
            this._savedState = null;
        }
        this._stream?.getTracks().forEach((track) => track.stop());
        this._stream = null;
        this.animationController.resume('timelapse');
        this.modeController.setLocked(false);
        this._setProgressVisible(false);
        this._recording = false;
    }

    _setProgressVisible(visible) {
        const pill = document.getElementById('timelapse-progress');
        if (pill) pill.hidden = !visible;
    }

    _updateProgress(fraction) {
        const percent = Math.round(fraction * 100);
        if (percent === this._lastPercent) return; // throttle DOM writes
        this._lastPercent = percent;
        const fill = document.getElementById('timelapse-progress-fill');
        const label = document.getElementById('timelapse-progress-pct');
        if (fill) fill.style.width = `${percent}%`;
        if (label) label.textContent = `${percent}%`;
    }
}
