import { describe, it, expect, vi } from 'vitest';
import { TTLCache } from '../net/weatherCache.js';

function createFakeLocalStorage() {
    const store = {};
    return {
        store,
        getItem: (key) => (key in store ? store[key] : null),
        setItem: (key, value) => {
            store[key] = String(value);
        },
        removeItem: (key) => {
            delete store[key];
        },
        key: (index) => Object.keys(store)[index] ?? null,
        get length() {
            return Object.keys(store).length;
        }
    };
}

describe('TTLCache — memory-only', () => {
    it('returns null on a miss and the stored entry on a hit', () => {
        const cache = new TTLCache();
        expect(cache.get('missing')).toBeNull();

        cache.set('k', { hello: 'world' });
        const entry = cache.get('k');
        expect(entry.data).toEqual({ hello: 'world' });
        expect(entry.timestamp).toBeTypeOf('number');
    });

    it('expires entries past the TTL unless allowExpired is set', () => {
        const cache = new TTLCache({ defaultTtlMs: 1000 });
        cache.set('k', 'value');
        cache.memory.get('k').timestamp = Date.now() - 5000;

        expect(cache.get('k')).toBeNull();

        cache.set('k', 'value');
        cache.memory.get('k').timestamp = Date.now() - 5000;
        expect(cache.get('k', { allowExpired: true })?.data).toBe('value');
    });

    it('does not persist to localStorage when no storagePrefix is configured', () => {
        const fakeStorage = createFakeLocalStorage();
        vi.stubGlobal('localStorage', fakeStorage);

        const cache = new TTLCache();
        cache.set('k', 'value');

        expect(Object.keys(fakeStorage.store)).toHaveLength(0);
        vi.unstubAllGlobals();
    });

    it('pruneMemoryExpired drops only expired entries', () => {
        const cache = new TTLCache({ defaultTtlMs: 1000 });
        cache.set('fresh', 1);
        cache.set('stale', 2);
        cache.memory.get('stale').timestamp = Date.now() - 5000;

        cache.pruneMemoryExpired();

        expect(cache.memory.has('fresh')).toBe(true);
        expect(cache.memory.has('stale')).toBe(false);
    });
});

describe('TTLCache — localStorage-backed', () => {
    it('persists entries under the given prefix and reads them back after a memory clear', () => {
        const fakeStorage = createFakeLocalStorage();
        vi.stubGlobal('localStorage', fakeStorage);

        const cache = new TTLCache({ storagePrefix: 'test_v1_' });
        cache.set('k', { a: 1 }, { lat: 1, lon: 2 });
        cache.memory.clear();

        const entry = cache.get('k');
        expect(entry.data).toEqual({ a: 1 });
        expect(entry.lat).toBe(1);
        expect(entry.lon).toBe(2);
        vi.unstubAllGlobals();
    });

    it('evicts the oldest entries once maxStorageEntries is exceeded', () => {
        const fakeStorage = createFakeLocalStorage();
        vi.stubGlobal('localStorage', fakeStorage);

        const cache = new TTLCache({ storagePrefix: 'test_v1_', maxStorageEntries: 5 });
        for (let i = 0; i < 10; i++) {
            cache.memory.clear();
            cache.set(`k${i}`, i);
        }

        const keys = Object.keys(fakeStorage.store);
        expect(keys.length).toBeLessThanOrEqual(5);
        expect(cache.get('k9')).not.toBeNull();
        expect(fakeStorage.getItem('test_v1_k0')).toBeNull();
        vi.unstubAllGlobals();
    });

    it('deletes from both memory and storage', () => {
        const fakeStorage = createFakeLocalStorage();
        vi.stubGlobal('localStorage', fakeStorage);

        const cache = new TTLCache({ storagePrefix: 'test_v1_' });
        cache.set('k', 'value');
        cache.delete('k');

        expect(cache.memory.has('k')).toBe(false);
        expect(fakeStorage.getItem('test_v1_k')).toBeNull();
        vi.unstubAllGlobals();
    });

    it('does not throw when localStorage.setItem fails, and keeps the in-memory write', () => {
        const fakeStorage = createFakeLocalStorage();
        fakeStorage.setItem = () => {
            throw new DOMException('Quota exceeded', 'QuotaExceededError');
        };
        vi.stubGlobal('localStorage', fakeStorage);

        const cache = new TTLCache({ storagePrefix: 'test_v1_' });
        expect(() => cache.set('k', 'value')).not.toThrow();
        expect(cache.memory.get('k')?.data).toBe('value');
        vi.unstubAllGlobals();
    });
});
