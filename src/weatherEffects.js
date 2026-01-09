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
        this.isActive = true; // Always "active" but maybe invisible
        this.targetOpacity = 0.0; // Controlled by intensity
        this.currentOpacity = 0.0;
        this.fadeSpeed = 2.0; // Speed of opacity change per second
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
    constructor(scene, maxParticles = 3000) {
        super(scene);
        this.maxParticles = maxParticles;
        this.zone = { minX: -8, maxX: 8 };

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
        this.scene.add(this.mesh);

        this.velocities = velocities;
        this.states = states;

        // Initialize all particles
        for (let i = 0; i < maxParticles; i++) {
            this.resetParticle(i, true);
        }
        this.mesh.visible = true;
    }

    resetParticle(i, randomY = false) {
        const i3 = i * 3;
        const i6 = i * 6;
        const positions = this.mesh.geometry.attributes.position.array;

        // Spawn anywhere in the zone width, but centered around 0
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

    update(delta, windSpeed, intensity, raycaster, sundialGroup, spawnSplashCallback) {
        // Intensity is 0.0 to 1.0 (approx mm/h scaled)
        // Map intensity to opacity and count
        // Light rain (<0.5mm): Low count, low opacity
        // Heavy rain (>2.0mm): High count, high opacity

        let targetOp = 0;
        let activeCount = 0;

        if (intensity > 0.01) {
            targetOp = Math.min(0.8, 0.2 + intensity * 0.2);
            activeCount = Math.min(this.maxParticles, Math.floor(intensity * 1000));
            // Clamp min count for visibility if it's raining at all
            if (activeCount < 100) activeCount = 100;
            if (activeCount > this.maxParticles) activeCount = this.maxParticles;
        }

        const opacity = this.updateOpacity(delta, targetOp);
        this.mesh.material.uniforms.uOpacity.value = opacity;

        if (opacity <= 0.01) {
            this.mesh.visible = false;
            return;
        }
        this.mesh.visible = true;

        // Set draw range to control density
        this.mesh.geometry.setDrawRange(0, activeCount * 2);

        const positions = this.mesh.geometry.attributes.position.array;
        const windX = windSpeed * 0.005;
        const windZ = windSpeed * 0.002;

        for (let i = 0; i < activeCount; i++) {
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
                    // Simple radial check first
                    if (sundialGroup && headX*headX + headZ*headZ < 12) {
                        raycaster.set(new THREE.Vector3(headX, headY+1, headZ), new THREE.Vector3(0,-1,0));
                        raycaster.far = 10.0; // Increased range
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
    }
}

class SnowSystem extends ParticleSystemBase {
    constructor(scene, maxParticles = 2000) {
        super(scene);
        this.maxParticles = maxParticles;
        this.zone = { minX: -8, maxX: 8 };

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

        // Init
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

    update(delta, windSpeed, intensity) {
        // Intensity 0-1 (cm of snow)
        let targetOp = 0;
        let activeCount = 0;

        if (intensity > 0.01) {
            targetOp = Math.min(0.9, 0.3 + intensity * 0.3);
            activeCount = Math.min(this.maxParticles, Math.floor(intensity * 1000));
            if (activeCount < 100) activeCount = 100;
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
        const windX = windSpeed * 0.005;

        for (let i = 0; i < activeCount; i++) {
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
    }
}

class CloudSystem extends ParticleSystemBase {
    constructor(scene, camera, maxClouds = 50) {
        super(scene);
        this.camera = camera;
        this.maxClouds = maxClouds;
        this.puffsPerCloud = 8;
        this.totalInstances = maxClouds * this.puffsPerCloud;
        this.zone = { minX: -12, maxX: 12 }; // Wider zone for clouds

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

        // Init clouds
        for(let i=0; i<maxClouds; i++) {
            this.addCloud();
        }

        // Hide initially
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

    update(delta, windSpeed, cloudCover) {
        // CloudCover 0-100
        let targetOp = 0;
        let activeClouds = 0;

        if (cloudCover > 10) {
            targetOp = Math.min(0.9, cloudCover / 100.0);
            activeClouds = Math.floor((cloudCover / 100.0) * this.maxClouds);
        }

        const opacity = this.updateOpacity(delta, targetOp);
        this.material.opacity = opacity;

        if (opacity <= 0.01) {
            this.mesh.visible = false;
            return;
        }
        this.mesh.visible = true;

        const camQuat = this.camera.quaternion;

        // Only update active clouds
        for (let i = 0; i < this.clouds.length; i++) {
            const cloud = this.clouds[i];

            // Move cloud
            const moveSpeed = (0.05 + windSpeed * 0.01) * delta;
            cloud.x += moveSpeed;
            if (cloud.x > this.zone.maxX) cloud.x = this.zone.minX;
            if (cloud.x < this.zone.minX) cloud.x = this.zone.maxX;

            // If this cloud is "active" (based on density), draw it. Else hide it.
            // We can just hide it by moving to -1000
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

        // Persistent systems
        this.rainSystem = new RainSystem(scene);
        this.snowSystem = new SnowSystem(scene);
        this.cloudSystem = new CloudSystem(scene, camera);

        this.raycaster = new THREE.Raycaster();
        this.downVector = new THREE.Vector3(0, -1, 0);
        this.flashIntensity = 0;
        this.createSplashes();
    }

    update(past, current, forecast, delta = 0.016) {
        // current is the 'simWeather' object which contains interpolated values

        if (this.flashIntensity > 0) {
            this.flashIntensity -= delta * 5.0;
            if (this.flashIntensity < 0) this.flashIntensity = 0;
        }

        // Calculate intensities based on interpolated data
        // Open-Meteo Rain: mm (preceding hour)
        // Showers: mm (preceding hour)
        // Snowfall: cm (preceding hour)

        const rainIntensity = (current.rain || 0) + (current.showers || 0);
        const snowIntensity = (current.snowfall || 0);
        const cloudCover = current.cloudCover || 0;
        const windSpeed = current.windSpeed || 0;

        // Update systems continuously
        this.rainSystem.update(delta, windSpeed, rainIntensity, this.raycaster, this.sundialGroup, (pos) => this.spawnSplash(pos));
        this.snowSystem.update(delta, windSpeed, snowIntensity);
        this.cloudSystem.update(delta, windSpeed, cloudCover);

        // Lightning check (still based on discrete code for trigger)
        // Only trigger if weather code implies thunderstorm
        if (current.weatherCode >= 95) {
             // Random lightning trigger
             if (Math.random() < 0.01) { // 1% chance per frame roughly
                 this.createLightning();
             }
        }

        this.updateSplashes();
    }

    getLightningFlash() {
        return this.flashIntensity;
    }

    createLightning() {
        if (this.flashIntensity > 0.5) return; // Don't double flash too fast

        const zone = { minX: -8, maxX: 8 };
        const flash = new THREE.PointLight(0xaaddff, 5, 50);
        flash.position.set(zone.minX + Math.random() * (zone.maxX - zone.minX), 10, Math.random() * 10 - 5);
        this.scene.add(flash);
        setTimeout(() => this.scene.remove(flash), 100 + Math.random()*100);
        this.flashIntensity = 2.0;
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
