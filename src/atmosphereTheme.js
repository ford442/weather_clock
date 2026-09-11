import { getAlertTier, getAlertTierTheme } from './air-quality.js';

// ── Smooth interpolation state ──
const target = {
    skyR: 10,
    skyG: 12,
    skyB: 18,
    accentR: 232,
    accentG: 168,
    accentB: 56
};

const current = {
    skyR: 10,
    skyG: 12,
    skyB: 18,
    accentR: 232,
    accentG: 168,
    accentB: 56
};

const LERP_FACTOR = 0.05;

const TEMP_ACCENTS = [
    { max: 0, r: 46, g: 92, b: 138 }, // #2E5C8A arctic
    { max: 15, r: 90, g: 172, b: 184 }, // #5AACB8 cool
    { max: 25, r: 126, g: 184, b: 218 }, // #7EB8DA neutral
    { max: 32, r: 232, g: 168, b: 56 }, // #E8A838 warm
    { max: Infinity, r: 212, g: 114, b: 106 } // #D4726A hot
];

function getAccentForTemp(celsius) {
    for (const entry of TEMP_ACCENTS) {
        if (celsius < entry.max) {
            return { r: entry.r, g: entry.g, b: entry.b };
        }
    }
    const last = TEMP_ACCENTS[TEMP_ACCENTS.length - 1];
    return { r: last.r, g: last.g, b: last.b };
}

function deriveSkyColor(scene, weatherData) {
    // Default to midday values
    let sunY = 0.5;
    let cloudCover = 0;
    let severity = 0;

    if (weatherData && weatherData.current) {
        cloudCover = weatherData.current.cloudCover ?? 0;
        severity = weatherData.current.severity ?? 0;
    }

    // Sample the sky object's sunPosition uniform if available
    scene.traverse((obj) => {
        if (obj.isMesh && obj.material && obj.material.uniforms && obj.material.uniforms.sunPosition) {
            const sunPos = obj.material.uniforms.sunPosition.value;
            if (sunPos) sunY = sunPos.y;
        }
    });

    const twilight = 0.3;
    let r, g, b;

    if (sunY < -twilight) {
        // Night — deep indigo
        r = 5;
        g = 8;
        b = 25;
    } else if (sunY > twilight) {
        // Day — sky blue
        r = 100;
        g = 180;
        b = 255;
    } else {
        // Twilight — night → amber → day
        const t = (sunY + twilight) / (twilight * 2);
        const night = { r: 5, g: 8, b: 25 };
        const dawn = { r: 255, g: 170, b: 85 };
        const day = { r: 100, g: 180, b: 255 };

        if (t < 0.5) {
            const lt = t * 2;
            r = night.r + (dawn.r - night.r) * lt;
            g = night.g + (dawn.g - night.g) * lt;
            b = night.b + (dawn.b - night.b) * lt;
        } else {
            const lt = (t - 0.5) * 2;
            r = dawn.r + (day.r - dawn.r) * lt;
            g = dawn.g + (day.g - dawn.g) * lt;
            b = dawn.b + (day.b - dawn.b) * lt;
        }
    }

    // Desaturate toward grey based on cloud cover
    if (cloudCover > 0) {
        const factor = cloudCover / 100;
        const grey = (r + g + b) / 3;
        r = r + (grey - r) * factor * 0.7;
        g = g + (grey - g) * factor * 0.7;
        b = b + (grey - b) * factor * 0.7;
    }

    // Darken based on weather severity
    if (severity > 0) {
        const factor = severity / 100;
        r *= 1 - factor * 0.4;
        g *= 1 - factor * 0.4;
        b *= 1 - factor * 0.4;
    }

    return { r, g, b };
}

// ── Contrast clamp ──
// --accent drives panel heading/text color (see clock-panels.css) and ranges
// from arctic blue to hot red depending on temperature. Against the dark
// glass panel background some of those hues (e.g. the cold end) drop below
// WCAG AA contrast. Brighten the color toward white, preserving hue, until
// it clears a 4.5:1 contrast ratio against the panel background.
const PANEL_BG_REFERENCE = { r: 14, g: 16, b: 22 };
const MIN_TEXT_CONTRAST = 4.5;

function srgbChannelToLinear(c) {
    const cs = c / 255;
    return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}

function relativeLuminance({ r, g, b }) {
    return 0.2126 * srgbChannelToLinear(r) + 0.7152 * srgbChannelToLinear(g) + 0.0722 * srgbChannelToLinear(b);
}

function contrastRatio(colorA, colorB) {
    const lA = relativeLuminance(colorA) + 0.05;
    const lB = relativeLuminance(colorB) + 0.05;
    return lA > lB ? lA / lB : lB / lA;
}

function clampAccentForContrast(color, background = PANEL_BG_REFERENCE) {
    let { r, g, b } = color;
    let iterations = 0;
    while (contrastRatio({ r, g, b }, background) < MIN_TEXT_CONTRAST && iterations < 24) {
        r = Math.min(255, r + (255 - r) * 0.12 + 2);
        g = Math.min(255, g + (255 - g) * 0.12 + 2);
        b = Math.min(255, b + (255 - b) * 0.12 + 2);
        iterations++;
    }
    return { r, g, b };
}

// Active alerts pulse --accent brightness. Watch / warning / emergency each get
// their own pulse rate and amplitude (see getAlertTierTheme).
const TIER_RANK = { watch: 0, warning: 1, emergency: 2 };

function getAlertPulse(weatherData) {
    const alerts = weatherData?.alerts;
    if (!alerts || alerts.length === 0) return { factor: 0, boost: 0 };
    const tier = alerts.map((a) => getAlertTier(a)).reduce((a, b) => (TIER_RANK[b] > TIER_RANK[a] ? b : a), 'watch');
    const theme = getAlertTierTheme(tier);
    if (!theme.pulse) {
        // A watch is a steady, slightly warmer accent rather than a pulse.
        return { factor: 1, boost: theme.accentBoost };
    }
    return { factor: (Math.sin(performance.now() * theme.pulseSpeed) + 1) / 2, boost: theme.accentBoost };
}

/**
 * Sample the 3D scene atmosphere and drive CSS custom properties.
 * @param {import('three').WebGLRenderer} renderer
 * @param {import('three').Scene} scene
 * @param {Object} weatherData
 */
export function updateAtmosphereTheme(renderer, scene, weatherData) {
    if (!document.documentElement) return;

    const skyColor = deriveSkyColor(scene, weatherData);

    let tempC = 20;
    if (weatherData && weatherData.current && weatherData.current.temp != null) {
        tempC = weatherData.current.temp;
    }
    const accent = getAccentForTemp(tempC);

    // Update targets
    target.skyR = skyColor.r;
    target.skyG = skyColor.g;
    target.skyB = skyColor.b;
    target.accentR = accent.r;
    target.accentG = accent.g;
    target.accentB = accent.b;

    // Smooth lerp toward target (~1 s at 60 fps with factor 0.05)
    current.skyR += (target.skyR - current.skyR) * LERP_FACTOR;
    current.skyG += (target.skyG - current.skyG) * LERP_FACTOR;
    current.skyB += (target.skyB - current.skyB) * LERP_FACTOR;
    current.accentR += (target.accentR - current.accentR) * LERP_FACTOR;
    current.accentG += (target.accentG - current.accentG) * LERP_FACTOR;
    current.accentB += (target.accentB - current.accentB) * LERP_FACTOR;

    // Active alerts brighten the accent on top of the temp-driven color: a steady
    // lift for a watch, a pulse (faster for an emergency) for warnings and above.
    const pulse = getAlertPulse(weatherData);
    const pulseBoost = 1 + pulse.factor * pulse.boost;
    const accentR = Math.min(255, current.accentR * pulseBoost);
    const accentG = Math.min(255, current.accentG * pulseBoost);
    const accentB = Math.min(255, current.accentB * pulseBoost);

    // --accent-text is a contrast-clamped copy of the accent color, used only
    // where the temperature-driven accent is rendered as panel text (rather
    // than as a glow/border/background) so headings stay readable against the
    // dark glass panels across the whole hue range.
    const textSafe = clampAccentForContrast({ r: accentR, g: accentG, b: accentB });

    const root = document.documentElement;
    root.style.setProperty(
        '--sky-dominant',
        `rgba(${Math.round(current.skyR)}, ${Math.round(current.skyG)}, ${Math.round(current.skyB)}, 0.6)`
    );
    root.style.setProperty('--accent', `${Math.round(accentR)}, ${Math.round(accentG)}, ${Math.round(accentB)}`);
    root.style.setProperty(
        '--glow',
        `rgba(${Math.round(accentR)}, ${Math.round(accentG)}, ${Math.round(accentB)}, 0.4)`
    );
    root.style.setProperty(
        '--accent-text',
        `${Math.round(textSafe.r)}, ${Math.round(textSafe.g)}, ${Math.round(textSafe.b)}`
    );
}
