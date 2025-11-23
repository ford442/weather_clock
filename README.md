# 3D Weather Clock

A 3D interactive weather clock built with Three.js. This application visualizes the current time and real-time weather conditions using a 3D sundial, moon, and dynamic weather effects.

## Features

*   **Real-time Time Display**: A functioning 3D sundial with rotating hands and shadow casting.
*   **Live Weather Visualization**:
    *   **Rain**: Dynamic rain simulation that interacts with the clock surface (pooling, running off).
    *   **Snow**: Gentle snowfall effect.
    *   **Clouds**: Floating 3D clouds.
    *   **Lighting**: Dynamic lighting changes based on time of day and weather conditions.
*   **Moon Phase**: Accurate moon phase visualization.
*   **Weather Data**: Fetches live weather data based on location.

## Setup

1.  **Install Dependencies**:
    ```bash
    npm install
    ```

2.  **Run Development Server**:
    ```bash
    npm run dev
    ```

3.  **Build for Production**:
    ```bash
    npm run build
    ```

## Controls

*   **Orbit**: Click and drag to rotate the view (if OrbitControls is enabled - currently fixed camera).
*   **Resize**: The view automatically adjusts to the window size.

## Technologies

*   **Three.js**: 3D rendering engine.
*   **Vite**: Build tool and development server.
*   **Open-Meteo API**: Free weather data API (or whichever is implemented).

## License

ISC
