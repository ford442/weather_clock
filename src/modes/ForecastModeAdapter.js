import { animateModeCamera, MODE_CAMERA } from './camera-transition.js';

export class ForecastModeAdapter {
    /** @param {import('../ModeController.js').ModeController} owner */
    constructor(owner) {
        this.owner = owner;
        /** @type {import('../forecast/ForecastController.js').ForecastController|null} */
        this.controller = null;
        /** @type {import('../forecast/ForecastUI.js').ForecastUI|null} */
        this.ui = null;
        /** @type {Promise<{ForecastController: typeof import('../forecast/ForecastController.js').ForecastController, ForecastUI: typeof import('../forecast/ForecastUI.js').ForecastUI}>|null} */
        this.modulesPromise = null;
        /** @type {(() => Promise<unknown>)|null} */
        this.prepareScene = null;
        /** @type {{index: number, day: DailyForecastDay, repDate: Date}|null} */
        this.focusedForecast = null;
    }

    /** @param {() => Promise<unknown>} loader */
    setSceneLoader(loader) {
        this.prepareScene = loader;
    }

    loadModules() {
        if (!this.modulesPromise) {
            this.modulesPromise = Promise.all([
                import('../forecast/ForecastController.js'),
                import('../forecast/ForecastUI.js')
            ]).then(([controllerModule, uiModule]) => ({
                ForecastController: controllerModule.ForecastController,
                ForecastUI: uiModule.ForecastUI
            }));
        }
        return this.modulesPromise;
    }

    /** @returns {HTMLElement} */
    getContainer() {
        let container = document.getElementById('forecast-ui-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'forecast-ui-container';
            container.style.cssText = 'position:fixed;bottom:8px;left:0;right:0;z-index:65;pointer-events:auto;';
            document.body.appendChild(container);
        }
        return container;
    }

    /**
     * @param {HTMLElement} container
     * @param {{ForecastController: typeof import('../forecast/ForecastController.js').ForecastController, ForecastUI: typeof import('../forecast/ForecastUI.js').ForecastUI}} modules
     */
    async init(container, modules) {
        if (this.controller) return;
        this.controller = new modules.ForecastController(
            this.owner.scene,
            this.owner.camera,
            this.owner.renderer,
            this.owner.weatherService
        );
        this.ui = new modules.ForecastUI(container, this.controller);
        this.controller.onDayFocus = (index, day, repDate) => {
            this.ui?.highlightCard?.(index);
            this.focusedForecast = { index, day, repDate };
            window.dispatchEvent(new CustomEvent('forecastfocus', { detail: { index, day, repDate } }));
        };
    }

    /** @param {boolean} visible */
    setVisible(visible) {
        const container = document.getElementById('forecast-ui-container');
        if (container) container.style.display = visible ? '' : 'none';
    }

    /** @param {{from?: import('../ModeController.js').AppMode}} [_transition] */
    async enter(_transition) {
        this.owner.controls.enabled = false;
        const [modules] = await Promise.all([this.loadModules(), this.prepareScene?.()]);
        const container = this.getContainer();
        container.style.display = '';
        await this.init(container, modules);

        const location = this.owner.getCurrentLocation();
        const prefetchedDaily = this.owner.state?.weatherData?.dailyForecast || null;
        if (!prefetchedDaily?.length) this.ui?.renderLoading?.();
        // init() above guarantees this.controller is set at this point.
        const controller = /** @type {import('../forecast/ForecastController.js').ForecastController} */ (
            this.controller
        );
        await controller.loadData(location.lat, location.lon, prefetchedDaily);
        if (controller.days.length) controller.focusDay(0);

        const fromPosition = this.owner.camera.position.clone();
        const fromTarget = this.owner.controls.target.clone();
        await animateModeCamera(
            this.owner,
            fromPosition,
            fromTarget,
            MODE_CAMERA.forecast.position,
            MODE_CAMERA.forecast.target
        );
    }

    /** @param {{to?: import('../ModeController.js').AppMode}} [_transition] */
    exit(_transition) {
        this.setVisible(false);
    }

    dispose() {
        this.controller?.dispose();
        this.ui?.dispose();
        this.controller = null;
        this.ui = null;
        this.focusedForecast = null;
        document.getElementById('forecast-ui-container')?.remove();
    }
}
