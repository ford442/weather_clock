import { describe, it, expect, vi } from 'vitest';
import { WeatherService } from '../weather.js';

// Mock fetch
global.fetch = vi.fn();

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
});
