// @ts-nocheck
import { animateModeCamera, MODE_CAMERA } from './camera-transition.js';

export class ForecastModeAdapter {
    constructor(owner) {
        this.owner = owner;
        this.controller = null;
        this.ui = null;
        this.modulesPromise = null;
        this.prepareScene = null;
        this.focusedForecast = null;
    }

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

    setVisible(visible) {
        const container = document.getElementById('forecast-ui-container');
        if (container) container.style.display = visible ? '' : 'none';
    }

    async enter() {
        this.owner.controls.enabled = false;
        const [modules] = await Promise.all([this.loadModules(), this.prepareScene?.()]);
        const container = this.getContainer();
        container.style.display = '';
        await this.init(container, modules);

        const location = this.owner.getCurrentLocation();
        const prefetchedDaily = this.owner.state?.weatherData?.dailyForecast || null;
        if (!prefetchedDaily?.length) this.ui?.renderLoading?.();
        await this.controller.loadData(location.lat, location.lon, prefetchedDaily);
        if (this.controller.days.length) this.controller.focusDay(0);

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

    exit() {
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
