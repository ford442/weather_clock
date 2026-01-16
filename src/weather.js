export class WeatherService {
    constructor() {
        // Open-Meteo API is free and doesn't require an API key
        this.latitude = null;
        this.longitude = null;
        this.location = null;
        this.unit = 'imperial'; // Default to Fahrenheit
    }

    async initialize() {
        await this.getLocation();
        return await this.fetchWeather();
    }

    toggleUnit() {
        this.unit = this.unit === 'metric' ? 'imperial' : 'metric';
        return this.unit;
    }

    convertTemp(celsius) {
        if (this.unit === 'metric') return celsius;
        return (celsius * 9/5) + 32;
    }

    async searchLocation(query) {
        try {
            const response = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`
            );
            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Search location failed:', error);
            throw error;
        }
    }

    setManualLocation(lat, lon, name) {
        this.latitude = parseFloat(lat);
        this.longitude = parseFloat(lon);
        this.location = name;
    }

    async getLocation() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                this.setDefaultLocation();
                resolve();
                return;
            }

            navigator.geolocation.getCurrentPosition(
                async (position) => {
                    this.latitude = position.coords.latitude;
                    this.longitude = position.coords.longitude;
                    
                    // Get location name using reverse geocoding
                    try {
                        const locationName = await this.reverseGeocode(this.latitude, this.longitude);
                        this.location = locationName;
                    } catch (error) {
                        this.location = `${this.latitude.toFixed(2)}, ${this.longitude.toFixed(2)}`;
                    }
                    
                    resolve();
                },
                (error) => {
                    console.warn('Geolocation failed, using default location:', error.message);
                    this.setDefaultLocation();
                    resolve();
                }
            );
        });
    }

    setDefaultLocation() {
        // Default to New York City coordinates
        this.latitude = 40.7128;
        this.longitude = -74.0060;
        this.location = 'New York, USA (default)';
    }

    async reverseGeocode(lat, lon) {
        try {
            const response = await fetch(
                `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`
            );
            const data = await response.json();
            
            if (data.address) {
                const city = data.address.city || data.address.town || data.address.village;
                const country = data.address.country;
                return city ? `${city}, ${country}` : country;
            }
            return `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
        } catch (error) {
            console.error('Reverse geocoding failed:', error);
            return `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
        }
    }

    async fetchWeather() {
        if (!this.latitude || !this.longitude) {
            throw new Error('Location not available');
        }

        try {
            // Using Open-Meteo API (free, no key required)
            // Get current and forecast weather
            // Added 'visibility' to current params
            // Request past_days=1 to ensure we have historical hourly data for the "Past" zone interpolation
            // even if the current time is just after midnight.
            const currentResponse = await fetch(
                `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(this.latitude)}&longitude=${encodeURIComponent(this.longitude)}&current=temperature_2m,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,visibility,rain,showers,snowfall&hourly=temperature_2m,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,visibility,rain,showers,snowfall&timezone=auto&past_days=1`
            );
            const currentData = await currentResponse.json();

            // Get historical weather (past 3 hours)
            const now = new Date();
            const pastDate = new Date(now.getTime() - 3 * 60 * 60 * 1000);
            const pastDateStr = pastDate.toISOString().split('T')[0];
            const todayStr = now.toISOString().split('T')[0];
            
            const historicalResponse = await fetch(
                `https://archive-api.open-meteo.com/v1/archive?latitude=${encodeURIComponent(this.latitude)}&longitude=${encodeURIComponent(this.longitude)}&start_date=${pastDateStr}&end_date=${todayStr}&hourly=temperature_2m,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,rain,showers,snowfall&timezone=auto`
            );
            const historicalData = await historicalResponse.json();

            // Create Timeline (Hourly Data)
            // Combine historical (past hours) and current/forecast (future hours) if needed
            // But Open-Meteo Forecast usually provides full day hourly data including past hours of the day.
            // Let's verify: Forecast returns 7 days by default. Hourly array covers 00:00 to 23:00+...

            const timeline = [];
            const hourly = currentData.hourly;

            if (hourly && hourly.time) {
                for (let i = 0; i < hourly.time.length; i++) {
                    timeline.push({
                        time: new Date(hourly.time[i]),
                        temp: hourly.temperature_2m[i],
                        weatherCode: hourly.weather_code[i],
                        description: this.getWeatherDescription(hourly.weather_code[i]),
                        cloudCover: hourly.cloud_cover[i],
                        windSpeed: hourly.wind_speed_10m[i],
                        windDirection: hourly.wind_direction_10m ? hourly.wind_direction_10m[i] : 0,
                        visibility: hourly.visibility ? hourly.visibility[i] : 10000,
                        rain: hourly.rain ? hourly.rain[i] : 0,
                        showers: hourly.showers ? hourly.showers[i] : 0,
                        snowfall: hourly.snowfall ? hourly.snowfall[i] : 0
                    });
                }
            }

            // Parse current weather
            const current = {
                temp: currentData.current.temperature_2m,
                weatherCode: currentData.current.weather_code,
                description: this.getWeatherDescription(currentData.current.weather_code),
                cloudCover: currentData.current.cloud_cover,
                windSpeed: currentData.current.wind_speed_10m,
                windDirection: currentData.current.wind_direction_10m || 0,
                visibility: currentData.current.visibility, // meters
                rain: currentData.current.rain,
                showers: currentData.current.showers,
                snowfall: currentData.current.snowfall
            };

            // Parse past weather (3 hours ago)
            const pastHourIndex = this.findClosestHourIndex(historicalData.hourly.time, pastDate);
            const past = {
                temp: historicalData.hourly.temperature_2m[pastHourIndex] || current.temp,
                weatherCode: historicalData.hourly.weather_code[pastHourIndex] || current.weatherCode,
                description: this.getWeatherDescription(historicalData.hourly.weather_code[pastHourIndex] || current.weatherCode),
                cloudCover: historicalData.hourly.cloud_cover[pastHourIndex] || current.cloudCover,
                windSpeed: historicalData.hourly.wind_speed_10m[pastHourIndex] || current.windSpeed,
                windDirection: historicalData.hourly.wind_direction_10m ? historicalData.hourly.wind_direction_10m[pastHourIndex] : (current.windDirection || 0),
                rain: historicalData.hourly.rain ? historicalData.hourly.rain[pastHourIndex] : 0,
                showers: historicalData.hourly.showers ? historicalData.hourly.showers[pastHourIndex] : 0,
                snowfall: historicalData.hourly.snowfall ? historicalData.hourly.snowfall[pastHourIndex] : 0
            };

            // Parse forecast (3 hours from now)
            const futureDate = new Date(now.getTime() + 3 * 60 * 60 * 1000);
            const futureHourIndex = this.findClosestHourIndex(currentData.hourly.time, futureDate);
            const forecast = {
                temp: currentData.hourly.temperature_2m[futureHourIndex] || current.temp,
                weatherCode: currentData.hourly.weather_code[futureHourIndex] || current.weatherCode,
                description: this.getWeatherDescription(currentData.hourly.weather_code[futureHourIndex] || current.weatherCode),
                cloudCover: currentData.hourly.cloud_cover[futureHourIndex] || current.cloudCover,
                windSpeed: currentData.hourly.wind_speed_10m[futureHourIndex] || current.windSpeed,
                windDirection: currentData.hourly.wind_direction_10m ? currentData.hourly.wind_direction_10m[futureHourIndex] : (current.windDirection || 0),
                rain: currentData.hourly.rain ? currentData.hourly.rain[futureHourIndex] : 0,
                showers: currentData.hourly.showers ? currentData.hourly.showers[futureHourIndex] : 0,
                snowfall: currentData.hourly.snowfall ? currentData.hourly.snowfall[futureHourIndex] : 0
            };

            // Advanced Data Fetches
            const historicalYearAgo = await this.fetchHistoricalYearAgo(now);
            const regional = await this.fetchRegionalWeather();
            const accuracy = this.getPredictionAccuracy(current);

            return {
                location: this.location,
                current,
                past,
                forecast,
                timeline, // Add timeline to return
                historicalYearAgo,
                regional,
                accuracy
            };
        } catch (error) {
            console.error('Weather fetch failed:', error);
            throw error;
        }
    }

    async fetchHistoricalYearAgo(now) {
        const lastYear = new Date(now.getTime());
        lastYear.setFullYear(now.getFullYear() - 1);
        const dateStr = lastYear.toISOString().split('T')[0];

        try {
            const response = await fetch(
                `https://archive-api.open-meteo.com/v1/archive?latitude=${encodeURIComponent(this.latitude)}&longitude=${encodeURIComponent(this.longitude)}&start_date=${dateStr}&end_date=${dateStr}&hourly=temperature_2m,weather_code,cloud_cover,wind_speed_10m&timezone=auto`
            );
            const data = await response.json();

            // Use same hour as now
            const index = this.findClosestHourIndex(data.hourly.time, lastYear);
             return {
                temp: data.hourly.temperature_2m[index],
                weatherCode: data.hourly.weather_code[index],
                description: this.getWeatherDescription(data.hourly.weather_code[index]),
                date: dateStr
            };
        } catch (e) {
            console.error("Failed to fetch historical year ago", e);
            return null;
        }
    }

    async fetchRegionalWeather() {
        // Offsets approx 10-15km
        const offsets = [
            { name: "North", lat: 0.1, lon: 0 },
            { name: "East", lat: 0, lon: 0.1 },
            { name: "South", lat: -0.1, lon: 0 },
            { name: "West", lat: 0, lon: -0.1 }
        ];

        const promises = offsets.map(async (offset) => {
             const rLat = this.latitude + offset.lat;
             const rLon = this.longitude + offset.lon;
             try {
                 const response = await fetch(
                    `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(rLat)}&longitude=${encodeURIComponent(rLon)}&current=temperature_2m,weather_code&timezone=auto`
                );
                const data = await response.json();
                return {
                    name: offset.name,
                    temp: data.current.temperature_2m,
                    weatherCode: data.current.weather_code,
                    description: this.getWeatherDescription(data.current.weather_code)
                };
             } catch (e) {
                 return null;
             }
        });

        const results = await Promise.all(promises);
        return results.filter(r => r !== null);
    }

    getPredictionAccuracy(current) {
         // Mock data for testing/demo purposes as requested
         // Simulate a prediction that was slightly off
         // Ensure it's deterministic enough for a single session but varies slightly
         const delta = (Math.random() * 4) - 2; // -2 to +2
         const predictedTemp = current.temp + delta;

         return {
             predictedTemp: parseFloat(predictedTemp.toFixed(1)),
             actualTemp: current.temp,
             delta: parseFloat(delta.toFixed(1)),
             accuracy: Math.max(0, 100 - Math.abs(delta) * 10).toFixed(0)
         };
    }

    findClosestHourIndex(timeArray, targetDate) {
        const targetTime = targetDate.getTime();
        let closestIndex = 0;
        let closestDiff = Infinity;

        for (let i = 0; i < timeArray.length; i++) {
            const time = new Date(timeArray[i]).getTime();
            const diff = Math.abs(time - targetTime);
            if (diff < closestDiff) {
                closestDiff = diff;
                closestIndex = i;
            }
        }

        return closestIndex;
    }

    getWeatherDescription(code) {
        // WMO Weather interpretation codes
        const weatherCodes = {
            0: 'Clear sky',
            1: 'Mainly clear',
            2: 'Partly cloudy',
            3: 'Overcast',
            45: 'Foggy',
            48: 'Depositing rime fog',
            51: 'Light drizzle',
            53: 'Moderate drizzle',
            55: 'Dense drizzle',
            61: 'Slight rain',
            63: 'Moderate rain',
            65: 'Heavy rain',
            71: 'Slight snow',
            73: 'Moderate snow',
            75: 'Heavy snow',
            77: 'Snow grains',
            80: 'Slight rain showers',
            81: 'Moderate rain showers',
            82: 'Violent rain showers',
            85: 'Slight snow showers',
            86: 'Heavy snow showers',
            95: 'Thunderstorm',
            96: 'Thunderstorm with hail',
            99: 'Thunderstorm with heavy hail'
        };

        return weatherCodes[code] || 'Unknown';
    }
}
