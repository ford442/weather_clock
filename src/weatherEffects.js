import * as THREE from 'three';

export class WeatherEffects {
    constructor(scene, sundialGroup) {
        this.scene = scene;
        this.sundialGroup = sundialGroup;
        this.particleSystems = [];
        this.clouds = [];
        this.currentWeatherCode = 0;

        this.raycaster = new THREE.Raycaster();
        this.downVector = new THREE.Vector3(0, -1, 0);
        this.dummyVector = new THREE.Vector3();
    }

    update(weatherCode, windSpeed = 0) {
        if (weatherCode !== this.currentWeatherCode) {
            this.clear();
            this.currentWeatherCode = weatherCode;
            this.createEffects(weatherCode, windSpeed);
        }

        // Update rain physics
        if (this.rainSystem) {
            this.updateRain(windSpeed);
        }

        // Update snow physics
        if (this.snowSystem) {
            this.updateSnow(windSpeed);
        }

        // Update splashes
        if (this.splashSystem) {
            this.updateSplashes();
        }

        // Animate clouds
        this.clouds.forEach(cloud => {
            cloud.position.x += 0.005 + windSpeed * 0.001;
            if (cloud.position.x > 15) {
                cloud.position.x = -15;
            }
        });
    }

    createEffects(weatherCode, windSpeed) {
        // Weather codes:
        // 61-65: Rain
        // 71-77: Snow
        // 95-99: Thunderstorm
        // 2-3: Cloudy

        if (weatherCode >= 61 && weatherCode <= 65) {
            this.createRain(weatherCode >= 63 ? 3000 : 1500);
        } else if (weatherCode >= 71 && weatherCode <= 77) {
            this.createSnow(weatherCode >= 73 ? 1500 : 800);
        } else if (weatherCode >= 95) {
            this.createRain(4000);
            this.createLightning();
        }

        if (weatherCode >= 2) {
            this.createClouds(weatherCode === 3 ? 5 : 3);
        }
    }

    createRain(particleCount = 1500) {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);

        // Custom data for physics
        // State: 0 = Falling, 1 = On Surface
        const states = new Int8Array(particleCount);
        const velocities = new Float32Array(particleCount * 3);

        for (let i = 0; i < particleCount; i++) {
            this.resetRainParticle(positions, velocities, states, i);
            // Pre-randomize Y so they don't all start at top
            positions[i * 3 + 1] = Math.random() * 20 - 5;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.PointsMaterial({
            color: 0x88ccff,
            size: 0.08,
            transparent: true,
            opacity: 0.8,
            // blending: THREE.AdditiveBlending
        });

        this.rainSystem = new THREE.Points(geometry, material);
        this.rainSystem.userData = {
            velocities: velocities,
            states: states
        };

        this.scene.add(this.rainSystem);
        this.particleSystems.push(this.rainSystem);

        // Initialize splashes
        this.createSplashes();
    }

    resetRainParticle(positions, velocities, states, i) {
        const i3 = i * 3;
        positions[i3] = Math.random() * 10 - 5; // x
        positions[i3 + 1] = 10 + Math.random() * 5; // y
        positions[i3 + 2] = Math.random() * 10 - 5; // z

        velocities[i3] = 0;
        velocities[i3 + 1] = -0.15 - Math.random() * 0.1; // Falling speed
        velocities[i3 + 2] = 0;

        states[i] = 0; // Falling
    }

    updateRain(windSpeed) {
        const positions = this.rainSystem.geometry.attributes.position.array;
        const velocities = this.rainSystem.userData.velocities;
        const states = this.rainSystem.userData.states;
        const count = states.length;

        const gravity = -0.005;
        const boxRadiusSq = 3.5 * 3.5; // Sundial radius approx

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;

            if (states[i] === 0) { // FALLING
                // Apply wind
                positions[i3] += windSpeed * 0.002;
                positions[i3 + 2] += windSpeed * 0.001;

                // Move
                positions[i3] += velocities[i3];
                positions[i3 + 1] += velocities[i3 + 1];
                positions[i3 + 2] += velocities[i3 + 2];

                // Collision Detection
                // Check if within horizontal bounds of sundial
                const distSq = positions[i3] * positions[i3] + positions[i3 + 2] * positions[i3 + 2];
                if (distSq < boxRadiusSq && positions[i3 + 1] > -1 && positions[i3 + 1] < 4) {

                    // Raycast downwards from previous position (approx)
                    this.raycaster.set(
                        new THREE.Vector3(positions[i3], positions[i3 + 1] + 0.5, positions[i3 + 2]),
                        this.downVector
                    );

                    // Only check intersections with sundial
                    // optimization: limit far distance
                    this.raycaster.far = 1.0;
                    const intersects = this.raycaster.intersectObject(this.sundialGroup, true);

                    if (intersects.length > 0) {
                        const hit = intersects[0];

                        // Move to surface
                        positions[i3] = hit.point.x;
                        positions[i3 + 1] = hit.point.y + 0.02; // Slightly above
                        positions[i3 + 2] = hit.point.z;

                        // Switch state
                        states[i] = 1; // ON SURFACE

                        // Calculate slide velocity based on normal
                        // Tangent = Gravity - (Gravity . Normal) * Normal
                        // Gravity direction is (0, -1, 0)
                        const normal = hit.face.normal;
                        // Transform normal to world space if needed (but object scaling might affect it)
                        // For simple geometries and uniform scaling, this is often close enough or we use hit.normal if available (not in standard three.js raycast result, it gives face normal)
                        // We need to apply object rotation to the normal
                        const worldNormal = normal.clone().applyQuaternion(hit.object.getWorldQuaternion(new THREE.Quaternion()));

                        // Simple slide logic
                        const steepness = 1.0 - Math.abs(worldNormal.y);

                        velocities[i3] = worldNormal.x * 0.05 + (Math.random() - 0.5) * 0.01;
                        velocities[i3 + 1] = 0; // Will be clamped to surface
                        velocities[i3 + 2] = worldNormal.z * 0.05 + (Math.random() - 0.5) * 0.01;

                        // Trigger splash
                        this.spawnSplash(hit.point);
                    }
                }

                // Reset if too low
                if (positions[i3 + 1] < -5) {
                    this.resetRainParticle(positions, velocities, states, i);
                }

            } else { // ON SURFACE (Pooling/Running off)

                // Add "stickiness" or friction
                velocities[i3] *= 0.9;
                velocities[i3 + 2] *= 0.9;

                // Add gravity to pull down slopes
                velocities[i3 + 1] += gravity;

                // Move
                positions[i3] += velocities[i3];
                positions[i3 + 1] += velocities[i3 + 1];
                positions[i3 + 2] += velocities[i3 + 2];

                // Check if still on surface
                this.raycaster.set(
                    new THREE.Vector3(positions[i3], positions[i3 + 1] + 0.5, positions[i3 + 2]),
                    this.downVector
                );
                this.raycaster.far = 1.0;
                const intersects = this.raycaster.intersectObject(this.sundialGroup, true);

                if (intersects.length > 0) {
                    const hit = intersects[0];

                    // Snap to surface
                    positions[i3 + 1] = hit.point.y + 0.02;

                    // Recalculate slope influence
                    const worldNormal = hit.face.normal.clone().applyQuaternion(hit.object.getWorldQuaternion(new THREE.Quaternion()));

                    // Slide down
                    velocities[i3] += worldNormal.x * 0.005;
                    velocities[i3 + 2] += worldNormal.z * 0.005;

                    // "Changingly" pool - add random noise
                    if (Math.abs(worldNormal.y) > 0.9) { // Flat surface
                        velocities[i3] += (Math.random() - 0.5) * 0.002;
                        velocities[i3 + 2] += (Math.random() - 0.5) * 0.002;
                    }

                } else {
                    // Fell off the edge
                    states[i] = 0; // Back to falling
                    velocities[i3 + 1] = -0.1; // Initial fall speed
                }

                // Randomly evaporate/reset to keep rain coming
                if (Math.random() < 0.005) {
                     this.resetRainParticle(positions, velocities, states, i);
                }
            }
        }

        this.rainSystem.geometry.attributes.position.needsUpdate = true;
    }

    createSplashes() {
        const particleCount = 200;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const life = new Float32Array(particleCount); // 0 = dead, >0 = alive

        // Hide initially
        for(let i=0; i<particleCount * 3; i++) positions[i] = 0;

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.PointsMaterial({
            color: 0xaaccff,
            size: 0.05,
            transparent: true,
            opacity: 0.6
        });

        this.splashSystem = new THREE.Points(geometry, material);
        this.splashSystem.userData = { life: life };
        this.scene.add(this.splashSystem);
    }

    spawnSplash(position) {
        if (!this.splashSystem) return;
        const positions = this.splashSystem.geometry.attributes.position.array;
        const life = this.splashSystem.userData.life;

        // Find a dead particle
        for (let i = 0; i < life.length; i++) {
            if (life[i] <= 0) {
                life[i] = 1.0; // Reset life
                positions[i * 3] = position.x + (Math.random() - 0.5) * 0.1;
                positions[i * 3 + 1] = position.y + 0.05;
                positions[i * 3 + 2] = position.z + (Math.random() - 0.5) * 0.1;
                break; // Only spawn one per call to save perf
            }
        }
    }

    updateSplashes() {
        const positions = this.splashSystem.geometry.attributes.position.array;
        const life = this.splashSystem.userData.life;

        for (let i = 0; i < life.length; i++) {
            if (life[i] > 0) {
                life[i] -= 0.1; // Decay
                positions[i * 3 + 1] += 0.01; // Float up slightly

                if (life[i] <= 0) {
                    // Hide
                    positions[i * 3 + 1] = -100;
                }
            }
        }
        this.splashSystem.geometry.attributes.position.needsUpdate = true;
    }

    createSnow(particleCount = 800) {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const velocities = new Float32Array(particleCount * 3);

        for (let i = 0; i < particleCount * 3; i += 3) {
            positions[i] = Math.random() * 20 - 10;
            positions[i + 1] = Math.random() * 15;
            positions[i + 2] = Math.random() * 20 - 10;

            velocities[i] = (Math.random() - 0.5) * 0.02;
            velocities[i + 1] = -0.02 - Math.random() * 0.03;
            velocities[i + 2] = (Math.random() - 0.5) * 0.02;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 0.1,
            transparent: true,
            opacity: 0.8
        });

        this.snowSystem = new THREE.Points(geometry, material);
        this.snowSystem.userData.velocities = velocities;
        this.particleSystems.push(this.snowSystem);
        this.scene.add(this.snowSystem);
    }

    updateSnow(windSpeed) {
        const positions = this.snowSystem.geometry.attributes.position.array;
        const velocities = this.snowSystem.userData.velocities;

        for (let i = 0; i < positions.length; i += 3) {
            positions[i] += velocities[i] + windSpeed * 0.001;
            positions[i + 1] += velocities[i + 1];
            positions[i + 2] += velocities[i + 2];

            // Reset
            if (positions[i + 1] < -5) {
                positions[i + 1] = 10;
                positions[i] = Math.random() * 20 - 10;
                positions[i + 2] = Math.random() * 20 - 10;
            }
            // Bounds
            if (positions[i] < -10) positions[i] = 10;
            if (positions[i] > 10) positions[i] = -10;
            if (positions[i + 2] < -10) positions[i + 2] = 10;
            if (positions[i + 2] > 10) positions[i + 2] = -10;
        }
        this.snowSystem.geometry.attributes.position.needsUpdate = true;
    }

    createClouds(count = 3) {
        for (let i = 0; i < count; i++) {
            const cloud = this.createCloud();
            cloud.position.x = Math.random() * 20 - 10;
            cloud.position.y = 5 + Math.random() * 3;
            cloud.position.z = Math.random() * 10 - 5;
            cloud.scale.setScalar(0.5 + Math.random() * 0.5);
            this.clouds.push(cloud);
            this.scene.add(cloud);
        }
    }

    createCloud() {
        const cloud = new THREE.Group();
        const geometry = new THREE.SphereGeometry(1, 16, 16);
        const material = new THREE.MeshStandardMaterial({
            color: 0xcccccc,
            transparent: true,
            opacity: 0.6,
            roughness: 1
        });

        for (let i = 0; i < 5; i++) {
            const sphere = new THREE.Mesh(geometry, material);
            sphere.position.x = (Math.random() - 0.5) * 2;
            sphere.position.y = (Math.random() - 0.5) * 0.5;
            sphere.position.z = (Math.random() - 0.5) * 2;
            sphere.scale.setScalar(0.5 + Math.random() * 0.5);
            cloud.add(sphere);
        }

        return cloud;
    }

    createLightning() {
        const flash = new THREE.PointLight(0xffffff, 5, 20);
        flash.position.set(Math.random() * 10 - 5, 8, Math.random() * 10 - 5);
        this.scene.add(flash);

        setTimeout(() => {
            this.scene.remove(flash);
        }, 100);

        if (Math.random() > 0.5) {
            setTimeout(() => this.createLightning(), 2000 + Math.random() * 5000);
        }
    }

    clear() {
        this.particleSystems.forEach(system => {
            this.scene.remove(system);
            system.geometry.dispose();
            system.material.dispose();
        });
        this.particleSystems = [];
        this.rainSystem = null;
        this.snowSystem = null;
        this.splashSystem = null;

        this.clouds.forEach(cloud => {
            this.scene.remove(cloud);
            cloud.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
        });
        this.clouds = [];
    }
}
