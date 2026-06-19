import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WeatherService } from '../weather.js';
import { getWeatherAtTime } from '../weather-simulation.js';

// Mock fetch
global.fetch = vi.fn();

beforeEach(() => {
    fetch.mockReset();
});

describe('WeatherService', () => {
    it('should initialize with default location if geolocation fails', async () => {
        const service = new WeatherService();
        // Mock navigator.geolocation
        vi.stubGlobal('navigator', {
            geolocation: {
                getCurrentPosition: (success, error) => {
                    error(new Error('User denied'));
                }
            }
        });

        // Mock fetch for weather
        fetch.mockResolvedValueOnce({
            json: async () => ({
                hourly: {
                    time: [],
                    temperature_2m: [],
                    weather_code: [],
                    cloud_cover: [],
                    wind_speed_10m: [],
                    rain: [],
                    showers: [],
                    snowfall: []
                },
                current: {
                    weather_code: 0,
                    temperature_2m: 20,
                    cloud_cover: 0,
                    wind_speed_10m: 0,
                    visibility: 10000,
                    rain: 0,
                    showers: 0,
                    snowfall: 0
                }
            })
        });
        // Mock fetch for historical
        fetch.mockResolvedValueOnce({
            json: async () => ({
                hourly: {
                    time: [],
                    temperature_2m: [],
                    weather_code: [],
                    cloud_cover: [],
                    wind_speed_10m: [],
                    rain: [],
                    showers: [],
                    snowfall: []
                }
            })
        });
        // Mock fetch for historical year ago
        fetch.mockResolvedValueOnce({
             json: async () => ({
                hourly: {
                    time: [],
                    temperature_2m: [],
                    weather_code: [],
                    cloud_cover: [],
                    wind_speed_10m: []
                }
            })
        });
        // Mock fetch for regional
        fetch.mockResolvedValue({
            json: async () => ({ current: { weather_code: 0, temperature_2m: 20 } })
        });

        await service.initialize();

        expect(service.latitude).toBe(40.7128); // Default NY
        expect(service.longitude).toBe(-74.0060);
    });

    it('should convert temperature correctly', () => {
        const service = new WeatherService();
        service.unit = 'metric';
        expect(service.convertTemp(20)).toBe(20);

        service.toggleUnit();
        expect(service.unit).toBe('imperial');
        expect(service.convertTemp(0)).toBe(32);
        expect(service.convertTemp(100)).toBe(212);
    });

    it('should get weather description from code', () => {
        const service = new WeatherService();
        expect(service.getWeatherDescription(0)).toBe('Clear sky');
        expect(service.getWeatherDescription(95)).toBe('Thunderstorm');
        expect(service.getWeatherDescription(999)).toBe('Unknown');
    });

    describe('Caching and Resilience', () => {
        it('should return null on cache miss', () => {
            const service = new WeatherService();
            service.setManualLocation(40.71, -74.01, 'Test City');
            const key = service.getCacheKey(40.71, -74.01);
            expect(service.getFromCache(key)).toBeNull();
        });

        it('should store and retrieve data from cache', () => {
            const service = new WeatherService();
            service.setManualLocation(40.71, -74.01, 'Test City');
            const key = service.getCacheKey(40.71, -74.01);
            const dummyData = { test: 'data' };
            
            service.setCache(key, dummyData);
            const cached = service.getFromCache(key);
            
            expect(cached).not.toBeNull();
            expect(cached.data).toEqual(dummyData);
            expect(cached.lat).toBe(40.71);
            expect(cached.lon).toBe(-74.01);
        });

        it('should handle expired cache entries correctly', () => {
            const service = new WeatherService();
            service.setManualLocation(40.71, -74.01, 'Test City');
            const key = service.getCacheKey(40.71, -74.01);
            const dummyData = { test: 'data' };
            
            service.setCache(key, dummyData);
            
            // Artificially expire the cache entry (more than 1 hour ago)
            const entry = service.cache.get(key);
            entry.timestamp = Date.now() - 2 * 60 * 60 * 1000; 
            
            // Without allowExpired, it should return null
            expect(service.getFromCache(key, false)).toBeNull();
            
            // Set again and expire again to test allowExpired
            service.setCache(key, dummyData);
            const entry2 = service.cache.get(key);
            entry2.timestamp = Date.now() - 2 * 60 * 60 * 1000;
            
            // With allowExpired, it should return the entry
            const stale = service.getFromCache(key, true);
            expect(stale).not.toBeNull();
            expect(stale.data).toEqual(dummyData);
        });

        it('should fall back to stale cached data when fetch fails', async () => {
            const service = new WeatherService();
            service.setManualLocation(40.71, -74.01, 'Test City');
            const key = service.getCacheKey(40.71, -74.01);
            const dummyData = { current: { temp: 15 }, timeline: [] };
            
            service.setCache(key, dummyData);
            
            // Mock fetch to reject (simulate network error)
            fetch.mockRejectedValueOnce(new Error('Network disconnected'));
            
            const data = await service.fetchWeather();
            
            expect(data).not.toBeNull();
            expect(data.current.temp).toBe(15);
            expect(data.isCached).toBe(true);
            expect(data.cachedAt).toBeDefined();
        });
    });
});

describe('Daily Forecast', () => {
    it('should fetch and normalize a 10-day daily forecast', async () => {
        const service = new WeatherService();
        service.setManualLocation(40.71, -74.01, 'Test City');

        fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                daily: {
                    time: Array.from({ length: 10 }, (_, i) => {
                        const d = new Date('2026-06-18T00:00:00Z');
                        d.setDate(d.getDate() + i);
                        return d.toISOString().split('T')[0];
                    }),
                    weather_code: Array(10).fill(0),
                    temperature_2m_max: Array(10).fill(25),
                    temperature_2m_min: Array(10).fill(15),
                    apparent_temperature_max: Array(10).fill(26),
                    apparent_temperature_min: Array(10).fill(16),
                    precipitation_sum: Array(10).fill(0),
                    rain_sum: Array(10).fill(0),
                    showers_sum: Array(10).fill(0),
                    snowfall_sum: Array(10).fill(0),
                    precipitation_probability_max: Array(10).fill(0),
                    wind_speed_10m_max: Array(10).fill(10),
                    wind_direction_10m_dominant: Array(10).fill(180)
                },
                daily_units: {
                    temperature_2m_max: '°C',
                    wind_speed_10m_max: 'km/h',
                    precipitation_sum: 'mm'
                },
                hourly: {
                    time: Array.from({ length: 10 * 24 }, (_, i) => {
                        const d = new Date('2026-06-18T00:00:00Z');
                        d.setHours(d.getHours() + i);
                        return d.toISOString().replace('T', ' ').substring(0, 19);
                    }),
                    cloud_cover: Array(10 * 24).fill(20),
                    visibility: Array(10 * 24).fill(10000)
                }
            })
        });

        const forecast = await service.getDailyForecast(40.71, -74.01, 10);

        expect(forecast).toHaveLength(10);
        expect(forecast[0]).toHaveProperty('date');
        expect(forecast[0]).toHaveProperty('weatherCode');
        expect(forecast[0]).toHaveProperty('tMax');
        expect(forecast[0]).toHaveProperty('tMin');
        expect(forecast[0]).toHaveProperty('condition');
        expect(forecast[0]).toHaveProperty('cloudCover');
        expect(forecast[0]).toHaveProperty('visibility');
    });

    it('should fall back to stale cache when daily forecast fetch fails', async () => {
        const service = new WeatherService();
        service.setManualLocation(40.71, -74.01, 'Test City');
        const key = service.getCacheKey(40.71, -74.01, 'daily_10');
        const dummyData = [{ date: '2026-06-18', weatherCode: 0, tMax: 20, tMin: 10, condition: 'clear' }];

        service.setCache(key, dummyData);
        fetch.mockRejectedValueOnce(new Error('Network disconnected'));

        const forecast = await service.getDailyForecast(40.71, -74.01, 10);

        expect(forecast).toEqual(dummyData);
    });

    it('should clamp requested days to valid range', async () => {
        const service = new WeatherService();
        service.setManualLocation(40.71, -74.01, 'Test City');

        fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                daily: {
                    time: ['2026-06-18'],
                    weather_code: [0],
                    temperature_2m_max: [20],
                    temperature_2m_min: [10]
                },
                hourly: {
                    time: ['2026-06-18T00:00:00Z'],
                    cloud_cover: [0],
                    visibility: [10000]
                }
            })
        });

        // Requesting 0 days should be clamped to 1
        const forecast = await service.getDailyForecast(40.71, -74.01, 0);
        expect(forecast).toHaveLength(1);
    });
});

describe('Weather Interpolation', () => {
    it('should smoothly interpolate rain intensity between code 0 and code 65', () => {
        const date1 = new Date('2026-06-11T12:00:00Z');
        const date2 = new Date('2026-06-11T13:00:00Z');

        const timeline = [
            {
                time: date1,
                weatherCode: 0, // Clear sky
                rain: 0,
                showers: 0,
                snowfall: 0,
                cloudCover: 0,
                windSpeed: 0,
                visibility: 10000
            },
            {
                time: date2,
                weatherCode: 65, // Heavy rain
                rain: 5.0,
                showers: 0,
                snowfall: 0,
                cloudCover: 100,
                windSpeed: 10,
                visibility: 2000
            }
        ];

        // Let's sample across the hour boundary
        const res0 = getWeatherAtTime(date1, timeline);
        const res25 = getWeatherAtTime(new Date(date1.getTime() + 15 * 60 * 1000), timeline);
        const res50 = getWeatherAtTime(new Date(date1.getTime() + 30 * 60 * 1000), timeline);
        const res75 = getWeatherAtTime(new Date(date1.getTime() + 45 * 60 * 1000), timeline);
        const res100 = getWeatherAtTime(date2, timeline);

        // Verify rain intensities are monotonically increasing
        expect(res0.rainIntensity).toBe(0.0);
        expect(res25.rainIntensity).toBeGreaterThan(0.0);
        expect(res50.rainIntensity).toBeGreaterThan(res25.rainIntensity);
        expect(res75.rainIntensity).toBeGreaterThan(res50.rainIntensity);
        expect(res100.rainIntensity).toBe(1.0);

        // Verify that weatherCode still flips at 0.5 factor (midpoint)
        expect(res25.weatherCode).toBe(0);
        expect(res50.weatherCode).toBe(65); // factor is 0.5, maps to next.weatherCode
        expect(res75.weatherCode).toBe(65);
    });
});
