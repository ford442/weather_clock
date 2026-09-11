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

/**
 * Physical sunlight modulation for one instant (see `src/celestialLighting.js`).
 * `intensityFactor` carries only the orbital-distance term — the altitude ramp
 * lives in weatherLighting.js#getDayFactor — while `transmission` and
 * `horizonReddening` are colour inputs.
 */
interface SunlightModel {
    /** Earth–Sun distance in AU, ~0.9833 (perihelion) to ~1.0167 (aphelion). */
    distanceAu: number;
    /** Irradiance relative to the annual mean, ~0.967..1.034. */
    irradianceFactor: number;
    altitudeRad: number;
    /** Atmospheric transmission, 1 at the zenith falling to 0 at the horizon. */
    transmission: number;
    horizonReddening: number;
    intensityFactor: number;
}

/**
 * Physical moonlight modulation for one instant (see `src/celestialLighting.js`):
 * the non-Lambertian lunar phase curve, the super/micromoon distance swing and
 * atmospheric extinction, plus the tint and earthshine terms they imply.
 */
interface MoonlightModel {
    illuminatedFraction: number;
    /** Sun–Moon–observer angle in degrees: 0 = full, 90 = quarter, 180 = new. */
    phaseAngleDeg: number;
    /** SunCalc's 0..1 synodic phase (0 = new, 0.5 = full). */
    synodicPhase: number;
    waxing: boolean;
    altitudeRad: number;
    /** Disk brightness relative to a full moon — ~0.09 at a quarter. */
    oppositionSurge: number;
    /** Inverse-square scale from the current Earth–Moon distance, ~0.90..1.11. */
    distanceFactor: number;
    /** Apparent angular size relative to the mean, ~0.95..1.05. */
    apparentSizeFactor: number;
    airmass: number;
    transmission: number;
    horizonReddening: number;
    /** Ashen light on the dark limb, peaking near new moon. */
    earthshine: number;
    /** Purkinje-shift weight: how far a dim phase should read blue. */
    coolShift: number;
    /** True ratio to a mean-distance full moon at the zenith. */
    physicalIntensityFactor: number;
    /** Tone-mapped version of the above; what renderers should multiply by. */
    intensityFactor: number;
}

/** Result of {@link AstronomyService.update} — scene-space positions plus lighting models. */
interface AstroSnapshot {
    sunPosition: import('three').Vector3;
    moonPosition: import('three').Vector3;
    moonIllumination: { fraction: number; phase: number; angle: number };
    sunrise: Date;
    sunset: Date;
    /** Sun altitude above the horizon in radians (SunCalc's own value). */
    sunAltitude: number;
    moonAltitude: number;
    moonDistanceKm: number;
    sunlight: SunlightModel;
    moonlight: MoonlightModel;
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
    /** European AQI, attached alongside `aqi` on the "current" snapshot. */
    europeanAqi?: number | null;
    /** Pollen load 0..1 (see air-quality.js#getPollenIntensity), drives the pollen motes. */
    pollenIntensity?: number;
}

/** WeatherSnapshot after weather-simulation.js#ensureIntensities() has populated its precipitation intensities. */
interface WeatherSnapshotWithIntensities extends WeatherSnapshot {
    rainIntensity: number;
    snowIntensity: number;
    fogIntensity: number;
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
 * Result of {@link WeatherService.fetchWeather}, assembled in
 * `weather.js#_fetchWeatherOnce` and enriched in `main.js` with air quality,
 * alerts and the 10-day daily forecast once those lazily-loaded pieces
 * arrive. This is `state.weatherData`'s shape.
 */
interface WeatherData {
    location: string | null;
    current: WeatherSnapshot;
    past: WeatherSnapshot;
    forecast: WeatherSnapshot;
    timeline: WeatherSnapshot[];
    sunrise: Date;
    sunset: Date;
    historicalYearAgo: { temp: number; weatherCode: number; description: string; date: string } | null;
    /** Populated by fetchRegionalWeather() when the Nearby tab is opened. */
    regional: Array<{ name: string; temp: number }> | null;
    accuracy: ClockForecastAccuracy | null;
    /** Attached by main.js after the Air Quality API resolves. */
    airQuality?: { usAqi?: number | null; europeanAqi?: number | null; pollen?: Record<string, number | null> } | null;
    /** Attached by main.js after the NWS alerts fetch resolves. */
    alerts?: Array<{ event: string; severity: string; headline: string; description: string }>;
    /** Attached by main.js once the 10-Day Forecast View lazily loads it. */
    dailyForecast?: DailyForecastDay[];
    /** Set when fetchWeather() fell back to a stale cache entry after a fetch failure. */
    isCached?: boolean;
    isOffline?: boolean;
    cachedAt?: number;
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
    /** Relative humidity, 0-100%; null when the API had no coverage for this hour. */
    humidity: number | null;
    /** Mean sea-level pressure, hPa; null when the API had no coverage for this hour. */
    pressure: number | null;
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
    /** Day-mean relative humidity, 0-100%; null when the API had no coverage. */
    humidityAvg: number | null;
    /** Day-mean sea-level pressure, hPa; null when the API had no coverage. */
    pressureAvg: number | null;
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

/** Shared mutable app state owned by main.js and threaded through ModeController/AnimationController. */
interface AppState {
    weatherData: WeatherData | null;
    simulationTime: Date;
    isTimeWarping: boolean;
    isDebugMode: boolean;
    timeSpeed: number;
    reducedMotion: boolean;
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
