/**
 * weatherCache.js - Shared cache policy for weather data.
 *
 * A `TTLCache` is a memory Map, optionally backed by localStorage for
 * persistence across reloads. Each entry is `{ data, timestamp, ...extra }`;
 * `timestamp` drives TTL expiry and eviction ordering.
 *
 * Cache policy by consumer (documented here since it's intentionally not
 * fully unified — see Dependencies note in the tracking issue):
 *  - WeatherService (src/weather.js): localStorage-backed, prefixed
 *    `weatherclock_cache_v1_`, capped at 24 entries on disk, 1h default TTL
 *    (24h for the daily prediction-accuracy entry). Persisted because current
 *    conditions are worth serving stale-while-offline across page reloads.
 *  - TimelineData (src/timeline/TimelineData.js): memory-only, 1h default TTL
 *    (24h for accuracy), capped at 50 in-memory entries. Not persisted to
 *    localStorage: the 21-day timeline payload is large and rebuilt cheaply
 *    from the same in-tab session, so disk persistence isn't worth the quota
 *    pressure it would add on shared origins.
 */

export class TTLCache {
    /**
     * @param {Object} [options]
     * @param {string|null} [options.storagePrefix] - localStorage key prefix; omit/null to keep this cache memory-only.
     * @param {number} [options.maxStorageEntries] - Max localStorage entries under storagePrefix before eviction.
     * @param {number} [options.defaultTtlMs]
     * @param {Map} [options.memory] - Backing Map. Provide one to expose it directly to callers that need it (tests, debugging).
     */
    constructor({ storagePrefix = null, maxStorageEntries = 24, defaultTtlMs = 60 * 60 * 1000, memory } = {}) {
        this.memory = memory ?? new Map();
        this.storagePrefix = storagePrefix;
        this.maxStorageEntries = maxStorageEntries;
        this.defaultTtlMs = defaultTtlMs;
    }

    /**
     * @param {string} key
     * @param {{allowExpired?: boolean, ttlMs?: number}} [options]
     */
    get(key, { allowExpired = false, ttlMs = this.defaultTtlMs } = {}) {
        let cached = this.memory.get(key);

        if (!cached && this.storagePrefix && typeof localStorage !== 'undefined') {
            try {
                const raw = localStorage.getItem(`${this.storagePrefix}${key}`);
                if (raw) {
                    cached = JSON.parse(raw);
                    if (cached) this.memory.set(key, cached);
                }
            } catch (e) {
                console.error('Failed to read from localStorage cache:', e);
            }
        }

        if (!cached) return null;

        const isExpired = Date.now() - cached.timestamp > ttlMs;
        if (isExpired && !allowExpired) {
            this.delete(key);
            return null;
        }

        return cached;
    }

    /**
     * @param {string} key
     * @param {*} data
     * @param {Record<string, unknown>} [extra] - Extra fields merged onto the stored entry (e.g. lat/lon).
     */
    set(key, data, extra = {}) {
        const entry = { data, timestamp: Date.now(), ...extra };
        this.memory.set(key, entry);

        if (!this.storagePrefix || typeof localStorage === 'undefined') return entry;

        const storageKey = `${this.storagePrefix}${key}`;
        const serialized = JSON.stringify(entry);

        try {
            this.#pruneStorage(this.maxStorageEntries - 1, [storageKey]);
            localStorage.setItem(storageKey, serialized);
        } catch (e) {
            console.error('Failed to write to localStorage cache, evicting oldest entries and retrying:', e);
            try {
                // The quota may already be exhausted by other apps sharing this
                // origin; evict more aggressively and retry once before giving up.
                this.#pruneStorage(Math.floor(this.maxStorageEntries / 2), [storageKey]);
                localStorage.setItem(storageKey, serialized);
            } catch (retryError) {
                console.error('Failed to write to localStorage cache after eviction, giving up:', retryError);
            }
        }

        return entry;
    }

    delete(key) {
        this.memory.delete(key);
        if (this.storagePrefix && typeof localStorage !== 'undefined') {
            try {
                localStorage.removeItem(`${this.storagePrefix}${key}`);
            } catch (e) {
                console.error('Failed to delete from localStorage cache:', e);
            }
        }
    }

    clear() {
        this.memory.clear();
    }

    /** Drop expired in-memory entries (storage entries self-expire via TTL checks on read). */
    pruneMemoryExpired(ttlMs = this.defaultTtlMs) {
        const now = Date.now();
        for (const [key, value] of this.memory.entries()) {
            if (now - value.timestamp > ttlMs) this.memory.delete(key);
        }
    }

    /**
     * Keep at most `maxRemaining` entries in localStorage under this cache's
     * prefix, evicting the oldest ones first. `preserveKeys` are never
     * evicted (used to protect the entry currently being written before its
     * own count is reflected in storage).
     */
    #pruneStorage(maxRemaining, preserveKeys = []) {
        if (!this.storagePrefix) return;

        const entries = [];
        for (let i = 0; i < localStorage.length; i++) {
            const storageKey = localStorage.key(i);
            if (!storageKey || !storageKey.startsWith(this.storagePrefix)) continue;
            if (preserveKeys.includes(storageKey)) continue;

            let timestamp = 0;
            try {
                // getItem() can race to null between the key() lookup above and here;
                // JSON.parse(null) coerces to "null" and parses to `null`, same as our catch fallback.
                const parsed = JSON.parse(/** @type {string} */ (localStorage.getItem(storageKey)));
                timestamp = parsed?.timestamp ?? 0;
            } catch {
                // Malformed entry; evict it first by treating it as oldest.
            }
            entries.push({ storageKey, timestamp });
        }

        const overflow = entries.length - Math.max(0, maxRemaining);
        if (overflow <= 0) return;

        entries.sort((a, b) => a.timestamp - b.timestamp);
        for (const { storageKey } of entries.slice(0, overflow)) {
            localStorage.removeItem(storageKey);
            this.memory.delete(storageKey.slice(this.storagePrefix.length));
        }
    }
}
