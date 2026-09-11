import { animateModeCamera, MODE_CAMERA } from './camera-transition.js';

export class TimelineModeAdapter {
    /** @param {import('../ModeController.js').ModeController} owner */
    constructor(owner) {
        this.owner = owner;
        /** @type {import('../timeline/TimelineController.js').TimelineController|null} */
        this.controller = null;
        /** @type {import('../timeline/TimelineUI.js').TimelineUI|null} */
        this.ui = null;
        /** @type {Promise<{TimelineController: typeof import('../timeline/TimelineController.js').TimelineController, TimelineUI: typeof import('../timeline/TimelineUI.js').TimelineUI}>|null} */
        this.modulesPromise = null;
    }

    loadModules() {
        if (!this.modulesPromise) {
            this.modulesPromise = Promise.all([
                import('../timeline/TimelineController.js'),
                import('../timeline/TimelineUI.js')
            ]).then(([controllerModule, uiModule]) => ({
                TimelineController: controllerModule.TimelineController,
                TimelineUI: uiModule.TimelineUI
            }));
        }
        return this.modulesPromise;
    }

    async init() {
        if (this.controller) return;
        const { TimelineController, TimelineUI } = await this.loadModules();
        const location = this.owner.getCurrentLocation();
        let container = document.getElementById('timeline-ui-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'timeline-ui-container';
            document.body.appendChild(container);
        }

        this.controller = new TimelineController(this.owner.scene, this.owner.camera, this.owner.renderer);
        this.ui = new TimelineUI(container);
        await this.controller.loadData(/** @type {number} */ (location.lat), /** @type {number} */ (location.lon));
        this.controller.onDaySelect = (dayData) => this.ui?.showDayDetails(dayData);
        this.ui.setDayProxies(this.controller.dayColumns, (column) => this.controller?.selectDay(column));
    }

    /** @param {boolean} visible */
    setVisible(visible) {
        document.getElementById('timeline-ui-container')?.classList.toggle('visible', visible);
        this.controller?.setVisible(visible);
    }

    /** @param {{from?: import('../ModeController.js').AppMode}} [_transition] */
    async enter(_transition) {
        this.owner.controls.enabled = false;
        await this.init();
        const fromPosition = this.owner.camera.position.clone();
        const fromTarget = this.owner.controls.target.clone();
        await animateModeCamera(
            this.owner,
            fromPosition,
            fromTarget,
            MODE_CAMERA.timeline.position,
            MODE_CAMERA.timeline.target
        );
        this.setVisible(true);
        this.controller?.enableInteractions();
    }

    /** @param {{to?: import('../ModeController.js').AppMode}} [_transition] */
    exit(_transition) {
        this.controller?.disableInteractions();
        this.setVisible(false);
    }

    dispose() {
        this.controller?.dispose();
        this.ui?.dispose();
        this.controller = null;
        this.ui = null;
        document.getElementById('timeline-ui-container')?.remove();
    }
}
