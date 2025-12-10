# Project Plan: 3D Weather Clock

## Overview
This document outlines the development roadmap and technical requirements for the 3D Weather Clock. It is intended to guide AI agents (Gemini, Copilot, etc.) in generating code and understanding project goals.

## Core Architecture
- **Entry Point**: `src/main.js`
- **Weather Logic**: `src/weather.js` (Data fetching)
- **Visual Effects**: `src/weatherEffects.js` (Particle systems, clouds, lighting)
- **Scene**: 3D Sundial with distinct spatial zones for time-based weather.

## Feature Implementation Roadmap

### 1. Multi-Temporal Weather Display (Primary Goal)
**Objective**: Visualize weather conditions across three distinct timelines simultaneously.

- **Zones**:
  - **Past**: Left spatial zone (Offset X: -8). Represents weather from ~3 hours ago.
  - **Present**: Center spatial zone (Offset X: 0). Represents live weather conditions.
  - **Future**: Right spatial zone (Offset X: +8). Represents forecasted weather (+3 hours).

- **Technical Requirements**:
  - Maintain independent particle systems (Rain, Snow) for each zone.
  - Ensure visual separation while maintaining scene cohesion.
  - Data Source: `WeatherService` must provide `past`, `current`, and `forecast` objects.

### 2. Advanced Weather Comparisons (Upcoming)
**Objective**: Enhance data visualization with comparative metrics to provide deeper insight into weather patterns.

- **Prediction Accuracy**:
  - Implement logic to compare *current actual* weather against *past predictions* for the current time.
  - Visual indicators (e.g., color shifts, UI overlays) to represent the delta/error in prediction.

- **Historical Context (Year-over-Year)**:
  - Fetch and display weather data from exactly **1 year ago** for the current location.
  - Allow users to compare today's conditions (temp, precipitation) against the historical baseline.

- **Regional Context**:
  - Fetch weather data for **nearby towns** or surrounding regions.
  - Display comparative markers or a mini-map visualization to show local weather variances.

## Instructions for AI Agents
- When modifying `weatherEffects.js`, ensure changes support the 3-zone architecture defined above.
- Future implementations for "Advanced Comparisons" should consider separating UI/HUD elements from the 3D scene logic to avoid clutter.
- Prioritize performance when adding new comparison layers; use efficient instancing for additional indicators.
