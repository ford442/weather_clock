// Central controller for ground/sundial weather reactions: snow accumulation,
// wet-ground reflection, seasonal foliage, and clock-face frost. Owns the
// simulated-time accumulator and pushes uniforms to the ground + sundial
// materials each frame. Heat shimmer lives in the post-processing pipeline and
// is driven directly from animation.js (it isn't a material concern).
import { createAccumulatorState, integrate, getSnowCoverage, getWetness01 } from './weather-accumulator.js';
import { GroundReflectionController } from './ground-reflection.js';
import { SeasonalFoliageSystem } from './seasonal-foliage-system.js';
import { applyGroundPatch, applySnowPatch, applyFrostPatch } from './material-patches.js';
import { ResourceManager } from './cloud-resources.js';

function clamp01(v) {
    return Math.max(0, Math.min(1, v));
}

export class GroundEffects {
    /**
     * @param {THREE.Scene} scene
     * @param {{mesh: THREE.Mesh, material: THREE.Material}} ground
     * @param {{group: THREE.Group, base: THREE.Mesh, face: THREE.Mesh}} sundial
     * @param {THREE.Camera} camera
     * @param {THREE.WebGLRenderer|import('three/webgpu').WebGPURenderer} renderer
     * @param {boolean} isWebGPU
     */
    constructor(scene, ground, sundial, camera, renderer, isWebGPU = false) {
        this.scene = scene;
        this.ground = ground;
        this.sundial = sundial;
        this.camera = camera;
        this.renderer = renderer;
        this.isWebGPU = isWebGPU;

        this.accumulator = createAccumulatorState();
        this.reflection = new GroundReflectionController(scene, ground.mesh.position.y);
        this.foliage = new SeasonalFoliageSystem(scene, 3.6);

        this.reflectionEnabled = true;
        this.latitude = 0;

        this.groundUniforms = null;
        this.baseUniforms = null;
        this.faceUniforms = null;

        this._snowNoiseTexture = ResourceManager.getCloudTexture('cumulus');
    }

    /** Async setup — swaps in WebGPU node materials when needed. Call once after construction. */
    async init() {
        if (this.isWebGPU) {
            const { createGroundMaterialWebGPU } = await import('../webgpu/materials/GroundMaterial.js');
            const { createSnowNodeMaterial, createFrostNodeMaterial } = await import(
                '../webgpu/materials/weather-node-patches.js'
            );

            const groundMat = await createGroundMaterialWebGPU(this._snowNoiseTexture, this.reflection.texture);
            this.ground.material.dispose();
            this.ground.mesh.material = groundMat;
            this.ground.material = groundMat;
            this.groundUniforms = groundMat.userData.groundUniforms;

            const baseMat = await createSnowNodeMaterial(0x8b7355, 0.7, 0.3, this._snowNoiseTexture);
            this.sundial.base.material.dispose();
            this.sundial.base.material = baseMat;
            this.baseUniforms = baseMat.userData.groundUniforms;

            const faceMat = await createFrostNodeMaterial(0xf5f5dc, 0.5, 0.1);
            this.sundial.face.material.dispose();
            this.sundial.face.material = faceMat;
            this.faceUniforms = faceMat.userData.groundUniforms;
        } else {
            this.groundUniforms = applyGroundPatch(this.ground.material, this._snowNoiseTexture);
            this.baseUniforms = applySnowPatch(this.sundial.base.material, this._snowNoiseTexture);
            this.faceUniforms = applyFrostPatch(this.sundial.face.material);
        }
    }

    setLatitude(latitude) {
        this.latitude = latitude ?? 0;
    }

    setQuality(tier, particleDivisor = 1) {
        this.reflectionEnabled = tier !== 'low';
        this.foliage.setQuality(tier, particleDivisor);
    }

    /**
     * @param {{temp?: number, rainIntensity?: number, snowIntensity?: number, windSpeed?: number, windDirection?: number}} currentWeather
     * @param {Date} simulationTime
     * @param {number} delta wall-clock seconds since last frame
     * @param {{sunPosition?: THREE.Vector3}|null} astroData
     */
    update(currentWeather, simulationTime, delta, astroData) {
        integrate(this.accumulator, currentWeather, simulationTime.getTime());
        const snowCoverage = getSnowCoverage(this.accumulator);
        const wetness01 = getWetness01(this.accumulator);

        if (this.groundUniforms) {
            this.groundUniforms.uSnowCoverage.value = snowCoverage;
            if (this.groundUniforms.uWetness) this.groundUniforms.uWetness.value = wetness01;
            if (this.groundUniforms.uReflectionEnabled) {
                this.groundUniforms.uReflectionEnabled.value = this.reflectionEnabled ? 1 : 0;
            }
        }
        if (this.baseUniforms) {
            this.baseUniforms.uSnowCoverage.value = snowCoverage;
        }

        if (!this.isWebGPU) {
            // Cheap, always-on wetness sheen via plain material properties (no shader patch needed).
            const targetRoughness = 0.9 - wetness01 * 0.75;
            const targetMetalness = 0.05 + wetness01 * 0.55;
            this.ground.material.roughness = targetRoughness;
            this.ground.material.metalness = targetMetalness;
        }

        // ── Reflection (medium+ tier, only while ground is meaningfully wet) ──
        if (this.reflectionEnabled && wetness01 > 0.001) {
            this.reflection.render(this.renderer, this.camera, [this.ground.mesh]);
            if (!this.isWebGPU && this.groundUniforms) {
                this.groundUniforms.uReflectionMap.value = this.reflection.texture;
                this.groundUniforms.uTextureMatrix.value = this.reflection.textureMatrix;
            }
        }

        // ── Frost sparkle on the sundial face ──
        if (this.faceUniforms) {
            const temp = currentWeather?.temp ?? 15;
            const coldFactor = clamp01((0 - temp) / 5);
            const sunY = astroData?.sunPosition?.y ?? -10;
            const dawnFactor = clamp01(1 - Math.abs(sunY - 1) / 6);
            this.faceUniforms.uCold.value = coldFactor;
            this.faceUniforms.uDawn.value = dawnFactor;
            if (this.faceUniforms.uFrostTime) {
                this.faceUniforms.uFrostTime.value = performance.now() * 0.001;
            }
        }

        // ── Seasonal foliage ──
        this.foliage.update(
            delta,
            simulationTime,
            this.latitude,
            currentWeather?.windSpeed ?? 0,
            currentWeather?.windDirection ?? 0
        );
    }

    /** Returns whether ground-level heat-shimmer should be active this frame. */
    computeHeatShimmer(currentWeather) {
        const temp = currentWeather?.temp ?? 15;
        const cloudCover = currentWeather?.cloudCover ?? 0;
        const weatherCode = currentWeather?.weatherCode ?? 0;
        const isClear = weatherCode <= 1 && cloudCover < 30;
        const heat = clamp01((temp - 30) / 10);
        const enabled = isClear && heat > 0;
        return { enabled, intensity: heat };
    }

    dispose() {
        this.reflection.dispose();
        this.foliage.dispose();
    }
}
