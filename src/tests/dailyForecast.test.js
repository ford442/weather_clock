import { describe, it, expect } from 'vitest';
import {
    getVisualPreset,
    getDailyDescription,
    parseDailyForecast,
    computeHourlyAggregates,
    estimateCloudAndVisibility,
    getRepresentativeTimeForDay,
    buildHourlyTimelineFromDay
} from '../dailyForecast.js';

describe('Daily forecast helpers', () => {
    it('maps WMO codes to visual presets', () => {
        expect(getVisualPreset(0)).toBe('clear');
        expect(getVisualPreset(1)).toBe('clear');
        expect(getVisualPreset(2)).toBe('partly-cloudy');
        expect(getVisualPreset(3)).toBe('cloudy');
        expect(getVisualPreset(45)).toBe('fog');
        expect(getVisualPreset(61)).toBe('rain');
        expect(getVisualPreset(71)).toBe('snow');
        expect(getVisualPreset(95)).toBe('thunderstorm');
        expect(getVisualPreset(999)).toBe('clear'); // unknown fallback
    });

    it('returns human-readable descriptions', () => {
        expect(getDailyDescription(0)).toBe('Clear sky');
        expect(getDailyDescription(65)).toBe('Heavy rain');
        expect(getDailyDescription(99)).toBe('Thunderstorm with heavy hail');
        expect(getDailyDescription(12345)).toBe('Unknown');
    });

    it('estimates cloud/visibility fallback from weather code', () => {
        expect(estimateCloudAndVisibility(0).cloudCover).toBeLessThan(20);
        expect(estimateCloudAndVisibility(3).cloudCover).toBeGreaterThan(80);
        expect(estimateCloudAndVisibility(45).visibility).toBeLessThan(5000);
        expect(estimateCloudAndVisibility(95).visibility).toBeLessThan(5000);
    });

    it('computes hourly aggregates for a date', () => {
        const hourly = {
            time: ['2026-06-18T00:00:00Z', '2026-06-18T01:00:00Z', '2026-06-18T02:00:00Z', '2026-06-19T00:00:00Z'],
            cloud_cover: [0, 50, 100, 75],
            visibility: [10000, 8000, 6000, 5000]
        };

        const result = computeHourlyAggregates(hourly, '2026-06-18');
        expect(result.cloudCover).toBe(50);
        expect(result.visibility).toBe(8000);
    });

    it('parses an Open-Meteo daily response', () => {
        const response = {
            daily: {
                time: ['2026-06-18', '2026-06-19', '2026-06-20'],
                weather_code: [0, 61, 71],
                temperature_2m_max: [25, 22, 18],
                temperature_2m_min: [15, 14, 10],
                apparent_temperature_max: [26, 23, 19],
                apparent_temperature_min: [16, 15, 11],
                precipitation_sum: [0, 5, 2],
                rain_sum: [0, 5, 0],
                showers_sum: [0, 0, 0],
                snowfall_sum: [0, 0, 2],
                precipitation_probability_max: [0, 80, 60],
                wind_speed_10m_max: [10, 20, 15],
                wind_direction_10m_dominant: [180, 270, 90]
            },
            daily_units: {
                temperature_2m_max: '°C',
                wind_speed_10m_max: 'km/h',
                precipitation_sum: 'mm',
                visibility: 'm'
            },
            hourly: {
                time: ['2026-06-18T00:00:00Z', '2026-06-18T12:00:00Z', '2026-06-19T00:00:00Z', '2026-06-19T12:00:00Z'],
                cloud_cover: [10, 20, 80, 90],
                visibility: [10000, 10000, 5000, 4000]
            }
        };

        const days = parseDailyForecast(response, { expectedDays: 10 });
        expect(days).toHaveLength(3);

        const first = days[0];
        expect(first.date).toBe('2026-06-18');
        expect(first.weatherCode).toBe(0);
        expect(first.condition).toBe('clear');
        expect(first.tMax).toBe(25);
        expect(first.tMin).toBe(15);
        expect(first.cloudCover).toBe(15);
        expect(first.visibility).toBe(10000);

        const rainDay = days[1];
        expect(rainDay.condition).toBe('rain');
        expect(rainDay.precipSum).toBe(5);
        expect(rainDay.cloudCover).toBe(85);
        expect(rainDay.visibility).toBe(4500);
    });

    it('returns fewer days when API response is partial', () => {
        const response = {
            daily: {
                time: ['2026-06-18', '2026-06-19'],
                weather_code: [0],
                temperature_2m_max: [25, 22],
                temperature_2m_min: [15, 14]
            }
        };

        const days = parseDailyForecast(response, { expectedDays: 10 });
        expect(days).toHaveLength(1);
        expect(days[0].date).toBe('2026-06-18');
    });

    it('returns representative time for a day', () => {
        const date = getRepresentativeTimeForDay('2026-06-18', 40.7, -74);
        expect(date instanceof Date).toBe(true);
        expect(date.toISOString().startsWith('2026-06-18')).toBe(true);
    });

    it('builds a 24-hour timeline from a daily summary', () => {
        const day = {
            date: '2026-06-18',
            weatherCode: 61,
            description: 'Slight rain',
            condition: 'rain',
            tMax: 22,
            tMin: 12,
            rainSum: 12,
            snowfallSum: 0,
            showersSum: 0,
            windSpeedMax: 20,
            windDir: 180,
            cloudCover: 80,
            visibility: 8000,
            precipProbabilityMax: 70
        };

        const repDate = new Date('2026-06-18T12:00:00');
        const timeline = buildHourlyTimelineFromDay(day, repDate);
        expect(timeline).toHaveLength(24);
        expect(timeline[12].weatherCode).toBe(61);
        expect(timeline[12].rain).toBe(0.5);
        expect(timeline[0].rain).toBe(0.5);
    });
});
