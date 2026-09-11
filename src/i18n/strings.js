/**
 * Minimal i18n layer: a string table keyed by locale, plus Intl-backed
 * date/time/number formatting helpers shared across the app.
 *
 * Add a new locale by adding a key to STRINGS with the same shape as `en`.
 */

/**
 * @typedef {Object} StringTable
 * @property {string} offline
 * @property {(time: string) => string} offlineWithTime
 * @property {string} offlineCachedData
 * @property {(time: string) => string} offlineCachedWeatherAt
 * @property {string} offlineNoCachedData
 * @property {string} weatherLoadFailed
 * @property {string} locationNotDetected
 * @property {(query: string) => string} noResultsFor
 * @property {string} timeWarpDisabledReducedMotion
 * @property {(tier: string, reason: string) => string} qualityChanged
 * @property {(tier: string) => string} qualityChangeFailed
 * @property {string} graphicsInitFailed
 * @property {string} graphicsRecoveryFailed
 * @property {string} graphicsDeviceReset
 * @property {string} photoSaved
 * @property {string} photoShared
 * @property {string} photoCaptureFailed
 * @property {string} timelapseDisabledReducedMotion
 * @property {string} videoRecordingUnsupported
 * @property {string} noWebmCodec
 * @property {string} timelapseCancelled
 * @property {string} timelapseSaved
 * @property {string} timelapseNoData
 * @property {string} timelapseExportFailed
 * @property {string} newVersionAvailable
 * @property {string} reload
 * @property {string} appReadyOffline
 * @property {(args: {description?: string, temp?: number|string, unit?: string, precip?: string, sunset?: string}) => string} sceneSummary
 */

/** @type {Record<string, StringTable>} */
const STRINGS = {
    en: {
        offline: 'Offline',
        offlineWithTime: (time) => `Offline — showing data from ${time}`,
        offlineCachedData: 'Offline — showing cached data',
        offlineCachedWeatherAt: (time) => `Showing cached weather from ${time}`,
        offlineNoCachedData: 'Offline — no cached weather data available',
        weatherLoadFailed: 'Failed to load weather data. Check your connection.',
        locationNotDetected: 'Could not detect location. Try searching for a city.',
        noResultsFor: (query) => `No results found for "${query}"`,
        timeWarpDisabledReducedMotion: 'Time warp is disabled while reduced motion is enabled.',
        qualityChanged: (tier, reason) => `Quality changed to ${tier}${reason}.`,
        qualityChangeFailed: (tier) => `Could not apply ${tier} quality live. Reloading scene...`,
        graphicsInitFailed: 'Graphics initialization failed. Reload the page to try again.',
        graphicsRecoveryFailed: 'Graphics recovery failed. Reload the page to continue.',
        graphicsDeviceReset: 'Graphics device reset. Recovering with WebGL…',
        photoSaved: 'Photo saved.',
        photoShared: 'Photo shared.',
        photoCaptureFailed: 'Photo capture failed. Try again.',
        timelapseDisabledReducedMotion: 'Time-lapse export is disabled while reduced motion is enabled.',
        videoRecordingUnsupported: 'Video recording is not supported in this browser.',
        noWebmCodec: 'No supported WebM codec found for time-lapse export.',
        timelapseCancelled: 'Time-lapse cancelled.',
        timelapseSaved: 'Time-lapse saved.',
        timelapseNoData: 'Time-lapse failed — no video data was recorded.',
        timelapseExportFailed: 'Time-lapse export failed. Try again.',
        newVersionAvailable: 'A new version is available.',
        reload: 'Reload',
        appReadyOffline: 'App ready for offline use.',
        sceneSummary: ({ description, temp, unit, precip, sunset }) => {
            let s = `${description}, ${temp}°${unit}`;
            if (precip) s += `, ${precip}`;
            if (sunset) s += `, sun sets at ${sunset}`;
            return s;
        }
    },
    es: {
        offline: 'Sin conexión',
        offlineWithTime: (time) => `Sin conexión — datos de las ${time}`,
        offlineCachedData: 'Sin conexión — mostrando datos en caché',
        offlineCachedWeatherAt: (time) => `Mostrando el clima en caché desde las ${time}`,
        offlineNoCachedData: 'Sin conexión — no hay datos del clima en caché',
        weatherLoadFailed: 'No se pudo cargar el clima. Comprueba tu conexión.',
        locationNotDetected: 'No se pudo detectar la ubicación. Prueba a buscar una ciudad.',
        noResultsFor: (query) => `No se encontraron resultados para "${query}"`,
        timeWarpDisabledReducedMotion: 'El salto temporal está desactivado porque el movimiento reducido está activo.',
        qualityChanged: (tier, reason) => `Calidad cambiada a ${tier}${reason}.`,
        qualityChangeFailed: (tier) => `No se pudo aplicar la calidad ${tier} en vivo. Recargando escena...`,
        graphicsInitFailed: 'Error al iniciar los gráficos. Recarga la página para volver a intentarlo.',
        graphicsRecoveryFailed: 'No se pudo recuperar los gráficos. Recarga la página para continuar.',
        graphicsDeviceReset: 'Dispositivo gráfico reiniciado. Recuperando con WebGL…',
        photoSaved: 'Foto guardada.',
        photoShared: 'Foto compartida.',
        photoCaptureFailed: 'No se pudo capturar la foto. Inténtalo de nuevo.',
        timelapseDisabledReducedMotion:
            'La exportación de lapso de tiempo está desactivada porque el movimiento reducido está activo.',
        videoRecordingUnsupported: 'La grabación de vídeo no es compatible con este navegador.',
        noWebmCodec: 'No se encontró ningún códec WebM compatible para exportar el lapso de tiempo.',
        timelapseCancelled: 'Lapso de tiempo cancelado.',
        timelapseSaved: 'Lapso de tiempo guardado.',
        timelapseNoData: 'Error en el lapso de tiempo — no se grabaron datos de vídeo.',
        timelapseExportFailed: 'Error al exportar el lapso de tiempo. Inténtalo de nuevo.',
        newVersionAvailable: 'Hay una nueva versión disponible.',
        reload: 'Recargar',
        appReadyOffline: 'La aplicación está lista para uso sin conexión.',
        sceneSummary: ({ description, temp, unit, precip, sunset }) => {
            let s = `${description}, ${temp}°${unit}`;
            if (precip) s += `, ${precip}`;
            if (sunset) s += `, el sol se pone a las ${sunset}`;
            return s;
        }
    }
};

const SUPPORTED_LOCALES = Object.keys(STRINGS);
const FALLBACK_LOCALE = 'en';
const LOCALE_STORAGE_KEY = 'weatherclock_locale';

/** @param {string} [tag] */
function baseLanguage(tag) {
    return String(tag || '')
        .split('-')[0]
        .toLowerCase();
}

let currentLocale = null;

/** Resolve the active locale: explicit override > browser language > fallback. */
export function getLocale() {
    if (currentLocale) return currentLocale;
    try {
        const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
        if (stored && SUPPORTED_LOCALES.includes(stored)) {
            currentLocale = stored;
            return currentLocale;
        }
    } catch (_) {
        // localStorage unavailable (private mode, etc.) — fall through.
    }
    const browserLang = baseLanguage(typeof navigator !== 'undefined' ? navigator.language : FALLBACK_LOCALE);
    currentLocale = SUPPORTED_LOCALES.includes(browserLang) ? browserLang : FALLBACK_LOCALE;
    return currentLocale;
}

/** Return the raw BCP-47 tag to hand to Intl formatters (browser locale, not the string-table key). */
export function getIntlLocale() {
    return (typeof navigator !== 'undefined' && navigator.language) || getLocale();
}

/** @param {string} locale */
export function setLocale(locale) {
    if (!SUPPORTED_LOCALES.includes(locale)) return;
    currentLocale = locale;
    try {
        localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch (_) {
        // Ignore persistence failures.
    }
}

/**
 * Look up a string (or string-builder function) by key for the active locale.
 * @param {keyof StringTable} key
 * @param {...any} args passed through when the entry is a function
 * @returns {string}
 */
export function t(key, ...args) {
    const table = STRINGS[getLocale()] || STRINGS[FALLBACK_LOCALE];
    const entry = table[key] ?? STRINGS[FALLBACK_LOCALE][key];
    if (typeof entry === 'function') return /** @type {(...a: any[]) => string} */ (entry)(...args);
    return entry ?? key;
}

// ── Intl-backed formatting helpers ──────────────────────────────────────────

/**
 * @param {Date|null|undefined} date
 * @param {Intl.DateTimeFormatOptions} [options]
 */
export function formatTime(date, options = {}) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return '--:--';
    return new Intl.DateTimeFormat(getIntlLocale(), {
        hour: 'numeric',
        minute: '2-digit',
        ...options
    }).format(date);
}

/**
 * @param {Date|null|undefined} date
 * @param {Intl.DateTimeFormatOptions} [options]
 */
export function formatDate(date, options = {}) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return '--';
    return new Intl.DateTimeFormat(getIntlLocale(), {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        ...options
    }).format(date);
}

/**
 * @param {number|null|undefined} value
 * @param {Intl.NumberFormatOptions} [options]
 */
export function formatNumber(value, options = {}) {
    if (value == null || isNaN(value)) return '--';
    return new Intl.NumberFormat(getIntlLocale(), options).format(value);
}

/**
 * Format a temperature value with its degree unit (°C / °F), locale-aware digit grouping.
 * @param {number|null|undefined} value
 * @param {string} [unit]
 * @param {Intl.NumberFormatOptions} [options]
 */
export function formatTemp(value, unit = 'C', options = {}) {
    if (value == null || isNaN(value)) return '--°';
    return `${formatNumber(value, { maximumFractionDigits: 0, ...options })}°${unit}`;
}

export { SUPPORTED_LOCALES };
