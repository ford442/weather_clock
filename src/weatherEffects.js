import * as THREE from 'three';

// Rain Shader: Fades out particles based on distance from camera
const rainVertexShader = `
uniform float uOpacity;
varying float vOpacity;

void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    float dist = length(mvPosition.xyz);
    float alpha = smoothstep(2.0, 5.0, dist) * (1.0 - smoothstep(30.0, 50.0, dist));
    vOpacity = alpha * uOpacity;
}
`;

const rainFragmentShader = `
uniform vec3 uColor;
varying float vOpacity;

void main() {
    gl_FragColor = vec4(uColor, vOpacity);
}
`;

function createCloudTexture() {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    context.fillStyle = 'rgba(0,0,0,0)';
    context.fillRect(0,0,size,size);
    const cx = size/2;
    const cy = size/2;
    const puffs = 15;
    for (let i = 0; i < puffs; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * (size * 0.2);
        const px = cx + Math.cos(angle) * dist;
        const py = cy + Math.sin(angle) * dist;
        const r = size * (0.15 + Math.random() * 0.25);
        const grad = context.createRadialGradient(px, py, 0, px, py, r);
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
        grad.addColorStop(0.4, 'rgba(255, 255, 255, 0.3)');
        grad.addColorStop(0.8, 'rgba(255, 255, 255, 0.05)');
        grad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
        context.fillStyle = grad;
        context.beginPath();
        context.arc(px, py, r, 0, Math.PI * 2);
        context.fill();
    }
    return new THREE.CanvasTexture(canvas);
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
        this.isActive = false;
        this.state = 'idle';
        this.fadeTimer = 0;
        this.fadeDuration = 5.0;
        this.targetOpacity = 1.0;
    }

    activate() {
        this.isActive = true;
        this.state = 'fading_in';
        this.fadeTimer = 0;
    }

    deactivate() {
        this.isActive = false;
        this.state = 'idle';
    }

    fadeOut() {
        this.state = 'fading_out';
        this.fadeTimer = 0;
    }

    updateFade(delta, currentOpacity) {
        if (this.state === 'fading_in') {
            this.fadeTimer += delta;
            currentOpacity = Math.min(this.targetOpacity, (this.fadeTimer / this.fadeDuration) * this.targetOpacity);
            if (this.fadeTimer >= this.fadeDuration) {
                this.state = 'stable';
                currentOpacity = this.targetOpacity;
            }
        } else if (this.state === 'fading_out') {
            this.fadeTimer += delta;
            currentOpacity = Math.max(0.0, this.targetOpacity - (this.fadeTimer / this.fadeDuration) * this.targetOpacity);
            if (this.fadeTimer >= this.fadeDuration) {
                this.deactivate();
                return { opacity: 0, done: true };
            }
        } else {
            currentOpacity = this.targetOpacity;
        }
        return { opacity: currentOpacity, done: false };
    }
}

class RainSystem extends ParticleSystemBase {
    constructor(scene, maxParticles = 2000) {
        super(scene);
        this.maxParticles = maxParticles;

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(maxParticles * 6);
        const velocities = new Float32Array(maxParticles * 3);
        const states = new Int8Array(maxParticles); // 0=falling

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
        this.mesh.visible = false;
        this.scene.add(this.mesh);

        this.velocities = velocities;
        this.states = states;
        this.targetOpacity = 0.6;
    }

    activate(count, zone, windSpeed) {
        super.activate();
        this.mesh.visible = true;
        this.count = Math.min(count, this.maxParticles);
        this.mesh.geometry.setDrawRange(0, this.count * 2);
        this.zone = zone;
        this.windSpeed = windSpeed;

        // Init particles
        for (let i = 0; i < this.count; i++) {
            this.resetParticle(i, true);
        }
        this.mesh.material.uniforms.uOpacity.value = 0;
    }

    deactivate() {
        super.deactivate();
        this.mesh.visible = false;
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

    update(delta, raycaster, sundialGroup, spawnSplashCallback) {
        if (!this.isActive) return false;

        const fade = this.updateFade(delta, 0); // initial opacity doesn't matter, we use uniform
        this.mesh.material.uniforms.uOpacity.value = fade.opacity;
        if (fade.done) return false;

        const positions = this.mesh.geometry.attributes.position.array;
        const windX = this.windSpeed * 0.005;
        const windZ = this.windSpeed * 0.002;

        for (let i = 0; i < this.count; i++) {
            const i3 = i * 3;
            const i6 = i * 6;

            if (this.states[i] === 0) {
                this.velocities[i3] += (windX - this.velocities[i3]) * 0.1;
                this.velocities[i3+2] += (windZ - this.velocities[i3+2]) * 0.1;

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

                // Wrap
                if (positions[i6+3] > this.zone.maxX) {
                    const w = this.zone.maxX - this.zone.minX;
                    positions[i6+3] -= w; positions[i6] -= w;
                } else if (positions[i6+3] < this.zone.minX) {
                    const w = this.zone.maxX - this.zone.minX;
                    positions[i6+3] += w; positions[i6] += w;
                }

                // Collision
                const headY = positions[i6+4];
                if (headY > -1 && headY < 4) {
                    const headX = positions[i6+3];
                    const headZ = positions[i6+5];
                    if (sundialGroup && headX*headX + headZ*headZ < 12) {
                        raycaster.set(new THREE.Vector3(headX, headY+1, headZ), new THREE.Vector3(0,-1,0));
                        raycaster.far = 2.0;
                        const intersects = raycaster.intersectObject(sundialGroup, true);
                        if (intersects.length > 0) {
                            spawnSplashCallback(intersects[0].point);
                            this.resetParticle(i);
                            continue;
                        }
                    }
                }

                if (headY < -5) this.resetParticle(i);
            }
        }
        this.mesh.geometry.attributes.position.needsUpdate = true;
        return true;
    }
}

class SnowSystem extends ParticleSystemBase {
    constructor(scene, maxParticles = 1000) {
        super(scene);
        this.maxParticles = maxParticles;

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
        this.mesh.visible = false;
        this.scene.add(this.mesh);

        this.velocities = velocities;
        this.offsets = offsets;
        this.targetOpacity = 0.8;
    }

    activate(count, zone, windSpeed) {
        super.activate();
        this.mesh.visible = true;
        this.count = Math.min(count, this.maxParticles);
        this.mesh.geometry.setDrawRange(0, this.count);
        this.zone = zone;
        this.windSpeed = windSpeed;

        // Init
        const positions = this.mesh.geometry.attributes.position.array;
        for (let i = 0; i < this.count; i++) {
            positions[i*3] = zone.minX + Math.random() * (zone.maxX - zone.minX);
            positions[i*3+1] = Math.random() * 15;
            positions[i*3+2] = Math.random() * 20 - 10;

            this.velocities[i*3] = 0;
            this.velocities[i*3+1] = -0.02 - Math.random() * 0.03;
            this.velocities[i*3+2] = 0;

            this.offsets[i] = Math.random() * 100;
        }
        this.mesh.material.opacity = 0;
    }

    deactivate() {
        super.deactivate();
        this.mesh.visible = false;
    }

    update(delta) {
        if (!this.isActive) return false;

        const fade = this.updateFade(delta, 0);
        this.mesh.material.opacity = fade.opacity;
        if (fade.done) return false;

        const positions = this.mesh.geometry.attributes.position.array;
        const time = Date.now() * 0.001;
        const windX = this.windSpeed * 0.005;

        for (let i = 0; i < this.count; i++) {
            const i3 = i * 3;
            const px = positions[i3];
            const py = positions[i3+1];
            const pz = positions[i3+2];

            const curl = curlNoise(px * 0.1, py * 0.1, pz * 0.1, time + this.offsets[i] * 0.01);

            positions[i3] += this.velocities[i3] + windX + curl.x * 0.05;
            positions[i3+1] += this.velocities[i3+1] + curl.y * 0.05;
            positions[i3+2] += this.velocities[i3+2] + curl.z * 0.05;

            // Wrap
            if (positions[i3] > this.zone.maxX) positions[i3] -= (this.zone.maxX - this.zone.minX);
            if (positions[i3] < this.zone.minX) positions[i3] += (this.zone.maxX - this.zone.minX);

            if (positions[i3+1] < -5) {
                positions[i3+1] = 15;
                positions[i3] = this.zone.minX + Math.random() * (this.zone.maxX - this.zone.minX);
            }
        }
        this.mesh.geometry.attributes.position.needsUpdate = true;
        return true;
    }
}

class CloudSystem extends ParticleSystemBase {
    constructor(scene, camera, maxClouds = 50) {
        super(scene);
        this.camera = camera;
        this.maxClouds = maxClouds;
        this.puffsPerCloud = 8;
        this.totalInstances = maxClouds * this.puffsPerCloud;

        const map = createCloudTexture();
        this.material = new THREE.MeshBasicMaterial({
            map: map,
            transparent: true,
            opacity: 0.0,
            depthWrite: false,
            side: THREE.DoubleSide
        });

        const geometry = new THREE.PlaneGeometry(1, 1);
        this.mesh = new THREE.InstancedMesh(geometry, this.material, this.totalInstances);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.scene.add(this.mesh);

        this.clouds = [];
        this.dummy = new THREE.Object3D();
        this.targetOpacity = 0.8;

        this.clear();
    }

    activate(zone, windSpeed, count) {
        super.activate();
        this.clear();
        for(let i=0; i<count; i++) {
            this.addCloud(zone, windSpeed);
        }
        this.mesh.visible = true;
    }

    deactivate() {
        super.deactivate();
        this.mesh.visible = false;
    }

    clear() {
        this.clouds = [];
        for(let i=0; i<this.totalInstances; i++) {
             this.dummy.position.set(0, -1000, 0);
             this.dummy.updateMatrix();
             this.mesh.setMatrixAt(i, this.dummy.matrix);
        }
        this.mesh.instanceMatrix.needsUpdate = true;
    }

    addCloud(zone, windSpeed) {
        if (this.clouds.length >= this.maxClouds) return;
        const startIndex = this.clouds.length * this.puffsPerCloud;
        const indices = [];
        for(let i=0; i<this.puffsPerCloud; i++) indices.push(startIndex + i);

        const cloud = {
            x: zone.minX + Math.random() * (zone.maxX - zone.minX),
            y: 6 + Math.random() * 4,
            z: Math.random() * 10 - 5,
            scale: 2.0 + Math.random() * 2.0,
            zone: zone,
            windSpeed: windSpeed,
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

    update(delta) {
        if (!this.isActive) return false;

        const fade = this.updateFade(delta, 0);
        this.material.opacity = fade.opacity;
        if (fade.done) return false;

        const camQuat = this.camera.quaternion;
        this.clouds.forEach(cloud => {
            const moveSpeed = (0.05 + cloud.windSpeed * 0.01) * delta;
            cloud.x += moveSpeed;
            if (cloud.x > cloud.zone.maxX) cloud.x = cloud.zone.minX;
            if (cloud.x < cloud.zone.minX) cloud.x = cloud.zone.maxX;

            cloud.indices.forEach((idx, i) => {
                const puff = cloud.puffs[i];
                this.dummy.position.set(
                    cloud.x + puff.x * cloud.scale * 0.5,
                    cloud.y + puff.y * cloud.scale * 0.5,
                    cloud.z + puff.z * cloud.scale * 0.5
                );
                this.dummy.quaternion.copy(camQuat);
                this.dummy.scale.setScalar(puff.scale * cloud.scale);
                this.dummy.updateMatrix();
                this.mesh.setMatrixAt(idx, this.dummy.matrix);
            });
        });
        this.mesh.instanceMatrix.needsUpdate = true;
        return true;
    }
}

export class WeatherEffects {
    constructor(scene, sundialGroup, camera) {
        this.scene = scene;
        this.sundialGroup = sundialGroup;
        this.camera = camera;

        this.rainPool = [];
        this.snowPool = [];
        this.cloudPool = [];

        this.weatherState = {
            past: { code: -1, wind: 0 },
            current: { code: -1, wind: 0 },
            forecast: { code: -1, wind: 0 }
        };

        this.raycaster = new THREE.Raycaster();
        this.downVector = new THREE.Vector3(0, -1, 0);
        this.flashIntensity = 0;
        this.createSplashes();
    }

    getRainSystem() {
        let sys = this.rainPool.find(s => !s.isActive);
        if (!sys) {
            sys = new RainSystem(this.scene);
            this.rainPool.push(sys);
        }
        return sys;
    }

    getSnowSystem() {
        let sys = this.snowPool.find(s => !s.isActive);
        if (!sys) {
            sys = new SnowSystem(this.scene);
            this.snowPool.push(sys);
        }
        return sys;
    }

    getCloudSystem() {
        let sys = this.cloudPool.find(s => !s.isActive);
        if (!sys) {
            sys = new CloudSystem(this.scene, this.camera);
            this.cloudPool.push(sys);
        }
        return sys;
    }

    update(past, current, forecast, delta = 0.016) {
        if (this.flashIntensity > 0) {
            this.flashIntensity -= delta * 5.0;
            if (this.flashIntensity < 0) this.flashIntensity = 0;
        }

        if (past.weatherCode !== this.weatherState.past.code ||
            current.weatherCode !== this.weatherState.current.code ||
            forecast.weatherCode !== this.weatherState.forecast.code) {

            // Mark all active systems as fading out
            [...this.rainPool, ...this.snowPool, ...this.cloudPool].forEach(s => {
                if (s.isActive && s.state !== 'fading_out') s.fadeOut();
            });

            this.weatherState.past = { ...past };
            this.weatherState.current = { ...current };
            this.weatherState.forecast = { ...forecast };

            this.createZoneEffects(past.weatherCode, past.windSpeed, -8, 8);
            this.createZoneEffects(current.weatherCode, current.windSpeed, 0, 8);
            this.createZoneEffects(forecast.weatherCode, forecast.windSpeed, 8, 8);
        }

        // Update all pools
        [...this.rainPool, ...this.snowPool, ...this.cloudPool].forEach(s => {
            if (s.isActive) {
                // Rain needs extra args
                if (s instanceof RainSystem) {
                    s.update(delta, this.raycaster, this.sundialGroup, (pos) => this.spawnSplash(pos));
                } else {
                    s.update(delta);
                }
            }
        });

        this.updateSplashes();
    }

    getLightningFlash() {
        return this.flashIntensity;
    }

    createZoneEffects(weatherCode, windSpeed, centerX, width) {
        const zone = {
            minX: centerX - width / 2,
            maxX: centerX + width / 2,
            centerX: centerX
        };

        if (weatherCode >= 61 && weatherCode <= 65) {
            const count = weatherCode >= 63 ? 750 : 375;
            this.getRainSystem().activate(count, zone, windSpeed);
        } else if (weatherCode >= 71 && weatherCode <= 77) {
            const count = weatherCode >= 73 ? 500 : 300;
            this.getSnowSystem().activate(count, zone, windSpeed);
        } else if (weatherCode >= 95) {
            this.getRainSystem().activate(1125, zone, windSpeed);
            this.createLightning(zone);
        }

        if (weatherCode >= 2) {
            const count = weatherCode === 3 ? 5 : 2;
            this.getCloudSystem().activate(zone, windSpeed, count);
        }
    }

    createLightning(zone) {
        const flash = new THREE.PointLight(0xaaddff, 5, 50);
        flash.position.set(zone.minX + Math.random() * (zone.maxX - zone.minX), 10, Math.random() * 10 - 5);
        this.scene.add(flash);
        setTimeout(() => this.scene.remove(flash), 100 + Math.random()*100);
        this.flashIntensity = 2.0;
        if (Math.random() > 0.6) {
             setTimeout(() => this.createLightning(zone), 1000 + Math.random() * 4000);
        }
    }

    createSplashes() {
        const particleCount = 200;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const life = new Float32Array(particleCount);
        for(let i=0; i<particleCount*3; i++) positions[i] = -100;

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const material = new THREE.PointsMaterial({
            color: 0x88ccff,
            size: 0.1,
            transparent: true,
            opacity: 0.8
        });

        this.splashSystem = new THREE.Points(geometry, material);
        this.splashSystem.userData = { life: life };
        this.scene.add(this.splashSystem);
    }

    spawnSplash(pos) {
        const positions = this.splashSystem.geometry.attributes.position.array;
        const life = this.splashSystem.userData.life;
        for(let i=0; i<life.length; i++) {
            if (life[i] <= 0) {
                life[i] = 1.0;
                positions[i*3] = pos.x;
                positions[i*3+1] = pos.y + 0.05;
                positions[i*3+2] = pos.z;
                break;
            }
        }
    }

    updateSplashes() {
        const positions = this.splashSystem.geometry.attributes.position.array;
        const life = this.splashSystem.userData.life;
        for(let i=0; i<life.length; i++) {
            if (life[i] > 0) {
                life[i] -= 0.05;
                positions[i*3+1] += 0.02;
                if (life[i] <= 0) positions[i*3+1] = -100;
            }
        }
        this.splashSystem.geometry.attributes.position.needsUpdate = true;
    }
}
