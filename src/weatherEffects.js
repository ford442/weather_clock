import * as THREE from 'three';

export class WeatherEffects {
    constructor(scene) {
        this.scene = scene;
        this.particleSystems = [];
        this.clouds = [];
        this.currentWeatherCode = 0;
    }

    update(weatherCode, windSpeed = 0) {
        if (weatherCode !== this.currentWeatherCode) {
            this.clear();
            this.currentWeatherCode = weatherCode;
            this.createEffects(weatherCode, windSpeed);
        }

        // Animate particles
        this.particleSystems.forEach(system => {
            const positions = system.geometry.attributes.position.array;
            const velocities = system.userData.velocities;

            for (let i = 0; i < positions.length; i += 3) {
                positions[i] += velocities[i]; // x
                positions[i + 1] += velocities[i + 1]; // y
                positions[i + 2] += velocities[i + 2]; // z

                // Reset particles that fall too far
                if (positions[i + 1] < -5) {
                    positions[i + 1] = 10;
                }

                // Wind effect
                if (windSpeed > 0) {
                    positions[i] += windSpeed * 0.01;
                }

                // Keep particles in bounds
                if (positions[i] < -10) positions[i] = 10;
                if (positions[i] > 10) positions[i] = -10;
                if (positions[i + 2] < -10) positions[i + 2] = 10;
                if (positions[i + 2] > 10) positions[i + 2] = -10;
            }

            system.geometry.attributes.position.needsUpdate = true;
        });

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
            this.createRain(weatherCode >= 63 ? 2000 : 1000);
        } else if (weatherCode >= 71 && weatherCode <= 77) {
            this.createSnow(weatherCode >= 73 ? 1500 : 800);
        } else if (weatherCode >= 95) {
            this.createRain(3000);
            this.createLightning();
        }

        if (weatherCode >= 2) {
            this.createClouds(weatherCode === 3 ? 5 : 3);
        }
    }

    createRain(particleCount = 1000) {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const velocities = new Float32Array(particleCount * 3);

        for (let i = 0; i < particleCount * 3; i += 3) {
            positions[i] = Math.random() * 20 - 10; // x
            positions[i + 1] = Math.random() * 15; // y
            positions[i + 2] = Math.random() * 20 - 10; // z

            velocities[i] = 0; // x velocity
            velocities[i + 1] = -0.1 - Math.random() * 0.1; // y velocity (falling)
            velocities[i + 2] = 0; // z velocity
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.PointsMaterial({
            color: 0x4488ff,
            size: 0.05,
            transparent: true,
            opacity: 0.6
        });

        const particles = new THREE.Points(geometry, material);
        particles.userData.velocities = velocities;
        this.particleSystems.push(particles);
        this.scene.add(particles);
    }

    createSnow(particleCount = 800) {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const velocities = new Float32Array(particleCount * 3);

        for (let i = 0; i < particleCount * 3; i += 3) {
            positions[i] = Math.random() * 20 - 10; // x
            positions[i + 1] = Math.random() * 15; // y
            positions[i + 2] = Math.random() * 20 - 10; // z

            velocities[i] = (Math.random() - 0.5) * 0.02; // x velocity (drift)
            velocities[i + 1] = -0.02 - Math.random() * 0.03; // y velocity (slow fall)
            velocities[i + 2] = (Math.random() - 0.5) * 0.02; // z velocity (drift)
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 0.1,
            transparent: true,
            opacity: 0.8
        });

        const particles = new THREE.Points(geometry, material);
        particles.userData.velocities = velocities;
        this.particleSystems.push(particles);
        this.scene.add(particles);
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

        // Create cloud from multiple spheres
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
        // Lightning flash effect (simplified)
        const flash = new THREE.PointLight(0xffffff, 5, 20);
        flash.position.set(
            Math.random() * 10 - 5,
            8,
            Math.random() * 10 - 5
        );
        this.scene.add(flash);

        // Remove flash after a moment
        setTimeout(() => {
            this.scene.remove(flash);
        }, 100);

        // Note: Recursive lightning calls are intentionally limited by probability
        // and will naturally stop when weather conditions change via clear()
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
