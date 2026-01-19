import * as THREE from 'three';
import {
    rainVertexShader, rainFragmentShader,
    splashVertexShader, splashFragmentShader,
    cloudShaderInjection
} from './shaders.js';

function createCloudTexture() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, size, size);

    // Advanced "Fluffy" Noise generation
    const cx = size/2;
    const cy = size/2;
    const puffs = 80; // Increased for more density

    // Create a radial gradient for the base shape to ensure edges fade to zero
    const baseGrad = context.createRadialGradient(cx, cy, size * 0.1, cx, cy, size * 0.45);
    baseGrad.addColorStop(0, 'rgba(255, 255, 255, 0.2)');
    baseGrad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
    context.fillStyle = baseGrad;
    context.fillRect(0,0,size,size);

    for (let i = 0; i < puffs; i++) {
        const angle = Math.random() * Math.PI * 2;
        // Cluster more near center
        const dist = Math.pow(Math.random(), 0.6) * (size * 0.35);
        const px = cx + Math.cos(angle) * dist;
        const py = cy + Math.sin(angle) * dist;

        const r = size * (0.05 + Math.random() * 0.15);

        const grad = context.createRadialGradient(px, py, 0, px, py, r);
        const opacity = 0.05 + Math.random() * 0.15;

        // Use slight off-white for depth in texture
        const val = 245 + Math.random() * 10;

        grad.addColorStop(0, `rgba(${val}, ${val}, ${val}, ${opacity})`);
        grad.addColorStop(0.4, `rgba(${val}, ${val}, ${val}, ${opacity * 0.6})`);
        grad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');

        context.fillStyle = grad;
        context.beginPath();
        context.arc(px, py, r, 0, Math.PI * 2);
        context.fill();
    }

    // Add noise
    const imgData = context.getImageData(0,0,size,size);
    const data = imgData.data;

    for(let i=0; i<data.length; i+=4) {
        if(data[i+3] > 0) {
             const noise = (Math.random() - 0.5) * 20;
             data[i] = Math.max(0, Math.min(255, data[i] + noise));
             data[i+1] = Math.max(0, Math.min(255, data[i+1] + noise));
             data[i+2] = Math.max(0, Math.min(255, data[i+2] + noise));
        }
    }
    context.putImageData(imgData, 0, 0);

    return new THREE.CanvasTexture(canvas);
}

// Helper for JS-side smoothstep
function smoothstep(min, max, value) {
  var x = Math.max(0, Math.min(1, (value-min)/(max-min)));
  return x*x*(3 - 2*x);
}

function curlNoise(x, y, z, time) {
    const eps = 0.1;
    const n = (a, b, c) => Math.sin(a * 0.5 + time) * Math.cos(b * 0.3 + time) * Math.sin(c * 0.5);
    const dx = n(x, y + eps, z) - n(x, y - eps, z);
    const dy = n(x - eps, y, z) - n(x + eps, y, z);
    const dz = Math.sin(x * 0.1 + time);
    return new THREE.Vector3(dx * 0.5, 0, dy * 0.5);
}

class ParticleSystemBase {
    constructor(scene) {
        this.scene = scene;
        this.isActive = true;
        this.targetOpacity = 0.0;
        this.currentOpacity = 0.0;
        this.fadeSpeed = 0.2;
    }

    updateOpacity(delta, target) {
        this.targetOpacity = target;
        if (this.currentOpacity < this.targetOpacity) {
            this.currentOpacity += delta * this.fadeSpeed;
            if (this.currentOpacity > this.targetOpacity) this.currentOpacity = this.targetOpacity;
        } else if (this.currentOpacity > this.targetOpacity) {
            this.currentOpacity -= delta * this.fadeSpeed;
            if (this.currentOpacity < this.targetOpacity) this.currentOpacity = this.targetOpacity;
        }
        return this.currentOpacity;
    }
}

class RainSystem extends ParticleSystemBase {
    constructor(scene, zone, maxParticles = 1500) {
        super(scene);
        this.maxParticles = maxParticles;
        this.zone = zone || { minX: -8, maxX: 8 };

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(maxParticles * 6);
        const velocities = new Float32Array(maxParticles * 3);
        const states = new Int8Array(maxParticles);

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: new THREE.Color(0x88ccff) },
                uOpacity: { value: 0.0 }
            },
            vertexShader: rainVertexShader,
            fragmentShader: rainFragmentShader,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide
        });

        this.mesh = new THREE.LineSegments(geometry, material);
        this.scene.add(this.mesh);

        this.velocities = velocities;
        this.states = states;

        for (let i = 0; i < maxParticles; i++) {
            this.resetParticle(i, true);
        }
        this.mesh.visible = true;
    }

    resetParticle(i, randomY = false) {
        const i3 = i * 3;
        const i6 = i * 6;
        const positions = this.mesh.geometry.attributes.position.array;

        const x = this.zone.minX + Math.random() * (this.zone.maxX - this.zone.minX);
        const y = randomY ? (Math.random() * 20 - 5) : (15 + Math.random() * 5);
        const z = Math.random() * 10 - 5;

        this.velocities[i3] = 0;
        this.velocities[i3 + 1] = -0.2 - Math.random() * 0.1;
        this.velocities[i3 + 2] = 0;

        positions[i6] = x;
        positions[i6 + 1] = y + 0.5;
        positions[i6 + 2] = z;
        positions[i6 + 3] = x;
        positions[i6 + 4] = y;
        positions[i6 + 5] = z;

        this.states[i] = 0;
    }

    update(delta, windSpeed, windDir, intensity, raycaster, sundialGroup, spawnSplashCallback, lightColor) {
        if (lightColor) {
            this.mesh.material.uniforms.uColor.value.copy(lightColor);
        }

        let targetOp = 0;
        let activeCount = 0;

        if (intensity > 0.01) {
            targetOp = Math.min(0.9, 0.3 + intensity * 0.2);
            activeCount = Math.min(this.maxParticles, Math.floor(intensity * 1000));
            if (activeCount < 50) activeCount = 50;
            if (activeCount > this.maxParticles) activeCount = this.maxParticles;
        }

        const opacity = this.updateOpacity(delta, targetOp);
        this.mesh.material.uniforms.uOpacity.value = opacity;

        if (opacity <= 0.01) {
            this.mesh.visible = false;
            return;
        }
        this.mesh.visible = true;

        this.mesh.geometry.setDrawRange(0, activeCount * 2);

        const positions = this.mesh.geometry.attributes.position.array;
        const rad = (90 - windDir) * Math.PI / 180;
        const speedScale = 0.005;
        const targetWindX = Math.cos(rad) * windSpeed * speedScale;
        const targetWindZ = -Math.sin(rad) * windSpeed * speedScale;

        for (let i = 0; i < activeCount; i++) {
            const i3 = i * 3;
            const i6 = i * 6;

            if (this.states[i] === 0) {
                this.velocities[i3] += (targetWindX - this.velocities[i3]) * 0.1;
                this.velocities[i3+2] += (targetWindZ - this.velocities[i3+2]) * 0.1;

                const vx = this.velocities[i3];
                const vy = this.velocities[i3+1];
                const vz = this.velocities[i3+2];

                positions[i6+3] += vx;
                positions[i6+4] += vy;
                positions[i6+5] += vz;

                const streak = 3.0;
                positions[i6] = positions[i6+3] - vx * streak;
                positions[i6+1] = positions[i6+4] - vy * streak;
                positions[i6+2] = positions[i6+5] - vz * streak;

                if (positions[i6+3] > this.zone.maxX) {
                    const w = this.zone.maxX - this.zone.minX;
                    positions[i6+3] -= w; positions[i6] -= w;
                } else if (positions[i6+3] < this.zone.minX) {
                    const w = this.zone.maxX - this.zone.minX;
                    positions[i6+3] += w; positions[i6] += w;
                }

                const headY = positions[i6+4];
                if (headY > -1 && headY < 4) {
                    if (sundialGroup) {
                        const headX = positions[i6+3];
                        const headZ = positions[i6+5];
                        const distSq = headX*headX + headZ*headZ;

                        if (distSq < 10.6) {
                            const dist = Math.sqrt(distSq);
                            let surfaceY = -100;

                            // Sundial Geometry Check (see src/sundial.js)
                            // Face: r=2.8, y=0.2 (cylinder top is at y=0.2 due to position.y=0.2 and height=0.1?? No)
                            // Base: r=3.2, height=0.3. Top at y=0.15.
                            // Face: height=0.1. Pos y=0.2. So Top is at 0.2 + 0.05 = 0.25. Bottom at 0.15.
                            // Base: height=0.3. Pos y=0 (default). Top at 0.15.

                            // Accurate collision layers:
                            if (dist < 2.8) {
                                surfaceY = 0.25; // Hit Clock Face
                            } else if (dist < 3.0) {
                                surfaceY = 0.15; // Hit Base Top
                            } else if (dist < 3.2) {
                                // Hit Base Slope (approximate)
                                surfaceY = 0.15 - ((dist - 3.0) / 0.2) * 0.3;
                            }

                            if (surfaceY > -99 && headY < surfaceY) {
                                if(spawnSplashCallback) spawnSplashCallback(new THREE.Vector3(headX, surfaceY, headZ));
                                this.resetParticle(i);
                                continue;
                            }
                        }
                    }
                }

                if (headY < -5) this.resetParticle(i);
            }
        }
        this.mesh.geometry.attributes.position.needsUpdate = true;
    }
}

class SnowSystem extends ParticleSystemBase {
    constructor(scene, zone, maxParticles = 1000) {
        super(scene);
        this.maxParticles = maxParticles;
        this.zone = zone || { minX: -8, maxX: 8 };

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(maxParticles * 3);
        const velocities = new Float32Array(maxParticles * 3);
        const offsets = new Float32Array(maxParticles);

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 0.15,
            transparent: true,
            opacity: 0.0,
            map: createCloudTexture(),
            depthWrite: false
        });

        this.mesh = new THREE.Points(geometry, material);
        this.scene.add(this.mesh);

        this.velocities = velocities;
        this.offsets = offsets;

        const posAttr = this.mesh.geometry.attributes.position.array;
        for (let i = 0; i < maxParticles; i++) {
            posAttr[i*3] = this.zone.minX + Math.random() * (this.zone.maxX - this.zone.minX);
            posAttr[i*3+1] = Math.random() * 15;
            posAttr[i*3+2] = Math.random() * 20 - 10;

            this.velocities[i*3] = 0;
            this.velocities[i*3+1] = -0.02 - Math.random() * 0.03;
            this.velocities[i*3+2] = 0;

            this.offsets[i] = Math.random() * 100;
        }
        this.mesh.visible = true;
    }

    update(delta, windSpeed, windDir, intensity, lightColor) {
        if (lightColor) {
            this.mesh.material.color.copy(lightColor);
        }

        let targetOp = 0;
        let activeCount = 0;

        if (intensity > 0.01) {
            targetOp = Math.min(0.9, 0.3 + intensity * 0.3);
            activeCount = Math.min(this.maxParticles, Math.floor(intensity * 1000));
            if (activeCount < 50) activeCount = 50;
            if (activeCount > this.maxParticles) activeCount = this.maxParticles;
        }

        const opacity = this.updateOpacity(delta, targetOp);
        this.mesh.material.opacity = opacity;

        if (opacity <= 0.01) {
            this.mesh.visible = false;
            return;
        }
        this.mesh.visible = true;
        this.mesh.geometry.setDrawRange(0, activeCount);

        const positions = this.mesh.geometry.attributes.position.array;
        const time = Date.now() * 0.001;

        const rad = (90 - windDir) * Math.PI / 180;
        const speedScale = 0.002;
        const wX = Math.cos(rad) * windSpeed * speedScale;
        const wZ = -Math.sin(rad) * windSpeed * speedScale;

        for (let i = 0; i < activeCount; i++) {
            const i3 = i * 3;
            const px = positions[i3];
            const py = positions[i3+1];
            const pz = positions[i3+2];

            const curl = curlNoise(px * 0.1, py * 0.1, pz * 0.1, time + this.offsets[i] * 0.01);

            positions[i3] += this.velocities[i3] + wX + curl.x * 0.05;
            positions[i3+1] += this.velocities[i3+1] + curl.y * 0.05;
            positions[i3+2] += this.velocities[i3+2] + wZ + curl.z * 0.05;

            if (positions[i3] > this.zone.maxX) positions[i3] -= (this.zone.maxX - this.zone.minX);
            if (positions[i3] < this.zone.minX) positions[i3] += (this.zone.maxX - this.zone.minX);

            if (positions[i3+1] < -5) {
                positions[i3+1] = 15;
                positions[i3] = this.zone.minX + Math.random() * (this.zone.maxX - this.zone.minX);
            }
        }
        this.mesh.geometry.attributes.position.needsUpdate = true;
    }
}

class CloudSystem extends ParticleSystemBase {
    constructor(scene, camera, zone, maxClouds = 20) {
        super(scene);
        this.camera = camera;
        this.maxClouds = maxClouds;
        this.puffsPerCloud = 8;
        this.totalInstances = maxClouds * this.puffsPerCloud;
        this.zone = zone || { minX: -12, maxX: 12 };

        const map = createCloudTexture();
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
        this.scene.add(this.mesh);

        this.clouds = [];
        this.dummy = new THREE.Object3D();

        for(let i=0; i<maxClouds; i++) {
            this.addCloud();
        }

        for(let i=0; i<this.totalInstances; i++) {
             this.dummy.position.set(0, -1000, 0);
             this.dummy.updateMatrix();
             this.mesh.setMatrixAt(i, this.dummy.matrix);
        }
        this.mesh.instanceMatrix.needsUpdate = true;
        this.mesh.visible = true;
    }

    addCloud() {
        const startIndex = this.clouds.length * this.puffsPerCloud;
        const indices = [];
        for(let i=0; i<this.puffsPerCloud; i++) indices.push(startIndex + i);

        const cloud = {
            x: this.zone.minX + Math.random() * (this.zone.maxX - this.zone.minX),
            y: 6 + Math.random() * 4,
            z: Math.random() * 10 - 5,
            scale: 2.0 + Math.random() * 2.0,
            indices: indices,
            puffs: []
        };

        for(let i=0; i<this.puffsPerCloud; i++) {
            cloud.puffs.push({
                x: (Math.random() - 0.5) * 2,
                y: (Math.random() - 0.5) * 1,
                z: (Math.random() - 0.5) * 2,
                scale: 0.5 + Math.random() * 0.5,
                rotation: Math.random() * Math.PI
            });
        }
        this.clouds.push(cloud);
    }

    update(delta, windSpeed, cloudCover, lightColor, sunPos, moonPos, sunColor, moonColor) {
        // We now update uniforms instead of just color
        if (this.material.userData.shader) { // Shader might not be compiled yet
            // Wait, we used shared uniforms object in cloudShaderInjection
            // So we can just update those values directly!
            // BUT we must be careful if we have multiple cloud systems sharing the same uniform object reference.
            // If they share `cloudShaderInjection.uniforms`, updating it updates ALL of them.
            // That's actually desired since sun/moon are global.
            // However, `uCloudColor` might need to be instance specific or per-system.
            // In the injection, I used `uCloudColor`.

            // Actually, lightColor passed here is the Ambient tint.
            // We should use that for `uCloudColor` or `uAmbientColor`.
            if (lightColor) cloudShaderInjection.uniforms.uAmbientColor.value.copy(lightColor);
            if (sunPos) cloudShaderInjection.uniforms.uSunPosition.value.copy(sunPos);
            if (moonPos) cloudShaderInjection.uniforms.uMoonPosition.value.copy(moonPos);
            if (sunColor) cloudShaderInjection.uniforms.uSunColor.value.copy(sunColor);
            if (moonColor) cloudShaderInjection.uniforms.uMoonColor.value.copy(moonColor);
        }

        let targetOp = 0;
        let activeClouds = 0;

        if (cloudCover > 10) {
            targetOp = Math.min(0.9, cloudCover / 100.0);
            activeClouds = Math.floor((cloudCover / 100.0) * this.maxClouds);
        }

        if (cloudCover > 80) targetOp = Math.max(targetOp, 0.6);

        const opacity = this.updateOpacity(delta, targetOp);
        this.material.opacity = opacity;

        if (opacity <= 0.01) {
            this.mesh.visible = false;
            return;
        }
        this.mesh.visible = true;

        const camQuat = this.camera.quaternion;

        for (let i = 0; i < this.clouds.length; i++) {
            const cloud = this.clouds[i];

            const moveSpeed = (0.05 + windSpeed * 0.01) * delta;
            cloud.x += moveSpeed;
            if (cloud.x > this.zone.maxX) cloud.x = this.zone.minX;
            if (cloud.x < this.zone.minX) cloud.x = this.zone.maxX;

            const isVisible = i < activeClouds;

            cloud.indices.forEach((idx, j) => {
                if (isVisible) {
                    const puff = cloud.puffs[j];
                    this.dummy.position.set(
                        cloud.x + puff.x * cloud.scale * 0.5,
                        cloud.y + puff.y * cloud.scale * 0.5,
                        cloud.z + puff.z * cloud.scale * 0.5
                    );
                    this.dummy.quaternion.copy(camQuat);
                    this.dummy.scale.setScalar(puff.scale * cloud.scale);
                    this.dummy.updateMatrix();
                    this.mesh.setMatrixAt(idx, this.dummy.matrix);
                } else {
                    this.dummy.position.set(0, -1000, 0);
                    this.dummy.updateMatrix();
                    this.mesh.setMatrixAt(idx, this.dummy.matrix);
                }
            });
        }
        this.mesh.instanceMatrix.needsUpdate = true;
    }
}

export class WeatherEffects {
    constructor(scene, sundialGroup, camera) {
        this.scene = scene;
        this.sundialGroup = sundialGroup;
        this.camera = camera;

        const pastZone = { minX: -12, maxX: -4 };
        const currZone = { minX: -4, maxX: 4 };
        const futureZone = { minX: 4, maxX: 12 };

        this.pastRain = new RainSystem(scene, pastZone, 2000);
        this.pastSnow = new SnowSystem(scene, pastZone, 1500);
        this.pastCloud = new CloudSystem(scene, camera, pastZone, 20);

        this.currRain = new RainSystem(scene, currZone, 2000);
        this.currSnow = new SnowSystem(scene, currZone, 1500);
        this.currCloud = new CloudSystem(scene, camera, currZone, 20);

        this.futureRain = new RainSystem(scene, futureZone, 2000);
        this.futureSnow = new SnowSystem(scene, futureZone, 1500);
        this.futureCloud = new CloudSystem(scene, camera, futureZone, 20);

        this.raycaster = new THREE.Raycaster();
        this.downVector = new THREE.Vector3(0, -1, 0);
        this.flashIntensity = 0;
        this.createSplashes();
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

        this.pastRain.update(delta, p.wind, p.dir, p.rain, this.raycaster, null, null, lightColor);
        this.pastSnow.update(delta, p.wind, p.dir, p.snow, lightColor);
        this.pastCloud.update(delta, p.wind, p.cloud, lightColor, sunPos, moonPos, sunColor, moonColor);

        this.currRain.update(delta, c.wind, c.dir, c.rain, this.raycaster, this.sundialGroup, (pos) => this.spawnSplash(pos), lightColor);
        this.currSnow.update(delta, c.wind, c.dir, c.snow, lightColor);
        this.currCloud.update(delta, c.wind, c.cloud, lightColor, sunPos, moonPos, sunColor, moonColor);

        this.futureRain.update(delta, f.wind, f.dir, f.rain, this.raycaster, null, null, lightColor);
        this.futureSnow.update(delta, f.wind, f.dir, f.snow, lightColor);
        this.futureCloud.update(delta, f.wind, f.cloud, lightColor, sunPos, moonPos, sunColor, moonColor);

        if (p.code >= 95 || c.code >= 95 || f.code >= 95) {
             if (Math.random() < 0.01) {
                 this.createLightning();
             }
        }

        this.updateSplashes(lightColor);
    }

    getLightningFlash() {
        return this.flashIntensity;
    }

    createLightning() {
        if (this.flashIntensity > 0.5) return;

        const zone = { minX: -8, maxX: 8 };
        const flash = new THREE.PointLight(0xaaddff, 5, 50);
        flash.position.set(zone.minX + Math.random() * (zone.maxX - zone.minX), 10, Math.random() * 10 - 5);
        this.scene.add(flash);
        setTimeout(() => this.scene.remove(flash), 100 + Math.random()*100);
        this.flashIntensity = 2.0;
    }

    createSplashes() {
        const particleCount = 1000;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const life = new Float32Array(particleCount);

        for(let i=0; i<particleCount*3; i++) positions[i] = -100;
        for(let i=0; i<particleCount; i++) life[i] = 0;

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('life', new THREE.BufferAttribute(life, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: new THREE.Color(0xffffff) }
            },
            vertexShader: splashVertexShader,
            fragmentShader: splashFragmentShader,
            transparent: true,
            depthWrite: false
        });

        this.splashSystem = new THREE.Points(geometry, material);
        this.splashSystem.frustumCulled = false;
        this.scene.add(this.splashSystem);
    }

    spawnSplash(pos) {
        const positions = this.splashSystem.geometry.attributes.position.array;
        const life = this.splashSystem.geometry.attributes.life.array;

        for(let i=0; i<life.length; i++) {
            if (life[i] <= 0) {
                life[i] = 1.0;
                positions[i*3] = pos.x;
                positions[i*3+1] = pos.y + 0.02;
                positions[i*3+2] = pos.z;

                this.splashSystem.geometry.attributes.life.needsUpdate = true;
                this.splashSystem.geometry.attributes.position.needsUpdate = true;
                break;
            }
        }
    }

    updateSplashes(lightColor) {
        if (lightColor) {
            this.splashSystem.material.uniforms.uColor.value.copy(lightColor);
        }

        const positions = this.splashSystem.geometry.attributes.position.array;
        const life = this.splashSystem.geometry.attributes.life.array;
        let needsUpdate = false;

        for(let i=0; i<life.length; i++) {
            if (life[i] > 0) {
                life[i] -= 0.05;
                if (life[i] <= 0) {
                    life[i] = 0;
                    positions[i*3] = -100;
                }
                needsUpdate = true;
            }
        }

        if (needsUpdate) {
            this.splashSystem.geometry.attributes.life.needsUpdate = true;
            this.splashSystem.geometry.attributes.position.needsUpdate = true;
        }
    }
}
