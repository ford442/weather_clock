import * as THREE from 'three';
import { RainSystem } from './rain-system.js';
import { SnowSystem } from './snow-system.js';
import { WindDustSystem } from './wind-dust-system.js';
import { CloudSystem } from './cloud-system.js';
import { StarField } from './star-field.js';
import { FogEffect } from './fog-effect.js';
import { SplashSystem } from './splash-system.js';

export class WeatherEffects {
    constructor(scene, sundialGroup, camera) {
        this.scene = scene;
        this.sundialGroup = sundialGroup;
        this.starField = new StarField(scene);
        this.camera = camera;

        const pastZone = { minX: -12, maxX: -4 };
        const currZone = { minX: -4, maxX: 4 };
        const futureZone = { minX: 4, maxX: 12 };

        this.pastRain = new RainSystem(scene, pastZone, 2000);
        this.pastSnow = new SnowSystem(scene, pastZone, 1500);
        this.pastCumulus = new CloudSystem(scene, camera, pastZone, 10, 'cumulus');
        this.pastStratus = new CloudSystem(scene, camera, pastZone, 8,  'stratus');
        this.pastCirrus  = new CloudSystem(scene, camera, pastZone, 6,  'cirrus');
        this.pastDust = new WindDustSystem(scene, pastZone, 300);
        this.pastFog = new FogEffect(scene, pastZone);

        this.currRain = new RainSystem(scene, currZone, 2000);
        this.currSnow = new SnowSystem(scene, currZone, 1500);
        this.currCumulus = new CloudSystem(scene, camera, currZone, 10, 'cumulus');
        this.currStratus = new CloudSystem(scene, camera, currZone, 8,  'stratus');
        this.currCirrus  = new CloudSystem(scene, camera, currZone, 6,  'cirrus');
        this.currDust = new WindDustSystem(scene, currZone, 300);
        this.currFog = new FogEffect(scene, currZone);

        this.futureRain = new RainSystem(scene, futureZone, 2000);
        this.futureSnow = new SnowSystem(scene, futureZone, 1500);
        this.futureCumulus = new CloudSystem(scene, camera, futureZone, 10, 'cumulus');
        this.futureStratus = new CloudSystem(scene, camera, futureZone, 8,  'stratus');
        this.futureCirrus  = new CloudSystem(scene, camera, futureZone, 6,  'cirrus');
        this.futureDust = new WindDustSystem(scene, futureZone, 300);
        this.futureFog = new FogEffect(scene, futureZone);

        this.raycaster = new THREE.Raycaster();
        this.downVector = new THREE.Vector3(0, -1, 0);
        this.flashIntensity = 0;

        // Pooled lightning light
        this.lightningLight = new THREE.PointLight(0xaaddff, 5, 50);
        this.lightningLight.visible = false;
        this.scene.add(this.lightningLight);

        this.splashSystem = new SplashSystem(scene);
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
    _cloudTypeCovers(code, cover) {
        // Cirrus: high-altitude ice-crystal wisps appear only in fair/mostly-clear skies
        let cirrus = 0;
        if (code === 1) cirrus = cover * 0.55;       // few clouds = mostly high cirrus
        else if (code === 2) cirrus = cover * 0.30;  // partly cloudy = some cirrus above cumulus

        // Stratus: low/mid flat layer clouds dominate overcast and precipitation codes
        let stratus = 0;
        if (code === 3)                            stratus = cover;          // overcast = full stratus sheet
        else if (code >= 45 && code <= 48)         stratus = 100;            // fog = dense, surface-level stratus
        else if (code >= 51 && code <= 77)         stratus = cover;          // drizzle/rain/snow — nimbostratus
        else if (code >= 80 && code <= 82)         stratus = cover * 0.35;   // showers — stratus anvil base (35%)
        else if (code >= 95)                       stratus = cover * 0.65;   // storm — heavy stratus base (65%)

        // Cumulus: convective puffy/towering clouds in fair and active-weather codes
        let cumulus = 0;
        if (code === 0)                            cumulus = 0;               // clear sky — no clouds
        else if (code <= 2)                        cumulus = cover;           // few/partly — scattered cumulus
        else if (code === 3)                       cumulus = cover * 0.25;    // overcast — minimal cumulus remnants
        else if (code >= 80 && code <= 82)         cumulus = cover;           // showers — active cumulus/congestus
        else if (code >= 95)                       cumulus = cover * 0.85;    // storm — towering cumulonimbus (85%)
        else                                       cumulus = cover * 0.40;    // other rain — mixed, mostly stratus

        return { cumulus, stratus, cirrus };
    }

    update(past, current, forecast, delta = 0.016, lightColor, sunPos, moonPos, sunColor, moonColor) {
        if (this.flashIntensity > 0) {
            this.flashIntensity -= delta * 15.0;
            if (this.flashIntensity < 0) this.flashIntensity = 0;
        }

        const extractData = (data) => ({
            rain: (data.rain || 0) + (data.showers || 0),
            snow: (data.snowfall || 0),
            cloud: data.cloudCover || 0,
            wind: data.windSpeed || 0,
            dir: data.windDirection || 0,
            code: data.weatherCode || 0
        });

        const p = extractData(past);
        const c = extractData(current);
        const f = extractData(forecast);

        const pCovers = this._cloudTypeCovers(p.code, p.cloud);
        const cCovers = this._cloudTypeCovers(c.code, c.cloud);
        const fCovers = this._cloudTypeCovers(f.code, f.cloud);

        const args = [lightColor, sunPos, moonPos, sunColor, moonColor];

        const fogIntensity = (code) => (code === 45 || code === 48) ? 1.0 : 0.0;

        this.pastRain.update(delta, p.wind, p.dir, p.rain, this.raycaster, null, null, lightColor);
        this.pastSnow.update(delta, p.wind, p.dir, p.snow, lightColor);
        this.pastCumulus.update(delta, p.wind, pCovers.cumulus, ...args, p.code);
        this.pastStratus.update(delta, p.wind, pCovers.stratus, ...args, p.code);
        this.pastCirrus.update(delta,  p.wind, pCovers.cirrus,  ...args, p.code);
        this.pastDust.update(delta, p.wind, p.dir, p.rain, lightColor);
        this.pastFog.setIntensity(fogIntensity(p.code));
        this.pastFog.update(delta, p.wind, p.dir);

        this.currRain.update(delta, c.wind, c.dir, c.rain, this.raycaster, this.sundialGroup, (pos) => this.splashSystem.spawnSplash(pos), lightColor);
        this.currSnow.update(delta, c.wind, c.dir, c.snow, lightColor);
        this.currCumulus.update(delta, c.wind, cCovers.cumulus, ...args, c.code);
        this.currStratus.update(delta, c.wind, cCovers.stratus, ...args, c.code);
        this.currCirrus.update(delta,  c.wind, cCovers.cirrus,  ...args, c.code);
        this.currDust.update(delta, c.wind, c.dir, c.rain, lightColor);
        this.currFog.setIntensity(fogIntensity(c.code));
        this.currFog.update(delta, c.wind, c.dir);

        this.futureRain.update(delta, f.wind, f.dir, f.rain, this.raycaster, null, null, lightColor);
        this.futureSnow.update(delta, f.wind, f.dir, f.snow, lightColor);
        this.futureCumulus.update(delta, f.wind, fCovers.cumulus, ...args, f.code);
        this.futureStratus.update(delta, f.wind, fCovers.stratus, ...args, f.code);
        this.futureCirrus.update(delta,  f.wind, fCovers.cirrus,  ...args, f.code);
        this.futureDust.update(delta, f.wind, f.dir, f.rain, lightColor);
        this.futureFog.setIntensity(fogIntensity(f.code));
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
        if (this.flashIntensity > 0.5) return;

        const zone = { minX: -8, maxX: 8 };
        // Reuse pooled light
        this.lightningLight.position.set(zone.minX + Math.random() * (zone.maxX - zone.minX), 10, Math.random() * 10 - 5);
        this.lightningLight.visible = true;

        // Hide after random duration
        setTimeout(() => {
            this.lightningLight.visible = false;
        }, 100 + Math.random() * 100);

        this.flashIntensity = 2.0;
    }
}
