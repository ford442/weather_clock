import * as THREE from 'three';

export class WeatherEffects {
    constructor(scene, sundialGroup) {
        this.scene = scene;
        this.sundialGroup = sundialGroup;
        this.particleSystems = [];
        this.clouds = [];

        // State to track if we need to rebuild
        this.weatherState = {
            past: { code: -1, wind: 0 },
            current: { code: -1, wind: 0 },
            forecast: { code: -1, wind: 0 }
        };

        this.raycaster = new THREE.Raycaster();
        this.downVector = new THREE.Vector3(0, -1, 0);
    }

    update(past, current, forecast) {
        // past, current, forecast are objects { weatherCode, windSpeed }

        // Check if weather codes changed
        if (past.weatherCode !== this.weatherState.past.code ||
            current.weatherCode !== this.weatherState.current.code ||
            forecast.weatherCode !== this.weatherState.forecast.code) {

            this.clear();

            this.weatherState.past = { ...past };
            this.weatherState.current = { ...current };
            this.weatherState.forecast = { ...forecast };

            // Create effects for each zone
            // Zones: Left (-12 to -4), Center (-4 to 4), Right (4 to 12)
            this.createZoneEffects(past.weatherCode, past.windSpeed, -8, 8);
            this.createZoneEffects(current.weatherCode, current.windSpeed, 0, 8);
            this.createZoneEffects(forecast.weatherCode, forecast.windSpeed, 8, 8);
        } else {
            // Update wind speeds if changed without code change
            this.weatherState.past.wind = past.windSpeed;
            this.weatherState.current.wind = current.windSpeed;
            this.weatherState.forecast.wind = forecast.windSpeed;
        }

        // Update all active systems
        this.particleSystems.forEach(system => {
            if (system.userData.type === 'rain') {
                this.updateRain(system, system.userData.windSpeed || 0, system.userData.zone);
            } else if (system.userData.type === 'snow') {
                this.updateSnow(system, system.userData.windSpeed || 0, system.userData.zone);
            }
        });

        // Update splashes (global system, but spawned locally)
        if (this.splashSystem) {
            this.updateSplashes();
        }

        // Animate clouds
        this.clouds.forEach(cloud => {
            // Clouds drift across the screen? Or stay in zones?
            // User wanted "visually divided". Let's keep clouds in zones if created there, or global?
            // For now, let's just drift them slowly and wrap within their zone if possible, or just global drift.
            // Let's implement simple global drift for now as clouds are high up.
            cloud.position.x += 0.005 + (cloud.userData.windSpeed || 0) * 0.001;
            const limit = 15;
            if (cloud.position.x > limit) cloud.position.x = -limit;
        });
    }

    createZoneEffects(weatherCode, windSpeed, centerX, width) {
        // Store zone info: minX, maxX
        const zone = {
            minX: centerX - width / 2,
            maxX: centerX + width / 2,
            centerX: centerX
        };

        if (weatherCode >= 61 && weatherCode <= 65) {
            this.createRain(weatherCode >= 63 ? 1000 : 500, zone, windSpeed);
        } else if (weatherCode >= 71 && weatherCode <= 77) {
            this.createSnow(weatherCode >= 73 ? 500 : 300, zone, windSpeed);
        } else if (weatherCode >= 95) {
            this.createRain(1500, zone, windSpeed);
            this.createLightning(zone);
        }

        if (weatherCode >= 2) {
            // Clouds
            // Only add clouds if not too many already?
            // Or add local clouds.
            this.createClouds(weatherCode === 3 ? 3 : 1, zone, windSpeed);
        }
    }

    createRain(particleCount, zone, windSpeed) {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const states = new Int8Array(particleCount);
        const velocities = new Float32Array(particleCount * 3);

        for (let i = 0; i < particleCount; i++) {
            this.resetRainParticle(positions, velocities, states, i, zone, windSpeed);
            positions[i * 3 + 1] = Math.random() * 20 - 5; // Random initial height
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.PointsMaterial({
            color: 0x88ccff,
            size: 0.08,
            transparent: true,
            opacity: 0.8
        });

        const system = new THREE.Points(geometry, material);
        system.userData = {
            type: 'rain',
            velocities: velocities,
            states: states,
            zone: zone,
            windSpeed: windSpeed
        };

        this.scene.add(system);
        this.particleSystems.push(system);

        if (!this.splashSystem) this.createSplashes();
    }

    resetRainParticle(positions, velocities, states, i, zone, windSpeed) {
        const i3 = i * 3;
        // Random position within zone
        positions[i3] = zone.minX + Math.random() * (zone.maxX - zone.minX);
        positions[i3 + 1] = 10 + Math.random() * 5;
        positions[i3 + 2] = Math.random() * 10 - 5; // Z depth

        velocities[i3] = 0;
        velocities[i3 + 1] = -0.15 - Math.random() * 0.1;
        velocities[i3 + 2] = 0;

        states[i] = 0;
    }

    updateRain(system, windSpeed, zone) {
        const positions = system.geometry.attributes.position.array;
        const velocities = system.userData.velocities;
        const states = system.userData.states;
        const count = states.length;
        const boxRadiusSq = 3.5 * 3.5;

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;

            if (states[i] === 0) { // FALLING
                positions[i3] += windSpeed * 0.002;
                positions[i3 + 2] += windSpeed * 0.001;

                positions[i3] += velocities[i3];
                positions[i3 + 1] += velocities[i3 + 1];
                positions[i3 + 2] += velocities[i3 + 2];

                // Check bounds and wrap
                if (positions[i3] > zone.maxX) positions[i3] -= (zone.maxX - zone.minX);
                if (positions[i3] < zone.minX) positions[i3] += (zone.maxX - zone.minX);

                // Collision with Sundial (only if in center zone roughly? Sundial is at 0,0,0)
                // If particles are in Past/Forecast zones (offset X), they shouldn't hit the central sundial.
                // Simple check: collisions only if within generic radius of (0,0,0).
                const distSq = positions[i3] * positions[i3] + positions[i3 + 2] * positions[i3 + 2];

                if (distSq < boxRadiusSq && positions[i3 + 1] > -1 && positions[i3 + 1] < 4) {
                    this.raycaster.set(new THREE.Vector3(positions[i3], positions[i3 + 1] + 0.5, positions[i3 + 2]), this.downVector);
                    this.raycaster.far = 1.0;
                    const intersects = this.raycaster.intersectObject(this.sundialGroup, true);

                    if (intersects.length > 0) {
                        const hit = intersects[0];
                        positions[i3] = hit.point.x;
                        positions[i3 + 1] = hit.point.y + 0.02;
                        positions[i3 + 2] = hit.point.z;
                        states[i] = 1;

                        const worldNormal = hit.face.normal.clone().applyQuaternion(hit.object.getWorldQuaternion(new THREE.Quaternion()));
                        velocities[i3] = worldNormal.x * 0.05;
                        velocities[i3 + 1] = 0;
                        velocities[i3 + 2] = worldNormal.z * 0.05;

                        this.spawnSplash(hit.point);
                    }
                }

                if (positions[i3 + 1] < -5) {
                    this.resetRainParticle(positions, velocities, states, i, zone, windSpeed);
                }

            } else { // ON SURFACE
                // ... (Simplified logic similar to before)
                 velocities[i3 + 1] += -0.005; // gravity
                 positions[i3] += velocities[i3];
                 positions[i3+1] += velocities[i3+1];
                 positions[i3+2] += velocities[i3+2];

                 // Simple fall off check
                 if (positions[i3+1] < -1) {
                     states[i] = 0;
                 }
                 if (Math.random() < 0.05) this.resetRainParticle(positions, velocities, states, i, zone, windSpeed);
            }
        }
        system.geometry.attributes.position.needsUpdate = true;
    }

    createSnow(particleCount, zone, windSpeed) {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const velocities = new Float32Array(particleCount * 3);

        for (let i = 0; i < particleCount * 3; i += 3) {
            positions[i] = zone.minX + Math.random() * (zone.maxX - zone.minX);
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

        const system = new THREE.Points(geometry, material);
        system.userData = { type: 'snow', velocities: velocities, zone: zone, windSpeed: windSpeed };
        this.particleSystems.push(system);
        this.scene.add(system);
    }

    updateSnow(system, windSpeed, zone) {
        const positions = system.geometry.attributes.position.array;
        const velocities = system.userData.velocities;

        for (let i = 0; i < positions.length; i += 3) {
            positions[i] += velocities[i] + windSpeed * 0.001;
            positions[i + 1] += velocities[i + 1];
            positions[i + 2] += velocities[i + 2];

            // Wrap in Zone
            if (positions[i] > zone.maxX) positions[i] -= (zone.maxX - zone.minX);
            if (positions[i] < zone.minX) positions[i] += (zone.maxX - zone.minX);

            // Reset height
            if (positions[i + 1] < -5) {
                positions[i + 1] = 10;
                positions[i] = zone.minX + Math.random() * (zone.maxX - zone.minX);
                positions[i + 2] = Math.random() * 20 - 10;
            }
        }
        system.geometry.attributes.position.needsUpdate = true;
    }

    createClouds(count, zone, windSpeed) {
        for (let i = 0; i < count; i++) {
            const cloud = this.createCloud();
            cloud.position.x = zone.minX + Math.random() * (zone.maxX - zone.minX);
            cloud.position.y = 5 + Math.random() * 3;
            cloud.position.z = Math.random() * 10 - 5;
            cloud.scale.setScalar(0.5 + Math.random() * 0.5);
            cloud.userData = { windSpeed: windSpeed };
            this.clouds.push(cloud);
            this.scene.add(cloud);
        }
    }

    // ... createCloud, createSplashes, spawnSplash, updateSplashes from previous version ...
    // Need to copy them back in because I'm overwriting the file.

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

    createLightning(zone) {
        const flash = new THREE.PointLight(0xffffff, 5, 20);
        // Random position within zone
        flash.position.set(zone.minX + Math.random() * (zone.maxX - zone.minX), 8, Math.random() * 10 - 5);
        this.scene.add(flash);

        setTimeout(() => {
            this.scene.remove(flash);
        }, 100);

        if (Math.random() > 0.5) {
            setTimeout(() => this.createLightning(zone), 2000 + Math.random() * 5000);
        }
    }

    createSplashes() {
        const particleCount = 200;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const life = new Float32Array(particleCount);

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

        for (let i = 0; i < life.length; i++) {
            if (life[i] <= 0) {
                life[i] = 1.0;
                positions[i * 3] = position.x + (Math.random() - 0.5) * 0.1;
                positions[i * 3 + 1] = position.y + 0.05;
                positions[i * 3 + 2] = position.z + (Math.random() - 0.5) * 0.1;
                break;
            }
        }
    }

    updateSplashes() {
        const positions = this.splashSystem.geometry.attributes.position.array;
        const life = this.splashSystem.userData.life;

        for (let i = 0; i < life.length; i++) {
            if (life[i] > 0) {
                life[i] -= 0.1;
                positions[i * 3 + 1] += 0.01;

                if (life[i] <= 0) {
                    positions[i * 3 + 1] = -100;
                }
            }
        }
        this.splashSystem.geometry.attributes.position.needsUpdate = true;
    }

    clear() {
        this.particleSystems.forEach(system => {
            this.scene.remove(system);
            system.geometry.dispose();
            system.material.dispose();
        });
        this.particleSystems = [];
        // do not nullify rainSystem/snowSystem because we use particleSystems array now

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
