import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import SunCalc from '../vendor/suncalc.js';
import {
    DEG,
    RAD_TO_DEG,
    eclipticToEquatorial,
    equatorialToEcliptic,
    julianCenturies,
    meanObliquity,
    OBLIQUITY_J2000
} from '../sky/celestialCoordinates.js';
import {
    SIGN_WIDTH_DEG,
    ZODIAC_SIGNS,
    getAyanamsaDeg,
    getMoonEclipticLongitudeDeg,
    getPlanetEclipticLongitudeDeg,
    getSunEclipticLongitudeDeg,
    getZodiacState,
    longitudeToSign,
    signCuspLongitudeDeg
} from '../sky/zodiac.js';
import { ZODIAC_CONFIG, ZodiacOverlay } from '../effects/zodiac-overlay.js';
import { StarField } from '../effects/star-field.js';

describe('ecliptic coordinate conversions', () => {
    it('agrees with the J2000 obliquity at J2000 and drifts the right way', () => {
        expect(meanObliquity(0) * RAD_TO_DEG).toBeCloseTo(23.43929, 4);
        // The obliquity decreases by roughly 47 arcseconds per century.
        const drift = (meanObliquity(1) - meanObliquity(0)) * RAD_TO_DEG * 3600;
        expect(drift).toBeCloseTo(-46.8, 0);
    });

    it('round-trips equatorial → ecliptic → equatorial', () => {
        const obliquity = meanObliquity(0.25);
        for (const [raDeg, decDeg] of [
            [0, 0],
            [45, 20],
            [187.5, -35],
            [300, 60]
        ]) {
            const { longitude, latitude } = equatorialToEcliptic(raDeg * DEG, decDeg * DEG, obliquity);
            const back = eclipticToEquatorial(longitude, latitude, obliquity);
            expect(((back.ra * RAD_TO_DEG - raDeg + 540) % 360) - 180).toBeCloseTo(0, 8);
            expect(back.dec * RAD_TO_DEG).toBeCloseTo(decDeg, 8);
        }
    });

    it('puts the vernal equinox at the origin of both frames', () => {
        const { longitude, latitude } = equatorialToEcliptic(0, 0, OBLIQUITY_J2000);
        expect(longitude).toBeCloseTo(0, 10);
        expect(latitude).toBeCloseTo(0, 10);
    });

    it('tilts the solstice point by exactly the obliquity', () => {
        // Ecliptic longitude 90° sits at RA 6h, Dec = +ε.
        const { ra, dec } = eclipticToEquatorial(90 * DEG, 0, OBLIQUITY_J2000);
        expect(ra * RAD_TO_DEG).toBeCloseTo(90, 8);
        expect(dec).toBeCloseTo(OBLIQUITY_J2000, 10);
    });
});

describe('solar and lunar ecliptic longitude', () => {
    it('puts the Sun at longitude zero at the March 2000 equinox', () => {
        // The equinox is defined as λ☉ = 0; it fell at 2000-03-20 07:35 UTC.
        expect(getSunEclipticLongitudeDeg(new Date('2000-03-20T07:35:00Z'))).toBeCloseTo(0, 1);
    });

    it('advances the Sun through the cardinal points across the year', () => {
        const cardinals = [
            ['2024-03-20T03:06:00Z', 0],
            ['2024-06-20T20:51:00Z', 90],
            ['2024-09-22T12:44:00Z', 180],
            ['2024-12-21T09:21:00Z', 270]
        ];
        for (const [iso, expected] of cardinals) {
            const longitude = getSunEclipticLongitudeDeg(new Date(iso));
            const error = ((longitude - Number(expected) + 540) % 360) - 180;
            // Within a couple of arcminutes of the published solstice/equinox instants.
            expect(Math.abs(error)).toBeLessThan(0.05);
        }
    });

    it("matches Meeus' worked lunar example for 1992 April 12", () => {
        // Astronomical Algorithms, example 47.a: λ = 133.162655°.
        expect(getMoonEclipticLongitudeDeg(new Date('1992-04-12T00:00:00Z'))).toBeCloseTo(133.1627, 1);
    });

    it('reproduces SunCalc lunar phase from its own Sun–Moon longitude gap', () => {
        // SunCalc's independent lunar series gives the illuminated fraction; the
        // same number falls out of the elongation between our two longitudes,
        // so a systematic error in either would show up here immediately.
        for (let day = 0; day < 60; day += 3) {
            const date = new Date(Date.UTC(2024, 0, 1 + day, 12));
            const elongation = (getMoonEclipticLongitudeDeg(date) - getSunEclipticLongitudeDeg(date)) * DEG;
            const fraction = (1 - Math.cos(elongation)) / 2;
            // The gap stays inside a few percent of the disc: our formula drops
            // the Moon's ≤5° ecliptic latitude, and SunCalc's own lunar series
            // is the coarser of the two by roughly a third of a degree.
            expect(Math.abs(fraction - SunCalc.getMoonIllumination(date).fraction)).toBeLessThan(0.025);
        }
    });

    it('moves the Moon roughly 13° a day', () => {
        const first = getMoonEclipticLongitudeDeg(new Date('2024-05-01T00:00:00Z'));
        const second = getMoonEclipticLongitudeDeg(new Date('2024-05-02T00:00:00Z'));
        const step = (second - first + 360) % 360;
        expect(step).toBeGreaterThan(11);
        expect(step).toBeLessThan(16);
    });
});

describe('sign assignment', () => {
    it('defines twelve 30° signs starting at Aries', () => {
        expect(ZODIAC_SIGNS).toHaveLength(12);
        expect(ZODIAC_SIGNS[0].id).toBe('aries');
        ZODIAC_SIGNS.forEach((sign, index) => {
            expect(sign.startDeg).toBe(index * SIGN_WIDTH_DEG);
            expect(sign.glyph).toHaveLength(1);
        });
    });

    it('maps a longitude to its slice and the offset inside it', () => {
        const { sign, signIndex, degreesInSign } = longitudeToSign(125.5);
        expect(sign.id).toBe('leo');
        expect(signIndex).toBe(4);
        expect(degreesInSign).toBeCloseTo(5.5, 10);
    });

    it('wraps negative and over-full-turn longitudes', () => {
        expect(longitudeToSign(-1).sign.id).toBe('pisces');
        expect(longitudeToSign(725).sign.id).toBe('aries');
        expect(longitudeToSign(360).sign.id).toBe('aries');
    });

    it('puts every cusp exactly on a boundary', () => {
        for (let i = 0; i < ZODIAC_SIGNS.length; i++) {
            const placement = longitudeToSign(i * SIGN_WIDTH_DEG);
            expect(placement.signIndex).toBe(i);
            expect(placement.degreesInSign).toBeCloseTo(0, 10);
        }
    });

    it('gives the tropical Sun the sign the calendar expects', () => {
        // Mid-month dates sit well clear of the cusps.
        expect(getZodiacState(new Date('2024-01-15T12:00:00Z')).sun.sign.id).toBe('capricorn');
        expect(getZodiacState(new Date('2024-07-15T12:00:00Z')).sun.sign.id).toBe('cancer');
        expect(getZodiacState(new Date('2024-11-15T12:00:00Z')).sun.sign.id).toBe('scorpio');
    });
});

describe('sidereal zodiac', () => {
    it('grows the Lahiri ayanamsa at the precession rate', () => {
        expect(getAyanamsaDeg(new Date('2000-01-01T12:00:00Z'))).toBeCloseTo(23.853, 2);
        const perCentury =
            getAyanamsaDeg(new Date('2100-01-01T12:00:00Z')) - getAyanamsaDeg(new Date('2000-01-01T12:00:00Z'));
        // General precession is ~5029 arcseconds per century.
        expect(perCentury * 3600).toBeCloseTo(5030, -2);
    });

    it('lags the tropical zodiac by the ayanamsa', () => {
        const date = new Date('2024-05-05T00:00:00Z');
        const tropical = longitudeToSign(100, { date });
        const sidereal = longitudeToSign(100, { mode: 'sidereal', date });
        const shift = tropical.longitudeDeg - sidereal.longitudeDeg;
        expect(shift).toBeCloseTo(getAyanamsaDeg(date), 10);
    });

    it('puts the sidereal Sun about three weeks behind the tropical one', () => {
        // Early January: tropical Capricorn began at the solstice, but the
        // sidereal sign does not start until mid-month.
        const date = new Date('2024-01-05T12:00:00Z');
        expect(getZodiacState(date).sun.sign.id).toBe('capricorn');
        expect(getZodiacState(date, { mode: 'sidereal' }).sun.sign.id).toBe('sagittarius');
    });

    it('offsets the drawn cusps by the ayanamsa in sidereal mode', () => {
        const date = new Date('2024-01-15T12:00:00Z');
        expect(signCuspLongitudeDeg(0, { date })).toBeCloseTo(0, 10);
        expect(signCuspLongitudeDeg(0, { mode: 'sidereal', date })).toBeCloseTo(getAyanamsaDeg(date), 10);
        // A sidereal cusp still lands on that sign's boundary once converted back.
        const cusp = signCuspLongitudeDeg(7, { mode: 'sidereal', date });
        const placement = longitudeToSign(cusp, { mode: 'sidereal', date });
        expect(placement.signIndex).toBe(7);
        expect(placement.degreesInSign).toBeCloseTo(0, 8);
    });
});

describe('zodiac state', () => {
    const date = new Date('2024-03-01T00:00:00Z');

    it('places the Sun, the Moon, and every naked-eye planet', () => {
        const state = getZodiacState(date);
        expect(state.mode).toBe('tropical');
        expect(state.ayanamsaDeg).toBe(0);
        expect(state.sun.id).toBe('sun');
        expect(state.moon.id).toBe('moon');
        expect(state.planets.map((p) => p.id)).toEqual(['mercury', 'venus', 'mars', 'jupiter', 'saturn']);
        for (const placement of [state.sun, state.moon, ...state.planets]) {
            expect(placement.longitudeDeg).toBeGreaterThanOrEqual(0);
            expect(placement.longitudeDeg).toBeLessThan(360);
            expect(placement.degreesInSign).toBeGreaterThanOrEqual(0);
            expect(placement.degreesInSign).toBeLessThan(SIGN_WIDTH_DEG);
        }
    });

    it('keeps Mercury and Venus near the Sun, as their orbits require', () => {
        const state = getZodiacState(date);
        const sun = state.sun.longitudeDeg;
        const elongation = (id) => {
            const planet = state.planets.find((p) => p.id === id);
            return Math.abs((((planet?.longitudeDeg ?? 0) - sun + 540) % 360) - 180);
        };
        expect(elongation('mercury')).toBeLessThan(29);
        expect(elongation('venus')).toBeLessThan(48);
    });

    it('reports a null longitude for a body it does not know', () => {
        expect(getPlanetEclipticLongitudeDeg('pluto', date)).toBeNull();
        expect(getPlanetEclipticLongitudeDeg('earth', date)).toBeNull();
    });
});

describe('ZodiacOverlay scene layer', () => {
    const makeOverlay = () => {
        const parent = new THREE.Group();
        const overlay = new ZodiacOverlay(parent, { radius: 100 });
        overlay.setDate(new Date('2024-03-01T00:00:00Z'));
        return { parent, overlay };
    };

    it('traces the ecliptic as a closed loop on the sky sphere', () => {
        const { overlay } = makeOverlay();
        const positions = overlay.eclipticLine.geometry.getAttribute('position');
        expect(positions.count).toBe(ZODIAC_CONFIG.eclipticSegments);
        for (let i = 0; i < positions.count; i++) {
            expect(Math.hypot(positions.getX(i), positions.getY(i), positions.getZ(i))).toBeCloseTo(100, 4);
        }
        overlay.dispose();
    });

    it('never lets the ecliptic stray further from the equator than the obliquity', () => {
        const { overlay } = makeOverlay();
        const positions = overlay.eclipticLine.geometry.getAttribute('position');
        let peak = 0;
        for (let i = 0; i < positions.count; i++) {
            peak = Math.max(peak, Math.abs(Math.asin(positions.getZ(i) / 100)) * RAD_TO_DEG);
        }
        expect(peak).toBeGreaterThan(23.3);
        expect(peak).toBeLessThan(23.5);
    });

    it('draws one tick per sign cusp, evenly spaced 30° apart', () => {
        const { overlay } = makeOverlay();
        const positions = overlay.cuspTicks.geometry.getAttribute('position');
        expect(positions.count).toBe(ZODIAC_SIGNS.length * 2);

        const obliquity = meanObliquity(julianCenturies(new Date('2024-03-01T00:00:00Z')));
        const longitudes = [];
        for (let i = 0; i < ZODIAC_SIGNS.length; i++) {
            // Midpoint of the tick sits on the ecliptic itself.
            const x = (positions.getX(i * 2) + positions.getX(i * 2 + 1)) / 2;
            const y = (positions.getY(i * 2) + positions.getY(i * 2 + 1)) / 2;
            const z = (positions.getZ(i * 2) + positions.getZ(i * 2 + 1)) / 2;
            const ra = Math.atan2(y, x);
            const dec = Math.asin(z / Math.hypot(x, y, z));
            longitudes.push(equatorialToEcliptic(ra, dec, obliquity).longitude * RAD_TO_DEG);
        }
        for (let i = 1; i < longitudes.length; i++) {
            const step = (longitudes[i] - longitudes[i - 1] + 360) % 360;
            expect(step).toBeCloseTo(SIGN_WIDTH_DEG, 4);
        }
        overlay.dispose();
    });

    it('stays hidden until it is switched on, and fades with the sky', () => {
        const { overlay } = makeOverlay();
        overlay.update(1);
        expect(overlay.group.visible).toBe(false);

        overlay.setVisible(true);
        overlay.update(1);
        expect(overlay.group.visible).toBe(true);
        expect(overlay.eclipticMaterial.opacity).toBeCloseTo(ZODIAC_CONFIG.eclipticOpacity, 6);

        // Daylight: the star field hands down a zero opacity and the band goes.
        overlay.update(0);
        expect(overlay.group.visible).toBe(false);
        overlay.dispose();
    });

    it('relays out the band when the convention changes', () => {
        const { overlay } = makeOverlay();
        const before = overlay.cuspTicks.geometry.getAttribute('position').getX(0);
        overlay.setMode('sidereal', new Date('2024-03-01T00:00:00Z'));
        const after = overlay.cuspTicks.geometry.getAttribute('position').getX(0);
        expect(after).not.toBeCloseTo(before, 3);
        expect(overlay.getState()?.mode).toBe('sidereal');
        overlay.dispose();
    });

    it('removes itself from its parent on dispose', () => {
        const { parent, overlay } = makeOverlay();
        expect(parent.children).toContain(overlay.group);
        overlay.dispose();
        expect(parent.children).not.toContain(overlay.group);
    });
});

describe('StarField zodiac integration', () => {
    const makeField = () => {
        const scene = new THREE.Scene();
        return { scene, field: new StarField(scene, { faintStarCount: 8 }) };
    };

    it('ships the band off by default so the scientific sky is untouched', () => {
        const { field } = makeField();
        expect(field.showZodiac).toBe(false);
        expect(field.zodiacMode).toBe('tropical');
        expect(field.skyGroup.children).toContain(field.zodiac.group);
        field.dispose();
    });

    it('toggles and switches convention through the star field', () => {
        const { field } = makeField();
        field.setZodiacVisible(true);
        expect(field.zodiac.visible).toBe(true);
        field.setZodiacMode('sidereal');
        expect(field.zodiac.mode).toBe('sidereal');
        field.setZodiacMode('nonsense');
        expect(field.zodiac.mode).toBe('tropical');
        field.dispose();
    });

    it('tears the band down with the rest of the sky', () => {
        const { scene, field } = makeField();
        const group = field.zodiac.group;
        field.setZodiacVisible(true);
        field.dispose();
        expect(scene.children).not.toContain(field.skyGroup);
        expect(field.skyGroup.children).not.toContain(group);
    });
});
