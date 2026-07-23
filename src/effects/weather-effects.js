import * as THREE from 'three';
import { RainSystem } from './rain-system.js';
import { SnowSystem } from './snow-system.js';
import { WindDustSystem } from './wind-dust-system.js';
import { CloudSystem } from './cloud-system.js';
import { StarField } from './star-field.js';
import { FogEffect } from './fog-effect.js';
import { SplashSystem } from './splash-system.js';
import { LightningBoltSystem } from './lightning-bolt-system.js';

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function inferPrecipType(code, rainIntensity, snowIntensity) {
    if (snowIntensity > rainIntensity && snowIntensity > 0.01) return 'snow';
    if (rainIntensity > 0.01) return 'rain';
    if (code >= 71 && code < 80) return 'snow';
    if ((code >= 51 && code < 71) || (code >= 80 && code < 90) || code >= 95) return 'rain';
    return 'none';
}

/**
 * Normalize a weather snapshot into the bounded values consumed by effects.
 * @param {WeatherSnapshot} [weatherSnap]
 * @param {EffectQuality} [quality]
 * @returns {EffectConfig}
 */
export function buildWeatherEffectConfig(weatherSnap = {}, quality = 'focused') {
    const code = weatherSnap.weatherCode || 0;
    const rain = (weatherSnap.rain || 0) + (weatherSnap.showers || 0);
    const snowfall = weatherSnap.snowfall || 0;
    const rainIntensity = clamp(
        weatherSnap.rainIntensity ??
            (rain > 0 ? rain / 8 : (code >= 51 && code < 71) || code >= 80 ? (code - 50) / 35 : 0),
        0,
        1
    );
    const snowIntensity = clamp(
        weatherSnap.snowIntensity ?? (snowfall > 0 ? snowfall / 4 : code >= 71 && code < 80 ? (code - 70) / 18 : 0),
        0,
        1
    );
    const fogIntensity = clamp(
        weatherSnap.fogIntensity ?? (code === 45 || code === 48 ? 1 : 1 - (weatherSnap.visibility ?? 10000) / 2000),
        0,
        1
    );
    const cloudCover = clamp(weatherSnap.cloudCover ?? 35, 0, 100);
    const precipType = weatherSnap.precipType || inferPrecipType(code, rainIntensity, snowIntensity);
    const particleScale = quality === 'thumbnail' ? 0.18 : quality === 'low' ? 0.45 : quality === 'medium' ? 0.7 : 1;

    return {
        weatherCode: code,
        cloudCover,
        windSpeed: weatherSnap.windSpeed || 0,
        windDir: weatherSnap.windDirection ?? weatherSnap.windDir ?? 0,
        precipType,
        precipIntensity: precipType === 'snow' ? snowIntensity : precipType === 'rain' ? rainIntensity : 0,
        rainIntensity: precipType === 'rain' ? rainIntensity : 0,
        snowIntensity: precipType === 'snow' ? snowIntensity : 0,
        fogIntensity,
        particleScale
    };
}

export function getPrecipitationParticleBudget(quality, isWebGPU = false, divisor = 1) {
    const gpuHighMultiplier = isWebGPU && quality === 'high' ? 5 : 1;
    return {
        rain: Math.floor((2000 * gpuHighMultiplier) / divisor),
        snow: Math.floor((1500 * gpuHighMultiplier) / divisor)
    };
}

export class WeatherEffects {
    constructor(
        scene,
        sundialGroup,
        camera,
        quality = 'high',
        { isWebGPU = false, renderer = null, gpuClasses = null } = {}
    ) {
        this.scene = scene;
        this.sundialGroup = sundialGroup;
        this.starField = new StarField(scene);
        this.camera = camera;
        this._webgpuInitialized = false;
        this.isWebGPU = isWebGPU;
        this.renderer = renderer;
        this.gpuClasses = gpuClasses;
        this.quality = quality;
        this._zones = {
            past: { minX: -12, maxX: -4 },
            current: { minX: -4, maxX: 4 },
            future: { minX: 4, maxX: 12 }
        };

        this.raycaster = new THREE.Raycaster();
        this.downVector = new THREE.Vector3(0, -1, 0);
        this.flashIntensity = 0;
        this._vignetteMode = false;
        this.reducedMotion = false;
        this.lightningTimeoutId = null;

        // Pooled lightning light
        this.lightningLight = new THREE.PointLight(0xaaddff, 5, 50);
        this.lightningLight.visible = false;
        this.scene.add(this.lightningLight);
        this.lightningBolts = new LightningBoltSystem(scene);

        this.splashSystem = isWebGPU ? new gpuClasses.SplashSystem(scene, renderer) : new SplashSystem(scene);
        this._createQualitySystems(this._particleDivisorFor(quality));
    }

    _particleDivisorFor(quality) {
        if (quality === 'low') return 3;
        if (quality === 'medium') return 2;
        return 1;
    }

    _createQualitySystems(divisor) {
        const { rain: rainCount, snow: snowCount } = getPrecipitationParticleBudget(
            this.quality,
            this.isWebGPU,
            divisor
        );
        const cumulusCount = Math.max(1, Math.floor(10 / divisor));
        const stratusCount = Math.max(1, Math.floor(8 / divisor));
        const cirrusCount = Math.max(1, Math.floor(6 / divisor));
        const dustCount = Math.floor(300 / divisor);
        const { past: pastZone, current: currZone, future: futureZone } = this._zones;

        const RainClass = this.isWebGPU ? this.gpuClasses.RainSystem : RainSystem;
        const SnowClass = this.isWebGPU ? this.gpuClasses.SnowSystem : SnowSystem;
        this.pastRain = new RainClass(this.scene, pastZone, rainCount, this.renderer);
        this.pastSnow = new SnowClass(this.scene, pastZone, snowCount, this.renderer);
        this.pastCumulus = new CloudSystem(this.scene, this.camera, pastZone, cumulusCount, 'cumulus');
        this.pastStratus = new CloudSystem(this.scene, this.camera, pastZone, stratusCount, 'stratus');
        this.pastCirrus = new CloudSystem(this.scene, this.camera, pastZone, cirrusCount, 'cirrus');
        this.pastDust = new WindDustSystem(this.scene, pastZone, dustCount);
        this.pastFog = new FogEffect(this.scene, pastZone);

        this.currRain = new RainClass(this.scene, currZone, rainCount, this.renderer);
        this.currSnow = new SnowClass(this.scene, currZone, snowCount, this.renderer);
        this.currRain.setSplashSystem?.(this.splashSystem);
        this.currCumulus = new CloudSystem(this.scene, this.camera, currZone, cumulusCount, 'cumulus');
        this.currStratus = new CloudSystem(this.scene, this.camera, currZone, stratusCount, 'stratus');
        this.currCirrus = new CloudSystem(this.scene, this.camera, currZone, cirrusCount, 'cirrus');
        this.currDust = new WindDustSystem(this.scene, currZone, dustCount);
        this.currFog = new FogEffect(this.scene, currZone);

        this.futureRain = new RainClass(this.scene, futureZone, rainCount, this.renderer);
        this.futureSnow = new SnowClass(this.scene, futureZone, snowCount, this.renderer);
        this.futureCumulus = new CloudSystem(this.scene, this.camera, futureZone, cumulusCount, 'cumulus');
        this.futureStratus = new CloudSystem(this.scene, this.camera, futureZone, stratusCount, 'stratus');
        this.futureCirrus = new CloudSystem(this.scene, this.camera, futureZone, cirrusCount, 'cirrus');
        this.futureDust = new WindDustSystem(this.scene, futureZone, dustCount);
        this.futureFog = new FogEffect(this.scene, futureZone);

        this._pastSystems = [
            this.pastRain,
            this.pastSnow,
            this.pastCumulus,
            this.pastStratus,
            this.pastCirrus,
            this.pastDust,
            this.pastFog
        ];
        this._currSystems = [
            this.currRain,
            this.currSnow,
            this.currCumulus,
            this.currStratus,
            this.currCirrus,
            this.currDust,
            this.currFog
        ];
        this._futureSystems = [
            this.futureRain,
            this.futureSnow,
            this.futureCumulus,
            this.futureStratus,
            this.futureCirrus,
            this.futureDust,
            this.futureFog
        ];
        this._qualitySystems = [...this._pastSystems, ...this._currSystems, ...this._futureSystems];

        if (this._vignetteMode) this.setVignetteMode(true);
    }

    async setQuality(quality, particleDivisor = this._particleDivisorFor(quality)) {
        if (this.quality === quality) return;

        for (const system of this._qualitySystems) system?.dispose?.();
        this.quality = quality;
        this._createQualitySystems(particleDivisor);

        if (this._webgpuInitialized) {
            await this._initWebGPUSystems(this._qualitySystems);
        }
    }

    setReducedMotion(reducedMotion) {
        this.reducedMotion = reducedMotion;
        if (reducedMotion) {
            this.flashIntensity = 0;
            if (this.lightningTimeoutId != null) {
                clearTimeout(this.lightningTimeoutId);
                this.lightningTimeoutId = null;
            }
            this.lightningLight.visible = false;
            for (const bolt of this.lightningBolts?.bolts || []) {
                bolt.life = 0;
                bolt.mesh.visible = false;
            }
        }
    }

    /**
     * Swap all custom-shader materials to WebGPU-compatible equivalents.
     * Called once after renderer detection confirms WebGPU is active.
     */
    async initWebGPU() {
        if (this._webgpuInitialized) return;
        this._webgpuInitialized = true;

        await this._initWebGPUSystems([
            this.starField,
            this.pastRain,
            this.pastSnow,
            this.currRain,
            this.currSnow,
            this.futureRain,
            this.futureSnow,
            this.pastCumulus,
            this.pastStratus,
            this.pastCirrus,
            this.currCumulus,
            this.currStratus,
            this.currCirrus,
            this.futureCumulus,
            this.futureStratus,
            this.futureCirrus,
            this.splashSystem
        ]);
    }

    async _initWebGPUSystems(systems) {
        await Promise.all(systems.map((sys) => sys.initWebGPU?.()).filter(Boolean));
    }

    /**
     * Split total cloudCover into per-type cover values based on weather code.
     * Returns { cumulus, stratus, cirrus } each in 0–100 range.
     *
     * Fractions are meteorologically motivated:
     *  - Cirrus: high-altitude ice crystals, prominent only in fair weather (codes 1–2).
     *    0.55 for code 1 = mostly cirrus at "few clouds"; 0.30 for code 2 = some cirrus mixed in.
     *  - Stratus: layer clouds dominant in overcast/precipitation. 0.35/0.65 split for showers/storms
     *    reflects the stratus anvil base beneath active convection.
     *  - Cumulus: convective clouds. 0.85 for storms = tall cumulonimbus; 0.40 general fallback
     *    for mixed conditions (e.g. drizzle has mostly stratus, only some cumulus).
     */
    _cloudTypeCovers(code, cover, rainIntensity = 0, snowIntensity = 0, fogIntensity = 0) {
        // Cirrus: high-altitude ice-crystal wisps appear only in fair/mostly-clear skies
        let cirrus = 0;
        if (code === 1)
            cirrus = cover * 0.55; // few clouds = mostly high cirrus
        else if (code === 2) cirrus = cover * 0.3; // partly cloudy = some cirrus above cumulus

        // Stratus: low/mid flat layer clouds dominate overcast and precipitation codes
        let stratus = 0;
        if (code === 3)
            stratus = cover; // overcast = full stratus sheet
        else if (fogIntensity > 0)
            stratus = cover * (1.0 - fogIntensity) + 100.0 * fogIntensity; // fog = dense, surface-level stratus
        else if (rainIntensity > 0 || snowIntensity > 0) {
            const pInt = Math.max(rainIntensity, snowIntensity);
            stratus = cover * (0.35 + pInt * 0.65);
        } else if (code >= 45 && code <= 48)
            stratus = 100; // fog = dense, surface-level stratus
        else if (code >= 51 && code <= 77)
            stratus = cover; // drizzle/rain/snow — nimbostratus
        else if (code >= 80 && code <= 82)
            stratus = cover * 0.35; // showers — stratus anvil base (35%)
        else if (code >= 95) stratus = cover * 0.65; // storm — heavy stratus base (65%)

        // Cumulus: convective puffy/towering clouds in fair and active-weather codes
        let cumulus;
        if (code === 0)
            cumulus = 0; // clear sky — no clouds
        else if (code <= 2)
            cumulus = cover; // few/partly — scattered cumulus
        else if (code === 3)
            cumulus = cover * 0.25; // overcast — minimal cumulus remnants
        else if (rainIntensity > 0 || snowIntensity > 0) {
            const pInt = Math.max(rainIntensity, snowIntensity);
            cumulus = cover * (0.4 + pInt * 0.45);
        } else if (code >= 80 && code <= 82)
            cumulus = cover; // showers — active cumulus/congestus
        else if (code >= 95)
            cumulus = cover * 0.85; // storm — towering cumulonimbus (85%)
        else cumulus = cover * 0.4; // other rain — mixed, mostly stratus

        return { cumulus, stratus, cirrus };
    }

    update(past, current, forecast, delta = 0.016, lightColor, sunPos, moonPos, sunColor, moonColor) {
        if (this._vignetteMode) this.setVignetteMode(false);
        if (this.flashIntensity > 0) {
            this.flashIntensity -= delta * 15.0;
            if (this.flashIntensity < 0) this.flashIntensity = 0;
        }

        const extractData = (data) => {
            const rainVal =
                data.rainIntensity !== undefined
                    ? data.rainIntensity
                    : Math.min(1.0, ((data.rain || 0) + (data.showers || 0)) / 5.0);
            const snowVal =
                data.snowIntensity !== undefined ? data.snowIntensity : Math.min(1.0, (data.snowfall || 0) / 3.0);
            const fogVal =
                data.fogIntensity !== undefined
                    ? data.fogIntensity
                    : data.weatherCode === 45 || data.weatherCode === 48
                      ? 1.0
                      : 0.0;
            return {
                rain: rainVal,
                snow: snowVal,
                fog: fogVal,
                cloud: data.cloudCover || 0,
                wind: data.windSpeed || 0,
                dir: data.windDirection || 0,
                code: data.weatherCode || 0
            };
        };

        const p = extractData(past);
        const c = extractData(current);
        const f = extractData(forecast);

        const pCovers = this._cloudTypeCovers(p.code, p.cloud, p.rain, p.snow, p.fog);
        const cCovers = this._cloudTypeCovers(c.code, c.cloud, c.rain, c.snow, c.fog);
        const fCovers = this._cloudTypeCovers(f.code, f.cloud, f.rain, f.snow, f.fog);

        const args = [lightColor, sunPos, moonPos, sunColor, moonColor];

        this.pastRain.update(delta, p.wind, p.dir, p.rain, this.raycaster, null, null, lightColor);
        this.pastSnow.update(delta, p.wind, p.dir, p.snow, lightColor);
        this.pastCumulus.update(delta, p.wind, pCovers.cumulus, ...args, p.code, p.dir);
        this.pastStratus.update(delta, p.wind, pCovers.stratus, ...args, p.code, p.dir);
        this.pastCirrus.update(delta, p.wind, pCovers.cirrus, ...args, p.code, p.dir);
        this.pastDust.update(delta, p.wind, p.dir, p.rain, lightColor);
        this.pastFog.setIntensity(p.fog);
        this.pastFog.update(delta, p.wind, p.dir);

        this.currRain.update(
            delta,
            c.wind,
            c.dir,
            c.rain,
            this.raycaster,
            this.sundialGroup,
            (pos) => this.splashSystem.spawnSplash(pos),
            lightColor
        );
        this.currSnow.update(delta, c.wind, c.dir, c.snow, lightColor);
        this.currCumulus.update(delta, c.wind, cCovers.cumulus, ...args, c.code, c.dir);
        this.currStratus.update(delta, c.wind, cCovers.stratus, ...args, c.code, c.dir);
        this.currCirrus.update(delta, c.wind, cCovers.cirrus, ...args, c.code, c.dir);
        this.currDust.update(delta, c.wind, c.dir, c.rain, lightColor);
        this.currFog.setIntensity(c.fog);
        this.currFog.update(delta, c.wind, c.dir);

        this.futureRain.update(delta, f.wind, f.dir, f.rain, this.raycaster, null, null, lightColor);
        this.futureSnow.update(delta, f.wind, f.dir, f.snow, lightColor);
        this.futureCumulus.update(delta, f.wind, fCovers.cumulus, ...args, f.code, f.dir);
        this.futureStratus.update(delta, f.wind, fCovers.stratus, ...args, f.code, f.dir);
        this.futureCirrus.update(delta, f.wind, fCovers.cirrus, ...args, f.code, f.dir);
        this.futureDust.update(delta, f.wind, f.dir, f.rain, lightColor);
        this.futureFog.setIntensity(f.fog);
        this.futureFog.update(delta, f.wind, f.dir);

        if (sunPos) {
            this.starField.update(sunPos);
        }

        if (p.code >= 95 || c.code >= 95 || f.code >= 95) {
            if (Math.random() < 0.01) {
                this.createLightning();
            }
        }

        this.splashSystem.update(lightColor, delta);
        this.lightningBolts?.update(delta);
    }

    getLightningFlash() {
        return this.flashIntensity;
    }

    createLightning() {
        if (this.reducedMotion) return;
        if (this.flashIntensity > 0.5) return;

        const zone = { minX: -8, maxX: 8 };
        // Reuse pooled light
        this.lightningLight.position.set(
            zone.minX + Math.random() * (zone.maxX - zone.minX),
            10,
            Math.random() * 10 - 5
        );
        this.lightningLight.visible = true;

        this.lightningBolts?.spawnBolt(this.lightningLight.position, 0);

        // Hide after random duration
        this.lightningTimeoutId = setTimeout(
            () => {
                this.lightningLight.visible = false;
                this.lightningTimeoutId = null;
            },
            100 + Math.random() * 100
        );

        this.flashIntensity = 2.0;
    }

    /**
     * Update for a single vignette (forecast day focused view).
     * Drives only the "curr" systems centered around 0 for simplicity.
     */
    updateVignette(
        weatherSnap,
        delta = 0.016,
        lightColor = null,
        sunPos = null,
        moonPos = null,
        sunColor = null,
        moonColor = null
    ) {
        if (!weatherSnap) return;
        if (!this._vignetteMode) this.setVignetteMode(true);
        const cfg = buildWeatherEffectConfig(
            this.ensureIntensitiesForSnap(weatherSnap),
            weatherSnap.quality || this.quality
        );
        const wind = cfg.windSpeed;
        const dir = cfg.windDir;
        const rainI = cfg.rainIntensity * cfg.particleScale;
        const snowI = cfg.snowIntensity * cfg.particleScale;
        const fogI = cfg.fogIntensity;
        const code = cfg.weatherCode;
        const cCover = cfg.cloudCover;

        // Center the curr systems around origin for vignette (they were created with zone)
        // We do not move them every frame; just feed intensity + wind. Visuals stay "local".
        this.currRain.update(
            delta,
            wind,
            dir,
            rainI,
            this.raycaster,
            this.sundialGroup || null,
            (pos) => this.splashSystem.spawnSplash(pos),
            lightColor
        );
        this.currSnow.update(delta, wind, dir, snowI, lightColor);
        const covers = this._cloudTypeCovers(code, cCover, rainI, snowI, fogI);
        const args = [lightColor, sunPos, moonPos, sunColor, moonColor];
        this.currCumulus.update(delta, wind, covers.cumulus, ...args, code, dir);
        this.currStratus.update(delta, wind, covers.stratus, ...args, code, dir);
        this.currCirrus.update(delta, wind, covers.cirrus, ...args, code, dir);
        this.currDust.update(delta, wind, dir, rainI, lightColor);
        this.currFog.setIntensity(fogI);
        this.currFog.update(delta, wind, dir);

        if (sunPos) this.starField.update(sunPos);

        if (code >= 95 && Math.random() < 0.012) this.createLightning();

        this.splashSystem.update(lightColor, delta);
        this.lightningBolts?.update(delta);
    }

    setVignetteMode(enabled) {
        this._vignetteMode = enabled;
        for (const sys of this._pastSystems) sys?.setVisible?.(!enabled);
        for (const sys of this._futureSystems) sys?.setVisible?.(!enabled);
    }

    // lightweight helper (mirrors ensure in weather-simulation)
    ensureIntensitiesForSnap(d) {
        if (!d) return {};
        if (d.rainIntensity != null) return d;
        const code = d.weatherCode || 0;
        let rainI = 0,
            snowI = 0,
            fogI = 0;
        const r = (d.rain || 0) + (d.showers || 0);
        if (r > 0) rainI = Math.min(1, r / 5);
        else if (code >= 51) rainI = Math.min(1, (code - 50) / 30);
        const sn = d.snowfall || 0;
        if (sn > 0) snowI = Math.min(1, sn / 3);
        else if (code >= 71) snowI = Math.min(1, (code - 70) / 20);
        if (code === 45 || code === 48) fogI = 1;
        else if ((d.visibility || 10000) < 2000) fogI = Math.max(0, 1 - (d.visibility || 10000) / 2000);
        return { ...d, rainIntensity: rainI, snowIntensity: snowI, fogIntensity: fogI };
    }

    getParticleMetrics() {
        const rain = [this.pastRain, this.currRain, this.futureRain];
        const snow = [this.pastSnow, this.currSnow, this.futureSnow];
        const sum = (systems, field) => systems.reduce((total, system) => total + (system?.[field] || 0), 0);
        const configuredRain = sum(rain, 'maxParticles');
        const configuredSnow = sum(snow, 'maxParticles');
        const splash =
            this.splashSystem?.maxParticles || this.splashSystem?.mesh?.geometry?.attributes?.life?.count || 0;
        return {
            backend: this.isWebGPU ? 'gpu-compute' : 'cpu',
            simulation: this.isWebGPU
                ? 'gpu-compute'
                : typeof window !== 'undefined'
                  ? window.__NATIVE_BACKENDS__?.particles || 'js'
                  : 'js',
            configured: {
                rain: configuredRain,
                snow: configuredSnow,
                splash,
                total: configuredRain + configuredSnow + splash
            },
            active: { rain: sum(rain, 'activeCount'), snow: sum(snow, 'activeCount') }
        };
    }

    dispose() {
        if (this.lightningTimeoutId != null) {
            clearTimeout(this.lightningTimeoutId);
            this.lightningTimeoutId = null;
        }
        for (const sys of this._qualitySystems) sys?.dispose?.();
        this.starField?.dispose?.();
        this.splashSystem?.dispose?.();
        this.lightningBolts?.dispose?.();
        if (this.lightningLight) {
            this.scene.remove(this.lightningLight);
            this.lightningLight.dispose?.();
            this.lightningLight = null;
        }
    }
}
