/**
 * ForecastController.js - Manages 10-Day Forecast View (vignettes strip)
 *
 * Responsibilities (incremental):
 * - Load 10 forecast days via TimelineData
 * - Maintain focused day index + representative time
 * - Provide data to ForecastUI
 * - Later: drive vignette state for main scene (with ModeController/animation)
 */

import { TimelineData } from '../timeline/TimelineData.js';

export class ForecastController {
    constructor(scene, camera, renderer) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;

        this.timelineData = new TimelineData();
        this.days = [];               // DayData[] (next 10)
        this.focusedIndex = 0;        // which day is expanded in main view
        this.vignetteHour = 12;       // 0-23.99 for scrubber

        this.onDayFocus = null;       // (index, dayData, repDate) => void
        this.onDataLoaded = null;

        this.isVisible = false;
        this.isLoading = false;
    }

    async loadData(lat, lon) {
        if (this.isLoading) return;
        this.isLoading = true;
        try {
            this.days = await this.timelineData.getForecastDays(lat, lon, 10);
            if (this.onDataLoaded) this.onDataLoaded(this.days);
            // default focus first (today or soonest forecast)
            if (this.days.length > 0 && this.focusedIndex >= this.days.length) {
                this.focusedIndex = 0;
            }
        } catch (e) {
            console.warn('Forecast data load failed, using empty set', e);
            this.days = [];
        } finally {
            this.isLoading = false;
        }
        return this.days;
    }

    setVisible(visible) {
        this.isVisible = visible;
        // 3D group (if we later add dedicated forecast objects) would live here
    }

    focusDay(index) {
        if (!this.days[index]) return;
        this.focusedIndex = index;
        const day = this.days[index];
        const repDate = this.timelineData.getRepresentativeTimeForDay(day, /*lat,lon passed later if needed*/);
        if (this.onDayFocus) {
            this.onDayFocus(index, day, repDate);
        }
    }

    /** Current focused day + a computed vignette Date for the current hour */
    getFocusedVignetteTime(lat = null, lon = null) {
        const day = this.days[this.focusedIndex];
        if (!day) return new Date();
        const base = new Date(day.date + 'T00:00:00');
        base.setHours(this.vignetteHour, (this.vignetteHour % 1) * 60, 0, 0);
        return base;
    }

    setVignetteHour(hour) {
        this.vignetteHour = Math.max(0, Math.min(23.99, hour));
    }

    update(delta) {
        // Future: per-vignette animation, particles for thumbnails etc.
    }

    dispose() {
        this.days = [];
        this.onDayFocus = null;
        this.onDataLoaded = null;
    }
}
