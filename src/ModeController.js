/**
 * Thin mode state machine. Per-mode adapters own camera and UI transitions;
 * ModeShell owns shared toggle/drawer chrome.
 */
import * as THREE from 'three';
import { ClockModeAdapter } from './modes/ClockModeAdapter.js';
import { ForecastModeAdapter } from './modes/ForecastModeAdapter.js';
import { ModeShell } from './modes/ModeShell.js';
import { TimelineModeAdapter } from './modes/TimelineModeAdapter.js';
import { animateModeCamera } from './modes/camera-transition.js';

/** @typedef {'clock'|'timeline'|'forecast'} AppMode */

const MODES = ['clock', 'timeline', 'forecast'];

export class ModeController {
    /**
     * @param {THREE.Scene} scene
     * @param {THREE.Camera} camera
     * @param {import('three/addons/controls/OrbitControls.js').OrbitControls} controls
     * @param {THREE.WebGLRenderer|import('three/webgpu').WebGPURenderer} renderer
     * @param {import('./weather.js').WeatherService} weatherService
     * @param {AppState|null} [state]
     */
    constructor(scene, camera, controls, renderer, weatherService, state = null) {
        this.scene = scene;
        this.camera = camera;
        this.controls = controls;
        this.renderer = renderer;
        this.weatherService = weatherService;
        this.state = state;

        /** @type {AppMode} */
        this.currentMode = 'clock';
        this.isTransitioning = false;
        this.locked = false; // blocks mode switching (e.g. during time-lapse recording)
        this.animationId = null;
        this.clockCameraState = {
            position: new THREE.Vector3(),
            target: new THREE.Vector3()
        };

        this.clockAdapter = new ClockModeAdapter(this);
        this.timelineAdapter = new TimelineModeAdapter(this);
        this.forecastAdapter = new ForecastModeAdapter(this);
        this.adapters = {
            clock: this.clockAdapter,
            timeline: this.timelineAdapter,
            forecast: this.forecastAdapter
        };
        this.shell = new ModeShell(this);
        this.init();
    }

    get timelineController() {
        return this.timelineAdapter.controller;
    }

    get timelineUI() {
        return this.timelineAdapter.ui;
    }

    get forecastController() {
        return this.forecastAdapter.controller;
    }

    get forecastUI() {
        return this.forecastAdapter.ui;
    }

    get _focusedForecast() {
        return this.forecastAdapter.focusedForecast;
    }

    init() {
        this.saveClockCameraState();
        this.shell.createModeToggle();
        this.setupHistory();
        this.shell.setupKeyboardShortcuts();
    }

    /** @param {boolean} reducedMotion */
    setReducedMotion(reducedMotion) {
        if (this.state) this.state.reducedMotion = reducedMotion;
    }

    /** Block/unblock all mode switching (button, T key, popstate) — used while recording a time-lapse.
     * @param {boolean} locked */
    setLocked(locked) {
        this.locked = locked;
    }

    /** @param {() => Promise<unknown>} loader */
    setForecastSceneLoader(loader) {
        this.forecastAdapter.setSceneLoader(loader);
    }

    loadTimelineModules() {
        return this.timelineAdapter.loadModules();
    }

    loadForecastModules() {
        return this.forecastAdapter.loadModules();
    }

    saveClockCameraState() {
        this.clockAdapter.saveCameraState();
    }

    showLeftDrawer() {
        this.shell.showLeftDrawer();
    }

    showRightDrawer() {
        this.shell.showRightDrawer();
    }

    hideDrawers() {
        this.shell.hideDrawers();
    }

    _crossFadeCenterOverlay() {
        this.shell._crossFadeCenterOverlay();
    }

    createModeToggle() {
        this.shell.createModeToggle();
    }

    injectStyles() {
        this.shell.injectStyles();
    }

    /** Cycle Clock → Timeline → Forecast. @returns {Promise<void>|void} */
    toggleMode() {
        const currentIndex = MODES.indexOf(this.currentMode);
        return this.switchMode(/** @type {AppMode} */ (MODES[(currentIndex + 1) % MODES.length]));
    }

    /** @param {AppMode} newMode */
    async switchMode(newMode) {
        if (!MODES.includes(newMode) || newMode === this.currentMode || this.isTransitioning || this.locked) return;

        this.isTransitioning = true;
        this._crossFadeCenterOverlay();
        this.updateHistory(newMode);

        const previousMode = this.currentMode;
        try {
            await this.adapters[previousMode].exit?.({ to: newMode });
            await this.adapters[newMode].enter?.({ from: previousMode });
            this.currentMode = newMode;
            this.updateToggleUI();
            window.dispatchEvent(new CustomEvent('modechange', { detail: { mode: newMode } }));
        } finally {
            this.isTransitioning = false;
        }
    }

    enterTimelineMode() {
        return this.timelineAdapter.enter();
    }

    enterForecastMode() {
        return this.forecastAdapter.enter();
    }

    enterClockMode() {
        return this.clockAdapter.enter();
    }

    initTimeline() {
        return this.timelineAdapter.init();
    }

    /**
     * @param {THREE.Vector3} fromPosition
     * @param {THREE.Vector3} fromTarget
     * @param {THREE.Vector3} toPosition
     * @param {THREE.Vector3} toTarget
     */
    animateCamera(fromPosition, fromTarget, toPosition, toTarget) {
        return animateModeCamera(this, fromPosition, fromTarget, toPosition, toTarget);
    }

    /** @param {boolean} visible */
    setClockUIVisibility(visible) {
        this.clockAdapter.setVisible(visible);
    }

    /** @param {boolean} visible */
    setTimelineUIVisibility(visible) {
        this.timelineAdapter.setVisible(visible);
    }

    /** @param {boolean} visible */
    setForecastUIVisibility(visible) {
        this.forecastAdapter.setVisible(visible);
    }

    updateToggleUI() {
        this.shell.updateToggleUI();
    }

    /** @param {AppMode} mode */
    updateHistory(mode) {
        const url = new URL(window.location.href);
        if (mode === 'clock') {
            url.searchParams.delete('mode');
            history.pushState({ mode: 'clock' }, '', url);
        } else {
            url.searchParams.set('mode', mode);
            history.pushState({ mode }, '', url);
        }
    }

    setupHistory() {
        window.addEventListener('popstate', (event) => {
            const mode = event.state?.mode || 'clock';
            if (mode !== this.currentMode && !this.isTransitioning) this.switchMode(mode);
        });

        const initialMode = new URLSearchParams(window.location.search).get('mode') || 'clock';
        if (MODES.includes(initialMode) && initialMode !== 'clock') {
            this.switchMode(/** @type {AppMode} */ (initialMode));
        }
    }

    setupKeyboardShortcuts() {
        this.shell.setupKeyboardShortcuts();
    }

    /** @returns {{lat: number|null, lon: number|null}} */
    getCurrentLocation() {
        if (
            (this.weatherService.latitude == null || this.weatherService.longitude == null) &&
            this.weatherService.setDefaultLocation
        ) {
            this.weatherService.setDefaultLocation();
        }
        return {
            lat: this.weatherService.latitude,
            lon: this.weatherService.longitude
        };
    }

    /** @returns {AppMode} */
    getMode() {
        return this.currentMode;
    }

    /** @returns {boolean} */
    isTimelineMode() {
        return this.currentMode === 'timeline';
    }

    /** @returns {boolean} */
    isForecastMode() {
        return this.currentMode === 'forecast';
    }

    dispose() {
        if (this.animationId) cancelAnimationFrame(this.animationId);
        Object.values(this.adapters).forEach((adapter) => adapter.dispose?.());
        this.shell.dispose();
    }
}

export default ModeController;
