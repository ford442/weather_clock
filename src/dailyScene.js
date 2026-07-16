import * as THREE from 'three';
import { updateSingleWeatherLighting, getSeverity, deriveDailyAtmosphere } from './weatherLighting.js';
import { AstronomyService } from './astronomy.js';
import { buildWeatherEffectConfig } from './effects/weather-effects.js';

const DEFAULT_LOCATION = { lat: 40.7128, lon: -74.006 };

const QUALITY_PRESETS = {
    thumbnail: {
        particleDeltaScale: 0.55,
        groundRadius: 9,
        horizonRadius: 11,
        animateEveryMs: 66
    },
    focused: {
        particleDeltaScale: 1,
        groundRadius: 14,
        horizonRadius: 18,
        animateEveryMs: 0
    }
};

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function getDayDate(day) {
    if (day?.date instanceof Date) return new Date(day.date);
    if (typeof day?.date === 'string') return new Date(`${day.date}T00:00:00`);
    return new Date();
}

function getWindDirection(input) {
    return input?.windDirection ?? input?.windDir ?? input?.wind_direction_10m_dominant ?? 0;
}

function weatherCodeImpliesRain(code) {
    return (code >= 51 && code < 71) || (code >= 80 && code < 90) || code >= 95;
}

function weatherCodeImpliesSnow(code) {
    return code >= 71 && code < 80;
}

export function getDailyScenePreset(quality = 'focused') {
    return QUALITY_PRESETS[quality] || QUALITY_PRESETS.focused;
}

export function getRepresentativeTimeForDailyScene(day, astronomyService, lat, lon, representativeTime = null) {
    if (representativeTime instanceof Date) return new Date(representativeTime);
    if (typeof representativeTime === 'string' || typeof representativeTime === 'number') {
        const parsed = new Date(representativeTime);
        if (Number.isFinite(parsed.getTime())) return parsed;
    }

    const baseDate = getDayDate(day);
    const today = new Date();
    const sameLocalDay =
        baseDate.getFullYear() === today.getFullYear() &&
        baseDate.getMonth() === today.getMonth() &&
        baseDate.getDate() === today.getDate();

    if (sameLocalDay) {
        const contextual = new Date(baseDate);
        contextual.setHours(today.getHours(), today.getMinutes(), today.getSeconds(), 0);
        return contextual;
    }

    return astronomyService.getSolarNoon(baseDate, lat, lon);
}

export function buildDailySceneSnapshot(day, representativeTime = null) {
    const source = day || {};
    const hour = representativeTime instanceof Date ? representativeTime.getHours() : 12;
    const hourly =
        Array.isArray(source.hourly) && source.hourly.length
            ? source.hourly.reduce((best, item) => {
                  const itemDate = item?.time ? new Date(item.time) : null;
                  const itemHour = itemDate && Number.isFinite(itemDate.getTime()) ? itemDate.getHours() : hour;
                  const bestDate = best?.time ? new Date(best.time) : null;
                  const bestHour = bestDate && Number.isFinite(bestDate.getTime()) ? bestDate.getHours() : hour;
                  return Math.abs(itemHour - hour) < Math.abs(bestHour - hour) ? item : best;
              }, source.hourly[0])
            : {};

    const weatherCode = source.weatherCode ?? hourly.weatherCode ?? 0;
    const cloudCover = clamp(hourly.cloudCover ?? source.cloudCover ?? source.meanCloudCover ?? 35, 0, 100);
    const windSpeed = hourly.windSpeed ?? source.windSpeed ?? source.windSpeedMax ?? 0;
    const windDirection = getWindDirection(hourly) || getWindDirection(source);
    const visibility = hourly.visibility ?? source.visibility ?? 10000;
    const precipSum = source.precipSum ?? source.precipitationSum ?? hourly.precipitation ?? 0;
    const rain = source.rainSum ?? hourly.rain ?? (weatherCodeImpliesRain(weatherCode) ? precipSum : 0);
    const showers = source.showersSum ?? hourly.showers ?? 0;
    const snowfall = source.snowfallSum ?? hourly.snowfall ?? (weatherCodeImpliesSnow(weatherCode) ? precipSum : 0);

    const rainIntensity = clamp((rain + showers) / 8 + (weatherCodeImpliesRain(weatherCode) ? 0.18 : 0), 0, 1);
    const snowIntensity = clamp(snowfall / 4 + (weatherCodeImpliesSnow(weatherCode) ? 0.25 : 0), 0, 1);
    const fogIntensity = weatherCode === 45 || weatherCode === 48 ? 1 : clamp(1 - visibility / 2000, 0, 1);

    return {
        weatherCode,
        cloudCover,
        windSpeed,
        windDirection,
        visibility,
        temp: hourly.temp ?? source.tempMax ?? source.temperature ?? null,
        severity: getSeverity(weatherCode),
        rain,
        showers,
        snowfall,
        rainIntensity,
        snowIntensity,
        fogIntensity,
        effectConfig: buildWeatherEffectConfig({
            weatherCode,
            cloudCover,
            windSpeed,
            windDirection,
            visibility,
            rain,
            showers,
            snowfall,
            rainIntensity,
            snowIntensity,
            fogIntensity
        })
    };
}

export class DailyScene {
    constructor(options = {}) {
        this.scene = options.scene;
        this.sky = options.sky || null;
        this.sundial = options.sundial || null;
        this.moonGroup = options.moonGroup || null;
        this.weatherEffects = options.weatherEffects || null;
        this.sunLight = options.sunLight || null;
        this.moonLight = options.moonLight || null;
        this.ambientLight = options.ambientLight || null;
        this.astronomyService = options.astronomyService || new AstronomyService();
        this.lat = options.lat ?? DEFAULT_LOCATION.lat;
        this.lon = options.lon ?? DEFAULT_LOCATION.lon;
        this.quality = options.quality || 'focused';
        this.preset = getDailyScenePreset(this.quality);
        this.enabled = false;
        this.day = null;
        this.representativeTime = null;
        this.snapshot = null;
        this._lastAnimatedAt = 0;
        this._ownedObjects = [];

        if (this.scene) {
            this.groundGroup = this._createGround();
            this.groundGroup.visible = false;
            this.scene.add(this.groundGroup);
            this._ownedObjects.push(this.groundGroup);
        }
    }

    setLocation(lat, lon) {
        this.lat = lat ?? this.lat;
        this.lon = lon ?? this.lon;
    }

    setQuality(quality) {
        this.quality = quality;
        this.preset = getDailyScenePreset(quality);
    }

    setDay(day, options = {}) {
        this.day = day;
        this.setLocation(options.lat, options.lon);
        this.representativeTime = getRepresentativeTimeForDailyScene(
            day,
            this.astronomyService,
            this.lat,
            this.lon,
            options.representativeTime
        );
        if (typeof options.hour === 'number') {
            this.setHour(options.hour);
        } else {
            this.snapshot = buildDailySceneSnapshot(day, this.representativeTime);
        }
        return this.snapshot;
    }

    setHour(hour) {
        const base = getDayDate(this.day);
        const clampedHour = clamp(hour, 0, 23.99);
        base.setHours(Math.floor(clampedHour), Math.floor((clampedHour % 1) * 60), 0, 0);
        this.representativeTime = base;
        this.snapshot = buildDailySceneSnapshot(this.day, this.representativeTime);
        return this.representativeTime;
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        if (this.groundGroup) this.groundGroup.visible = enabled;
        this.weatherEffects?.setVignetteMode?.(enabled);
    }

    update(delta = 0.016) {
        if (!this.enabled || !this.day) return null;

        const now = performance.now?.() ?? Date.now();
        if (this.preset.animateEveryMs && now - this._lastAnimatedAt < this.preset.animateEveryMs) {
            return this.snapshot;
        }
        this._lastAnimatedAt = now;

        const astro = this.astronomyService.getPositionsForDate(this.representativeTime, this.lat, this.lon, 20);
        const baseSnap = this.snapshot || buildDailySceneSnapshot(this.day, this.representativeTime);
        const snap = {
            ...baseSnap,
            quality: this.quality,
            effectConfig: buildWeatherEffectConfig(baseSnap, this.quality),
            atmosphere: deriveDailyAtmosphere(baseSnap, astro, {
                date: this.representativeTime,
                lat: this.lat
            })
        };

        if (this.sunLight) this.sunLight.position.copy(astro.sunPosition);
        if (this.moonLight) this.moonLight.position.copy(astro.moonPosition);
        if (this.moonGroup) {
            this.moonGroup.position.copy(astro.moonPosition);
            this.moonGroup.lookAt(0, 0, 0);
        }

        updateSingleWeatherLighting(
            this.scene,
            this.sunLight,
            this.moonLight,
            this.ambientLight,
            this.sky,
            snap,
            astro
        );

        this.weatherEffects?.updateVignette?.(
            snap,
            delta * this.preset.particleDeltaScale,
            this.ambientLight?.color || null,
            this.sunLight?.position || null,
            this.moonLight?.position || null,
            this.sunLight?.color || null,
            this.moonLight?.color || null
        );

        this.sundial?.update?.(this.representativeTime);
        return snap;
    }

    getSnapshot() {
        return this.snapshot;
    }

    dispose() {
        this.setEnabled(false);
        for (const object of this._ownedObjects) {
            this.scene?.remove(object);
            object.traverse?.((child) => {
                child.geometry?.dispose?.();
                const material = child.material;
                if (Array.isArray(material)) {
                    material.forEach((m) => m?.dispose?.());
                } else {
                    material?.dispose?.();
                }
            });
        }
        this._ownedObjects = [];
    }

    _createGround() {
        const group = new THREE.Group();

        const ground = new THREE.Mesh(
            new THREE.CircleGeometry(this.preset.groundRadius, 96),
            new THREE.MeshStandardMaterial({
                color: 0x314532,
                roughness: 0.92,
                metalness: 0.02
            })
        );
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -0.18;
        ground.receiveShadow = true;
        group.add(ground);

        const horizon = new THREE.Mesh(
            new THREE.RingGeometry(this.preset.groundRadius * 0.78, this.preset.horizonRadius, 96),
            new THREE.MeshBasicMaterial({
                color: 0x203321,
                transparent: true,
                opacity: 0.32,
                depthWrite: false,
                side: THREE.DoubleSide
            })
        );
        horizon.rotation.x = -Math.PI / 2;
        horizon.position.y = -0.16;
        group.add(horizon);

        return group;
    }
}

export default DailyScene;
