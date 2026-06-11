import * as THREE from 'three';
import { RainSystem } from './rain-system.js';
import { SnowSystem } from './snow-system.js';
import { WindDustSystem } from './wind-dust-system.js';
import { CloudSystem } from './cloud-system.js';
import { StarField } from './star-field.js';
import { FogEffect } from './fog-effect.js';
import { SplashSystem } from './splash-system.js';

export class WeatherEffects {
    constructor(scene, sundialGroup, camera, quality = 'high') {
        this.scene = scene;
        this.sundialGroup = sundialGroup;
        this.starField = new StarField(scene);
        this.camera = camera;
        this._webgpuInitialized = false;
        this.quality = quality;

        let divisor = 1;
        if (quality === 'medium') divisor = 2;
        if (quality === 'low') divisor = 3;

        const pastZone = { minX: -12, maxX: -4 };
        const currZone = { minX: -4, maxX: 4 };
        const futureZone = { minX: 4, maxX: 12 };

        const rainCount = Math.floor(2000 / divisor);
        const snowCount = Math.floor(1500 / divisor);
        const cumulusCount = Math.max(1, Math.floor(10 / divisor));
        const stratusCount = Math.max(1, Math.floor(8 / divisor));
        const cirrusCount = Math.max(1, Math.floor(6 / divisor));
        const dustCount = Math.floor(300 / divisor);

        this.pastRain = new RainSystem(scene, pastZone, rainCount);
        this.pastSnow = new SnowSystem(scene, pastZone, snowCount);
        this.pastCumulus = new CloudSystem(scene, camera, pastZone, cumulusCount, 'cumulus');
        this.pastStratus = new CloudSystem(scene, camera, pastZone, stratusCount,  'stratus');
        this.pastCirrus  = new CloudSystem(scene, camera, pastZone, cirrusCount,  'cirrus');
        this.pastDust = new WindDustSystem(scene, pastZone, dustCount);
        this.pastFog = new FogEffect(scene, pastZone);

        this.currRain = new RainSystem(scene, currZone, rainCount);
        this.currSnow = new SnowSystem(scene, currZone, snowCount);
        this.currCumulus = new CloudSystem(scene, camera, currZone, cumulusCount, 'cumulus');
        this.currStratus = new CloudSystem(scene, camera, currZone, stratusCount,  'stratus');
        this.currCirrus  = new CloudSystem(scene, camera, currZone, cirrusCount,  'cirrus');
        this.currDust = new WindDustSystem(scene, currZone, dustCount);
        this.currFog = new FogEffect(scene, currZone);

        this.futureRain = new RainSystem(scene, futureZone, rainCount);
        this.futureSnow = new SnowSystem(scene, futureZone, snowCount);
        this.futureCumulus = new CloudSystem(scene, camera, futureZone, cumulusCount, 'cumulus');
        this.futureStratus = new CloudSystem(scene, camera, futureZone, stratusCount,  'stratus');
        this.futureCirrus  = new CloudSystem(scene, camera, futureZone, cirrusCount,  'cirrus');
        this.futureDust = new WindDustSystem(scene, futureZone, dustCount);
        this.futureFog = new FogEffect(scene, futureZone);

        this.raycaster = new THREE.Raycaster();
        this.downVector = new THREE.Vector3(0, -1, 0);
        this.flashIntensity = 0;
        this.reducedMotion = false;
        this.lightningTimeoutId = null;

        // Pooled lightning light
        this.lightningLight = new THREE.PointLight(0xaaddff, 5, 50);
        this.lightningLight.visible = false;
        this.scene.add(this.lightningLight);

        this.splashSystem = new SplashSystem(scene);
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
        }
    }

    /**
     * Swap all custom-shader materials to WebGPU-compatible equivalents.
     * Called once after renderer detection confirms WebGPU is active.
     */
    async initWebGPU() {
        if (this._webgpuInitialized) return;
        this._webgpuInitialized = true;

        const systems = [
            this.starField,
            this.pastRain, this.currRain, this.futureRain,
            this.pastCumulus, this.pastStratus, this.pastCirrus,
            this.currCumulus, this.currStratus, this.currCirrus,
            this.futureCumulus, this.futureStratus, this.futureCirrus,
            this.splashSystem
        ];

        await Promise.all(
            systems.map(sys => sys.initWebGPU?.()).filter(Boolean)
        );
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
        if (code === 1) cirrus = cover * 0.55;       // few clouds = mostly high cirrus
        else if (code === 2) cirrus = cover * 0.30;  // partly cloudy = some cirrus above cumulus

        // Stratus: low/mid flat layer clouds dominate overcast and precipitation codes
        let stratus = 0;
        if (code === 3)                            stratus = cover;          // overcast = full stratus sheet
        else if (fogIntensity > 0)                 stratus = cover * (1.0 - fogIntensity) + 100.0 * fogIntensity; // fog = dense, surface-level stratus
        else if (rainIntensity > 0 || snowIntensity > 0) {
            const pInt = Math.max(rainIntensity, snowIntensity);
            stratus = cover * (0.35 + pInt * 0.65);
        } else if (code >= 45 && code <= 48)         stratus = 100;            // fog = dense, surface-level stratus
        else if (code >= 51 && code <= 77)         stratus = cover;          // drizzle/rain/snow — nimbostratus
        else if (code >= 80 && code <= 82)         stratus = cover * 0.35;   // showers — stratus anvil base (35%)
        else if (code >= 95)                       stratus = cover * 0.65;   // storm — heavy stratus base (65%)

        // Cumulus: convective puffy/towering clouds in fair and active-weather codes
        let cumulus = 0;
        if (code === 0)                            cumulus = 0;               // clear sky — no clouds
        else if (code <= 2)                        cumulus = cover;           // few/partly — scattered cumulus
        else if (code === 3)                       cumulus = cover * 0.25;    // overcast — minimal cumulus remnants
        else if (rainIntensity > 0 || snowIntensity > 0) {
            const pInt = Math.max(rainIntensity, snowIntensity);
            cumulus = cover * (0.40 + pInt * 0.45);
        } else if (code >= 80 && code <= 82)         cumulus = cover;           // showers — active cumulus/congestus
        else if (code >= 95)                       cumulus = cover * 0.85;    // storm — towering cumulonimbus (85%)
        else                                       cumulus = cover * 0.40;    // other rain — mixed, mostly stratus

        return { cumulus, stratus, cirrus };
    }

    update(past, current, forecast, delta = 0.016, lightColor, sunPos, moonPos, sunColor, moonColor) {
        if (this.flashIntensity > 0) {
            this.flashIntensity -= delta * 15.0;
            if (this.flashIntensity < 0) this.flashIntensity = 0;
        }

        const extractData = (data) => {
            const rainVal = data.rainIntensity !== undefined ? data.rainIntensity : Math.min(1.0, ((data.rain || 0) + (data.showers || 0)) / 5.0);
            const snowVal = data.snowIntensity !== undefined ? data.snowIntensity : Math.min(1.0, (data.snowfall || 0) / 3.0);
            const fogVal = data.fogIntensity !== undefined ? data.fogIntensity : ((data.weatherCode === 45 || data.weatherCode === 48) ? 1.0 : 0.0);
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
        this.pastCumulus.update(delta, p.wind, pCovers.cumulus, ...args, p.code);
        this.pastStratus.update(delta, p.wind, pCovers.stratus, ...args, p.code);
        this.pastCirrus.update(delta,  p.wind, pCovers.cirrus,  ...args, p.code);
        this.pastDust.update(delta, p.wind, p.dir, p.rain, lightColor);
        this.pastFog.setIntensity(p.fog);
        this.pastFog.update(delta, p.wind, p.dir);

        this.currRain.update(delta, c.wind, c.dir, c.rain, this.raycaster, this.sundialGroup, (pos) => this.splashSystem.spawnSplash(pos), lightColor);
        this.currSnow.update(delta, c.wind, c.dir, c.snow, lightColor);
        this.currCumulus.update(delta, c.wind, cCovers.cumulus, ...args, c.code);
        this.currStratus.update(delta, c.wind, cCovers.stratus, ...args, c.code);
        this.currCirrus.update(delta,  c.wind, cCovers.cirrus,  ...args, c.code);
        this.currDust.update(delta, c.wind, c.dir, c.rain, lightColor);
        this.currFog.setIntensity(c.fog);
        this.currFog.update(delta, c.wind, c.dir);

        this.futureRain.update(delta, f.wind, f.dir, f.rain, this.raycaster, null, null, lightColor);
        this.futureSnow.update(delta, f.wind, f.dir, f.snow, lightColor);
        this.futureCumulus.update(delta, f.wind, fCovers.cumulus, ...args, f.code);
        this.futureStratus.update(delta, f.wind, fCovers.stratus, ...args, f.code);
        this.futureCirrus.update(delta,  f.wind, fCovers.cirrus,  ...args, f.code);
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

        this.splashSystem.update(lightColor);
    }

    getLightningFlash() {
        return this.flashIntensity;
    }

    createLightning() {
        if (this.reducedMotion) return;
        if (this.flashIntensity > 0.5) return;

        const zone = { minX: -8, maxX: 8 };
        // Reuse pooled light
        this.lightningLight.position.set(zone.minX + Math.random() * (zone.maxX - zone.minX), 10, Math.random() * 10 - 5);
        this.lightningLight.visible = true;

        // Hide after random duration
        this.lightningTimeoutId = setTimeout(() => {
            this.lightningLight.visible = false;
            this.lightningTimeoutId = null;
        }, 100 + Math.random() * 100);

        this.flashIntensity = 2.0;
    }
}
