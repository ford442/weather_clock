import * as THREE from 'three';
import { RainSystem } from './rain-system.js';
import { SnowSystem } from './snow-system.js';
import { WindDustSystem } from './wind-dust-system.js';
import { PollenSystem } from './pollen-system.js';
import { CloudSystem } from './cloud-system.js';
import { StarField } from './star-field.js';
import { FogEffect } from './fog-effect.js';
import { SplashSystem } from './splash-system.js';
import { LightningBoltSystem } from './lightning-bolt-system.js';
import { SCENE_LAYOUT } from '../scene-layout.js';
import { TemporalBand } from './temporal-band.js';
import { computeTemporalNarrative } from '../temporal-narrative.js';
import { getHumidityHaze } from '../moisture-pressure.js';

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
    /**
     * @param {THREE.Scene} scene
     * @param {THREE.Group} sundialGroup
     * @param {THREE.Camera} camera
     * @param {EffectQuality} [quality]
     * @param {{isWebGPU?: boolean, renderer?: THREE.WebGPURenderer|null, gpuClasses?: {SplashSystem: new (...args: any[]) => any, RainSystem: new (...args: any[]) => any, SnowSystem: new (...args: any[]) => any}|null}} [options]
     */
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
        this._zones = SCENE_LAYOUT.zones;

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
        // Backdrop that carries the past→present→future temperature story.
        /** @type {TemporalBand|null} */
        this.temporalBand = quality === 'thumbnail' ? null : new TemporalBand(scene);
        /** @type {import('../temporal-narrative.js').TemporalNarrative|null} */
        this.narrative = null;

        // isWebGPU true implies gpuClasses was supplied by the caller.
        this.splashSystem = isWebGPU
            ? new /** @type {NonNullable<typeof gpuClasses>} */ (gpuClasses).SplashSystem(scene, renderer)
            : new SplashSystem(scene);
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
        // Pollen motes are a "nice to have": skipped entirely on the cheapest tiers.
        const pollenCount = this.quality === 'low' || this.quality === 'thumbnail' ? 0 : Math.floor(60 / divisor);
        const { past: pastZone, current: currZone, future: futureZone } = this._zones;

        // this.isWebGPU true implies this.gpuClasses was supplied by the caller (see constructor).
        const gpuClasses = /** @type {NonNullable<typeof this.gpuClasses>} */ (this.gpuClasses);
        const RainClass = this.isWebGPU ? gpuClasses.RainSystem : RainSystem;
        const SnowClass = this.isWebGPU ? gpuClasses.SnowSystem : SnowSystem;
        this.pastRain = new RainClass(this.scene, pastZone, rainCount, this.renderer);
        this.pastSnow = new SnowClass(this.scene, pastZone, snowCount, this.renderer);
        /** @type {CloudSystem} */
        this.pastCumulus = new CloudSystem(this.scene, this.camera, pastZone, cumulusCount, 'cumulus');
        /** @type {CloudSystem} */
        this.pastStratus = new CloudSystem(this.scene, this.camera, pastZone, stratusCount, 'stratus');
        /** @type {CloudSystem} */
        this.pastCirrus = new CloudSystem(this.scene, this.camera, pastZone, cirrusCount, 'cirrus');
        /** @type {WindDustSystem} */
        this.pastDust = new WindDustSystem(this.scene, pastZone, dustCount);
        /** @type {FogEffect} */
        this.pastFog = new FogEffect(this.scene, pastZone);

        this.currRain = new RainClass(this.scene, currZone, rainCount, this.renderer);
        this.currSnow = new SnowClass(this.scene, currZone, snowCount, this.renderer);
        this.currRain.setSplashSystem?.(this.splashSystem);
        /** @type {CloudSystem} */
        this.currCumulus = new CloudSystem(this.scene, this.camera, currZone, cumulusCount, 'cumulus');
        /** @type {CloudSystem} */
        this.currStratus = new CloudSystem(this.scene, this.camera, currZone, stratusCount, 'stratus');
        /** @type {CloudSystem} */
        this.currCirrus = new CloudSystem(this.scene, this.camera, currZone, cirrusCount, 'cirrus');
        /** @type {WindDustSystem} */
        this.currDust = new WindDustSystem(this.scene, currZone, dustCount);
        /** @type {FogEffect} */
        this.currFog = new FogEffect(this.scene, currZone);
        /** @type {PollenSystem|null} */
        this.currPollen = pollenCount > 0 ? new PollenSystem(this.scene, currZone, pollenCount) : null;

        this.futureRain = new RainClass(this.scene, futureZone, rainCount, this.renderer);
        this.futureSnow = new SnowClass(this.scene, futureZone, snowCount, this.renderer);
        /** @type {CloudSystem} */
        this.futureCumulus = new CloudSystem(this.scene, this.camera, futureZone, cumulusCount, 'cumulus');
        /** @type {CloudSystem} */
        this.futureStratus = new CloudSystem(this.scene, this.camera, futureZone, stratusCount, 'stratus');
        /** @type {CloudSystem} */
        this.futureCirrus = new CloudSystem(this.scene, this.camera, futureZone, cirrusCount, 'cirrus');
        /** @type {WindDustSystem} */
        this.futureDust = new WindDustSystem(this.scene, futureZone, dustCount);
        /** @type {FogEffect} */
        this.futureFog = new FogEffect(this.scene, futureZone);

        /** @type {any[]} */
        this._pastSystems = [
            this.pastRain,
            this.pastSnow,
            this.pastCumulus,
            this.pastStratus,
            this.pastCirrus,
            this.pastDust,
            this.pastFog
        ];
        /** @type {any[]} */
        this._currSystems = [
            this.currRain,
            this.currSnow,
            this.currCumulus,
            this.currStratus,
            this.currCirrus,
            this.currDust,
            this.currFog,
            this.currPollen
        ].filter(Boolean);
        /** @type {any[]} */
        this._futureSystems = [
            this.futureRain,
            this.futureSnow,
            this.futureCumulus,
            this.futureStratus,
            this.futureCirrus,
            this.futureDust,
            this.futureFog
        ];
        /** @type {any[]} */
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
     * Point the night sky at an observer — date, location, and how much cloud is
     * washing the stars out. Forwarded straight to the star field, which decides
     * how much of the work actually needs redoing this frame.
     * @param {{date?: Date|number|string, latitude?: number|null, longitude?: number|null, cloudCover?: number|null}} observer
     */
    setSkyObserver(observer) {
        this.starField?.setObserver?.(observer);
    }

    /**
     * Toggle the optional night-sky overlays so the sky can stay uncluttered.
     * @param {{constellations?: boolean, planets?: boolean, labels?: boolean, lightPollution?: number}} options
     */
    setSkyLayers({ constellations, planets, labels, lightPollution } = {}) {
        if (constellations !== undefined) this.starField?.setConstellationsVisible?.(constellations);
        if (planets !== undefined) this.starField?.setPlanetsVisible?.(planets);
        if (labels !== undefined) this.starField?.setLabelsVisible?.(labels);
        if (lightPollution !== undefined) this.starField?.setLightPollution?.(lightPollution);
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
     *
     * `humidityHaze` (0..1, see moisture-pressure.js) nudges the split toward flatter
     * stratus and away from puffy cumulus — muggy air reads hazier, not fluffier.
     */
    _cloudTypeCovers(code, cover, rainIntensity = 0, snowIntensity = 0, fogIntensity = 0, humidityHaze = 0) {
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

        // Muggy air biases the split toward stratus — a small, continuous shift,
        // not a hard override of the weather-code-driven split above.
        if (humidityHaze > 0) {
            const shift = cover * humidityHaze * 0.15;
            stratus = Math.min(100, stratus + shift);
            cumulus = Math.max(0, cumulus - shift);
        }

        return { cumulus, stratus, cirrus };
    }

    /**
     * Push each zone's slice of the narrative into that zone's cloud systems, so the
     * departing/arriving drift and the blue-vs-red temperature tint are consistent
     * across every cloud layer.
     * @param {import('../temporal-narrative.js').TemporalNarrative} narrative
     */
    _applyNarrative(narrative) {
        this.pastCumulus?.setNarrative(narrative.past);
        this.pastStratus?.setNarrative(narrative.past);
        this.pastCirrus?.setNarrative(narrative.past);
        this.currCumulus?.setNarrative(narrative.current);
        this.currStratus?.setNarrative(narrative.current);
        this.currCirrus?.setNarrative(narrative.current);
        this.futureCumulus?.setNarrative(narrative.future);
        this.futureStratus?.setNarrative(narrative.future);
        this.futureCirrus?.setNarrative(narrative.future);
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
                code: data.weatherCode || 0,
                humidityHaze: getHumidityHaze(data.humidity)
            };
        };

        const p = extractData(past);
        const c = extractData(current);
        const f = extractData(forecast);

        // Temporal narrative: time flows leftward, temperature reads as colour.
        const narrative = computeTemporalNarrative(past, current, forecast, {
            dayFactor: sunPos ? Math.max(-1, Math.min(1, sunPos.y / 20)) : 0
        });
        this.narrative = narrative;
        this._applyNarrative(narrative);
        this.temporalBand?.update(narrative, delta);

        const pCovers = this._cloudTypeCovers(p.code, p.cloud, p.rain, p.snow, p.fog, p.humidityHaze);
        const cCovers = this._cloudTypeCovers(c.code, c.cloud, c.rain, c.snow, c.fog, c.humidityHaze);
        const fCovers = this._cloudTypeCovers(f.code, f.cloud, f.rain, f.snow, f.fog, f.humidityHaze);

        const args = [lightColor, sunPos, moonPos, sunColor, moonColor];

        this.pastRain.update(delta, p.wind, p.dir, p.rain, this.raycaster, null, null, lightColor);
        this.pastSnow.update(delta, p.wind, p.dir, p.snow, lightColor);
        this.pastCumulus.update(delta, p.wind, pCovers.cumulus, ...args, p.code, p.dir, p.humidityHaze);
        this.pastStratus.update(delta, p.wind, pCovers.stratus, ...args, p.code, p.dir, p.humidityHaze);
        this.pastCirrus.update(delta, p.wind, pCovers.cirrus, ...args, p.code, p.dir, p.humidityHaze);
        this.pastDust.update(delta, p.wind, p.dir, p.rain, lightColor);
        this.pastFog.setHaze(p.humidityHaze);
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
        this.currCumulus.update(delta, c.wind, cCovers.cumulus, ...args, c.code, c.dir, c.humidityHaze);
        this.currStratus.update(delta, c.wind, cCovers.stratus, ...args, c.code, c.dir, c.humidityHaze);
        this.currCirrus.update(delta, c.wind, cCovers.cirrus, ...args, c.code, c.dir, c.humidityHaze);
        this.currDust.update(delta, c.wind, c.dir, c.rain, lightColor);
        this.currFog.setHaze(c.humidityHaze);
        this.currFog.setIntensity(c.fog);
        this.currFog.update(delta, c.wind, c.dir);
        this.currPollen?.update(delta, current?.pollenIntensity ?? 0, c.wind, c.dir, c.rain, lightColor);

        this.futureRain.update(delta, f.wind, f.dir, f.rain, this.raycaster, null, null, lightColor);
        this.futureSnow.update(delta, f.wind, f.dir, f.snow, lightColor);
        this.futureCumulus.update(delta, f.wind, fCovers.cumulus, ...args, f.code, f.dir, f.humidityHaze);
        this.futureStratus.update(delta, f.wind, fCovers.stratus, ...args, f.code, f.dir, f.humidityHaze);
        this.futureCirrus.update(delta, f.wind, fCovers.cirrus, ...args, f.code, f.dir, f.humidityHaze);
        this.futureDust.update(delta, f.wind, f.dir, f.rain, lightColor);
        this.futureFog.setHaze(f.humidityHaze);
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

    getSceneLayout() {
        return SCENE_LAYOUT;
    }

    createLightning() {
        if (this.reducedMotion) return;
        if (this.flashIntensity > 0.5) return;

        const zone = SCENE_LAYOUT.lightning;
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
        const humidityHaze = getHumidityHaze(weatherSnap.humidity);

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
        const covers = this._cloudTypeCovers(code, cCover, rainI, snowI, fogI, humidityHaze);
        const args = [lightColor, sunPos, moonPos, sunColor, moonColor];
        this.currCumulus.update(delta, wind, covers.cumulus, ...args, code, dir, humidityHaze);
        this.currStratus.update(delta, wind, covers.stratus, ...args, code, dir, humidityHaze);
        this.currCirrus.update(delta, wind, covers.cirrus, ...args, code, dir, humidityHaze);
        this.currDust.update(delta, wind, dir, rainI, lightColor);
        this.currPollen?.update(delta, weatherSnap.pollenIntensity ?? 0, wind, dir, rainI, lightColor);
        this.currFog.setHaze(humidityHaze);
        this.currFog.setIntensity(fogI);
        this.currFog.update(delta, wind, dir);

        if (sunPos) this.starField.update(sunPos);

        if (code >= 95 && Math.random() < 0.012) this.createLightning();

        this.splashSystem.update(lightColor, delta);
        this.lightningBolts?.update(delta);
    }

    setVignetteMode(enabled) {
        this._vignetteMode = enabled;
        this.temporalBand?.setVisible(!enabled);
        if (enabled) {
            // A single-day vignette has no past/future zones to narrate.
            for (const cloud of [this.currCumulus, this.currStratus, this.currCirrus]) {
                cloud?.setNarrative({ drift: 0, tint: [1, 1, 1] });
            }
        }
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
        this.temporalBand?.dispose?.();
        this.temporalBand = null;
        if (this.lightningLight) {
            this.scene.remove(this.lightningLight);
            this.lightningLight.dispose?.();
            this.lightningLight = null;
        }
    }
}
