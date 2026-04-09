/**
 * TimelineController.js - Manages the 3D timeline visualization
 * 
 * Handles:
 * - Creating and managing DayColumn instances for 21-day view
 * - Camera interactions in timeline mode
 * - Data loading and updates
 * - Selection and highlighting of days
 */

import * as THREE from 'three';
import { DayColumn } from './DayColumn.js';
import { TimelineData } from './TimelineData.js';

const TIMELINE_CONFIG = {
    columnSpacing: 2.5,      // Space between day columns
    columnWidth: 1.8,        // Width of each column
    visibleRange: 21,        // Total days to show (-10 to +10)
    interactionDistance: 30, // Max distance for raycasting
    animDuration: 0.6        // Column animation duration
};

export class TimelineController {
    constructor(scene, camera, renderer) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        
        this.timelineData = new TimelineData();
        this.dayColumns = [];      // Array of DayColumn instances
        this.timelineGroup = null; // Group containing all timeline objects
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        this.isVisible = false;
        this.isInteractionsEnabled = false;
        this.selectedDay = null;
        this.hoveredDay = null;
        
        this.onDaySelect = null;   // Callback when a day is selected
        
        this.init();
    }
    
    init() {
        this.createTimelineGroup();
        this.setupInteraction();
    }
    
    /**
     * Create the main timeline group
     */
    createTimelineGroup() {
        this.timelineGroup = new THREE.Group();
        this.timelineGroup.name = 'timeline';
        this.timelineGroup.visible = false;
        this.scene.add(this.timelineGroup);
    }
    
    /**
     * Load timeline data for a location
     */
    async loadData(lat, lon) {
        if (!lat || !lon) {
            console.warn('TimelineController: No location provided');
            return;
        }
        
        try {
            // Fetch timeline data
            const days = await this.timelineData.fetchTimelineData(lat, lon);
            
            // Clear existing columns
            this.clearColumns();
            
            // Create day columns
            this.createDayColumns(days);
            
            // Position timeline in scene
            this.positionTimeline();
            
        } catch (error) {
            console.error('TimelineController: Failed to load data:', error);
            throw error;
        }
    }
    
    /**
     * Create DayColumn instances from day data
     */
    createDayColumns(days) {
        const totalWidth = (days.length - 1) * TIMELINE_CONFIG.columnSpacing;
        const startX = -totalWidth / 2;
        
        days.forEach((dayData, index) => {
            const x = startX + index * TIMELINE_CONFIG.columnSpacing;
            
            const dayColumn = new DayColumn(dayData, {
                x,
                z: 0,
                width: TIMELINE_CONFIG.columnWidth,
                index
            });
            
            dayColumn.create(this.timelineGroup);
            this.dayColumns.push(dayColumn);
        });
        
        // Animate columns in
        this.animateColumnsIn();
    }
    
    /**
     * Clear all day columns
     */
    clearColumns() {
        this.dayColumns.forEach(column => {
            column.dispose();
        });
        this.dayColumns = [];
        
        // Remove all children from timeline group
        while (this.timelineGroup.children.length > 0) {
            const child = this.timelineGroup.children[0];
            this.timelineGroup.remove(child);
        }
    }
    
    /**
     * Position the timeline in the scene
     */
    positionTimeline() {
        // Center the timeline at origin, slightly elevated
        this.timelineGroup.position.set(0, -1, 0);
    }
    
    /**
     * Animate columns appearing
     */
    animateColumnsIn() {
        this.dayColumns.forEach((column, index) => {
            column.animateIn(index * 0.05); // Stagger animations
        });
    }
    
    /**
     * Setup mouse/touch interaction
     */
    setupInteraction() {
        this.boundOnMouseMove = this.onMouseMove.bind(this);
        this.boundOnClick = this.onClick.bind(this);
        
        window.addEventListener('mousemove', this.boundOnMouseMove);
        window.addEventListener('click', this.boundOnClick);
    }
    
    /**
     * Handle mouse move for hover effects
     */
    onMouseMove(event) {
        if (!this.isInteractionsEnabled || !this.isVisible) {
            return;
        }
        
        // Calculate mouse position in normalized device coordinates
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        
        // Raycast for hover
        this.updateHover();
    }
    
    /**
     * Handle click for day selection
     */
    onClick(event) {
        if (!this.isInteractionsEnabled || !this.isVisible) {
            return;
        }
        
        // Don't trigger if clicking on UI
        if (event.target.closest('.timeline-ui') || event.target.closest('.mode-toggle-btn')) {
            return;
        }
        
        const intersected = this.raycast();
        if (intersected) {
            this.selectDay(intersected.dayColumn);
        } else {
            this.deselectDay();
        }
    }
    
    /**
     * Update hover state
     */
    updateHover() {
        const intersected = this.raycast();
        
        if (intersected !== this.hoveredDay) {
            // Clear previous hover
            if (this.hoveredDay) {
                this.hoveredDay.setHovered(false);
            }
            
            // Set new hover
            this.hoveredDay = intersected;
            if (this.hoveredDay) {
                this.hoveredDay.setHovered(true);
                document.body.style.cursor = 'pointer';
            } else {
                document.body.style.cursor = '';
            }
        }
    }
    
    /**
     * Perform raycast against day columns
     */
    raycast() {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        // Get all meshes from day columns
        const meshes = [];
        this.dayColumns.forEach(column => {
            const columnMeshes = column.getRaycastMeshes();
            meshes.push(...columnMeshes);
        });
        
        const intersects = this.raycaster.intersectObjects(meshes);
        
        if (intersects.length > 0) {
            // Find which day column was hit
            const hitMesh = intersects[0].object;
            return this.dayColumns.find(column => column.containsMesh(hitMesh));
        }
        
        return null;
    }
    
    /**
     * Select a day
     */
    selectDay(dayColumn) {
        // Deselect previous
        if (this.selectedDay && this.selectedDay !== dayColumn) {
            this.selectedDay.setSelected(false);
        }
        
        this.selectedDay = dayColumn;
        dayColumn.setSelected(true);
        
        // Trigger callback
        if (this.onDaySelect) {
            this.onDaySelect(dayColumn.getData());
        }
    }
    
    /**
     * Deselect current day
     */
    deselectDay() {
        if (this.selectedDay) {
            this.selectedDay.setSelected(false);
            this.selectedDay = null;
        }
    }
    
    /**
     * Enable interactions
     */
    enableInteractions() {
        this.isInteractionsEnabled = true;
    }
    
    /**
     * Disable interactions
     */
    disableInteractions() {
        this.isInteractionsEnabled = false;
        document.body.style.cursor = '';
        
        if (this.hoveredDay) {
            this.hoveredDay.setHovered(false);
            this.hoveredDay = null;
        }
    }
    
    /**
     * Set timeline visibility
     */
    setVisible(visible) {
        this.isVisible = visible;
        if (this.timelineGroup) {
            this.timelineGroup.visible = visible;
        }
    }
    
    /**
     * Update method (called each frame)
     */
    update(deltaTime) {
        if (!this.isVisible) {
            return;
        }
        
        // Update all day columns
        this.dayColumns.forEach(column => {
            column.update(deltaTime);
        });
    }
    
    /**
     * Dispose resources
     */
    dispose() {
        this.disableInteractions();
        
        window.removeEventListener('mousemove', this.boundOnMouseMove);
        window.removeEventListener('click', this.boundOnClick);
        
        this.clearColumns();
        
        if (this.timelineGroup) {
            this.scene.remove(this.timelineGroup);
            this.timelineGroup = null;
        }
        
        this.timelineData.clearCache();
    }
}

export default TimelineController;
