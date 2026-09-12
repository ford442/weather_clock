import * as THREE from 'three';

/**
 * Small canvas-texture label. Sprites are used rather than CSS overlays so the
 * labels live in the same rotating sky group as the thing they name and need no
 * per-frame DOM projection.
 * @param {string} text
 * @param {string} color
 * @param {{width?: number, height?: number, font?: string}} [options]
 * @returns {THREE.Sprite}
 */
export function createTextSprite(text, color, options = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = options.width ?? 256;
    canvas.height = options.height ?? 64;
    // A freshly created 2D canvas always has a context; the cast keeps
    // strictNullChecks happy without a runtime guard that can never fire.
    const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    ctx.font = options.font ?? '600 30px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        fog: false,
        opacity: 0
    });
    const sprite = new THREE.Sprite(material);
    sprite.renderOrder = -1;
    return sprite;
}
