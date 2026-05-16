import * as THREE from 'three';
import { ResourceManager } from './cloud-resources.js';
import { cloudShaderInjection } from '../shaders.js';
import { ParticleSystemBase } from './particle-base.js';

export class CloudSystem extends ParticleSystemBase {
    /**
     * @param {string} cloudType  'cumulus' | 'stratus' | 'cirrus'
     */
    constructor(scene, camera, zone, maxClouds = 12, cloudType = 'cumulus') {
        super(scene);
        this.currentCloudCover = 0;
        this.camera = camera;
        this.maxClouds = maxClouds;
        this.cloudType = cloudType;
        this.zone = zone || { minX: -12, maxX: 12 };

        // Puff counts and scale ranges per cloud type
        const typeConfig = {
            cumulus: { puffsPerCloud: 10, scaleMin: 2.0, scaleMax: 4.0,
                       yMin: 6,  yRange: 4,  windMult: 1.0, bobAmp: 0.07 },
            stratus: { puffsPerCloud: 5,  scaleMin: 4.5, scaleMax: 7.5,
                       yMin: 4,  yRange: 2,  windMult: 0.6, bobAmp: 0.04 },
            cirrus:  { puffsPerCloud: 4,  scaleMin: 3.5, scaleMax: 5.5,
                       yMin: 12, yRange: 4,  windMult: 1.8, bobAmp: 0.015 }
        };
        const cfg = typeConfig[cloudType] || typeConfig.cumulus;
        this.cfg = cfg;
        this.puffsPerCloud = cfg.puffsPerCloud;
        this.totalInstances = maxClouds * this.puffsPerCloud;

        const map = ResourceManager.getCloudTexture(cloudType);
        this.material = new THREE.MeshBasicMaterial({
            map: map,
            transparent: true,
            opacity: 0.0,
            depthWrite: false,
            side: THREE.DoubleSide
        });

        // Inject Volumetric Shader Logic
        this.material.onBeforeCompile = cloudShaderInjection.onBeforeCompile;

        const geometry = new THREE.PlaneGeometry(1, 1);
        this.mesh = new THREE.InstancedMesh(geometry, this.material, this.totalInstances);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

        // Enable per-instance colors for depth shading (bright top, shadowed bottom)
        const whiteColor = new THREE.Color(1, 1, 1);
        for (let i = 0; i < this.totalInstances; i++) {
            this.mesh.setColorAt(i, whiteColor);
        }
        if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

        this.scene.add(this.mesh);

        this.clouds = [];
        this.dummy = new THREE.Object3D();
        // Reusable quaternion for puff spin
        this._spinQuat = new THREE.Quaternion();
        this._spinAxis = new THREE.Vector3(0, 0, 1);
        // Reusable color for instance color writes
        this._puffColor = new THREE.Color();

        for (let i = 0; i < maxClouds; i++) {
            this.addCloud();
        }

        // Hide all instances initially
        for (let i = 0; i < this.totalInstances; i++) {
            this.dummy.position.set(0, -1000, 0);
            this.dummy.updateMatrix();
            this.mesh.setMatrixAt(i, this.dummy.matrix);
        }
        this.mesh.instanceMatrix.needsUpdate = true;
        this.mesh.visible = true;
    }

    addCloud() {
        const startIndex = this.clouds.length * this.puffsPerCloud;
        const indices = Array.from({ length: this.puffsPerCloud }, (_, i) => startIndex + i);
        const { scaleMin, scaleMax, yMin, yRange } = this.cfg;

        const cloud = {
            x: this.zone.minX + Math.random() * (this.zone.maxX - this.zone.minX),
            y: yMin + Math.random() * yRange,
            z: Math.random() * 10 - 5,
            scale: scaleMin + Math.random() * (scaleMax - scaleMin),
            indices,
            puffs: this._createPuffs(),
            floatOffset: Math.random() * Math.PI * 2   // for gentle vertical bob
        };
        this.clouds.push(cloud);
    }

    _createPuffs() {
        const count = this.puffsPerCloud;
        const puffs = [];

        if (this.cloudType === 'cumulus') {
            // Dome arrangement: 3 tiers — base ring, middle ring, top cap
            // Tier 0: 3 puffs at base, wide spread
            const tier0 = [[0, 120, 240], 0.90, 0.00, [0.65, 0.85]];
            // Tier 1: 4 puffs in middle, medium spread
            const tier1 = [[30, 120, 210, 300], 0.62, 0.35, [0.72, 0.95]];
            // Tier 2: 2 puffs upper, tighter
            const tier2 = [[60, 220], 0.35, 0.60, [0.55, 0.72]];
            // Tier 3: 1 apex puff
            const tier3 = [[0], 0.00, 0.80, [0.45, 0.62]];

            for (const [angles, radius, yOff, [sMin, sMax]] of [tier0, tier1, tier2, tier3]) {
                for (const deg of angles) {
                    const a = (deg + (Math.random() - 0.5) * 25) * Math.PI / 180;
                    puffs.push({
                        x: Math.cos(a) * radius + (Math.random() - 0.5) * 0.15,
                        y: yOff + (Math.random() - 0.5) * 0.18,
                        z: Math.sin(a) * radius * 0.55 + (Math.random() - 0.5) * 0.15,
                        scale: sMin + Math.random() * (sMax - sMin),
                        rotation: Math.random() * Math.PI,
                        rotSpeed: (Math.random() - 0.5) * 0.04,
                        // colorT: 0=bottom-shadow, 1=top-bright
                        colorT: 0.2 + yOff * 0.7
                    });
                }
            }
        } else if (this.cloudType === 'stratus') {
            // Wide, flat arrangement: 5 puffs in a horizontal strip
            for (let i = 0; i < count; i++) {
                const t = (i / (count - 1)) - 0.5; // -0.5 to +0.5
                puffs.push({
                    x: t * 2.8 + (Math.random() - 0.5) * 0.4,
                    y: (Math.random() - 0.5) * 0.15,
                    z: (Math.random() - 0.5) * 0.55,
                    scale: 1.0 + Math.random() * 0.65,
                    rotation: Math.random() * Math.PI,
                    rotSpeed: (Math.random() - 0.5) * 0.015,
                    colorT: 0.45 + Math.random() * 0.25  // stratus is mid-grey, darker at bottom
                });
            }
        } else if (this.cloudType === 'cirrus') {
            // Elongated streak: 4 puffs in a diagonal line
            for (let i = 0; i < count; i++) {
                const t = (i / (count - 1)) - 0.5; // -0.5 to +0.5
                puffs.push({
                    x: t * 3.8 + (Math.random() - 0.5) * 0.25,
                    y: t * 0.12 + (Math.random() - 0.5) * 0.08,  // slight diagonal
                    z: (Math.random() - 0.5) * 0.22,
                    scale: 0.28 + Math.random() * 0.38,
                    rotation: Math.random() * Math.PI,
                    rotSpeed: (Math.random() - 0.5) * 0.025,
                    colorT: 0.80 + Math.random() * 0.20  // cirrus is near-white, very bright
                });
            }
        }

        return puffs;
    }

    update(delta, windSpeed, cloudCover, lightColor, sunPos, moonPos, sunColor, moonColor, weatherCode = 0) {
        // Update global lighting uniforms (shared across all cloud systems)
        if (lightColor) cloudShaderInjection.uniforms.uAmbientColor.value.copy(lightColor);
        if (sunPos)     cloudShaderInjection.uniforms.uSunPosition.value.copy(sunPos);
        if (moonPos)    cloudShaderInjection.uniforms.uMoonPosition.value.copy(moonPos);
        if (sunColor)   cloudShaderInjection.uniforms.uSunColor.value.copy(sunColor);
        if (moonColor)  cloudShaderInjection.uniforms.uMoonColor.value.copy(moonColor);

        // Derive a storm darkness factor (0=clear, 1=heavy storm)
        const isStorm = weatherCode >= 95;
        const isRain  = weatherCode >= 51 && weatherCode < 95;
        const stormFactor = isStorm ? 1.0 : isRain ? 0.5 : 0.0;

        // Smooth cloud cover transition
        const smoothFactor = Math.min(1.0, delta * 1.0);
        this.currentCloudCover += (cloudCover - this.currentCloudCover) * smoothFactor;

        let targetOp = 0;
        let activeClouds = 0;

        if (this.currentCloudCover > 10) {
            targetOp = Math.min(0.9, this.currentCloudCover / 100.0);
            activeClouds = Math.floor((this.currentCloudCover / 100.0) * this.maxClouds);
        }
        if (this.currentCloudCover > 80) targetOp = Math.max(targetOp, 0.6);

        // Stratus/storm clouds are more opaque
        if (this.cloudType === 'stratus' && stormFactor > 0) {
            targetOp = Math.min(0.92, targetOp * (1.0 + stormFactor * 0.35));
        }

        const opacity = this.updateOpacity(delta, targetOp);
        this.material.opacity = opacity;

        if (opacity <= 0.01) {
            this.mesh.visible = false;
            return;
        }
        this.mesh.visible = true;

        const camQuat = this.camera.quaternion;
        const time = Date.now() * 0.001;
        const { windMult } = this.cfg;

        // Instance color: top = white, bottom = shadow tinted by stormFactor
        // Storm tops are darker overall
        const topR = 1.0 - stormFactor * 0.35;
        const topG = 1.0 - stormFactor * 0.30;
        const topB = 1.0 - stormFactor * 0.20;
        const botR = (this.cloudType === 'stratus' ? 0.62 : 0.70) - stormFactor * 0.22;
        const botG = (this.cloudType === 'stratus' ? 0.65 : 0.73) - stormFactor * 0.20;
        const botB = (this.cloudType === 'stratus' ? 0.78 : 0.85) - stormFactor * 0.18;

        let instanceColorDirty = false;

        for (let i = 0; i < this.clouds.length; i++) {
            const cloud = this.clouds[i];

            // Move cloud horizontally (cirrus faster, stratus slower)
            const moveSpeed = (0.05 + windSpeed * 0.01) * delta * windMult;
            cloud.x += moveSpeed;
            if (cloud.x > this.zone.maxX) cloud.x = this.zone.minX;
            if (cloud.x < this.zone.minX) cloud.x = this.zone.maxX;

            // Gentle vertical bob (amplitude comes from per-type config)
            const bob = Math.sin(time * 0.28 + cloud.floatOffset) * this.cfg.bobAmp;

            const isVisible = i < activeClouds;

            cloud.indices.forEach((idx, j) => {
                if (isVisible) {
                    const puff = cloud.puffs[j];
                    // Animate puff rotation slowly
                    puff.rotation += puff.rotSpeed * delta;

                    this.dummy.position.set(
                        cloud.x + puff.x * cloud.scale * 0.5,
                        cloud.y + bob + puff.y * cloud.scale * 0.5,
                        cloud.z + puff.z * cloud.scale * 0.5
                    );
                    // Billboard to camera, then apply puff spin in screen space
                    this.dummy.quaternion.copy(camQuat);
                    this._spinQuat.setFromAxisAngle(this._spinAxis, puff.rotation);
                    this.dummy.quaternion.multiply(this._spinQuat);
                    this.dummy.scale.setScalar(puff.scale * cloud.scale);
                    this.dummy.updateMatrix();
                    this.mesh.setMatrixAt(idx, this.dummy.matrix);

                    // Per-puff depth color: lerp between bottom shadow and top highlight
                    const t = puff.colorT;
                    this._puffColor.setRGB(
                        botR + (topR - botR) * t,
                        botG + (topG - botG) * t,
                        botB + (topB - botB) * t
                    );
                    this.mesh.setColorAt(idx, this._puffColor);
                    instanceColorDirty = true;
                } else {
                    this.dummy.position.set(0, -1000, 0);
                    this.dummy.updateMatrix();
                    this.mesh.setMatrixAt(idx, this.dummy.matrix);
                }
            });
        }
        this.mesh.instanceMatrix.needsUpdate = true;
        if (instanceColorDirty && this.mesh.instanceColor) {
            this.mesh.instanceColor.needsUpdate = true;
        }
    }
}
