/** Shared weather and rendering contracts used across the JavaScript modules. */

type QualityTier = 'low' | 'medium' | 'high';
type EffectQuality = QualityTier | 'focused' | 'thumbnail';
type PrecipitationType = 'none' | 'rain' | 'snow';
type VisualPreset = 'clear' | 'partly-cloudy' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'thunderstorm';

interface AtmosphereUniforms {
    turbidity: number;
    rayleigh: number;
    mieCoefficient: number;
    mieDirectionalG: number;
    sunIntensityMultiplier: number;
    ambientIntensityMultiplier: number;
    moonIntensityMultiplier: number;
    shadowRadius: number;
    fogDensityMultiplier: number;
    skyFogColor: import('three').Color;
    sunColor: import('three').Color;
    ambientColor: import('three').Color;
}

interface WeatherSnapshot {
    time?: Date;
    temp?: number;
    apparentTemp?: number;
    humidity?: number;
    uvIndex?: number;
    precipProb?: number;
    precipitation?: number;
    pressure?: number;
    weatherCode?: number;
    description?: string;
    cloudCover?: number;
    windSpeed?: number;
    windDirection?: number;
    windDir?: number;
    visibility?: number;
    rain?: number;
    showers?: number;
    snowfall?: number;
    severity?: number;
    rainIntensity?: number;
    snowIntensity?: number;
    fogIntensity?: number;
    precipType?: PrecipitationType;
    atmosphere?: AtmosphereUniforms;
    /** US AQI, attached only to the "current" snapshot (no hourly/forecast timeline for it). */
    aqi?: number | null;
}

interface DailyForecastDay {
    date: string;
    weatherCode: number;
    description: string;
    condition: VisualPreset;
    tMax: number | null;
    tMin: number | null;
    tempMax: number | null;
    tempMin: number | null;
    apparentTMax: number | null;
    apparentTMin: number | null;
    precipSum: number;
    rainSum: number;
    showersSum: number;
    snowfallSum: number;
    precipProbabilityMax: number;
    windSpeedMax: number;
    windDir: number;
    cloudCover: number;
    visibility: number;
    hourly: WeatherSnapshot[];
    units: {
        temperature: string;
        speed: string;
        precipitation: string;
        visibility: string;
    };
}

/**
 * Canonical hourly point used by the 21-day timeline and 10-day forecast
 * strip (src/timeline/TimelineData.js). Deliberately narrower than
 * {@link WeatherSnapshot}, which is the clock/current-conditions hourly
 * shape — the two are kept distinct rather than unified because the timeline
 * only carries what its charts/vignettes need, while WeatherSnapshot mirrors
 * the full Open-Meteo hourly payload consumed by the 3D scene.
 */
interface TimelineHourlyPoint {
    time: string;
    temp: number | null;
    weatherCode: number;
    cloudCover: number;
    windSpeed: number;
    precipitation: number;
}

/** One day of the 21-day timeline (10 past + today + 10 forecast). */
interface TimelineDayData {
    date: string;
    type: 'historical' | 'forecast';
    tempMax: number | null;
    tempMin: number | null;
    tempAvg: number | null;
    tempAnomaly: number;
    zScore: number;
    weatherCode: number;
    condition: 'clear' | 'cloudy' | 'rain' | 'snow' | 'storm';
    hourly: TimelineHourlyPoint[];
    /** Present only on historical days once accuracy data is available. */
    prediction?: { source: string; sampleSize: number };
    accuracy?: TimelineForecastAccuracy;
}

/** 30-year (1991-2020) daily climate normal for one day-of-year. */
interface ClimatologyDayNormal {
    mean: number;
    max: number;
    min: number;
    stdDev: number;
}

interface Climatology {
    daily: Record<number, ClimatologyDayNormal>;
    isFallback: boolean;
}

/**
 * Timeline accuracy metrics: one-day-ahead model forecast vs. observed
 * temperature for a historical day, scored against a persistence baseline.
 * Computed by TimelineData.calculateAccuracy.
 */
interface TimelineForecastAccuracy {
    mae: number | null;
    rmse: number | null;
    skill: number | null;
    /** UI-friendly 0-1 score derived from mae; only present once attached via enrichWithAccuracy. */
    tempScore?: number;
}

/**
 * Clock/current-conditions accuracy metrics: day-1 (and day-3) mean absolute
 * error over the trailing 24 observed hours. Computed by
 * WeatherService.getPredictionAccuracy. Kept distinct from
 * {@link TimelineForecastAccuracy} since the two compare different things
 * (a single rolling 24h window vs. per-calendar-day skill-vs-persistence).
 */
interface ClockForecastAccuracy {
    mae: number;
    maeDay3: number | null;
    score: number;
    sampleSize: number;
    updatedAt: number;
}

interface EffectConfig {
    weatherCode: number;
    cloudCover: number;
    windSpeed: number;
    windDir: number;
    precipType: PrecipitationType;
    precipIntensity: number;
    rainIntensity: number;
    snowIntensity: number;
    fogIntensity: number;
    particleScale: number;
}

interface Navigator {
    readonly deviceMemory?: number;
}

interface HTMLDivElement {
    _dayData?: DailyForecastDay;
}

interface Window {
    webkitAudioContext?: typeof AudioContext;
    __IS_WEBGPU__?: boolean;
    __NATIVE_BACKEND__?: string;
    __NATIVE_BACKENDS__?: Record<string, string>;
    runNativeBenchmarks?: () => Record<string, unknown>;
    aetherDebug?: Record<string, unknown>;
    aetherPerf?: Record<string, unknown>;
    modeController?: import('./ModeController.js').ModeController;
    setDebugDailyForecast?: (...args: any[]) => any;
    setDebugForecastDay?: (...args: any[]) => any;
    setDebugTime?: (...args: any[]) => any;
    setDebugWeather?: (...args: any[]) => any;
    updateQualityButton?: (tier: QualityTier) => void;
}
