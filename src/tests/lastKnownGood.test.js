import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    LAST_GOOD_MAX_AGE_MS,
    LAST_GOOD_STORAGE_KEY,
    loadLastKnownGood,
    reviveWeatherDates,
    saveLastKnownGood
} from '../net/lastKnownGood.js';

function fakeLocalStorage(initial = {}) {
    const store = { ...initial };
    return {
        store,
        getItem: (key) => (key in store ? store[key] : null),
        setItem: (key, value) => {
            store[key] = String(value);
        },
        removeItem: (key) => {
            delete store[key];
        }
    };
}

const WHERE = { lat: 40.7, lon: -74, location: 'New York', countryCode: 'us' };

function payload() {
    return {
        location: 'New York',
        current: { temp: 12 },
        timeline: [
            { time: new Date('2026-11-13T10:00:00Z'), temp: 11 },
            { time: new Date('2026-11-13T11:00:00Z'), temp: 12 }
        ],
        sunrise: new Date('2026-11-13T11:30:00Z'),
        sunset: new Date('2026-11-13T21:30:00Z')
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('reviveWeatherDates', () => {
    it('turns the ISO strings JSON leaves behind back into Dates', () => {
        const roundTripped = JSON.parse(JSON.stringify(payload()));
        expect(typeof roundTripped.timeline[0].time).toBe('string');

        const revived = reviveWeatherDates(roundTripped);

        expect(revived.timeline[0].time).toBeInstanceOf(Date);
        expect(revived.timeline[1].time.toISOString()).toBe('2026-11-13T11:00:00.000Z');
        expect(revived.sunrise).toBeInstanceOf(Date);
        expect(revived.sunset.toISOString()).toBe('2026-11-13T21:30:00.000Z');
    });

    it('is idempotent and leaves missing fields alone', () => {
        const once = reviveWeatherDates(payload());
        expect(reviveWeatherDates(once).timeline[0].time).toBeInstanceOf(Date);

        const bare = reviveWeatherDates({ current: {} });
        expect(bare.sunrise).toBeUndefined();
        expect(bare.timeline).toBeUndefined();
        // A polar-day Invalid Date serialises to null; it must stay null, not become 1970.
        expect(reviveWeatherDates({ sunrise: null, timeline: [] }).sunrise).toBeNull();
    });

    it('does not mutate its input', () => {
        const input = JSON.parse(JSON.stringify(payload()));
        reviveWeatherDates(input);
        expect(typeof input.timeline[0].time).toBe('string');
    });
});

describe('last-known-good snapshot', () => {
    it('round-trips a payload with its place and timestamp, Dates revived', () => {
        const storage = fakeLocalStorage();
        vi.stubGlobal('localStorage', storage);

        expect(saveLastKnownGood(payload(), WHERE, 1_000)).toBe(true);
        expect(storage.store[LAST_GOOD_STORAGE_KEY]).toBeDefined();

        const loaded = loadLastKnownGood(2_000);
        expect(loaded).toMatchObject({ savedAt: 1_000, lat: 40.7, lon: -74, location: 'New York', countryCode: 'us' });
        expect(loaded.data.current.temp).toBe(12);
        expect(loaded.data.timeline[0].time).toBeInstanceOf(Date);
        expect(loaded.data.sunset).toBeInstanceOf(Date);
    });

    it('keeps only the most recent one, whatever the location', () => {
        vi.stubGlobal('localStorage', fakeLocalStorage());
        saveLastKnownGood(payload(), WHERE, 1_000);
        saveLastKnownGood({ ...payload(), location: 'Paris' }, { ...WHERE, location: 'Paris' }, 5_000);

        expect(loadLastKnownGood(6_000)).toMatchObject({ savedAt: 5_000, location: 'Paris' });
    });

    it('ignores a snapshot older than the max age', () => {
        vi.stubGlobal('localStorage', fakeLocalStorage());
        saveLastKnownGood(payload(), WHERE, 0);

        expect(loadLastKnownGood(LAST_GOOD_MAX_AGE_MS - 1)).not.toBeNull();
        expect(loadLastKnownGood(LAST_GOOD_MAX_AGE_MS + 1)).toBeNull();
    });

    it.each([
        ['nothing stored', undefined],
        ['unparseable JSON', '{not json'],
        ['no savedAt', JSON.stringify({ data: payload() })],
        ['no current conditions', JSON.stringify({ savedAt: 1, data: { timeline: [] } })],
        ['no timeline array', JSON.stringify({ savedAt: 1, data: { current: {} } })]
    ])('returns null for %s', (_label, raw) => {
        vi.stubGlobal('localStorage', fakeLocalStorage(raw === undefined ? {} : { [LAST_GOOD_STORAGE_KEY]: raw }));
        expect(loadLastKnownGood(2)).toBeNull();
    });

    it('degrades to "no snapshot" when storage is unavailable or full', () => {
        expect(saveLastKnownGood(payload(), WHERE)).toBe(false); // no localStorage global at all
        expect(loadLastKnownGood()).toBeNull();

        vi.stubGlobal('localStorage', {
            getItem: () => {
                throw new Error('SecurityError');
            },
            setItem: () => {
                throw new Error('QuotaExceededError');
            }
        });
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(saveLastKnownGood(payload(), WHERE)).toBe(false);
        expect(loadLastKnownGood()).toBeNull();
    });
});
