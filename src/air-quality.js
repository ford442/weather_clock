// Pure mapping helpers for air quality / pollen / alert severity → UI + scene values.
// No fetch, no DOM — kept side-effect free so it's trivially unit-testable.

// US EPA AQI breakpoints (0-500 scale).
const US_AQI_CATEGORIES = [
    { max: 50, label: 'Good', color: '#5fbf5f' },
    { max: 100, label: 'Moderate', color: '#e8d84a' },
    { max: 150, label: 'Unhealthy (Sensitive)', color: '#f0a04a' },
    { max: 200, label: 'Unhealthy', color: '#e05a5a' },
    { max: 300, label: 'Very Unhealthy', color: '#a25ac7' },
    { max: Infinity, label: 'Hazardous', color: '#7e2340' }
];

/**
 * @param {number|null|undefined} usAqi
 * @returns {{label: string, color: string, severity01: number}|null}
 */
export function getUsAqiCategory(usAqi) {
    if (usAqi == null || Number.isNaN(usAqi)) return null;
    const category = US_AQI_CATEGORIES.find((c) => usAqi <= c.max) ?? US_AQI_CATEGORIES[US_AQI_CATEGORIES.length - 1];
    const severity01 = Math.max(0, Math.min(1, usAqi / 300));
    return { label: category.label, color: category.color, severity01 };
}

/**
 * Normalized 0..1 haze contribution for the fog/scene integration.
 * 0 at "Good" (<=50), ramps to 1 by "Unhealthy" (>=200).
 * @param {number|null|undefined} usAqi
 */
export function getAqiHaze(usAqi) {
    if (usAqi == null || Number.isNaN(usAqi)) return 0;
    return Math.max(0, Math.min(1, (usAqi - 50) / 150));
}

const POLLEN_THRESHOLDS = [
    { max: 10, label: 'Low', color: '#5fbf5f' },
    { max: 30, label: 'Moderate', color: '#e8d84a' },
    { max: 70, label: 'High', color: '#f0a04a' },
    { max: Infinity, label: 'Very High', color: '#e05a5a' }
];

/**
 * @param {number|null|undefined} grainsPerM3
 * @returns {{label: string, color: string}|null}
 */
export function getPollenSeverity(grainsPerM3) {
    if (grainsPerM3 == null || Number.isNaN(grainsPerM3)) return null;
    const tier = POLLEN_THRESHOLDS.find((t) => grainsPerM3 <= t.max) ?? POLLEN_THRESHOLDS[POLLEN_THRESHOLDS.length - 1];
    return { label: tier.label, color: tier.color };
}

/**
 * Pick the single highest pollen reading from an airQuality.pollen bag for a compact chip.
 * @param {{birch?: number|null, grass?: number|null, ragweed?: number|null}|null|undefined} pollen
 */
export function getDominantPollen(pollen) {
    if (!pollen) return null;
    const entries = Object.entries(pollen).filter(([, v]) => v != null && !Number.isNaN(v));
    if (entries.length === 0) return null;
    const [type, value] = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
    return { type, value, ...getPollenSeverity(value) };
}

const NWS_SEVERITY_ORDER = ['Unknown', 'Minor', 'Moderate', 'Severe', 'Extreme'];

/**
 * @param {string|null|undefined} severity NWS alert `properties.severity`
 * @returns {{color: string, pulse: boolean}}
 */
export function getAlertSeverityStyle(severity) {
    const rank = NWS_SEVERITY_ORDER.indexOf(severity ?? 'Unknown');
    if (rank >= 3) return { color: '#e05a5a', pulse: true }; // Severe / Extreme
    if (rank === 2) return { color: '#f0a04a', pulse: false }; // Moderate
    return { color: '#e8d84a', pulse: false }; // Minor / Unknown
}

export function isPulseSeverity(severity) {
    return severity === 'Severe' || severity === 'Extreme';
}
