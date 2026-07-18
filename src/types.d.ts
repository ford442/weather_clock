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
