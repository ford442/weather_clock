import { animateModeCamera } from './camera-transition.js';

const CLOCK_UI_SELECTORS = ['#panel-left', '#panel-right', '#panel-advanced', '#timeline-scrubber', '.center-stats'];

export class ClockModeAdapter {
    /** @param {import('../ModeController.js').ModeController} owner */
    constructor(owner) {
        this.owner = owner;
    }

    saveCameraState() {
        this.owner.clockCameraState.position.copy(this.owner.camera.position);
        this.owner.clockCameraState.target.copy(this.owner.controls.target);
    }

    /** @param {boolean} visible */
    setVisible(visible) {
        CLOCK_UI_SELECTORS.forEach((selector) => {
            const element = /** @type {HTMLElement|null} */ (document.querySelector(selector));
            if (!element) return;
            element.classList.toggle('hidden', !visible);
            element.style.opacity = visible ? '' : '0';
            element.style.pointerEvents = visible ? '' : 'none';
        });
    }

    /** @param {{from?: import('../ModeController.js').AppMode}} [_transition] */
    async enter(_transition) {
        const currentPosition = this.owner.camera.position.clone();
        const currentTarget = this.owner.controls.target.clone();
        await animateModeCamera(
            this.owner,
            currentPosition,
            currentTarget,
            this.owner.clockCameraState.position,
            this.owner.clockCameraState.target
        );
        this.owner.controls.enabled = true;
        this.setVisible(true);
    }

    /** @param {{to?: import('../ModeController.js').AppMode}} [_transition] */
    exit(_transition) {
        this.saveCameraState();
        this.owner.controls.enabled = false;
        this.setVisible(false);
    }

    dispose() {}
}
