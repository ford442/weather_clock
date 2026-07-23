import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WeatherService } from '../weather.js';
import { getWeatherAtTime } from '../weather-simulation.js';

// Mock fetch
global.fetch = vi.fn();

beforeEach(() => {
    fetch.mockReset();
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
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
        expect(service.longitude).toBe(-74.006);
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
            const service = new WeatherService({ retryDelaysMs: [] });
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

        it('should mark cached data as offline after a failed request while offline', async () => {
            const service = new WeatherService();
            service.setManualLocation(40.71, -74.01, 'Test City');
            service.setCache(service.getCacheKey(40.71, -74.01), {
                current: { temp: 15 },
                timeline: []
            });
            vi.stubGlobal('navigator', { onLine: false });
            fetch.mockRejectedValueOnce(new Error('Network disconnected'));

            const data = await service.fetchWeather();

            expect(data.isCached).toBe(true);
            expect(data.isOffline).toBe(true);
            expect(fetch).toHaveBeenCalledTimes(1);
        });
    });

    describe('Request cancellation and timeouts', () => {
        it('should abort a request that exceeds the HTTP timeout', async () => {
            vi.useFakeTimers();
            const service = new WeatherService({ timeoutMs: 10000 });
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            fetch.mockImplementation((_url, options) => {
                return new Promise((_resolve, reject) => {
                    options.signal.addEventListener('abort', () => {
                        reject(new DOMException('Aborted', 'AbortError'));
                    });
                });
            });

            const request = service.searchLocation('Berlin');
            const rejection = expect(request).rejects.toMatchObject({ code: 'TIMEOUT', status: null });

            await vi.advanceTimersByTimeAsync(10000);
            await rejection;
            expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
            errorSpy.mockRestore();
        });

        it('should cancel an older search when a new search starts', async () => {
            const service = new WeatherService();
            const firstRequest = {};

            fetch.mockImplementationOnce((_url, options) => {
                firstRequest.signal = options.signal;
                return new Promise((_resolve, reject) => {
                    options.signal.addEventListener('abort', () => {
                        reject(new DOMException('Aborted', 'AbortError'));
                    });
                });
            });
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => [{ display_name: 'Berlin, Germany', lat: '52.52', lon: '13.405' }]
            });

            const olderSearch = service.searchLocation('Ber');
            const olderRejection = expect(olderSearch).rejects.toMatchObject({ code: 'ABORTED' });
            const latestSearch = service.searchLocation('Berlin');

            await olderRejection;
            await expect(latestSearch).resolves.toEqual([
                { display_name: 'Berlin, Germany', lat: '52.52', lon: '13.405' }
            ]);
            expect(firstRequest.signal.aborted).toBe(true);
        });
    });
});

describe('WeatherService — air quality & alerts', () => {
    it('builds the NWS alerts URL rounded to 4 decimal places', () => {
        const service = new WeatherService();
        expect(service.buildAlertsUrl(40.71280001, -74.00600009)).toBe(
            'https://api.weather.gov/alerts/active?point=40.7128,-74.006'
        );
        expect(service.buildAlertsUrl(51.5074, -0.1278)).toBe(
            'https://api.weather.gov/alerts/active?point=51.5074,-0.1278'
        );
    });

    it('fetches and normalizes air quality data', async () => {
        const service = new WeatherService();
        service.setManualLocation(40.71, -74.01, 'Test City');

        fetch.mockResolvedValueOnce({
            json: async () => ({
                current: {
                    pm2_5: 12.3,
                    pm10: 20.1,
                    ozone: 45,
                    us_aqi: 62,
                    european_aqi: 30,
                    birch_pollen: 15,
                    grass_pollen: 5,
                    ragweed_pollen: null
                }
            })
        });

        const result = await service.fetchAirQuality();
        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('https://air-quality-api.open-meteo.com/v1/air-quality'),
            expect.anything()
        );
        expect(result).toEqual({
            pm2_5: 12.3,
            pm10: 20.1,
            ozone: 45,
            usAqi: 62,
            europeanAqi: 30,
            pollen: { birch: 15, grass: 5, ragweed: null }
        });
    });

    it('falls back to null when air quality fetch fails with no cache', async () => {
        const service = new WeatherService();
        service.setManualLocation(40.71, -74.01, 'Test City');
        fetch.mockRejectedValueOnce(new Error('network down'));

        const result = await service.fetchAirQuality();
        expect(result).toBeNull();
    });

    it('fetches and normalizes active alerts', async () => {
        const service = new WeatherService();
        service.setManualLocation(40.71, -74.01, 'Test City');

        fetch.mockResolvedValueOnce({
            json: async () => ({
                features: [
                    {
                        id: 'urn:test:1',
                        properties: {
                            event: 'Severe Thunderstorm Warning',
                            severity: 'Severe',
                            headline: 'Severe storm approaching',
                            description: 'Details here',
                            effective: '2024-01-01T00:00:00Z',
                            expires: '2024-01-01T02:00:00Z'
                        }
                    }
                ]
            })
        });

        const result = await service.fetchAlerts();
        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('https://api.weather.gov/alerts/active?point='),
            expect.anything()
        );
        expect(result).toEqual([
            {
                id: 'urn:test:1',
                event: 'Severe Thunderstorm Warning',
                severity: 'Severe',
                headline: 'Severe storm approaching',
                description: 'Details here',
                effective: '2024-01-01T00:00:00Z',
                expires: '2024-01-01T02:00:00Z'
            }
        ]);
    });

    it('treats alert fetch failure as "no active alerts" rather than an error', async () => {
        const service = new WeatherService();
        service.setManualLocation(51.5074, -0.1278, 'London'); // non-US — NWS has no coverage
        fetch.mockRejectedValueOnce(new Error('404'));

        const result = await service.fetchAlerts();
        expect(result).toEqual([]);
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

describe('Forecast accuracy', () => {
    const buildPreviousRunsResponse = ({ hours = 24, day1Error = 1, day3Error = 2 } = {}) => {
        const times = [];
        const actual = [];
        const day1 = [];
        const day3 = [];
        for (let h = hours; h >= 1; h--) {
            times.push(new Date(Date.now() - h * 60 * 60 * 1000).toISOString());
            actual.push(10);
            day1.push(10 + day1Error);
            day3.push(10 - day3Error);
        }
        return {
            hourly: {
                time: times,
                temperature_2m: actual,
                temperature_2m_previous_day1: day1,
                temperature_2m_previous_day3: day3
            }
        };
    };

    const createService = () => {
        const service = new WeatherService();
        service.setManualLocation(40.71, -74.01, 'Test City');
        return service;
    };

    it('should compute MAE and score from previous-runs fixture data', async () => {
        const service = createService();
        fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => buildPreviousRunsResponse()
        });

        const accuracy = await service.getPredictionAccuracy();

        expect(accuracy).not.toBeNull();
        expect(accuracy.mae).toBe(1); // |10 - 11| over 24h
        expect(accuracy.maeDay3).toBe(2); // |10 - 8| over 24h
        expect(accuracy.score).toBe(90); // 100 - 10 points per °C of MAE
        expect(accuracy.sampleSize).toBe(24);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch.mock.calls[0][0]).toContain('previous-runs-api.open-meteo.com');
    });

    it('should skip null pairs when computing MAE', async () => {
        const service = createService();
        const response = buildPreviousRunsResponse({ hours: 24, day1Error: 2 });
        // Null out half the day-1 predictions; remaining 12 pairs keep MAE = 2
        for (let i = 0; i < 12; i++) {
            response.hourly.temperature_2m_previous_day1[i] = null;
        }
        fetch.mockResolvedValueOnce({ ok: true, json: async () => response });

        const accuracy = await service.getPredictionAccuracy();

        expect(accuracy).not.toBeNull();
        expect(accuracy.mae).toBe(2);
        expect(accuracy.sampleSize).toBe(12);
    });

    it('should return null when the endpoint lacks data for the location', async () => {
        const service = createService();
        fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ hourly: { time: ['2026-07-23T00:00'] } })
        });

        const accuracy = await service.getPredictionAccuracy();
        expect(accuracy).toBeNull();
    });

    it('should return null when there are too few valid comparison hours', async () => {
        const service = createService();
        fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => buildPreviousRunsResponse({ hours: 5 })
        });

        const accuracy = await service.getPredictionAccuracy();
        expect(accuracy).toBeNull();
    });

    it('should return null gracefully when the fetch fails', async () => {
        const service = createService();
        fetch.mockRejectedValueOnce(new Error('Network disconnected'));

        const accuracy = await service.getPredictionAccuracy();
        expect(accuracy).toBeNull();
    });

    it('should cache the result and only fetch once per day per location', async () => {
        const service = createService();
        fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => buildPreviousRunsResponse()
        });

        const first = await service.getPredictionAccuracy();
        const second = await service.getPredictionAccuracy();

        expect(first).not.toBeNull();
        expect(second).toEqual(first);
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});
