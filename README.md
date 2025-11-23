# Weather Clock 🌤️⏰

A stunning 3D sundial clock that displays real-time weather information, featuring dynamic lighting, moon phases, and animated weather effects.

![Weather Clock](https://github.com/user-attachments/assets/131518ce-7ff3-4ecf-83ca-f61a7f4c770d)

## Features

### Core Features ✨
- **3D Sundial with Clock Face**: Beautiful 3D-rendered sundial with hour markers, numbers, and working clock hands (hour, minute, second)
- **Real-time Clock**: Displays current time with animated clock hands
- **Weather Data**: 
  - Current weather conditions with temperature
  - Past weather (3 hours ago) with fading visualization
  - Weather forecast (3 hours ahead) with approaching effects
  - Temperature comparison across time periods
- **Dynamic Lighting**: Scene lighting adapts based on weather conditions (clear, cloudy, stormy, etc.)
- **Geolocation**: Automatically detects user's location for local weather (with fallback to default location)

### Advanced Features 🌙
- **Moon Phase Display**: Real-time moon phase calculation and 3D visualization
- **3D Weather Animations**: 
  - Animated rain particles
  - Falling snow effects
  - Moving clouds
  - Lightning flashes for thunderstorms
- **Wind Speed Indicator**: Shows current wind speed
- **Weather-responsive Colors**: Lighting and colors change based on weather conditions

## Installation

```bash
npm install
```

## Usage

### Development Server
```bash
npm run dev
```
Then open your browser to `http://localhost:5173/`

### Build for Production
```bash
npm run build
```

### Preview Production Build
```bash
npm run preview
```

## Technology Stack

- **Three.js**: 3D graphics rendering
- **Vite**: Fast build tool and dev server
- **Open-Meteo API**: Free weather data (no API key required)
- **OpenStreetMap Nominatim**: Reverse geocoding for location names

## Weather Data

The application uses the free Open-Meteo API which provides:
- Current weather conditions
- Historical weather data
- Weather forecasts
- Wind speed
- Cloud cover
- No API key required!

## Geolocation

The app requests your location to provide accurate local weather. If geolocation is denied or unavailable, it defaults to New York City.

## Browser Compatibility

Works best in modern browsers with WebGL support:
- Chrome/Edge (recommended)
- Firefox
- Safari

## Future Enhancements

Planned features for future releases:
- Additional weather phenomena (fog, hail)
- More detailed moon textures
- Timezone support
- Multiple location management
- Weather alerts
- Historical weather graphs

## License

ISC

## Credits

Weather data provided by [Open-Meteo.com](https://open-meteo.com/)
Geocoding by [OpenStreetMap Nominatim](https://nominatim.openstreetmap.org/)
