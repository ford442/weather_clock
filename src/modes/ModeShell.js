// @ts-nocheck
/**
 * Shared mode chrome: toggle button, drawers, cross-fade, and keyboard controls.
 * Mode state and transitions remain owned by ModeController and its adapters.
 */
export class ModeShell {
    constructor(owner) {
        this.owner = owner;
    }

    get state() {
        return this.owner.state;
    }

    get currentMode() {
        return this.owner.currentMode;
    }

    toggleMode() {
        return this.owner.toggleMode();
    }

    switchMode(mode) {
        return this.owner.switchMode(mode);
    }

    /**
     * Show left drawer and hide right drawer
     */
    showLeftDrawer() {
        const left = document.getElementById('panel-left');
        const right = document.getElementById('panel-right');
        if (left) {
            this._setWillChange(left);
            left.classList.add('expanded');
        }
        if (right) right.classList.remove('expanded');
        document.body.classList.add('drawers-open');
    }

    /**
     * Show right drawer and hide left drawer
     */
    showRightDrawer() {
        const left = document.getElementById('panel-left');
        const right = document.getElementById('panel-right');
        if (left) left.classList.remove('expanded');
        if (right) {
            this._setWillChange(right);
            right.classList.add('expanded');
        }
        document.body.classList.add('drawers-open');
    }

    /**
     * Hide both drawers
     */
    hideDrawers() {
        const left = document.getElementById('panel-left');
        const right = document.getElementById('panel-right');
        if (left) {
            this._setWillChange(left);
            left.classList.remove('expanded');
        }
        if (right) {
            this._setWillChange(right);
            right.classList.remove('expanded');
        }
        document.body.classList.remove('drawers-open');
    }

    /**
     * Add will-change: transform during CSS transitions and remove after
     */
    _setWillChange(el) {
        if (!el) return;
        el.style.willChange = 'transform';
        const onEnd = () => {
            el.style.willChange = '';
            el.removeEventListener('transitionend', onEnd);
        };
        el.addEventListener('transitionend', onEnd, { once: true });
    }

    /**
     * Cross-fade center overlay during mode switch
     */
    _crossFadeCenterOverlay() {
        if (this.state?.reducedMotion) return;
        const overlay = document.getElementById('center-overlay');
        if (!overlay) return;
        overlay.style.willChange = 'transform, opacity';
        overlay.classList.remove('mode-crossfade');
        void overlay.offsetWidth; // force reflow
        overlay.classList.add('mode-crossfade');
        const onEnd = () => {
            overlay.style.willChange = '';
            overlay.classList.remove('mode-crossfade');
            overlay.removeEventListener('animationend', onEnd);
        };
        overlay.addEventListener('animationend', onEnd, { once: true });
    }

    /**
     * Create the mode toggle button in the UI
     */
    createModeToggle() {
        // Check if toggle already exists
        if (document.getElementById('mode-toggle')) {
            return;
        }

        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'mode-toggle';
        toggleBtn.className = 'mode-toggle-btn';
        toggleBtn.innerHTML = `<svg class="icon-svg" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="7" stroke="currentColor" fill="none" stroke-width="1.5"/><line x1="8" y1="8" x2="8" y2="4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="8" y1="8" x2="11" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
        toggleBtn.title = 'Cycle views: Clock / Timeline / 10-Day Forecast (T)';
        toggleBtn.setAttribute('aria-label', 'Cycle between clock, timeline and forecast views');

        // Add to center panel
        const centerPanel = document.getElementById('panel-center');
        if (centerPanel) {
            // Insert after the time display section
            const timeDisplay = centerPanel.querySelector('.time-display');
            if (timeDisplay && timeDisplay.parentElement) {
                timeDisplay.parentElement.appendChild(toggleBtn);
            } else {
                centerPanel.insertBefore(toggleBtn, centerPanel.firstChild);
            }
        }

        // Add click handler
        toggleBtn.addEventListener('click', () => {
            this.toggleMode();
        });

        // Add CSS if not already present
        this.injectStyles();
    }

    /**
     * Inject required CSS styles
     */
    injectStyles() {
        if (document.getElementById('mode-controller-styles')) {
            return;
        }

        const styles = document.createElement('style');
        styles.id = 'mode-controller-styles';
        styles.textContent = `
            .mode-toggle-btn {
                position: fixed;
                top: 20px;
                right: 20px;
                width: 50px;
                height: 50px;
                border-radius: 50%;
                border: 1px solid rgba(255, 255, 255, 0.3);
                background: rgba(0, 0, 0, 0.6);
                backdrop-filter: blur(10px);
                color: white;
                font-size: 24px;
                cursor: pointer;
                transition: all 0.3s ease;
                z-index: 100;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
            }
            
            .mode-toggle-btn:hover {
                transform: scale(1.1);
                background: rgba(0, 0, 0, 0.8);
                border-color: rgba(255, 255, 255, 0.5);
                box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
            }
            
            .mode-toggle-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
                transform: none;
            }
            
            /* Timeline UI Container */
            #timeline-ui-container {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                pointer-events: none;
                z-index: 50;
                opacity: 0;
                transition: opacity 0.5s ease;
            }
            
            #timeline-ui-container.visible {
                opacity: 1;
                pointer-events: auto;
            }
            
            /* Clock UI elements that should hide in timeline mode */
            .clock-ui {
                transition: opacity 0.5s ease;
            }
            
            .clock-ui.hidden {
                opacity: 0;
                pointer-events: none;
            }
            
            /* Timeline-specific styles */
            #timeline-canvas-container {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
            }
            
            .timeline-overlay {
                position: absolute;
                bottom: 30px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0, 0, 0, 0.7);
                backdrop-filter: blur(10px);
                border-radius: 15px;
                padding: 15px 30px;
                color: white;
                font-family: 'Inter', sans-serif;
                text-align: center;
                border: 1px solid rgba(255, 255, 255, 0.1);
            }
            
            .timeline-title {
                font-size: 18px;
                font-weight: 500;
                margin-bottom: 5px;
            }
            
            .timeline-subtitle {
                font-size: 13px;
                opacity: 0.8;
            }
            
            .timeline-controls {
                position: absolute;
                bottom: 30px;
                right: 30px;
                display: flex;
                gap: 10px;
            }
            
            .timeline-btn {
                background: rgba(255, 255, 255, 0.1);
                border: 1px solid rgba(255, 255, 255, 0.2);
                border-radius: 8px;
                padding: 8px 16px;
                color: white;
                cursor: pointer;
                font-size: 13px;
                transition: all 0.2s;
            }
            
            .timeline-btn:hover {
                background: rgba(255, 255, 255, 0.2);
            }
        `;

        document.head.appendChild(styles);
    }

    /**
     * Update toggle button UI
     */
    updateToggleUI() {
        const toggleBtn = document.getElementById('mode-toggle');
        if (!toggleBtn) return;

        const CLOCK_SVG = `<svg class="icon-svg" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="7" stroke="currentColor" fill="none" stroke-width="1.5"/><line x1="8" y1="8" x2="8" y2="4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="8" y1="8" x2="11" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
        const TIMELINE_SVG = `<svg class="icon-svg" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="5" cy="8" r="1" stroke="currentColor" fill="none" stroke-width="1.5"/><circle cx="11" cy="8" r="1" stroke="currentColor" fill="none" stroke-width="1.5"/></svg>`;
        const FORECAST_SVG = `<svg class="icon-svg" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="2" y="3" width="3" height="10" rx="0.5" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="6.5" y="3" width="3" height="10" rx="0.5" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="11" y="3" width="3" height="10" rx="0.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;

        if (this.currentMode === 'clock') {
            toggleBtn.innerHTML = CLOCK_SVG;
            toggleBtn.title = 'Switch to Timeline View (T)';
        } else if (this.currentMode === 'timeline') {
            toggleBtn.innerHTML = TIMELINE_SVG;
            toggleBtn.title = 'Switch to 10-Day Forecast (T)';
        } else {
            toggleBtn.innerHTML = FORECAST_SVG;
            toggleBtn.title = 'Switch to Clock View (T)';
        }
    }

    /**
     * Setup keyboard shortcuts
     */
    setupKeyboardShortcuts() {
        window.addEventListener('keydown', (e) => {
            // Don't trigger if user is typing in an input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                return;
            }

            // 'T' key toggles mode
            if (e.key === 't' || e.key === 'T') {
                this.toggleMode();
            }

            // ArrowLeft toggles left drawer
            if (e.key === 'ArrowLeft') {
                const left = document.getElementById('panel-left');
                if (left && left.classList.contains('expanded')) {
                    this.hideDrawers();
                } else {
                    this.showLeftDrawer();
                }
            }

            // ArrowRight toggles right drawer
            if (e.key === 'ArrowRight') {
                const right = document.getElementById('panel-right');
                if (right && right.classList.contains('expanded')) {
                    this.hideDrawers();
                } else {
                    this.showRightDrawer();
                }
            }

            // Escape returns to clock mode from timeline, or hides drawers in clock mode
            if (e.key === 'Escape') {
                if (this.currentMode === 'timeline') {
                    this.switchMode('clock');
                } else {
                    this.hideDrawers();
                }
            }
        });
    }

    dispose() {
        document.getElementById('mode-toggle')?.remove();
        document.getElementById('mode-controller-styles')?.remove();
    }
}
