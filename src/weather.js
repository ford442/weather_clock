export class WeatherService {
    constructor() {
        this.apiKey = 'demo'; // Using demo mode for Open-Meteo (no key needed)
        this.latitude = null;
        this.longitude = null;
        this.location = null;
    }

    async initialize() {
        await this.getLocation();
        return await this.fetchWeather();
    }

    async getLocation() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocation not supported'));
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
                    reject(error);
                }
            );
        });
    }

    async reverseGeocode(lat, lon) {
        try {
            const response = await fetch(
                `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`
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
            const currentResponse = await fetch(
                `https://api.open-meteo.com/v1/forecast?latitude=${this.latitude}&longitude=${this.longitude}&current=temperature_2m,weather_code,cloud_cover&hourly=temperature_2m,weather_code,cloud_cover&timezone=auto`
            );
            const currentData = await currentResponse.json();

            // Get historical weather (past 3 hours)
            const now = new Date();
            const pastDate = new Date(now.getTime() - 3 * 60 * 60 * 1000);
            const pastDateStr = pastDate.toISOString().split('T')[0];
            const todayStr = now.toISOString().split('T')[0];
            
            const historicalResponse = await fetch(
                `https://archive-api.open-meteo.com/v1/archive?latitude=${this.latitude}&longitude=${this.longitude}&start_date=${pastDateStr}&end_date=${todayStr}&hourly=temperature_2m,weather_code,cloud_cover&timezone=auto`
            );
            const historicalData = await historicalResponse.json();

            // Parse current weather
            const current = {
                temp: currentData.current.temperature_2m,
                weatherCode: currentData.current.weather_code,
                description: this.getWeatherDescription(currentData.current.weather_code),
                cloudCover: currentData.current.cloud_cover
            };

            // Parse past weather (3 hours ago)
            const pastHourIndex = this.findClosestHourIndex(historicalData.hourly.time, pastDate);
            const past = {
                temp: historicalData.hourly.temperature_2m[pastHourIndex] || current.temp,
                weatherCode: historicalData.hourly.weather_code[pastHourIndex] || current.weatherCode,
                description: this.getWeatherDescription(historicalData.hourly.weather_code[pastHourIndex] || current.weatherCode),
                cloudCover: historicalData.hourly.cloud_cover[pastHourIndex] || current.cloudCover
            };

            // Parse forecast (3 hours from now)
            const futureDate = new Date(now.getTime() + 3 * 60 * 60 * 1000);
            const futureHourIndex = this.findClosestHourIndex(currentData.hourly.time, futureDate);
            const forecast = {
                temp: currentData.hourly.temperature_2m[futureHourIndex] || current.temp,
                weatherCode: currentData.hourly.weather_code[futureHourIndex] || current.weatherCode,
                description: this.getWeatherDescription(currentData.hourly.weather_code[futureHourIndex] || current.weatherCode),
                cloudCover: currentData.hourly.cloud_cover[futureHourIndex] || current.cloudCover
            };

            return {
                location: this.location,
                current,
                past,
                forecast
            };
        } catch (error) {
            console.error('Weather fetch failed:', error);
            throw error;
        }
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
