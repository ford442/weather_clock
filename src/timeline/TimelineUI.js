/**
 * TimelineUI.js - UI overlay for the 3D timeline visualization
 * 
 * Handles:
 * - Day detail panels
 * - Timeline legend and info
 * - Navigation controls
 * - Weather condition indicators
 */

export class TimelineUI {
    constructor(container) {
        this.container = container;
        this.currentPanel = null;
        
        this.init();
    }
    
    init() {
        this.createBaseStructure();
        this.injectStyles();
    }
    
    /**
     * Create base HTML structure
     */
    createBaseStructure() {
        this.container.innerHTML = `
            <div class="timeline-ui-overlay">
                <!-- Header -->
                <div class="timeline-header">
                    <h2 class="timeline-title">21-Day Weather Timeline</h2>
                    <p class="timeline-subtitle">Past 10 days → Today ← Next 10 days</p>
                </div>
                
                <!-- Legend -->
                <div class="timeline-legend">
                    <div class="legend-item">
                        <span class="legend-color" style="background: #3b82f6;"></span>
                        <span class="legend-label">Below Normal (&lt;-1σ)</span>
                    </div>
                    <div class="legend-item">
                        <span class="legend-color" style="background: #22c55e;"></span>
                        <span class="legend-label">Normal (±1σ)</span>
                    </div>
                    <div class="legend-item">
                        <span class="legend-color" style="background: #f97316;"></span>
                        <span class="legend-label">Above Normal (&gt;+1σ)</span>
                    </div>
                    <div class="legend-item">
                        <span class="legend-dot accuracy"></span>
                        <span class="legend-label">Forecast Accuracy</span>
                    </div>
                </div>
                
                <!-- Day detail panel (hidden by default) -->
                <div class="day-detail-panel" id="day-detail-panel">
                    <button class="detail-close" id="detail-close">×</button>
                    <div class="detail-content">
                        <div class="detail-date" id="detail-date">--</div>
                        <div class="detail-temps">
                            <span class="temp-high" id="detail-high">--°</span>
                            <span class="temp-low" id="detail-low">--°</span>
                        </div>
                        <div class="detail-condition" id="detail-condition">--</div>
                        <div class="detail-anomaly" id="detail-anomaly">--</div>
                        <div class="detail-accuracy" id="detail-accuracy" style="display:none;">
                            <span class="accuracy-label">Forecast Accuracy:</span>
                            <span class="accuracy-value" id="accuracy-value">--%</span>
                        </div>
                    </div>
                </div>
                
                <!-- Bottom controls -->
                <div class="timeline-controls">
                    <button class="timeline-btn" id="timeline-help" title="Help">?</button>
                </div>
            </div>
        `;
        
        this.cacheElements();
        this.bindEvents();
    }
    
    /**
     * Cache DOM element references
     */
    cacheElements() {
        this.detailPanel = this.container.querySelector('#day-detail-panel');
        this.detailDate = this.container.querySelector('#detail-date');
        this.detailHigh = this.container.querySelector('#detail-high');
        this.detailLow = this.container.querySelector('#detail-low');
        this.detailCondition = this.container.querySelector('#detail-condition');
        this.detailAnomaly = this.container.querySelector('#detail-anomaly');
        this.detailAccuracy = this.container.querySelector('#detail-accuracy');
        this.accuracyValue = this.container.querySelector('#accuracy-value');
        this.detailClose = this.container.querySelector('#detail-close');
    }
    
    /**
     * Bind event listeners
     */
    bindEvents() {
        // Close detail panel
        if (this.detailClose) {
            this.detailClose.addEventListener('click', () => {
                this.hideDayDetails();
            });
        }
        
        // Close on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideDayDetails();
            }
        });
    }
    
    /**
     * Inject CSS styles
     */
    injectStyles() {
        if (document.getElementById('timeline-ui-styles')) {
            return;
        }
        
        const styles = document.createElement('style');
        styles.id = 'timeline-ui-styles';
        styles.textContent = `
            .timeline-ui-overlay {
                width: 100%;
                height: 100%;
                pointer-events: none;
                display: flex;
                flex-direction: column;
                justify-content: space-between;
                padding: 20px;
                box-sizing: border-box;
            }
            
            .timeline-ui-overlay > * {
                pointer-events: auto;
            }
            
            /* Header */
            .timeline-header {
                position: absolute;
                top: 20px;
                left: 50%;
                transform: translateX(-50%);
                text-align: center;
                color: white;
                background: rgba(0, 0, 0, 0.6);
                backdrop-filter: blur(10px);
                padding: 15px 30px;
                border-radius: 12px;
                border: 1px solid rgba(255, 255, 255, 0.1);
            }
            
            .timeline-title {
                margin: 0 0 5px 0;
                font-size: 20px;
                font-weight: 500;
                font-family: 'Inter', sans-serif;
            }
            
            .timeline-subtitle {
                margin: 0;
                font-size: 13px;
                opacity: 0.7;
                font-family: 'Inter', sans-serif;
            }
            
            /* Legend */
            .timeline-legend {
                position: absolute;
                top: 20px;
                left: 20px;
                background: rgba(0, 0, 0, 0.6);
                backdrop-filter: blur(10px);
                border-radius: 12px;
                padding: 15px 20px;
                border: 1px solid rgba(255, 255, 255, 0.1);
                display: flex;
                flex-direction: column;
                gap: 10px;
            }
            
            .legend-item {
                display: flex;
                align-items: center;
                gap: 10px;
                font-size: 13px;
                color: white;
                font-family: 'Inter', sans-serif;
            }
            
            .legend-color {
                width: 16px;
                height: 16px;
                border-radius: 4px;
            }
            
            .legend-dot {
                width: 12px;
                height: 12px;
                border-radius: 50%;
                border: 2px solid white;
            }
            
            .legend-dot.accuracy {
                background: conic-gradient(from 0deg, #22c55e 0deg, #22c55e 120deg, transparent 120deg);
            }
            
            /* Day Detail Panel */
            .day-detail-panel {
                position: absolute;
                top: 50%;
                right: 30px;
                transform: translateY(-50%);
                width: 280px;
                background: rgba(0, 0, 0, 0.8);
                backdrop-filter: blur(15px);
                border-radius: 16px;
                padding: 25px;
                border: 1px solid rgba(255, 255, 255, 0.15);
                color: white;
                font-family: 'Inter', sans-serif;
                opacity: 0;
                visibility: hidden;
                transition: opacity 0.3s ease, visibility 0.3s ease;
            }
            
            .day-detail-panel.visible {
                opacity: 1;
                visibility: visible;
            }
            
            .detail-close {
                position: absolute;
                top: 10px;
                right: 10px;
                width: 28px;
                height: 28px;
                border-radius: 50%;
                border: none;
                background: rgba(255, 255, 255, 0.1);
                color: white;
                font-size: 20px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background 0.2s;
            }
            
            .detail-close:hover {
                background: rgba(255, 255, 255, 0.2);
            }
            
            .detail-date {
                font-size: 16px;
                font-weight: 500;
                margin-bottom: 15px;
                opacity: 0.9;
            }
            
            .detail-temps {
                display: flex;
                align-items: baseline;
                gap: 15px;
                margin-bottom: 10px;
            }
            
            .temp-high {
                font-size: 42px;
                font-weight: 700;
                color: #f97316;
            }
            
            .temp-low {
                font-size: 28px;
                font-weight: 400;
                color: #3b82f6;
            }
            
            .detail-condition {
                font-size: 18px;
                margin-bottom: 15px;
                opacity: 0.9;
            }
            
            .detail-anomaly {
                font-size: 14px;
                padding: 8px 12px;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 8px;
                margin-bottom: 10px;
            }
            
            .detail-anomaly.positive {
                color: #f97316;
            }
            
            .detail-anomaly.negative {
                color: #3b82f6;
            }
            
            .detail-accuracy {
                margin-top: 15px;
                padding-top: 15px;
                border-top: 1px solid rgba(255, 255, 255, 0.1);
            }
            
            .accuracy-label {
                font-size: 13px;
                opacity: 0.7;
            }
            
            .accuracy-value {
                font-size: 18px;
                font-weight: 600;
                margin-left: 8px;
            }
            
            /* Controls */
            .timeline-controls {
                position: absolute;
                bottom: 30px;
                right: 30px;
            }
            
            .timeline-btn {
                width: 36px;
                height: 36px;
                border-radius: 50%;
                border: 1px solid rgba(255, 255, 255, 0.2);
                background: rgba(0, 0, 0, 0.6);
                color: white;
                font-size: 16px;
                cursor: pointer;
                transition: all 0.2s;
            }
            
            .timeline-btn:hover {
                background: rgba(255, 255, 255, 0.1);
                transform: scale(1.1);
            }
            
            /* Responsive adjustments */
            @media (max-width: 768px) {
                .timeline-legend {
                    top: auto;
                    bottom: 80px;
                    left: 20px;
                    right: 20px;
                    flex-direction: row;
                    flex-wrap: wrap;
                    justify-content: center;
                }
                
                .day-detail-panel {
                    right: 50%;
                    transform: translate(50%, -50%);
                    width: 90%;
                    max-width: 300px;
                }
            }
        `;
        
        document.head.appendChild(styles);
    }
    
    /**
     * Show day details panel
     */
    showDayDetails(dayData) {
        if (!dayData) return;
        
        // Format date
        const date = new Date(dayData.date);
        const dateStr = date.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        
        // Update content
        this.detailDate.textContent = dateStr;
        this.detailHigh.textContent = `${Math.round(dayData.tempMax)}°`;
        this.detailLow.textContent = `${Math.round(dayData.tempMin)}°`;
        this.detailCondition.textContent = this.formatCondition(dayData.condition);
        
        // Anomaly display
        const anomaly = dayData.tempAnomaly;
        const anomalySign = anomaly > 0 ? '+' : '';
        this.detailAnomaly.textContent = `${anomalySign}${anomaly.toFixed(1)}° from normal`;
        this.detailAnomaly.className = 'detail-anomaly' + (anomaly > 0 ? ' positive' : anomaly < 0 ? ' negative' : '');
        
        // Accuracy (only for historical days with predictions)
        if (dayData.accuracy) {
            this.detailAccuracy.style.display = 'block';
            const accuracyPercent = Math.round(dayData.accuracy.tempScore * 100);
            this.accuracyValue.textContent = `${accuracyPercent}%`;
            this.accuracyValue.style.color = this.getAccuracyColor(accuracyPercent);
        } else {
            this.detailAccuracy.style.display = 'none';
        }
        
        // Show panel
        this.detailPanel.classList.add('visible');
    }
    
    /**
     * Hide day details panel
     */
    hideDayDetails() {
        if (this.detailPanel) {
            this.detailPanel.classList.remove('visible');
        }
    }
    
    /**
     * Format condition for display
     */
    formatCondition(condition) {
        if (!condition) return 'Unknown';
        return condition.charAt(0).toUpperCase() + condition.slice(1);
    }
    
    /**
     * Get color based on accuracy percentage
     */
    getAccuracyColor(percent) {
        if (percent >= 90) return '#22c55e';  // Green
        if (percent >= 70) return '#eab308';  // Yellow
        return '#ef4444';  // Red
    }
    
    /**
     * Update location display
     */
    updateLocation(locationName) {
        const subtitle = this.container.querySelector('.timeline-subtitle');
        if (subtitle && locationName) {
            subtitle.textContent = `${locationName} — Past 10 days → Today ← Next 10 days`;
        }
    }
    
    /**
     * Show/hide loading indicator
     */
    setLoading(isLoading) {
        const header = this.container.querySelector('.timeline-header');
        if (header) {
            if (isLoading) {
                header.classList.add('loading');
            } else {
                header.classList.remove('loading');
            }
        }
    }
    
    /**
     * Dispose and cleanup
     */
    dispose() {
        this.hideDayDetails();
        if (this.container) {
            this.container.innerHTML = '';
        }
    }
}

export default TimelineUI;
