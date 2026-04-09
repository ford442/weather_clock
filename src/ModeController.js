/**
 * ModeController.js - Handles switching between Clock and Timeline modes
 * 
 * Manages:
 * - Mode state (clock vs timeline)
 * - Camera transitions between modes
 * - UI element visibility
 * - TimelineController and TimelineUI lifecycle
 * - Browser history integration
 */

import * as THREE from 'three';
import { TimelineController } from './timeline/TimelineController.js';
import { TimelineUI } from './timeline/TimelineUI.js';

const CAMERA_CONFIG = {
    // Clock mode camera position (near the sundial)
    clockPosition: new THREE.Vector3(0, 5, 8),
    clockTarget: new THREE.Vector3(0, 0, 0),
    
    // Timeline mode camera position (overview of 21-day timeline)
    timelinePosition: new THREE.Vector3(0, 15, 25),
    timelineTarget: new THREE.Vector3(0, 2, 0),
    
    // Animation
    transitionDuration: 1.5, // seconds
    easeFunction: (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2 // smoothstep-like
};

export class ModeController {
    constructor(scene, camera, controls, renderer, weatherService) {
        this.scene = scene;
        this.camera = camera;
        this.controls = controls;  // OrbitControls
        this.renderer = renderer;
        this.weatherService = weatherService;
        
        this.currentMode = 'clock'; // 'clock' or 'timeline'
        this.timelineController = null;
        this.timelineUI = null;
        this.isTransitioning = false;
        
        // Store clock mode camera state
        this.clockCameraState = {
            position: new THREE.Vector3(),
            target: new THREE.Vector3()
        };
        
        // Animation state
        this.animationId = null;
        
        this.init();
    }
    
    init() {
        this.saveClockCameraState();
        this.createModeToggle();
        this.setupHistory();
        this.setupKeyboardShortcuts();
    }
    
    /**
     * Save current camera position for returning to clock mode
     */
    saveClockCameraState() {
        this.clockCameraState.position.copy(this.camera.position);
        this.clockCameraState.target.copy(this.controls.target);
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
        toggleBtn.innerHTML = '🕐'; // Clock icon by default
        toggleBtn.title = 'Switch to Timeline View (T)';
        toggleBtn.setAttribute('aria-label', 'Toggle between clock and timeline view');
        
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
     * Toggle between clock and timeline modes
     */
    toggleMode() {
        const newMode = this.currentMode === 'clock' ? 'timeline' : 'clock';
        this.switchMode(newMode);
    }
    
    /**
     * Switch to a specific mode with animation
     */
    async switchMode(newMode) {
        if (newMode === this.currentMode || this.isTransitioning) {
            return;
        }
        
        this.isTransitioning = true;
        
        // Update browser history
        this.updateHistory(newMode);
        
        if (newMode === 'timeline') {
            await this.enterTimelineMode();
        } else {
            await this.enterClockMode();
        }
        
        this.currentMode = newMode;
        this.updateToggleUI();
        this.isTransitioning = false;
        
        // Dispatch mode change event
        window.dispatchEvent(new CustomEvent('modechange', { 
            detail: { mode: newMode }
        }));
    }
    
    /**
     * Enter timeline mode
     */
    async enterTimelineMode() {
        // 1. Save current clock camera state
        this.saveClockCameraState();
        
        // 2. Disable OrbitControls during transition
        this.controls.enabled = false;
        
        // 3. Initialize TimelineController if needed
        if (!this.timelineController) {
            await this.initTimeline();
        }
        
        // 4. Hide clock UI elements
        this.setClockUIVisibility(false);
        
        // 5. Animate camera to timeline position
        await this.animateCamera(
            this.clockCameraState.position,
            this.clockCameraState.target,
            CAMERA_CONFIG.timelinePosition,
            CAMERA_CONFIG.timelineTarget
        );
        
        // 6. Show Timeline UI
        this.setTimelineUIVisibility(true);
        
        // 7. Enable timeline interactions
        if (this.timelineController) {
            this.timelineController.enableInteractions();
        }
    }
    
    /**
     * Enter clock mode
     */
    async enterClockMode() {
        // 1. Disable timeline interactions
        if (this.timelineController) {
            this.timelineController.disableInteractions();
        }
        
        // 2. Hide Timeline UI
        this.setTimelineUIVisibility(false);
        
        // 3. Get current camera position (might have been moved in timeline)
        const currentPosition = this.camera.position.clone();
        const currentTarget = this.controls.target.clone();
        
        // 4. Animate camera back to clock position
        await this.animateCamera(
            currentPosition,
            currentTarget,
            this.clockCameraState.position,
            this.clockCameraState.target
        );
        
        // 5. Re-enable OrbitControls
        this.controls.enabled = true;
        
        // 6. Show clock UI elements
        this.setClockUIVisibility(true);
    }
    
    /**
     * Initialize timeline components
     */
    async initTimeline() {
        try {
            const location = this.getCurrentLocation();
            
            // Create Timeline UI container if it doesn't exist
            let timelineContainer = document.getElementById('timeline-ui-container');
            if (!timelineContainer) {
                timelineContainer = document.createElement('div');
                timelineContainer.id = 'timeline-ui-container';
                document.body.appendChild(timelineContainer);
            }
            
            // Initialize TimelineController
            this.timelineController = new TimelineController(
                this.scene,
                this.camera,
                this.renderer
            );
            
            // Initialize TimelineUI
            this.timelineUI = new TimelineUI(timelineContainer);
            
            // Load timeline data
            await this.timelineController.loadData(location.lat, location.lon);
            
            // Connect controller to UI
            this.timelineController.onDaySelect = (dayData) => {
                this.timelineUI.showDayDetails(dayData);
            };
            
        } catch (error) {
            console.error('Failed to initialize timeline:', error);
            // Fall back to clock mode
            throw error;
        }
    }
    
    /**
     * Animate camera from one position to another
     */
    animateCamera(fromPos, fromTarget, toPos, toTarget) {
        return new Promise((resolve) => {
            const startTime = performance.now();
            const duration = CAMERA_CONFIG.transitionDuration * 1000;
            
            const animate = (currentTime) => {
                const elapsed = currentTime - startTime;
                const progress = Math.min(elapsed / duration, 1);
                const eased = CAMERA_CONFIG.easeFunction(progress);
                
                // Interpolate camera position
                this.camera.position.lerpVectors(fromPos, toPos, eased);
                
                // Interpolate controls target
                const currentTarget = new THREE.Vector3().lerpVectors(fromTarget, toTarget, eased);
                this.controls.target.copy(currentTarget);
                
                // Update camera look-at
                this.camera.lookAt(currentTarget);
                
                if (progress < 1) {
                    this.animationId = requestAnimationFrame(animate);
                } else {
                    this.animationId = null;
                    resolve();
                }
            };
            
            this.animationId = requestAnimationFrame(animate);
        });
    }
    
    /**
     * Set visibility of clock UI elements
     */
    setClockUIVisibility(visible) {
        // Elements to hide/show in timeline mode
        const selectors = [
            '#panel-left',
            '#panel-right',
            '#panel-advanced',
            '#time-warp-btn',
            '.center-stats'
        ];
        
        selectors.forEach(selector => {
            const el = document.querySelector(selector);
            if (el) {
                if (visible) {
                    el.classList.remove('hidden');
                    el.style.opacity = '';
                    el.style.pointerEvents = '';
                } else {
                    el.classList.add('hidden');
                    el.style.opacity = '0';
                    el.style.pointerEvents = 'none';
                }
            }
        });
    }
    
    /**
     * Set visibility of timeline UI
     */
    setTimelineUIVisibility(visible) {
        const container = document.getElementById('timeline-ui-container');
        if (container) {
            if (visible) {
                container.classList.add('visible');
            } else {
                container.classList.remove('visible');
            }
        }
        
        // Show/hide timeline 3D objects
        if (this.timelineController) {
            this.timelineController.setVisible(visible);
        }
    }
    
    /**
     * Update toggle button UI
     */
    updateToggleUI() {
        const toggleBtn = document.getElementById('mode-toggle');
        if (!toggleBtn) return;
        
        if (this.currentMode === 'clock') {
            toggleBtn.innerHTML = '🕐';
            toggleBtn.title = 'Switch to Timeline View (T)';
        } else {
            toggleBtn.innerHTML = '📊';
            toggleBtn.title = 'Switch to Clock View (T)';
        }
    }
    
    /**
     * Update browser history for back/forward button support
     */
    updateHistory(mode) {
        const url = new URL(window.location.href);
        url.searchParams.set('mode', mode);
        
        if (mode === 'timeline') {
            history.pushState({ mode: 'timeline' }, '', url);
        } else {
            // Remove mode param for clock (default)
            url.searchParams.delete('mode');
            history.pushState({ mode: 'clock' }, '', url);
        }
    }
    
    /**
     * Handle browser back/forward buttons
     */
    setupHistory() {
        window.addEventListener('popstate', (e) => {
            const mode = e.state?.mode || 'clock';
            if (mode !== this.currentMode && !this.isTransitioning) {
                this.switchMode(mode);
            }
        });
        
        // Check URL params on load
        const urlParams = new URLSearchParams(window.location.search);
        const initialMode = urlParams.get('mode') || 'clock';
        if (initialMode === 'timeline' && this.currentMode !== 'timeline') {
            this.switchMode('timeline');
        }
    }
    
    /**
     * Setup keyboard shortcuts
     */
    setupKeyboardShortcuts() {
        window.addEventListener('keydown', (e) => {
            // 'T' key toggles mode
            if (e.key === 't' || e.key === 'T') {
                // Don't trigger if user is typing in an input
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                    return;
                }
                this.toggleMode();
            }
            
            // 'Escape' returns to clock mode from timeline
            if (e.key === 'Escape' && this.currentMode === 'timeline') {
                this.switchMode('clock');
            }
        });
    }
    
    /**
     * Get current location from weather service
     */
    getCurrentLocation() {
        return {
            lat: this.weatherService.latitude,
            lon: this.weatherService.longitude
        };
    }
    
    /**
     * Get current mode
     */
    getMode() {
        return this.currentMode;
    }
    
    /**
     * Check if currently in timeline mode
     */
    isTimelineMode() {
        return this.currentMode === 'timeline';
    }
    
    /**
     * Cleanup resources
     */
    dispose() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        
        if (this.timelineController) {
            this.timelineController.dispose();
            this.timelineController = null;
        }
        
        if (this.timelineUI) {
            this.timelineUI.dispose();
            this.timelineUI = null;
        }
        
        const toggleBtn = document.getElementById('mode-toggle');
        if (toggleBtn) {
            toggleBtn.remove();
        }
        
        const container = document.getElementById('timeline-ui-container');
        if (container) {
            container.remove();
        }
    }
}

export default ModeController;
