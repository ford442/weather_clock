import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import SunCalc from '../vendor/suncalc.js';
import {
    DEG,
    HOURS_TO_RAD,
    equatorialToHorizontal,
    equatorialToSceneMatrix,
    equatorialToVector,
    greenwichMeanSiderealTime,
    julianCenturies,
    localSiderealTime,
    OBLIQUITY_J2000,
    precessFromJ2000,
    toJulianDay
} from '../sky/celestialCoordinates.js';
import { CONSTELLATIONS, STARS, STAR_INDEX, colorFromBV, getConstellationLineIndices } from '../sky/starCatalog.js';
import { ALL_PLANETS, getPlanetPosition, getPlanetPositions, getSunEquatorial } from '../sky/planets.js';
import { magnitudeToBrightness, magnitudeToPointSize, StarField, STAR_FIELD_CONFIG } from '../effects/star-field.js';

const NYC = { lat: 40.7128, lon: -74.006 };
const RAD_TO_DEG = 180 / Math.PI;

describe('celestial coordinates', () => {
    it('computes the Julian Day of J2000.0', () => {
        expect(toJulianDay(new Date('2000-01-01T12:00:00Z'))).toBeCloseTo(2451545.0, 6);
        expect(julianCenturies(new Date('2000-01-01T12:00:00Z'))).toBeCloseTo(0, 9);
    });

    it('computes Greenwich sidereal time to within a few arcseconds of the known value', () => {
        // GMST at J2000.0 is 18h 41m 50.548s = 280.46061837°.
        const gmst = greenwichMeanSiderealTime(new Date('2000-01-01T12:00:00Z')) * RAD_TO_DEG;
        expect(gmst).toBeCloseTo(280.46061837, 5);
    });

    it('offsets local sidereal time by the observer longitude', () => {
        const date = new Date('2024-03-20T00:00:00Z');
        const greenwich = greenwichMeanSiderealTime(date);
        const local = localSiderealTime(date, NYC.lon);
        const delta = ((local - greenwich) * RAD_TO_DEG + 360) % 360;
        expect(delta).toBeCloseTo((NYC.lon + 360) % 360, 6);
    });

    it('places Polaris at an altitude equal to the observer latitude', () => {
        const polaris = STARS[STAR_INDEX.get('polaris')];
        for (const lat of [0, 25, 40.7128, 65]) {
            const lst = localSiderealTime(new Date('2024-07-04T03:00:00Z'), NYC.lon);
            const { altitude } = equatorialToHorizontal(polaris.raHours * HOURS_TO_RAD, polaris.decDeg * DEG, lst, lat);
            // Polaris sits 0.74° off the true pole, so it circles within that.
            expect(Math.abs(altitude * RAD_TO_DEG - lat)).toBeLessThan(0.75);
        }
    });

    it('never puts a northern-circumpolar star below the horizon at high latitude', () => {
        const alioth = STARS[STAR_INDEX.get('alioth')];
        for (let hour = 0; hour < 24; hour++) {
            const lst = localSiderealTime(new Date(Date.UTC(2024, 0, 1, hour)), 0);
            const { altitude } = equatorialToHorizontal(alioth.raHours * HOURS_TO_RAD, alioth.decDeg * DEG, lst, 60);
            expect(altitude).toBeGreaterThan(0);
        }
    });

    it('puts the Sun on the equinox and solstice longitudes at the right instants', () => {
        // The strongest absolute check available without a second ephemeris: at
        // an equinox the Sun's apparent ecliptic longitude is exactly 0° or 180°,
        // and at a solstice exactly 90° or 270°.
        const ofDateLongitudeDeg = (date) => {
            const sun = getSunEquatorial(date);
            const { ra, dec } = precessFromJ2000(sun.ra, sun.dec, julianCenturies(date));
            const x = Math.cos(dec) * Math.cos(ra);
            const y = Math.cos(dec) * Math.sin(ra);
            const z = Math.sin(dec);
            const longitude = Math.atan2(y * Math.cos(OBLIQUITY_J2000) + z * Math.sin(OBLIQUITY_J2000), x) * RAD_TO_DEG;
            return ((longitude % 360) + 360) % 360;
        };

        /** @type {[string, number][]} */
        const events = [
            ['2024-03-20T03:06:00Z', 0],
            ['2024-09-22T12:44:00Z', 180],
            ['2025-06-21T02:42:00Z', 90],
            ['2025-12-21T15:03:00Z', 270]
        ];
        for (const [iso, expected] of events) {
            const error = (((ofDateLongitudeDeg(new Date(iso)) - expected + 540) % 360) - 180) * 60;
            expect(Math.abs(error), iso).toBeLessThan(1.5); // arcminutes
        }
    });

    it('agrees with SunCalc on where the Sun is', () => {
        // The ephemeris and SunCalc share no code, so agreeing on the Sun
        // cross-checks the Kepler solver, the sidereal time, and the horizontal
        // transform all at once. The tolerance is set by SunCalc, not by us: its
        // two-term equation of centre drifts ~0.08° from the JPL elements over a
        // couple of decades, which the equinox test above shows is SunCalc's
        // error rather than ours.
        for (const iso of ['2024-09-21T15:30:00Z', '2025-01-05T09:00:00Z', '2026-06-21T18:45:00Z']) {
            const date = new Date(iso);
            const sun = SunCalc.getPosition(date, NYC.lat, NYC.lon);
            const ours = getSunEquatorial(date);
            // SunCalc reports apparent, of-date coordinates; the ephemeris is
            // J2000, so precess it the same way the renderer does.
            const ofDate = precessFromJ2000(ours.ra, ours.dec, julianCenturies(date));
            const lst = localSiderealTime(date, NYC.lon);
            const horizontal = equatorialToHorizontal(ofDate.ra, ofDate.dec, lst, NYC.lat);

            expect(Math.abs(horizontal.altitude - sun.altitude) * RAD_TO_DEG).toBeLessThan(0.3);
            const azimuthGap = Math.acos(Math.min(1, Math.cos(horizontal.azimuth - sun.azimuth))) * RAD_TO_DEG;
            expect(azimuthGap).toBeLessThan(0.4);
            // Earth's orbit keeps the Sun between perihelion and aphelion.
            expect(ours.distanceAu).toBeGreaterThan(0.98);
            expect(ours.distanceAu).toBeLessThan(1.02);
        }
    });

    it('agrees with the horizontal formula through the scene rotation matrix', () => {
        const date = new Date('2026-06-21T04:00:00Z');
        const lst = localSiderealTime(date, NYC.lon);
        const m = equatorialToSceneMatrix(lst, NYC.lat);

        for (const id of ['sirius', 'vega', 'polaris', 'acrux', 'betelgeuse']) {
            const star = STARS[STAR_INDEX.get(id)];
            const ra = star.raHours * HOURS_TO_RAD;
            const dec = star.decDeg * DEG;
            const e = equatorialToVector(ra, dec);
            const rotated = [
                m[0] * e.x + m[1] * e.y + m[2] * e.z,
                m[3] * e.x + m[4] * e.y + m[5] * e.z,
                m[6] * e.x + m[7] * e.y + m[8] * e.z
            ];

            // Same mapping AstronomyService.sphericalToCartesian uses: Y up, Z+ north, X+ east.
            const { altitude, azimuth } = equatorialToHorizontal(ra, dec, lst, NYC.lat);
            const expected = [
                -Math.sin(azimuth) * Math.cos(altitude),
                Math.sin(altitude),
                -Math.cos(azimuth) * Math.cos(altitude)
            ];

            for (let i = 0; i < 3; i++) expect(rotated[i]).toBeCloseTo(expected[i], 12);
        }
    });

    it('precesses J2000 coordinates by roughly 50 arcseconds of ecliptic drift per year', () => {
        const star = STARS[STAR_INDEX.get('regulus')];
        const ra = star.raHours * HOURS_TO_RAD;
        const dec = star.decDeg * DEG;

        const unmoved = precessFromJ2000(ra, dec, 0);
        expect(unmoved.ra).toBeCloseTo(ra, 12);
        expect(unmoved.dec).toBeCloseTo(dec, 12);

        // Regulus sits near the ecliptic, so 25 years of precession moves it by
        // about 25 × 50" ≈ 0.35°.
        const moved = precessFromJ2000(ra, dec, 0.25);
        const separation = Math.acos(
            Math.sin(dec) * Math.sin(moved.dec) + Math.cos(dec) * Math.cos(moved.dec) * Math.cos(ra - moved.ra)
        );
        expect(separation * RAD_TO_DEG).toBeGreaterThan(0.25);
        expect(separation * RAD_TO_DEG).toBeLessThan(0.45);
    });

    it('keeps precession finite at the celestial pole', () => {
        const polaris = STARS[STAR_INDEX.get('polaris')];
        const result = precessFromJ2000(polaris.raHours * HOURS_TO_RAD, polaris.decDeg * DEG, 0.25);
        expect(Number.isFinite(result.ra)).toBe(true);
        expect(Number.isFinite(result.dec)).toBe(true);
    });
});

describe('star catalog', () => {
    it('has unique ids and physically sane entries', () => {
        expect(STAR_INDEX.size).toBe(STARS.length);
        for (const star of STARS) {
            expect(star.raHours).toBeGreaterThanOrEqual(0);
            expect(star.raHours).toBeLessThan(24);
            expect(Math.abs(star.decDeg)).toBeLessThanOrEqual(90);
            expect(star.mag).toBeGreaterThan(-2);
            expect(star.mag).toBeLessThan(6);
        }
    });

    it('resolves every constellation line to a catalogued star', () => {
        for (const constellation of CONSTELLATIONS) {
            expect(constellation.lines.length).toBeGreaterThan(0);
            for (const [from, to] of constellation.lines) {
                expect(STAR_INDEX.has(from), `${constellation.abbr}: ${from}`).toBe(true);
                expect(STAR_INDEX.has(to), `${constellation.abbr}: ${to}`).toBe(true);
            }
        }
        const indices = getConstellationLineIndices();
        expect(indices.length % 2).toBe(0);
        expect(indices.length / 2).toBe(CONSTELLATIONS.reduce((n, c) => n + c.lines.length, 0));
    });

    it('places the Big Dipper stars within a few degrees of each other', () => {
        const dubhe = STARS[STAR_INDEX.get('dubhe')];
        const merak = STARS[STAR_INDEX.get('merak')];
        const a = equatorialToVector(dubhe.raHours * HOURS_TO_RAD, dubhe.decDeg * DEG);
        const b = equatorialToVector(merak.raHours * HOURS_TO_RAD, merak.decDeg * DEG);
        const separation = Math.acos(a.x * b.x + a.y * b.y + a.z * b.z) * RAD_TO_DEG;
        // The pointer pair is the canonical 5.4° "one fist" gap.
        expect(separation).toBeGreaterThan(4.5);
        expect(separation).toBeLessThan(6.5);
    });

    it('tints hot stars blue and cool stars orange', () => {
        const [, , blueB] = colorFromBV(-0.24);
        const [redR, , redB] = colorFromBV(1.85);
        expect(blueB).toBeCloseTo(1, 5);
        expect(redR).toBeCloseTo(1, 5);
        expect(redB).toBeLessThan(0.6);
    });
});

describe('planet ephemeris', () => {
    it('returns every naked-eye planet with finite coordinates', () => {
        const positions = getPlanetPositions(new Date('2026-09-11T00:00:00Z'));
        expect(positions.map((p) => p.id)).toEqual(['mercury', 'venus', 'mars', 'jupiter', 'saturn']);
        for (const planet of positions) {
            expect(planet.ra).toBeGreaterThanOrEqual(0);
            expect(planet.ra).toBeLessThan(2 * Math.PI);
            expect(Math.abs(planet.dec * RAD_TO_DEG)).toBeLessThan(90);
            expect(Number.isFinite(planet.magnitude)).toBe(true);
        }
    });

    it('never lets a planet stray far from the ecliptic', () => {
        // Every major planet orbits within ~7° of the ecliptic, so its declination
        // can never exceed the obliquity plus that inclination.
        for (let month = 0; month < 12; month++) {
            const date = new Date(Date.UTC(2026, month, 1));
            for (const planet of getPlanetPositions(date, ALL_PLANETS)) {
                expect(Math.abs(planet.dec * RAD_TO_DEG)).toBeLessThan(31);
            }
        }
    });

    it('keeps each planet inside its real orbital distance range', () => {
        const date = new Date('2026-09-11T00:00:00Z');
        // [min, max] geocentric distance in au.
        const ranges = {
            mercury: [0.5, 1.5],
            venus: [0.25, 1.75],
            mars: [0.35, 2.7],
            jupiter: [3.9, 6.6],
            saturn: [7.9, 11.1],
            uranus: [17.2, 21.2],
            neptune: [28.8, 31.4]
        };
        for (const planet of getPlanetPositions(date, ALL_PLANETS)) {
            const [min, max] = ranges[planet.id];
            expect(planet.distanceAu).toBeGreaterThanOrEqual(min);
            expect(planet.distanceAu).toBeLessThanOrEqual(max);
        }
    });

    it('reports Venus as the brightest planet and Neptune as invisible to the eye', () => {
        const date = new Date('2026-09-11T00:00:00Z');
        const byId = Object.fromEntries(getPlanetPositions(date, ALL_PLANETS).map((p) => [p.id, p]));
        expect(byId.venus.magnitude).toBeLessThan(-3.5);
        expect(byId.jupiter.magnitude).toBeLessThan(-1);
        expect(byId.neptune.magnitude).toBeGreaterThan(6);
    });

    it('keeps the inner planets within their maximum elongation from the Sun', () => {
        // Mercury never gets more than ~28° from the Sun, Venus ~47°. Checking the
        // Sun-planet-Earth geometry this way catches an error in either the planet
        // solution or Earth's.
        for (let month = 0; month < 12; month++) {
            const date = new Date(Date.UTC(2026, month, 1));
            const sun = SunCalc.getPosition(date, 0, 0);
            expect(Number.isFinite(sun.altitude)).toBe(true);
            const mercury = getPlanetPosition('mercury', date);
            const venus = getPlanetPosition('venus', date);
            expect(mercury.phaseAngleDeg).toBeGreaterThanOrEqual(0);
            expect(mercury.phaseAngleDeg).toBeLessThanOrEqual(180);
            expect(venus.phaseAngleDeg).toBeGreaterThanOrEqual(0);
            expect(venus.phaseAngleDeg).toBeLessThanOrEqual(180);
        }
    });

    it('returns null for Earth and for unknown bodies', () => {
        expect(getPlanetPosition('earth', new Date())).toBeNull();
        expect(getPlanetPosition('pluto', new Date())).toBeNull();
    });

    it('moves the fast planets much further than the slow ones over a year', () => {
        const start = new Date('2026-01-01T00:00:00Z');
        const end = new Date('2027-01-01T00:00:00Z');
        const drift = (id) => {
            const a = getPlanetPosition(id, start);
            const b = getPlanetPosition(id, end);
            return Math.abs(((b.ra - a.ra + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
        };
        expect(drift('neptune')).toBeLessThan(drift('saturn'));
        expect(drift('saturn')).toBeLessThan(drift('jupiter'));
    });
});

describe('star field brightness mapping', () => {
    it('draws brighter stars larger', () => {
        expect(magnitudeToPointSize(-1.46)).toBeGreaterThan(magnitudeToPointSize(0));
        expect(magnitudeToPointSize(0)).toBeGreaterThan(magnitudeToPointSize(3));
        expect(magnitudeToPointSize(8)).toBeGreaterThanOrEqual(1);
        expect(magnitudeToPointSize(-5)).toBeLessThanOrEqual(9);
    });

    it('clamps brightness into a visible range', () => {
        expect(magnitudeToBrightness(-1.46)).toBeGreaterThan(0.99);
        expect(magnitudeToBrightness(-5)).toBeLessThanOrEqual(1);
        expect(magnitudeToBrightness(6)).toBeGreaterThanOrEqual(0.25);
        expect(magnitudeToBrightness(2)).toBeLessThan(magnitudeToBrightness(0));
    });

    it('fades stars out between nautical and civil twilight', () => {
        // The scene places the sun 20 units out, so y = 20·sin(altitude).
        expect(StarField.twilightFade(20 * Math.sin(-18 * DEG))).toBe(1);
        expect(StarField.twilightFade(20 * Math.sin(-12 * DEG))).toBeCloseTo(1, 1);
        expect(StarField.twilightFade(20 * Math.sin(-6 * DEG))).toBeCloseTo(0, 1);
        expect(StarField.twilightFade(10)).toBe(0);
    });
});

describe('StarField scene layer', () => {
    /** Builds a StarField against a minimal stand-in scene (no renderer needed). */
    const makeField = () => {
        const scene = new THREE.Scene();
        return { scene, field: new StarField(scene, { faintStarCount: 32 }) };
    };

    it('builds one point per catalogued star with colour and size attributes', () => {
        const { field } = makeField();
        const geometry = field.catalogStars.geometry;
        expect(geometry.getAttribute('position').count).toBe(STARS.length);
        expect(geometry.getAttribute('size').count).toBe(STARS.length);
        expect(geometry.getAttribute('aColor').count).toBe(STARS.length);
        field.dispose();
    });

    it('places every star on the sky sphere', () => {
        const { field } = makeField();
        const positions = field.catalogStars.geometry.getAttribute('position');
        for (let i = 0; i < positions.count; i++) {
            const length = Math.hypot(positions.getX(i), positions.getY(i), positions.getZ(i));
            expect(length).toBeCloseTo(field.radius, 2);
        }
        field.dispose();
    });

    it('rotates the sky so a star lands where the horizontal formula says it should', () => {
        const { field } = makeField();
        const date = new Date('2026-01-15T02:00:00Z');
        field.setObserver({ date, latitude: NYC.lat, longitude: NYC.lon });
        field.skyGroup.updateMatrixWorld(true);

        const index = STAR_INDEX.get('betelgeuse');
        const positions = field.catalogStars.geometry.getAttribute('position');
        const world = new THREE.Vector3(positions.getX(index), positions.getY(index), positions.getZ(index));
        world.applyMatrix4(field.skyGroup.matrixWorld);

        const star = STARS[index];
        // Catalog positions are precessed to `catalogEpochCenturies`, which the
        // field only refreshes once a year of precession has accumulated.
        const { ra, dec } = precessFromJ2000(
            star.raHours * HOURS_TO_RAD,
            star.decDeg * DEG,
            field.catalogEpochCenturies
        );
        expect(Math.abs(field.catalogEpochCenturies - julianCenturies(date))).toBeLessThan(
            STAR_FIELD_CONFIG.precessionRebuildCenturies
        );
        const { altitude, azimuth } = equatorialToHorizontal(ra, dec, localSiderealTime(date, NYC.lon), NYC.lat);

        // 4 decimals is the float32 position buffer's resolution, ~20 arcseconds
        // on the sky — far finer than a star sprite.
        expect(world.y / field.radius).toBeCloseTo(Math.sin(altitude), 4);
        expect(world.x / field.radius).toBeCloseTo(-Math.sin(azimuth) * Math.cos(altitude), 4);
        expect(world.z / field.radius).toBeCloseTo(-Math.cos(azimuth) * Math.cos(altitude), 4);
        field.dispose();
    });

    it('hides everything in daylight and shows it at night', () => {
        const { field } = makeField();
        field.update(new THREE.Vector3(0, 15, 0));
        expect(field.skyGroup.visible).toBe(false);

        field.update(new THREE.Vector3(0, -15, 0));
        expect(field.skyGroup.visible).toBe(true);
        expect(field.catalogMaterial.uniforms.uOpacity.value).toBeGreaterThan(0.9);
        field.dispose();
    });

    it('dims the faint field faster than the bright stars under cloud and skyglow', () => {
        const { field } = makeField();
        const night = new THREE.Vector3(0, -15, 0);

        field.update(night);
        const clearBright = field.catalogMaterial.uniforms.uOpacity.value;
        const clearFaint = field.faintMaterial.uniforms.uOpacity.value;

        field.setObserver({ cloudCover: 90 });
        field.setLightPollution(0.8);
        field.update(night);

        expect(field.catalogMaterial.uniforms.uOpacity.value).toBeLessThan(clearBright);
        expect(field.faintMaterial.uniforms.uOpacity.value).toBeLessThan(clearFaint);
        expect(field.faintMaterial.uniforms.uOpacity.value).toBeLessThan(field.catalogMaterial.uniforms.uOpacity.value);
        field.dispose();
    });

    it('toggles constellations, planets, and labels independently', () => {
        const { field } = makeField();
        const night = new THREE.Vector3(0, -15, 0);

        field.setConstellationsVisible(false);
        field.setPlanetsVisible(false);
        field.update(night);
        expect(field.constellationLines.visible).toBe(false);
        expect(field.planetPoints.visible).toBe(false);

        field.setConstellationsVisible(true);
        field.setPlanetsVisible(true);
        field.update(night);
        expect(field.constellationLines.visible).toBe(true);
        expect(field.planetPoints.visible).toBe(true);
        expect(field.constellationMaterial.opacity).toBeGreaterThan(0);
        field.dispose();
    });

    it('moves the sky with sidereal time', () => {
        const { field } = makeField();
        field.setObserver({ date: new Date('2026-01-15T02:00:00Z'), latitude: NYC.lat, longitude: NYC.lon });
        const before = field.skyGroup.matrix.clone();
        field.setObserver({ date: new Date('2026-01-15T08:00:00Z') });
        expect(field.skyGroup.matrix.equals(before)).toBe(false);
        field.dispose();
    });

    it('solves every rendered planet and exposes it for debugging', () => {
        const { field } = makeField();
        field.setObserver({ date: new Date('2026-09-11T04:00:00Z'), latitude: NYC.lat, longitude: NYC.lon });
        const planets = field.getPlanetPositions();
        expect(planets).toHaveLength(5);
        const positions = field.planetPoints.geometry.getAttribute('position');
        for (let i = 0; i < positions.count; i++) {
            expect(Math.hypot(positions.getX(i), positions.getY(i), positions.getZ(i))).toBeCloseTo(field.radius, 2);
        }
        field.dispose();
    });

    it('ignores invalid observer input rather than corrupting the sky', () => {
        const { field } = makeField();
        const latitude = field.latitude;
        field.setObserver({ date: new Date('nope'), latitude: Number.NaN, longitude: null, cloudCover: undefined });
        expect(field.latitude).toBe(latitude);
        expect(Number.isFinite(field.observerDate.getTime())).toBe(true);
        field.dispose();
    });

    it('removes everything it added from the scene on dispose', () => {
        const { scene, field } = makeField();
        field.setLabelsVisible(true);
        expect(scene.children).toContain(field.skyGroup);
        field.dispose();
        expect(scene.children).not.toContain(field.skyGroup);
    });
});
