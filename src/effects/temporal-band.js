import * as THREE from 'three';
import { SCENE_LAYOUT } from '../scene-layout.js';
import { TEMPORAL_NARRATIVE_CONFIG } from '../temporal-narrative.js';

/**
 * A wide backdrop band that spans the past, present, and future zones and carries the
 * scene's temperature story graphically: blue on the cold side, red on the warm side,
 * blending continuously left-to-right so the three zones read as one scene rather than
 * three boxes. Chevrons drift leftward across it — tilted up while temperature is
 * rising, down while it is falling, flat while it is steady — and a warm shoulder of
 * light lingers on the left so daylight visibly fades into the past.
 *
 * Deliberately texture-driven (canvas + `MeshBasicMaterial`) rather than a custom
 * shader so it behaves identically on the WebGL and WebGPU backends.
 */
export const TEMPORAL_BAND_CONFIG = Object.freeze({
    width: 34,
    height: 11,
    y: 4.6,
    z: -15,
    /** Peak opacity of the temperature gradient plane. */
    gradientOpacity: 0.42,
    /** Peak opacity of the drifting chevron overlay. */
    flowOpacity: 0.3,
    /** Chevron repeats across the band. */
    flowRepeat: 7,
    /** Chevron scroll speed in repeats/second at full change rate. */
    flowSpeed: 0.11,
    /** Redraw the gradient only once a zone colour moves this far (0..1 per channel). */
    redrawThreshold: 0.02,
    gradientTextureWidth: 256,
    gradientTextureHeight: 64,
    flowTextureSize: 128
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * The band states the temperature louder than the neutral-centred narrative tint does:
 * a full cold-blue → warm-amber ramp, so the cold end of time is unmistakably blue and
 * the warm end unmistakably red even after alpha-blending over a bright sky.
 * @param {number} warmth - 0 (cold) … 1 (hot).
 * @returns {[number, number, number]}
 */
function zoneRgb(warmth) {
    const cool = [0.32, 0.62, 1.0];
    const warm = [1.0, 0.46, 0.22];
    const lift = 0.82 + warmth * 0.18;
    return /** @type {[number, number, number]} */ (
        cool.map((c, i) => clamp((c + (warm[i] - c) * warmth) * lift, 0, 1))
    );
}

const toCss = (/** @type {[number, number, number]} */ rgb, alpha) =>
    `rgba(${Math.round(rgb[0] * 255)}, ${Math.round(rgb[1] * 255)}, ${Math.round(rgb[2] * 255)}, ${alpha})`;

/**
 * Bake a soft edge falloff into a plane's vertex alpha so the band dissolves into the
 * sky on every side — independent of the scrolling texture, which cannot fade its own
 * edges once it tiles.
 * @param {THREE.PlaneGeometry} geometry
 * @param {number} width
 * @param {number} height
 * @returns {THREE.PlaneGeometry}
 */
function withEdgeFalloff(geometry, width, height) {
    const position = geometry.attributes.position;
    const colors = new Float32Array(position.count * 4);
    const smooth = (t) => {
        const x = clamp(t, 0, 1);
        return x * x * (3 - 2 * x);
    };
    for (let i = 0; i < position.count; i++) {
        // 0 at each edge, 1 across the middle; the top tapers sooner than the bottom
        // so the band hugs the horizon.
        const u = Math.abs(position.getX(i)) / (width / 2);
        const v = position.getY(i) / (height / 2);
        const horizontal = smooth((1 - u) / 0.3);
        const vertical = v > 0 ? smooth((1 - v) / 0.7) : smooth((1 + v) / 0.5);
        colors[i * 4] = 1;
        colors[i * 4 + 1] = 1;
        colors[i * 4 + 2] = 1;
        colors[i * 4 + 3] = horizontal * vertical;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    return geometry;
}

export class TemporalBand {
    /**
     * @param {THREE.Scene} scene
     */
    constructor(scene) {
        this.scene = scene;
        this.enabled = true;
        this._time = 0;
        this._opacity = 0;
        this._lastWarmShoulder = -1;
        /** @type {[number, number, number][]} Last drawn past/current/future colours. */
        this._lastColors = [
            [-1, -1, -1],
            [-1, -1, -1],
            [-1, -1, -1]
        ];

        const cfg = TEMPORAL_BAND_CONFIG;
        const { past, future } = SCENE_LAYOUT.zones;
        const centerX = (past.minX + future.maxX) / 2;

        this.group = new THREE.Group();
        this.group.position.set(centerX, cfg.y, cfg.z);
        this.group.renderOrder = -2;

        this.gradientCanvas = document.createElement('canvas');
        this.gradientCanvas.width = cfg.gradientTextureWidth;
        this.gradientCanvas.height = cfg.gradientTextureHeight;
        this.gradientCtx = /** @type {CanvasRenderingContext2D} */ (this.gradientCanvas.getContext('2d'));
        this.gradientTexture = new THREE.CanvasTexture(this.gradientCanvas);
        this.gradientTexture.minFilter = THREE.LinearFilter;
        this.gradientTexture.magFilter = THREE.LinearFilter;

        const planeGeometry = withEdgeFalloff(
            new THREE.PlaneGeometry(cfg.width, cfg.height, 16, 8),
            cfg.width,
            cfg.height
        );
        this.gradientMaterial = new THREE.MeshBasicMaterial({
            map: this.gradientTexture,
            vertexColors: true,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        this.gradientMesh = new THREE.Mesh(planeGeometry, this.gradientMaterial);
        this.group.add(this.gradientMesh);

        this.flowTexture = this._createFlowTexture();
        this.flowMaterial = new THREE.MeshBasicMaterial({
            map: this.flowTexture,
            vertexColors: true,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide
        });
        this.flowMesh = new THREE.Mesh(planeGeometry.clone(), this.flowMaterial);
        this.flowMesh.position.z = 0.05;
        this.group.add(this.flowMesh);

        this._drawGradient([0.5, 0.6, 0.8], [0.55, 0.6, 0.75], [0.6, 0.6, 0.7], { warmShoulder: 0, presentGlow: 0.4 });
        this.scene.add(this.group);
    }

    /** Tiling chevron strip: a soft arrow pointing along +X, used for the trend flow. */
    _createFlowTexture() {
        const size = TEMPORAL_BAND_CONFIG.flowTextureSize;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
        ctx.clearRect(0, 0, size, size);

        const gradient = ctx.createLinearGradient(0, 0, size, 0);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
        gradient.addColorStop(0.55, 'rgba(255, 255, 255, 0.85)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.strokeStyle = gradient;
        ctx.lineWidth = size * 0.075;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // One chevron, apex toward -X: the direction time flows in this scene.
        ctx.beginPath();
        ctx.moveTo(size * 0.82, size * 0.14);
        ctx.lineTo(size * 0.2, size * 0.5);
        ctx.lineTo(size * 0.82, size * 0.86);
        ctx.stroke();

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.repeat.set(TEMPORAL_BAND_CONFIG.flowRepeat, 1);
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        return texture;
    }

    /**
     * Repaint the left→right temperature gradient.
     * @param {[number, number, number]} pastRgb
     * @param {[number, number, number]} currentRgb
     * @param {[number, number, number]} futureRgb
     * @param {{warmShoulder: number, presentGlow: number}} accents
     */
    _drawGradient(pastRgb, currentRgb, futureRgb, accents) {
        const { gradientTextureWidth: w, gradientTextureHeight: h } = TEMPORAL_BAND_CONFIG;
        const ctx = this.gradientCtx;
        ctx.clearRect(0, 0, w, h);

        const ramp = ctx.createLinearGradient(0, 0, w, 0);
        ramp.addColorStop(0, toCss(pastRgb, 0));
        ramp.addColorStop(0.24, toCss(pastRgb, 0.9));
        ramp.addColorStop(0.5, toCss(currentRgb, 1));
        ramp.addColorStop(0.76, toCss(futureRgb, 0.9));
        ramp.addColorStop(1, toCss(futureRgb, 0));
        ctx.fillStyle = ramp;
        ctx.fillRect(0, 0, w, h);

        // Warm light lingering in the past: a low amber shoulder on the left that
        // grows as the sun leaves the sky.
        if (accents.warmShoulder > 0.01) {
            ctx.globalCompositeOperation = 'lighter';
            const shoulder = ctx.createLinearGradient(0, 0, w * 0.5, 0);
            shoulder.addColorStop(0, `rgba(255, 176, 94, ${0.55 * accents.warmShoulder})`);
            shoulder.addColorStop(1, 'rgba(255, 176, 94, 0)');
            ctx.fillStyle = shoulder;
            ctx.fillRect(0, 0, w * 0.5, h);

            // The present is where "now" happens — keep a faint core highlight.
            const glow = ctx.createRadialGradient(w * 0.5, h * 0.6, 0, w * 0.5, h * 0.6, w * 0.22);
            glow.addColorStop(0, `rgba(255, 255, 255, ${0.22 * accents.presentGlow})`);
            glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = glow;
            ctx.fillRect(0, 0, w, h);
            ctx.globalCompositeOperation = 'source-over';
        }

        // Vertical weighting — densest near the horizon, thinning upward. The plane's
        // own vertex alpha dissolves every edge, so this only shapes the interior.
        ctx.globalCompositeOperation = 'destination-in';
        const weight = ctx.createLinearGradient(0, 0, 0, h);
        weight.addColorStop(0, 'rgba(0, 0, 0, 0.25)');
        weight.addColorStop(1, 'rgba(0, 0, 0, 1)');
        ctx.fillStyle = weight;
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'source-over';

        this.gradientTexture.needsUpdate = true;
    }

    /**
     * @param {[number, number, number]} a
     * @param {[number, number, number]} b
     */
    _colorsDiffer(a, b) {
        const threshold = TEMPORAL_BAND_CONFIG.redrawThreshold;
        return (
            Math.abs(a[0] - b[0]) > threshold || Math.abs(a[1] - b[1]) > threshold || Math.abs(a[2] - b[2]) > threshold
        );
    }

    /**
     * @param {import('../temporal-narrative.js').TemporalNarrative} narrative
     * @param {number} delta - Seconds since the previous frame.
     */
    update(narrative, delta = 0.016) {
        if (!this.group.visible || !narrative) return;
        const cfg = TEMPORAL_BAND_CONFIG;
        this._time += delta;

        const colors = /** @type {[number, number, number][]} */ ([
            zoneRgb(narrative.past.warmth),
            zoneRgb(narrative.current.warmth),
            zoneRgb(narrative.future.warmth)
        ]);

        // Warm light fading into the past: strongest around dusk, gone at high noon
        // and in the dead of night.
        const warmShoulder = clamp(1 - Math.abs(narrative.dayFactor) * 1.6, 0, 1);
        const presentGlow = clamp(0.35 + narrative.dayFactor * 0.5, 0, 1);
        const needsRedraw =
            this._colorsDiffer(colors[0], this._lastColors[0]) ||
            this._colorsDiffer(colors[1], this._lastColors[1]) ||
            this._colorsDiffer(colors[2], this._lastColors[2]) ||
            Math.abs(warmShoulder - this._lastWarmShoulder) > 0.05;

        if (needsRedraw) {
            this._drawGradient(colors[0], colors[1], colors[2], { warmShoulder, presentGlow });
            this._lastColors = colors;
            this._lastWarmShoulder = warmShoulder;
        }

        // Fade the whole band with how much story there is to tell: a flat, unchanging
        // sky barely shows it; a swinging temperature or a departing storm brings it up.
        const story = clamp(Math.abs(narrative.tempTrend) * 0.75 + narrative.changeRate * 0.6, 0, 1);
        const targetOpacity = cfg.gradientOpacity * (0.35 + story * 0.65);
        this._opacity += (targetOpacity - this._opacity) * Math.min(1, delta * 1.5);
        this.gradientMaterial.opacity = this._opacity;

        // Chevrons: tilt up while warming, down while cooling, flat while steady,
        // always drifting leftward because that is the direction time flows here.
        const trend = narrative.tempTrend;
        const magnitude = Math.abs(trend);
        this.flowMesh.rotation.z = trend * 0.12;
        this.flowMaterial.opacity = cfg.flowOpacity * clamp(magnitude * 0.8 + narrative.changeRate * 0.35, 0, 1);
        const flowTint = trend >= 0 ? TEMPORAL_NARRATIVE_CONFIG.warmTint : TEMPORAL_NARRATIVE_CONFIG.coolTint;
        this.flowMaterial.color.setRGB(flowTint[0], flowTint[1], flowTint[2]);
        this.flowTexture.offset.x -= delta * cfg.flowSpeed * (0.4 + narrative.changeRate + magnitude);
        if (this.flowTexture.offset.x < -1) this.flowTexture.offset.x += 1;
    }

    /** @param {boolean} visible */
    setVisible(visible) {
        this.group.visible = visible;
    }

    dispose() {
        this.scene?.remove?.(this.group);
        this.gradientMesh.geometry.dispose();
        this.flowMesh.geometry.dispose();
        this.gradientMaterial.dispose();
        this.flowMaterial.dispose();
        this.gradientTexture.dispose();
        this.flowTexture.dispose();
    }
}
