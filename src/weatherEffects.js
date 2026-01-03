import * as THREE from 'three';

// Simple Cloud Texture Generator
function createCloudTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
    gradient.addColorStop(0.4, 'rgba(255, 255, 255, 0.2)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(canvas);
    return texture;
}

class CloudSystem {
    constructor(scene, camera, maxClouds = 50) {
        this.scene = scene;
        this.camera = camera;
        this.maxClouds = maxClouds;
        this.puffsPerCloud = 8;
        this.totalInstances = maxClouds * this.puffsPerCloud;

        // Soft sprite material
        const map = createCloudTexture();
        const material = new THREE.MeshBasicMaterial({
            map: map,
            transparent: true,
            opacity: 0.6,
            depthWrite: false,
            side: THREE.DoubleSide
        });

        // Sprites are planes
        const geometry = new THREE.PlaneGeometry(1, 1);

        this.mesh = new THREE.InstancedMesh(geometry, material, this.totalInstances);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.scene.add(this.mesh);

        this.clouds = [];
        this.dummy = new THREE.Object3D();

        // Hide all initially
        this.clear();
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

        // Generate local puffs
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
        // Billboard rotation
        const camQuat = this.camera.quaternion;

        this.clouds.forEach(cloud => {
            // Move
            const moveSpeed = (0.05 + cloud.windSpeed * 0.01) * delta;
            cloud.x += moveSpeed;

            // Wrap
            if (cloud.x > cloud.zone.maxX) cloud.x = cloud.zone.minX;
            if (cloud.x < cloud.zone.minX) cloud.x = cloud.zone.maxX;

            // Update Instances
            cloud.indices.forEach((idx, i) => {
                const puff = cloud.puffs[i];

                this.dummy.position.set(
                    cloud.x + puff.x * cloud.scale * 0.5,
                    cloud.y + puff.y * cloud.scale * 0.5,
                    cloud.z + puff.z * cloud.scale * 0.5
                );

                // Billboard: copy camera rotation
                this.dummy.quaternion.copy(camQuat);

                this.dummy.scale.setScalar(puff.scale * cloud.scale);
                this.dummy.updateMatrix();
                this.mesh.setMatrixAt(idx, this.dummy.matrix);
            });
        });

        this.mesh.instanceMatrix.needsUpdate = true;
    }

    clear() {
        this.clouds = [];
        for(let i=0; i<this.totalInstances; i++) {
             this.dummy.position.set(0, -1000, 0); // Far away
             this.dummy.updateMatrix();
             this.mesh.setMatrixAt(i, this.dummy.matrix);
        }
        this.mesh.instanceMatrix.needsUpdate = true;
    }
}

export class WeatherEffects {
    constructor(scene, sundialGroup, camera) {
        this.scene = scene;
        this.sundialGroup = sundialGroup;
        this.camera = camera;
        this.particleSystems = [];

        this.cloudSystem = new CloudSystem(scene, camera);

        this.weatherState = {
            past: { code: -1, wind: 0 },
            current: { code: -1, wind: 0 },
            forecast: { code: -1, wind: 0 }
        };

        this.raycaster = new THREE.Raycaster();
        this.downVector = new THREE.Vector3(0, -1, 0);

        // Initialize Splash System
        this.createSplashes();
    }

    update(past, current, forecast, delta = 0.016) {
        if (past.weatherCode !== this.weatherState.past.code ||
            current.weatherCode !== this.weatherState.current.code ||
            forecast.weatherCode !== this.weatherState.forecast.code) {

            this.clearParticles();
            this.cloudSystem.clear();

            this.weatherState.past = { ...past };
            this.weatherState.current = { ...current };
            this.weatherState.forecast = { ...forecast };

            this.createZoneEffects(past.weatherCode, past.windSpeed, -8, 8);
            this.createZoneEffects(current.weatherCode, current.windSpeed, 0, 8);
            this.createZoneEffects(forecast.weatherCode, forecast.windSpeed, 8, 8);
        } else {
             // Update wind if needed, but for now we just use the initial state's wind for simpler logic
             // or update it:
             // But existing particles have wind baked in or we pass it?
             // We pass it in updateParticleSystem.
        }

        // Update active particle systems
        this.particleSystems.forEach(system => {
            if (system.userData.type === 'rain') {
                // Use current windSpeed from args if available, or stored
                // We'll use stored zone wind for now to match the "zone" logic
                this.updateRain(system, system.userData.windSpeed, system.userData.zone, delta);
            } else if (system.userData.type === 'snow') {
                this.updateSnow(system, system.userData.windSpeed, system.userData.zone, delta);
            }
        });

        this.cloudSystem.update(delta);
        this.updateSplashes();
    }

    createZoneEffects(weatherCode, windSpeed, centerX, width) {
        const zone = {
            minX: centerX - width / 2,
            maxX: centerX + width / 2,
            centerX: centerX
        };

        if (weatherCode >= 61 && weatherCode <= 65) {
            this.createRain(weatherCode >= 63 ? 750 : 375, zone, windSpeed);
        } else if (weatherCode >= 71 && weatherCode <= 77) {
            this.createSnow(weatherCode >= 73 ? 500 : 300, zone, windSpeed);
        } else if (weatherCode >= 95) {
            this.createRain(1125, zone, windSpeed);
            this.createLightning(zone);
        }

        if (weatherCode >= 2) {
            // Add clouds
            const count = weatherCode === 3 ? 5 : 2;
            for(let i=0; i<count; i++) {
                this.cloudSystem.addCloud(zone, windSpeed);
            }
        }
    }

    createRain(particleCount, zone, windSpeed) {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 6); // 2 verts per particle
        const states = new Int8Array(particleCount);
        const velocities = new Float32Array(particleCount * 3);

        for (let i = 0; i < particleCount; i++) {
            this.resetRainParticle(positions, velocities, states, i, zone, windSpeed);
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.LineBasicMaterial({
            color: 0x88ccff,
            transparent: true,
            opacity: 0.6
        });

        const system = new THREE.LineSegments(geometry, material);
        system.userData = {
            type: 'rain',
            velocities: velocities,
            states: states,
            zone: zone,
            windSpeed: windSpeed
        };

        this.scene.add(system);
        this.particleSystems.push(system);
    }

    resetRainParticle(positions, velocities, states, i, zone, windSpeed) {
        const i3 = i * 3;
        const i6 = i * 6;

        // Random Pos
        const x = zone.minX + Math.random() * (zone.maxX - zone.minX);
        const y = 15 + Math.random() * 5;
        const z = Math.random() * 10 - 5;

        velocities[i3] = 0;
        velocities[i3 + 1] = -0.2 - Math.random() * 0.1; // Base fall speed
        velocities[i3 + 2] = 0;

        positions[i6] = x;
        positions[i6 + 1] = y + 0.5;
        positions[i6 + 2] = z;

        positions[i6 + 3] = x;
        positions[i6 + 4] = y;
        positions[i6 + 5] = z;

        states[i] = 0;
    }

    updateRain(system, windSpeed, zone, delta) {
        const positions = system.geometry.attributes.position.array;
        const velocities = system.userData.velocities;
        const states = system.userData.states;
        const count = states.length;

        // Wind vector (simple x/z influence)
        const windX = windSpeed * 0.005;
        const windZ = windSpeed * 0.002;

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            const i6 = i * 6;

            if (states[i] === 0) { // Falling
                // Apply gravity/wind to velocity
                // Rain falls straight down relative to air, so wind adds horizontal velocity
                velocities[i3] += (windX - velocities[i3]) * 0.1;
                velocities[i3 + 2] += (windZ - velocities[i3 + 2]) * 0.1;

                const vx = velocities[i3];
                const vy = velocities[i3 + 1];
                const vz = velocities[i3 + 2];

                // Update HEAD
                positions[i6 + 3] += vx;
                positions[i6 + 4] += vy;
                positions[i6 + 5] += vz;

                // Update TAIL (streak)
                // Tail follows head minus velocity vector scaled
                const streak = 3.0;
                positions[i6] = positions[i6 + 3] - vx * streak;
                positions[i6 + 1] = positions[i6 + 4] - vy * streak;
                positions[i6 + 2] = positions[i6 + 5] - vz * streak;

                // Wrap
                if (positions[i6 + 3] > zone.maxX) {
                     const w = zone.maxX - zone.minX;
                     positions[i6 + 3] -= w; positions[i6] -= w;
                } else if (positions[i6 + 3] < zone.minX) {
                     const w = zone.maxX - zone.minX;
                     positions[i6 + 3] += w; positions[i6] += w;
                }

                // Check collision
                const headY = positions[i6 + 4];
                if (headY > -1 && headY < 4) {
                    const headX = positions[i6 + 3];
                    const headZ = positions[i6 + 5];
                    // Simple Box check for sundial center
                    if (headX * headX + headZ * headZ < 12) {
                        this.raycaster.set(new THREE.Vector3(headX, headY+1, headZ), this.downVector);
                        this.raycaster.far = 2.0;
                        const intersects = this.raycaster.intersectObject(this.sundialGroup, true);
                        if (intersects.length > 0) {
                            const hit = intersects[0];
                            this.spawnSplash(hit.point);
                            this.resetRainParticle(positions, velocities, states, i, zone, windSpeed);
                            // Or bounce? Rain just splashes and disappears usually.
                            continue;
                        }
                    }
                }

                if (headY < -5) {
                    this.resetRainParticle(positions, velocities, states, i, zone, windSpeed);
                }

            }
        }
        system.geometry.attributes.position.needsUpdate = true;
    }

    createSnow(particleCount, zone, windSpeed) {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const velocities = new Float32Array(particleCount * 3);
        const offsets = new Float32Array(particleCount); // For noise offset

        for (let i = 0; i < particleCount; i++) {
            positions[i*3] = zone.minX + Math.random() * (zone.maxX - zone.minX);
            positions[i*3+1] = Math.random() * 15;
            positions[i*3+2] = Math.random() * 20 - 10;

            velocities[i*3] = 0;
            velocities[i*3+1] = -0.02 - Math.random() * 0.03;
            velocities[i*3+2] = 0;

            offsets[i] = Math.random() * 100;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 0.15,
            transparent: true,
            opacity: 0.8,
            map: createCloudTexture(), // Use soft texture for snow too?
            depthWrite: false
        });

        const system = new THREE.Points(geometry, material);
        system.userData = { type: 'snow', velocities: velocities, offsets: offsets, zone: zone, windSpeed: windSpeed };
        this.particleSystems.push(system);
        this.scene.add(system);
    }

    updateSnow(system, windSpeed, zone, delta) {
        const positions = system.geometry.attributes.position.array;
        const velocities = system.userData.velocities;
        const offsets = system.userData.offsets;
        const time = Date.now() * 0.001;
        const windX = windSpeed * 0.005;

        for (let i = 0; i < positions.length; i += 3) {
            const idx = i/3;
            // Curl/Turbulence
            const noise = Math.sin(time + offsets[idx]) * 0.02;
            const noiseZ = Math.cos(time * 0.8 + offsets[idx]) * 0.02;

            positions[i] += velocities[i] + windX + noise;
            positions[i + 1] += velocities[i + 1];
            positions[i + 2] += velocities[i + 2] + noiseZ;

            // Wrap
            if (positions[i] > zone.maxX) positions[i] -= (zone.maxX - zone.minX);
            if (positions[i] < zone.minX) positions[i] += (zone.maxX - zone.minX);

            if (positions[i+1] < -5) {
                positions[i+1] = 15;
                positions[i] = zone.minX + Math.random() * (zone.maxX - zone.minX);
            }
        }
        system.geometry.attributes.position.needsUpdate = true;
    }

    createLightning(zone) {
        const flash = new THREE.PointLight(0xaaddff, 5, 50);
        flash.position.set(zone.minX + Math.random() * (zone.maxX - zone.minX), 10, Math.random() * 10 - 5);
        this.scene.add(flash);
        setTimeout(() => this.scene.remove(flash), 100 + Math.random()*100);

        if (Math.random() > 0.6) {
             setTimeout(() => this.createLightning(zone), 1000 + Math.random() * 4000);
        }
    }

    createSplashes() {
        const particleCount = 200;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const life = new Float32Array(particleCount);
        for(let i=0; i<particleCount*3; i++) positions[i] = -100; // hide

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
        // Find dead particle
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
                positions[i*3+1] += 0.02; // rise
                if (life[i] <= 0) positions[i*3+1] = -100;
            }
        }
        this.splashSystem.geometry.attributes.position.needsUpdate = true;
    }

    clearParticles() {
        this.particleSystems.forEach(s => {
            this.scene.remove(s);
            s.geometry.dispose();
            s.material.dispose();
        });
        this.particleSystems = [];
    }
}
