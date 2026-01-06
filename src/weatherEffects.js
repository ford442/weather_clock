import * as THREE from 'three';

// Rain Shader: Fades out particles based on distance from camera
const rainVertexShader = `
uniform float uOpacity;
varying float vOpacity;

void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // Calculate distance from camera
    float dist = length(mvPosition.xyz);

    // Fade out if too close (< 2.0) or too far (> 40.0)
    // smoothstep(min, max, val) returns 0 if val < min, 1 if val > max
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

// Improved Cloud Texture Generator using simple noise approximation
function createCloudTexture() {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');

    // Clear
    context.fillStyle = 'rgba(0,0,0,0)';
    context.fillRect(0,0,size,size);

    // Draw improved fluffy cloud texture
    // Center glow
    const cx = size/2;
    const cy = size/2;

    // Create multiple overlapping puffs for organic shape
    const puffs = 15;

    for (let i = 0; i < puffs; i++) {
        // Random offset from center
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

    const texture = new THREE.CanvasTexture(canvas);
    return texture;
}

// Pseudo-random noise for curl
function noise(x, y, z) {
    return Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453 % 1;
}

function curlNoise(x, y, z, time) {
    const eps = 0.1;
    // Simple 3D noise approx using sines
    const n = (a, b, c) => Math.sin(a * 0.5 + time) * Math.cos(b * 0.3 + time) * Math.sin(c * 0.5);

    // Approximate partial derivatives for curl (Rotational)
    // Curl F = (dFz/dy - dFy/dz, dFx/dz - dFz/dx, dFy/dx - dFx/dy)
    // We use a potential field P = (n, n, n)
    // But let's just create a turbulent vector directly

    const dx = n(x, y + eps, z) - n(x, y - eps, z);
    const dy = n(x - eps, y, z) - n(x + eps, y, z);
    const dz = Math.sin(x * 0.1 + time);

    return new THREE.Vector3(dx * 0.5, 0, dy * 0.5);
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
        this.material = new THREE.MeshBasicMaterial({
            map: map,
            transparent: true,
            opacity: 0.0, // Start invisible, fade in
            depthWrite: false,
            side: THREE.DoubleSide
        });

        // Sprites are planes
        const geometry = new THREE.PlaneGeometry(1, 1);

        // InstancedMesh for efficient cloud rendering
        this.mesh = new THREE.InstancedMesh(geometry, this.material, this.totalInstances);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.scene.add(this.mesh);

        this.clouds = [];
        this.dummy = new THREE.Object3D();

        // Lifecycle
        this.state = 'fading_in'; // fading_in, stable, fading_out
        this.fadeTimer = 0;
        this.fadeDuration = 5.0; // seconds

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
        // Handle Fade
        if (this.state === 'fading_in') {
            this.fadeTimer += delta;
            this.material.opacity = Math.min(0.8, (this.fadeTimer / this.fadeDuration) * 0.8);
            if (this.fadeTimer >= this.fadeDuration) {
                this.state = 'stable';
                this.material.opacity = 0.8;
            }
        } else if (this.state === 'fading_out') {
            this.fadeTimer += delta;
            this.material.opacity = Math.max(0.0, 0.8 - (this.fadeTimer / this.fadeDuration) * 0.8);
            if (this.fadeTimer >= this.fadeDuration) {
                return false; // Signal to destroy
            }
        }

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
        return true;
    }

    fadeOut() {
        this.state = 'fading_out';
        this.fadeTimer = 0;
    }

    dispose() {
        this.scene.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.material.dispose();
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

        // Active systems (Rain/Snow/Clouds)
        // Array of objects: { system: Object, type: 'rain'|'snow'|'cloud', update: Function }
        this.activeSystems = [];

        this.weatherState = {
            past: { code: -1, wind: 0 },
            current: { code: -1, wind: 0 },
            forecast: { code: -1, wind: 0 }
        };

        this.raycaster = new THREE.Raycaster();
        this.downVector = new THREE.Vector3(0, -1, 0);

        // Flash intensity for lightning (boosts ambient light)
        this.flashIntensity = 0;

        // Initialize Splash System
        this.createSplashes();
    }

    update(past, current, forecast, delta = 0.016) {
        // Decay flash intensity
        if (this.flashIntensity > 0) {
            this.flashIntensity -= delta * 5.0; // Decay speed
            if (this.flashIntensity < 0) this.flashIntensity = 0;
        }

        // Check for changes
        if (past.weatherCode !== this.weatherState.past.code ||
            current.weatherCode !== this.weatherState.current.code ||
            forecast.weatherCode !== this.weatherState.forecast.code) {

            // Mark all current systems to fade out
            this.activeSystems.forEach(s => {
                if (s.system && s.system.userData) s.system.userData.state = 'fading_out'; // For rain/snow
                if (s.system instanceof CloudSystem) s.system.fadeOut();
            });

            this.weatherState.past = { ...past };
            this.weatherState.current = { ...current };
            this.weatherState.forecast = { ...forecast };

            // Create new systems
            this.createZoneEffects(past.weatherCode, past.windSpeed, -8, 8);
            this.createZoneEffects(current.weatherCode, current.windSpeed, 0, 8);
            this.createZoneEffects(forecast.weatherCode, forecast.windSpeed, 8, 8);
        }

        // Update active systems and clean up dead ones
        this.activeSystems = this.activeSystems.filter(s => {
            let keep = true;
            if (s.type === 'cloud') {
                keep = s.system.update(delta);
                if (!keep) s.system.dispose();
            } else {
                // Rain/Snow
                keep = this.updateParticleSystem(s.system, delta);
                if (!keep) {
                    this.scene.remove(s.system);
                    s.system.geometry.dispose();
                    s.system.material.dispose();
                }
            }
            return keep;
        });

        this.updateSplashes();
    }

    // Accessor for the main loop to grab the extra ambient intensity
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
            const cloudSys = new CloudSystem(this.scene, this.camera);
            for(let i=0; i<count; i++) {
                cloudSys.addCloud(zone, windSpeed);
            }
            this.activeSystems.push({ type: 'cloud', system: cloudSys });
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

        // Upgraded: Use ShaderMaterial for distance fading
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

        const system = new THREE.LineSegments(geometry, material);
        system.userData = {
            type: 'rain',
            velocities: velocities,
            states: states,
            zone: zone,
            windSpeed: windSpeed,
            state: 'fading_in',
            fadeTimer: 0,
            fadeDuration: 5.0,
            targetOpacity: 0.6
        };

        this.scene.add(system);
        this.activeSystems.push({ type: 'rain', system: system });
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

    updateParticleSystem(system, delta) {
        const userData = system.userData;
        let currentOpacity = 0;

        // Handle Fade Logic (Calculate target opacity)
        if (userData.state === 'fading_in') {
            userData.fadeTimer += delta;
            currentOpacity = Math.min(userData.targetOpacity, (userData.fadeTimer / userData.fadeDuration) * userData.targetOpacity);
            if (userData.fadeTimer >= userData.fadeDuration) {
                userData.state = 'stable';
                currentOpacity = userData.targetOpacity;
            }
        } else if (userData.state === 'fading_out') {
            if (userData.fadingOutTimer === undefined) userData.fadingOutTimer = 0;
            userData.fadingOutTimer += delta;
            currentOpacity = Math.max(0.0, userData.targetOpacity - (userData.fadingOutTimer / userData.fadeDuration) * userData.targetOpacity);
            if (userData.fadingOutTimer >= userData.fadeDuration) {
                return false; // Destroy
            }
        } else {
            currentOpacity = userData.targetOpacity;
        }

        // Apply Opacity
        if (userData.type === 'rain') {
            // ShaderMaterial uses uniform
            if (system.material.uniforms) {
                system.material.uniforms.uOpacity.value = currentOpacity;
            }
        } else {
            // Standard Material
            system.material.opacity = currentOpacity;
        }

        // Update Physics
        if (userData.type === 'rain') {
            this.updateRain(system, userData.windSpeed, userData.zone, delta);
        } else if (userData.type === 'snow') {
            this.updateSnow(system, userData.windSpeed, userData.zone, delta);
        }

        return true;
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

                    // Safety check for sundialGroup
                    if (this.sundialGroup && headX * headX + headZ * headZ < 12) {
                        this.raycaster.set(new THREE.Vector3(headX, headY+1, headZ), this.downVector);
                        this.raycaster.far = 2.0;
                        const intersects = this.raycaster.intersectObject(this.sundialGroup, true);
                        if (intersects.length > 0) {
                            const hit = intersects[0];
                            this.spawnSplash(hit.point);
                            this.resetRainParticle(positions, velocities, states, i, zone, windSpeed);
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
            opacity: 0.0, // Fade in
            map: createCloudTexture(),
            depthWrite: false
        });

        const system = new THREE.Points(geometry, material);
        system.userData = {
            type: 'snow',
            velocities: velocities,
            offsets: offsets,
            zone: zone,
            windSpeed: windSpeed,
            state: 'fading_in',
            fadeTimer: 0,
            fadeDuration: 5.0,
            targetOpacity: 0.8
        };
        this.activeSystems.push({ type: 'snow', system: system });
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

            // Curl Noise Simulation
            // We use the curlNoise helper
            const px = positions[i];
            const py = positions[i+1];
            const pz = positions[i+2];

            // Add randomness from offsets
            const curl = curlNoise(px * 0.1, py * 0.1, pz * 0.1, time + offsets[idx] * 0.01);

            // Apply curl influence to movement (flutter)
            // Snow falls (velocities.y) + wind + curl

            positions[i] += velocities[i] + windX + curl.x * 0.05;
            positions[i + 1] += velocities[i + 1] + curl.y * 0.05;
            positions[i + 2] += velocities[i + 2] + curl.z * 0.05;

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

        // Trigger global flash
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
        this.activeSystems.forEach(s => {
            if (s.type === 'cloud') {
                s.system.dispose();
            } else {
                this.scene.remove(s.system);
                s.system.geometry.dispose();
                s.system.material.dispose();
            }
        });
        this.activeSystems = [];
    }
}
