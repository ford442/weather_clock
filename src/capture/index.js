// Capture module entry: photo mode + time-lapse export wiring.
import { capturePhoto } from './photo.js';
import { TimelapseRecorder } from './timelapse.js';

/**
 * Wire the photo-capture and time-lapse buttons and return handles used by
 * the keyboard shortcuts and the reduced-motion preference handler.
 */
export function setupCapture({ state, renderer, pipeline, animationController, modeController, showToast }) {
    const recorder = new TimelapseRecorder({
        state,
        animationController,
        modeController,
        canvas: renderer.domElement,
        showToast
    });

    const takePhoto = () => capturePhoto({ renderer, pipeline, state, showToast });
    const toggleTimelapse = () => {
        if (recorder.isRecording) recorder.cancel();
        else recorder.start();
    };

    document.getElementById('photo-capture')?.addEventListener('click', takePhoto);
    document.getElementById('timelapse-record')?.addEventListener('click', toggleTimelapse);
    document.getElementById('timelapse-cancel')?.addEventListener('click', () => recorder.cancel());

    const setReducedMotion = (reduced) => {
        const button = document.getElementById('timelapse-record');
        if (button) button.hidden = reduced;
    };
    setReducedMotion(state.reducedMotion);

    return { capturePhoto: takePhoto, toggleTimelapse, recorder, setReducedMotion };
}
