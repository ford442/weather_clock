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
    // Already filtered to non-null/non-NaN values above.
    const [type, value] = entries.reduce((a, b) => ((b[1] ?? -Infinity) > (a[1] ?? -Infinity) ? b : a));
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

// European AQI (0-100+ scale, EEA bands).
const EU_AQI_CATEGORIES = [
    { max: 20, label: 'Good', color: '#5fbf5f' },
    { max: 40, label: 'Fair', color: '#a8d24a' },
    { max: 60, label: 'Moderate', color: '#e8d84a' },
    { max: 80, label: 'Poor', color: '#f0a04a' },
    { max: 100, label: 'Very Poor', color: '#e05a5a' },
    { max: Infinity, label: 'Extremely Poor', color: '#7e2340' }
];

/**
 * @param {number|null|undefined} europeanAqi
 * @returns {{label: string, color: string, severity01: number}|null}
 */
export function getEuropeanAqiCategory(europeanAqi) {
    if (europeanAqi == null || Number.isNaN(europeanAqi)) return null;
    const category =
        EU_AQI_CATEGORIES.find((c) => europeanAqi <= c.max) ?? EU_AQI_CATEGORIES[EU_AQI_CATEGORIES.length - 1];
    const severity01 = Math.max(0, Math.min(1, europeanAqi / 100));
    return { label: category.label, color: category.color, severity01 };
}

// Countries that publish the US EPA AQI rather than the European index. Everywhere
// else the European AQI is the number people recognise, so it leads the chip.
const US_AQI_COUNTRIES = new Set(['us', 'ca', 'mx', 'cn', 'in', 'kr', 'tw', 'th']);

/**
 * Choose which index to lead with for a location, falling back to whichever
 * value actually came back from the API.
 * @param {{usAqi?: number|null, europeanAqi?: number|null}|null|undefined} airQuality
 * @param {string|null|undefined} countryCode ISO 3166-1 alpha-2 (any case)
 * @returns {{scale: 'US'|'EU', value: number, label: string, color: string, severity01: number}|null}
 */
export function getPrimaryAqi(airQuality, countryCode) {
    const us = getUsAqiCategory(airQuality?.usAqi);
    const eu = getEuropeanAqiCategory(airQuality?.europeanAqi);
    const prefersUs = US_AQI_COUNTRIES.has(String(countryCode ?? '').toLowerCase());
    const first = prefersUs ? us : eu;
    const second = prefersUs ? eu : us;
    const chosen = first ?? second;
    if (!chosen) return null;
    const scale = chosen === us ? 'US' : 'EU';
    const value = /** @type {number} */ (scale === 'US' ? airQuality?.usAqi : airQuality?.europeanAqi);
    return { scale, value, ...chosen };
}

// WHO UV index categories.
const UV_CATEGORIES = [
    { max: 2, label: 'Low', color: '#5fbf5f' },
    { max: 5, label: 'Moderate', color: '#e8d84a' },
    { max: 7, label: 'High', color: '#f0a04a' },
    { max: 10, label: 'Very High', color: '#e05a5a' },
    { max: Infinity, label: 'Extreme', color: '#a25ac7' }
];

/**
 * @param {number|null|undefined} uvIndex
 * @returns {{label: string, color: string, advice: string}|null}
 */
export function getUvCategory(uvIndex) {
    if (uvIndex == null || Number.isNaN(uvIndex)) return null;
    const rounded = Math.round(uvIndex);
    const tier = UV_CATEGORIES.find((c) => rounded <= c.max) ?? UV_CATEGORIES[UV_CATEGORIES.length - 1];
    const advice =
        rounded <= 2
            ? 'No protection needed'
            : rounded <= 5
              ? 'Seek shade at midday'
              : rounded <= 7
                ? 'Sunscreen and a hat'
                : rounded <= 10
                  ? 'Avoid the midday sun'
                  : 'Stay indoors at midday';
    return { label: tier.label, color: tier.color, advice };
}

/**
 * Normalized 0..1 "sun harshness" from the UV index: 0 at or below the WHO
 * "High" threshold (6), ramping to 1 at the top of the scale (11).
 * @param {number|null|undefined} uvIndex
 */
export function getUvHarshness(uvIndex) {
    if (uvIndex == null || Number.isNaN(uvIndex)) return 0;
    return Math.max(0, Math.min(1, (uvIndex - 6) / 5));
}

/**
 * Scene-facing multipliers derived from the UV index. Sun glare brightens and
 * the sky picks up a little more forward (Mie) scattering on harsh-UV days.
 * @param {number|null|undefined} uvIndex
 */
export function getUvSunHarshness(uvIndex) {
    const harshness = getUvHarshness(uvIndex);
    return {
        harshness,
        sunIntensityMultiplier: 1 + harshness * 0.3,
        mieBoost: harshness * 0.012
    };
}

/**
 * Normalized 0..1 pollen load for the scene particles, from the strongest of
 * the tree/grass/weed readings. 0 below "Moderate" (20 grains/m³), 1 at 100.
 * @param {{birch?: number|null, grass?: number|null, ragweed?: number|null}|null|undefined} pollen
 */
export function getPollenIntensity(pollen) {
    const dominant = getDominantPollen(pollen);
    if (!dominant) return 0;
    return Math.max(0, Math.min(1, ((dominant.value ?? 0) - 20) / 80));
}

/**
 * Classify an NWS alert into the three tiers the UI and scene theme react to.
 * The event name carries the watch/warning distinction; severity carries the
 * jump to an emergency (e.g. "Tornado Emergency", Extreme severity).
 * @param {{event?: string|null, severity?: string|null}|null|undefined} alert
 * @returns {'watch'|'warning'|'emergency'}
 */
export function getAlertTier(alert) {
    const event = String(alert?.event ?? '').toLowerCase();
    const severity = alert?.severity ?? 'Unknown';
    if (severity === 'Extreme' || event.includes('emergency')) return 'emergency';
    if (severity === 'Severe' || event.includes('warning')) return 'warning';
    return 'watch';
}

const ALERT_TIER_THEMES = {
    watch: { color: '#e8d84a', pulse: false, pulseSpeed: 0, accentBoost: 0.12 },
    warning: { color: '#f0704a', pulse: true, pulseSpeed: 0.004, accentBoost: 0.35 },
    emergency: { color: '#e0364a', pulse: true, pulseSpeed: 0.009, accentBoost: 0.55 }
};

/**
 * Color / pulse theming for an alert tier, used by both the banner and
 * atmosphereTheme's accent pulse.
 * @param {'watch'|'warning'|'emergency'} tier
 */
export function getAlertTierTheme(tier) {
    return ALERT_TIER_THEMES[tier] ?? ALERT_TIER_THEMES.watch;
}
