import * as THREE from 'three';

// --- Shared Resources Manager ---
const ResourceManager = {
    cloudTextures: {},
    getCloudTexture: function (type = 'cumulus') {
        if (!this.cloudTextures[type]) {
            if (type === 'stratus') this.cloudTextures[type] = createStratusTexture();
            else if (type === 'cirrus') this.cloudTextures[type] = createCirrusTexture();
            else this.cloudTextures[type] = createCumulusTexture();
        }
        return this.cloudTextures[type];
    }
};

export { ResourceManager };

// Fluffy cumulus puff texture: bright top, soft shadow at base
export function createCumulusTexture() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);

    const cx = size / 2,
        cy = size / 2;

    // Base elliptical shape: bottom-flat, top-rounded
    const baseGrad = ctx.createRadialGradient(cx, cy * 0.88, size * 0.06, cx, cy * 0.88, size * 0.48);
    baseGrad.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
    baseGrad.addColorStop(0.5, 'rgba(248, 250, 255, 0.10)');
    baseGrad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
    ctx.fillStyle = baseGrad;
    ctx.fillRect(0, 0, size, size);

    // Layered puff blobs: biased toward top half for dome shape
    const numPuffs = 200;
    for (let i = 0; i < numPuffs; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.pow(Math.random(), 0.55) * (size * 0.38);
        // Bias puffs toward the top half
        const px = cx + Math.cos(angle) * dist;
        const py = cy * 0.85 + Math.sin(angle) * dist * (Math.sin(angle) < 0 ? 0.6 : 1.05);

        const r = size * (0.04 + Math.random() * 0.14);
        // Brighter on top, cooler on bottom
        const brightness = py < cy ? 250 + Math.random() * 5 : 232 + Math.random() * 12;
        const blueShift = py > cy ? 5 + Math.random() * 8 : 0;
        const opacity = 0.03 + Math.random() * 0.11;

        const grad = ctx.createRadialGradient(px, py, 0, px, py, r);
        grad.addColorStop(0, `rgba(${brightness}, ${brightness}, ${brightness + blueShift}, ${opacity})`);
        grad.addColorStop(0.5, `rgba(${brightness}, ${brightness}, ${brightness + blueShift}, ${opacity * 0.5})`);
        grad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
    }

    // Bright specular highlights at the top peaks
    for (let i = 0; i < 6; i++) {
        const px = cx + (Math.random() - 0.5) * size * 0.28;
        const py = cy * (0.4 + Math.random() * 0.45);
        const r = size * (0.04 + Math.random() * 0.07);
        const grad = ctx.createRadialGradient(px, py, 0, px, py, r);
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.40)');
        grad.addColorStop(0.4, 'rgba(255, 255, 255, 0.18)');
        grad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
    }

    // Bottom shadow gradient (blue-grey underside)
    const shadowGrad = ctx.createLinearGradient(0, cy * 0.9, 0, size);
    shadowGrad.addColorStop(0, 'rgba(190, 200, 220, 0.0)');
    shadowGrad.addColorStop(0.5, 'rgba(175, 185, 210, 0.07)');
    shadowGrad.addColorStop(1, 'rgba(150, 162, 195, 0.16)');
    ctx.fillStyle = shadowGrad;
    ctx.fillRect(0, cy * 0.9, size, size);

    // Subtle pixel-level noise for organic feel
    const imgData = ctx.getImageData(0, 0, size, size);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 0) {
            const noise = (Math.random() - 0.5) * 14;
            data[i] = Math.max(0, Math.min(255, data[i] + noise));
            data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
            data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
        }
    }
    ctx.putImageData(imgData, 0, 0);
    return new THREE.CanvasTexture(canvas);
}

// Flat stratus/nimbostratus texture: wide, grey, layered sheets
export function createStratusTexture() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);

    // Wide soft base
    const baseGrad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.5);
    baseGrad.addColorStop(0, 'rgba(195, 200, 215, 0.28)');
    baseGrad.addColorStop(0.45, 'rgba(205, 210, 225, 0.14)');
    baseGrad.addColorStop(0.85, 'rgba(215, 220, 235, 0.05)');
    baseGrad.addColorStop(1, 'rgba(215, 220, 235, 0.0)');
    ctx.fillStyle = baseGrad;
    ctx.fillRect(0, 0, size, size);

    // Horizontal layered bands
    for (let i = 0; i < 10; i++) {
        const bandY = size * (0.25 + Math.random() * 0.5);
        const bandH = size * (0.06 + Math.random() * 0.14);
        const grey = 175 + Math.random() * 35;
        const opacity = 0.04 + Math.random() * 0.09;
        const grad = ctx.createLinearGradient(0, bandY - bandH, 0, bandY + bandH);
        grad.addColorStop(0, `rgba(${grey}, ${grey + 4}, ${grey + 14}, 0.0)`);
        grad.addColorStop(0.5, `rgba(${grey}, ${grey + 4}, ${grey + 14}, ${opacity})`);
        grad.addColorStop(1, `rgba(${grey}, ${grey + 4}, ${grey + 14}, 0.0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(size * 0.04, bandY - bandH, size * 0.92, bandH * 2);
    }

    // Wide flat elliptical blobs
    for (let i = 0; i < 55; i++) {
        const px = Math.random() * size;
        const py = size * (0.28 + Math.random() * 0.44);
        const rx = size * (0.12 + Math.random() * 0.22);
        const ry = size * (0.025 + Math.random() * 0.055);
        const grey = 180 + Math.random() * 28;
        const opacity = 0.025 + Math.random() * 0.065;
        ctx.save();
        ctx.translate(px, py);
        ctx.scale(1, ry / rx);
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
        grad.addColorStop(0, `rgba(${grey}, ${grey + 4}, ${grey + 12}, ${opacity})`);
        grad.addColorStop(1, 'rgba(215, 220, 235, 0.0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, rx, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // Darker bottom (rain-laden underside)
    const shadowGrad = ctx.createLinearGradient(0, size * 0.45, 0, size);
    shadowGrad.addColorStop(0, 'rgba(135, 140, 160, 0.0)');
    shadowGrad.addColorStop(0.6, 'rgba(120, 125, 148, 0.12)');
    shadowGrad.addColorStop(1, 'rgba(100, 108, 135, 0.22)');
    ctx.fillStyle = shadowGrad;
    ctx.fillRect(0, size * 0.45, size, size * 0.55);
    return new THREE.CanvasTexture(canvas);
}

// Thin cirrus texture: wispy elongated ice-crystal streaks
export function createCirrusTexture() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);

    // Very thin wispy streaks
    for (let i = 0; i < 22; i++) {
        const startX = Math.random() * size * 0.25;
        const endX = startX + size * (0.45 + Math.random() * 0.45);
        const y = size * (0.3 + Math.random() * 0.4);
        const thickness = 2.5 + Math.random() * 7;
        const angle = (Math.random() - 0.5) * 0.14;

        ctx.save();
        ctx.translate(size / 2, size / 2);
        ctx.rotate(angle);
        ctx.translate(-size / 2, -size / 2);

        const opacity = 0.06 + Math.random() * 0.16;
        const grad = ctx.createLinearGradient(startX, y, endX, y);
        grad.addColorStop(0, 'rgba(238, 244, 255, 0.0)');
        grad.addColorStop(0.1, `rgba(238, 244, 255, ${opacity})`);
        grad.addColorStop(0.5, `rgba(244, 250, 255, ${opacity * 1.5})`);
        grad.addColorStop(0.9, `rgba(238, 244, 255, ${opacity})`);
        grad.addColorStop(1, 'rgba(238, 244, 255, 0.0)');

        ctx.strokeStyle = grad;
        ctx.lineWidth = thickness;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(startX, y);
        const cpY = y + (Math.random() - 0.5) * size * 0.055;
        ctx.quadraticCurveTo((startX + endX) / 2, cpY, endX, y + (Math.random() - 0.5) * size * 0.03);
        ctx.stroke();

        // Thin filament tails
        for (let j = 0; j < 4; j++) {
            const fStartX = startX + Math.random() * (endX - startX) * 0.6;
            const fLen = (endX - startX) * (0.08 + Math.random() * 0.25);
            const fY = y + (Math.random() - 0.5) * 18;
            const fOp = opacity * (0.3 + Math.random() * 0.3);
            const fGrad = ctx.createLinearGradient(fStartX, fY, fStartX + fLen, fY + (Math.random() - 0.5) * 14);
            fGrad.addColorStop(0, 'rgba(238, 244, 255, 0.0)');
            fGrad.addColorStop(0.5, `rgba(238, 244, 255, ${fOp})`);
            fGrad.addColorStop(1, 'rgba(238, 244, 255, 0.0)');
            ctx.strokeStyle = fGrad;
            ctx.lineWidth = 1 + Math.random() * 2.5;
            ctx.beginPath();
            ctx.moveTo(fStartX, fY);
            ctx.lineTo(fStartX + fLen, fY + (Math.random() - 0.5) * 14);
            ctx.stroke();
        }
        ctx.restore();
    }

    // Very subtle central glow
    const glow = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.5);
    glow.addColorStop(0, 'rgba(248, 252, 255, 0.06)');
    glow.addColorStop(1, 'rgba(248, 252, 255, 0.0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
}

export function createFogTexture() {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(215, 225, 240, 0.55)');
    grad.addColorStop(0.4, 'rgba(210, 220, 238, 0.28)');
    grad.addColorStop(0.8, 'rgba(205, 215, 235, 0.08)');
    grad.addColorStop(1, 'rgba(200, 215, 235, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
}
