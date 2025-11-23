# AGENTS.md

## Scope
This file applies to the entire `weather_clock` repository.

## Guiding Principles
- **Code Quality**: Write clean, modular, and well-documented ES6+ JavaScript code.
- **Performance**: Prioritize performance, especially in the 3D rendering loop. Reuse geometries and materials where possible. Optimize particle systems.
- **User Experience**: Ensure smooth animations and responsive design.
- **Testing**: Verify all changes visually since this is a graphical application.

## Working with Three.js
- **Memory Management**: Dispose of geometries, materials, and textures when they are no longer needed to prevent memory leaks.
- **Animation**: Use `requestAnimationFrame` for the render loop.
- **Responsiveness**: Handle window resize events correctly to update camera aspect ratio and renderer size.

## File Structure
- `src/`: Contains all source code.
- `src/main.js`: Entry point and main scene setup.
- `src/weatherEffects.js`: Handles weather particle systems.
- `src/sundial.js`: Sundial geometry and logic.
- `src/moonPhase.js`: Moon logic.
- `src/weather.js`: Weather API service.

## Instructions for Agents
- When modifying the particle system, ensure it remains performant (e.g., limit particle counts, use efficient collision detection).
- When adding new 3D objects, ensure they cast/receive shadows as appropriate.
