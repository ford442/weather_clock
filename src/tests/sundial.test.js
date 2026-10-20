import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import SunCalc from 'suncalc';
import { AstronomyService } from '../astronomy.js';
import { createSundial, SUNDIAL_CONFIG } from '../sundial.js';
import {
    apparentSolarTime,
    equationOfTime,
    hourAngleFromShadowDirection,
    hourAngleToHours,
    hourAngleToMinutes,
    hourLineSegment,
    hoursToHourAngle,
    layoutGnomon,
    localMeanSolarTime,
    maxSunlitHourAngle,
    solarAltitude
} from '../sundial-astronomy.js';

const DEG = Math.PI / 180;
const NEW_YORK = { latitude: 40.7128, longitude: -74.006 };
const SYDNEY = { latitude: -33.8688, longitude: 151.2093 };
const GREENWICH = { latitude: 51.4779, longitude: 0 };

/** Wrap an angle difference into (−π, π]. */
const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** The UTC instant near `guess` at which apparent solar time equals `hours`. */
function instantOfApparentTime(guess, longitude, hours) {
    let t = guess.getTime();
    for (let i = 0; i < 4; i++) {
        const error = wrap(hoursToHourAngle(apparentSolarTime(new Date(t), longitude)) - hoursToHourAngle(hours));
        t -= (error / (2 * Math.PI)) * 86400000;
    }
    return new Date(t);
}

/**
 * Cast one plate edge of the gnomon's style along the scene sun vector (the
 * same vector the DirectionalLight is placed on) onto the face.
 */
function castStyleShadow(state, sun, edgeOffset = 0) {
    const project = (p) => {
        const k = (p.y - state.faceY) / sun.y;
        return { e: p.x + edgeOffset - k * sun.x, n: p.z - k * sun.z };
    };
    const from = project(state.style.start);
    const to = project(state.style.end);
    return { from, direction: { e: to.e - from.e, n: to.n - from.n } };
}

function styleDirection(sundial) {
    const { start, end } = sundial.getState().style;
    return new THREE.Vector3(end.x - start.x, end.y - start.y, end.z - start.z).normalize();
}

afterEach(() => {
    vi.useRealTimers();
});

describe('equation of time', () => {
    // Reference values: the Sun's apparent hour angle at Greenwich at 12:00 UT,
    // from Wolfram Language's SunPosition (equatorial) and SiderealTime — i.e.
    // apparent minus mean solar time, in minutes.
    const TABLE = [
        ['2026-02-11T12:00:00Z', -14.1747, 'annual minimum'],
        ['2026-04-15T12:00:00Z', -0.0055, 'April zero'],
        ['2026-05-14T12:00:00Z', 3.6739, 'May maximum'],
        ['2026-07-26T12:00:00Z', -6.5645, 'July minimum'],
        ['2026-09-01T12:00:00Z', -0.0065, 'September zero'],
        ['2026-11-03T12:00:00Z', 16.449, 'annual maximum'],
        ['2026-12-25T12:00:00Z', -0.0443, 'December zero']
    ];

    it.each(TABLE)('%s (%f min, %s) matches within 5 seconds', (iso, minutes) => {
        expect(Math.abs(equationOfTime(new Date(iso)) - minutes) * 60).toBeLessThan(5);
    });

    it("reproduces Meeus' worked example 28.a: +13m 42.6s on 1992 October 13.0", () => {
        const seconds = equationOfTime(new Date('1992-10-13T00:00:00Z')) * 60;
        expect(seconds).toBeCloseTo(13 * 60 + 42.6, 0);
    });

    it('traces the familiar annual curve and never leaves ±16.6 minutes', () => {
        const values = [];
        for (let day = 0; day < 365; day++) values.push(equationOfTime(new Date(Date.UTC(2026, 0, 1 + day, 12))));
        expect(Math.max(...values)).toBeLessThan(16.6);
        expect(Math.min(...values)).toBeGreaterThan(-14.4);
        // Four extrema a year: Feb min, May max, Jul min, Nov max.
        let turns = 0;
        for (let i = 1; i < values.length - 1; i++) {
            if ((values[i] - values[i - 1]) * (values[i + 1] - values[i]) < 0) turns++;
        }
        expect(turns).toBe(4);
    });
});

describe('solar time', () => {
    it('reads apparent time at Greenwich as UTC plus the equation of time', () => {
        const t = new Date('2026-11-03T12:00:00Z');
        expect(apparentSolarTime(t, 0)).toBeCloseTo(12 + equationOfTime(t) / 60, 10);
    });

    it('shifts mean time by four minutes per degree of longitude', () => {
        const t = new Date('2026-06-21T17:00:00Z');
        expect(localMeanSolarTime(t, NEW_YORK.longitude)).toBeCloseTo(17 - 74.006 / 15, 10);
        expect(localMeanSolarTime(t, 15) - localMeanSolarTime(t, 14)).toBeCloseTo(4 / 60, 10);
    });

    it('maps solar hours to hour angle: noon on the meridian, afternoon positive', () => {
        expect(hoursToHourAngle(12)).toBeCloseTo(0, 12);
        expect(hoursToHourAngle(18)).toBeCloseTo(Math.PI / 2, 12);
        expect(hoursToHourAngle(6)).toBeCloseTo(-Math.PI / 2, 12);
        expect(Math.abs(hoursToHourAngle(0))).toBeCloseTo(Math.PI, 12);
        for (const hours of [0.25, 5.5, 11.99, 13, 23.5]) {
            expect(hourAngleToHours(hoursToHourAngle(hours))).toBeCloseTo(hours, 10);
        }
    });

    it("puts SunCalc's sun due south at New York's apparent noon", () => {
        for (const iso of ['2026-02-11T17:00:00Z', '2026-06-21T17:00:00Z', '2026-11-03T17:00:00Z']) {
            const noon = instantOfApparentTime(new Date(iso), NEW_YORK.longitude, 12);
            const { azimuth } = SunCalc.getPosition(noon, NEW_YORK.latitude, NEW_YORK.longitude);
            expect(Math.abs(azimuth) / DEG).toBeLessThan(0.5);
        }
    });

    it("agrees with SunCalc's solar altitude", () => {
        for (let hour = 0; hour < 24; hour += 3) {
            const t = new Date(Date.UTC(2026, 9, 16, hour));
            const reference = SunCalc.getPosition(t, NEW_YORK.latitude, NEW_YORK.longitude).altitude;
            expect(Math.abs(solarAltitude(t, NEW_YORK.latitude, NEW_YORK.longitude) - reference) / DEG).toBeLessThan(
                0.3
            );
        }
    });
});

describe('gnomon follows latitude', () => {
    it('lies parallel to the face at the equator, raised so it still casts a shadow', () => {
        const sundial = createSundial();
        sundial.setLatitude(0);
        const direction = styleDirection(sundial);
        expect(direction.y).toBeCloseTo(0, 12);
        expect(Math.abs(direction.z)).toBeCloseTo(1, 12);
        expect(sundial.getState().style.start.y - sundial.getState().faceY).toBeCloseTo(
            SUNDIAL_CONFIG.gnomon.minStyleHeight,
            12
        );
        expect(sundial.getState().root).toBeNull();
    });

    it('stands vertical at either pole', () => {
        const sundial = createSundial();
        for (const latitude of [90, -90]) {
            sundial.setLatitude(latitude);
            expect(styleDirection(sundial).y).toBeCloseTo(1, 12);
        }
    });

    it('climbs at the latitude toward celestial north (+Z) in New York, parallel to Earth’s axis', () => {
        const sundial = createSundial();
        sundial.setLatitude(NEW_YORK.latitude);
        const direction = styleDirection(sundial);
        expect(Math.asin(direction.y) / DEG).toBeCloseTo(NEW_YORK.latitude, 9);
        expect(direction.z).toBeGreaterThan(0);
        expect(direction.x).toBe(0);
        // The north celestial pole in the scene frame (Y up, Z+ north).
        const pole = new THREE.Vector3(0, Math.sin(NEW_YORK.latitude * DEG), Math.cos(NEW_YORK.latitude * DEG));
        expect(direction.dot(pole)).toBeCloseTo(1, 12);
    });

    it('climbs toward the south celestial pole (−Z) in Sydney', () => {
        const sundial = createSundial();
        sundial.setLatitude(SYDNEY.latitude);
        const direction = styleDirection(sundial);
        expect(Math.asin(direction.y) / DEG).toBeCloseTo(-SYDNEY.latitude, 9);
        expect(direction.z).toBeLessThan(0);
    });

    it('relays the gnomon and hour lines when the observer moves, and disposes the old plate', () => {
        const sundial = createSundial();
        const t = new Date('2026-10-16T16:00:00Z');
        sundial.update(t, NEW_YORK);
        const before = sundial.getState();
        const oldGeometry = sundial.gnomon.geometry;
        const dispose = vi.spyOn(oldGeometry, 'dispose');

        sundial.update(t, GREENWICH);
        const after = sundial.getState();
        expect(after.styleAngleDeg).toBeCloseTo(GREENWICH.latitude, 9);
        expect(sundial.gnomon.geometry).not.toBe(oldGeometry);
        expect(dispose).toHaveBeenCalled();
        expect(after.hourLines).not.toEqual(before.hourLines);

        // Re-sending the same observer is free: nothing is rebuilt.
        const current = sundial.gnomon.geometry;
        sundial.update(t, GREENWICH);
        expect(sundial.gnomon.geometry).toBe(current);
    });

    it('keeps a buildable, shadow-casting plate inside the night ring at every latitude', () => {
        const { gnomon, nightClock } = SUNDIAL_CONFIG;
        for (let latitude = -90; latitude <= 90; latitude += 0.5) {
            const layout = layoutGnomon(latitude, gnomon);
            expect(layout.styleAngleRad).toBeCloseTo(Math.abs(latitude) * DEG, 12);
            expect(layout.styleEnd.y).toBeLessThanOrEqual(gnomon.maxStyleHeight + 1e-9);
            expect(layout.styleEnd.y).toBeGreaterThanOrEqual(gnomon.minStyleHeight - 1e-9);
            for (const point of layout.profile) {
                expect(Number.isFinite(point.n) && Number.isFinite(point.y)).toBe(true);
                expect(Math.abs(point.n)).toBeLessThan(nightClock.pointerInnerRadius);
            }
        }
    });
});

describe('solar hour lines', () => {
    const uniqueHours = (sundial) =>
        [...new Set(sundial.getState().hourLines.map((line) => line.hour))].sort((a, b) => a - b);

    it('obey tan θ = sin φ · tan h', () => {
        const sundial = createSundial();
        sundial.setLatitude(NEW_YORK.latitude);
        for (const line of sundial.getState().hourLines) {
            const direction = { e: line.end.x - line.start.x, n: line.end.z - line.start.z };
            expect(hourAngleFromShadowDirection(NEW_YORK.latitude, direction)).toBeCloseTo(line.hourAngleRad, 9);
            if (Math.abs(line.hourAngleRad) < Math.PI / 2) {
                const theta = Math.atan2(direction.e, direction.n);
                expect(Math.tan(theta)).toBeCloseTo(Math.sin(NEW_YORK.latitude * DEG) * Math.tan(line.hourAngleRad), 9);
            }
        }
    });

    it('draws only the hours a summer sun can reach', () => {
        const sundial = createSundial();
        // New York: summer sunrise ~04:32 apparent time, so lines run 05–19.
        sundial.setLatitude(NEW_YORK.latitude);
        expect(maxSunlitHourAngle(NEW_YORK.latitude) / DEG).toBeCloseTo(111.9, 0);
        expect(uniqueHours(sundial)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
        // Inside the Arctic circle the midnight sun reaches every hour.
        sundial.setLatitude(70);
        expect(uniqueHours(sundial)).toHaveLength(24);
        // At the equator the lines are parallel and 06/18 run off to infinity.
        sundial.setLatitude(0);
        expect(uniqueHours(sundial)).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
        for (const line of sundial.getState().hourLines) {
            expect(line.end.x - line.start.x).toBeCloseTo(0, 12);
        }
    });

    it('splits the noon line around the plate and draws each half-day for the edge that bounds the shadow', () => {
        const sundial = createSundial();
        sundial.setLatitude(NEW_YORK.latitude);
        const half = SUNDIAL_CONFIG.gnomon.thickness / 2;
        const lines = sundial.getState().hourLines;
        expect(
            lines
                .filter((line) => line.hour === 12)
                .map((line) => line.edgeOffset)
                .sort()
        ).toEqual([-half, half]);
        for (const line of lines.filter((l) => l.hour !== 12)) {
            expect(line.edgeOffset).toBe(line.hourAngleRad < 0 ? -half : half);
        }
    });

    it('keeps every mark on the face', () => {
        const sundial = createSundial();
        for (const latitude of [-66, -33.9, 0, 5, 15, 40.7, 51.5, 70, 89]) {
            sundial.setLatitude(latitude);
            for (const line of sundial.getState().hourLines) {
                expect(Math.hypot(line.end.x, line.end.z)).toBeLessThanOrEqual(SUNDIAL_CONFIG.hourLines.radius + 1e-9);
            }
        }
    });
});

describe('the shadow is the clock', () => {
    const astronomy = new AstronomyService();

    /**
     * Sweep a day at a fixed place and date: wherever the sun is usefully up,
     * cast the real style along the scene sun vector and read the hour off the
     * shadow. It must match local apparent solar time.
     */
    function sweep(observer, dayIso) {
        const sundial = createSundial();
        const start = new Date(`${dayIso}T00:00:00Z`).getTime();
        let checked = 0;
        let worst = 0;
        for (let minutes = 0; minutes < 24 * 60; minutes += 20) {
            const t = new Date(start + minutes * 60000);
            const astro = astronomy.getPositionsForDate(t, observer.latitude, observer.longitude, 20);
            if (astro.sunAltitude < 5 * DEG) continue;
            sundial.update(t, astro);
            const state = sundial.getState();
            const sun = astro.sunPosition.clone().normalize();
            const { direction } = castStyleShadow(state, sun);
            const reading = hourAngleFromShadowDirection(observer.latitude, direction);
            const truth = hoursToHourAngle(/** @type {number} */ (state.apparentSolarHours));
            worst = Math.max(worst, Math.abs(hourAngleToMinutes(wrap(reading - truth))));
            checked++;
        }
        return { checked, worst };
    }

    it.each([
        ['New York, winter solstice', NEW_YORK, '2026-12-21'],
        ['New York, equinox', NEW_YORK, '2026-09-23'],
        ['New York, summer solstice', NEW_YORK, '2026-06-21'],
        ['New York, equation-of-time maximum', NEW_YORK, '2026-11-03'],
        ['Sydney, equation-of-time minimum', SYDNEY, '2026-02-11'],
        ['Greenwich, July', GREENWICH, '2026-07-26']
    ])('%s: the shadow reads apparent solar time within a minute', (_label, observer, dayIso) => {
        const { checked, worst } = sweep(observer, dayIso);
        expect(checked).toBeGreaterThan(10);
        expect(worst).toBeLessThan(1);
    });

    it('lands on the drawn hour line at each whole apparent hour', () => {
        const sundial = createSundial();
        const day = new Date('2026-11-03T12:00:00Z');
        sundial.update(day, NEW_YORK);
        for (const line of sundial.getState().hourLines) {
            const t = instantOfApparentTime(day, NEW_YORK.longitude, line.hour);
            const astro = astronomy.getPositionsForDate(t, NEW_YORK.latitude, NEW_YORK.longitude, 20);
            if (astro.sunAltitude < 5 * DEG) continue;
            const state = sundial.getState();
            const { from, direction } = castStyleShadow(state, astro.sunPosition.clone().normalize(), line.edgeOffset);
            // The shadow of that plate edge starts where the drawn line points back to…
            const drawn = { e: line.end.x - line.start.x, n: line.end.z - line.start.z };
            const length = Math.hypot(drawn.e, drawn.n);
            const cross = ((line.start.x - from.e) * drawn.n - (line.start.z - from.n) * drawn.e) / length;
            expect(Math.abs(cross)).toBeLessThan(1e-9);
            // …and points along the drawn mark itself. Away from 06/18 a minute of
            // time is under 0.4° of shadow on a 40.7° dial.
            const angle = wrap(Math.atan2(direction.e, direction.n) - Math.atan2(drawn.e, drawn.n));
            expect(Math.abs(angle) / DEG).toBeLessThan(0.4);
            const shadowHour = hourAngleFromShadowDirection(NEW_YORK.latitude, direction);
            expect(Math.abs(hourAngleToMinutes(wrap(shadowHour - line.hourAngleRad)))).toBeLessThan(1);
        }
    });

    it('draws each line for the plate face whose shadow is the outer, readable edge', () => {
        const sundial = createSundial();
        const day = new Date('2026-06-21T12:00:00Z');
        sundial.update(day, NEW_YORK);
        const half = SUNDIAL_CONFIG.gnomon.thickness / 2;
        for (const line of sundial.getState().hourLines.filter((l) => l.hour !== 12)) {
            const t = instantOfApparentTime(day, NEW_YORK.longitude, line.hour);
            const astro = astronomy.getPositionsForDate(t, NEW_YORK.latitude, NEW_YORK.longitude, 20);
            if (astro.sunAltitude < 5 * DEG) continue;
            const sun = astro.sunPosition.clone().normalize();
            // Project the tip of each plate face; the boundary between shadow and
            // sunlit face is whichever lands farther toward the shadow side.
            const tipE = (edge) => {
                const { from, direction } = castStyleShadow(sundial.getState(), sun, edge);
                return from.e + direction.e;
            };
            const shadowSide = Math.sign(line.hourAngleRad);
            const outer = shadowSide * tipE(half) > shadowSide * tipE(-half) ? half : -half;
            expect(line.edgeOffset).toBe(outer);
        }
    });

    it('straightens into parallel lines at the equator and still reads the raised style', () => {
        const sundial = createSundial();
        sundial.setLatitude(0);
        const layout = layoutGnomon(0, SUNDIAL_CONFIG.gnomon);
        const options = { radius: SUNDIAL_CONFIG.hourLines.radius, rootGap: SUNDIAL_CONFIG.hourLines.rootGap };
        for (const hours of [8, 10, 14, 16]) {
            const segment = hourLineSegment(layout, hoursToHourAngle(hours), options);
            const t = instantOfApparentTime(new Date('2026-03-20T12:00:00Z'), 0, hours);
            const astro = astronomy.getPositionsForDate(t, 1e-9, 1e-9, 20);
            const sun = astro.sunPosition.clone().normalize();
            const state = sundial.getState();
            const { from } = castStyleShadow(state, sun);
            expect(from.e).toBeCloseTo(/** @type {NonNullable<typeof segment>} */ (segment).start.e, 1);
        }
    });
});

describe('night clock', () => {
    const civilPointerDirection = (sundial) => {
        const yaw = /** @type {THREE.Object3D} */ (sundial.group.getObjectByName('sundial-night-hour')).rotation.y;
        return { x: Math.sin(yaw), z: Math.cos(yaw) };
    };

    it('appears only once the sun is down', () => {
        const sundial = createSundial();
        const t = new Date('2026-10-16T16:00:00Z');
        const hourPivot = /** @type {THREE.Object3D} */ (sundial.group.getObjectByName('sundial-night-hour'));

        sundial.update(t, { ...NEW_YORK, sunAltitude: 30 * DEG });
        expect(sundial.getState().nightFactor).toBe(0);
        expect(hourPivot.visible).toBe(false);
        expect(sundial.getState().ghostVisible).toBe(true);

        sundial.update(t, { ...NEW_YORK, sunAltitude: -20 * DEG });
        expect(sundial.getState().nightFactor).toBe(1);
        expect(hourPivot.visible).toBe(true);
        expect(sundial.getState().ghostVisible).toBe(false);

        // Twilight is a crossfade, not a switch.
        sundial.update(t, { ...NEW_YORK, sunAltitude: -1 * DEG });
        expect(sundial.getState().nightFactor).toBeGreaterThan(0);
        expect(sundial.getState().nightFactor).toBeLessThan(1);
    });

    it('points at local clock time on a 24-hour ring that turns the way the shadow does', () => {
        const sundial = createSundial();
        // Local wall-clock instants, the same clock the digital display shows.
        const at = (hours) => new Date(2026, 9, 16, hours, 0, 0);
        sundial.update(at(18), { ...NEW_YORK, sunAltitude: -20 * DEG });
        expect(civilPointerDirection(sundial).x).toBeCloseTo(1, 9); // east, where the evening shadow points
        sundial.update(at(0), { ...NEW_YORK, sunAltitude: -20 * DEG });
        expect(civilPointerDirection(sundial).z).toBeCloseTo(-1, 9); // midnight opposite the noon shadow
        sundial.update(at(6), { ...NEW_YORK, sunAltitude: -20 * DEG });
        expect(civilPointerDirection(sundial).x).toBeCloseTo(-1, 9);

        // Southern hemisphere: noon shadow points south, so midnight is north.
        sundial.update(at(0), { ...SYDNEY, sunAltitude: -20 * DEG });
        expect(civilPointerDirection(sundial).z).toBeCloseTo(1, 9);
        sundial.update(at(18), { ...SYDNEY, sunAltitude: -20 * DEG });
        expect(civilPointerDirection(sundial).x).toBeCloseTo(1, 9);
    });
});

describe('motion follows simulation time, never the wall clock', () => {
    const snapshot = (sundial) => {
        const hour = /** @type {THREE.Object3D} */ (sundial.group.getObjectByName('sundial-night-hour'));
        const minute = /** @type {THREE.Object3D} */ (sundial.group.getObjectByName('sundial-night-minute'));
        const ghost = /** @type {THREE.Object3D} */ (sundial.group.getObjectByName('sundial-ghost'));
        return {
            group: sundial.group.rotation.toArray(),
            hour: hour.rotation.y,
            minute: minute.rotation.y,
            ghost: [...ghost.position.toArray(), ghost.rotation.y, ghost.scale.z]
        };
    };

    it('does not move when only the wall clock advances', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-16T09:00:00Z'));
        const sundial = createSundial();
        const simulated = new Date('2026-06-21T15:00:00Z');
        sundial.update(simulated, { ...NEW_YORK, sunAltitude: 40 * DEG });
        const first = snapshot(sundial);

        vi.setSystemTime(new Date('2026-10-16T12:17:00Z'));
        sundial.update(simulated, { ...NEW_YORK, sunAltitude: 40 * DEG });
        expect(snapshot(sundial)).toEqual(first);
        // A still instrument on the meridian: no idle yaw at all.
        expect(first.group).toEqual([0, 0, 0, 'XYZ']);
    });

    it('turns the night pointer 15° per simulated hour', () => {
        const sundial = createSundial();
        const t = new Date(2026, 9, 16, 22, 0, 0);
        sundial.update(t, { ...NEW_YORK, sunAltitude: -30 * DEG });
        const before = snapshot(sundial).hour;
        sundial.update(new Date(t.getTime() + 3600000), { ...NEW_YORK, sunAltitude: -30 * DEG });
        expect(Math.abs(wrap(snapshot(sundial).hour - before))).toBeCloseTo(15 * DEG, 9);
    });
});

describe('equation-of-time ghost line', () => {
    const ghostOf = (sundial) => /** @type {THREE.Mesh} */ (sundial.group.getObjectByName('sundial-ghost'));

    it('marks local mean time, one equation of time away from the shadow', () => {
        const sundial = createSundial();
        const t = new Date('2026-11-03T18:00:00Z');
        sundial.update(t, { ...NEW_YORK, sunAltitude: 30 * DEG });
        const ghost = ghostOf(sundial);
        const yaw = ghost.rotation.y;
        const ghostHour = hourAngleFromShadowDirection(NEW_YORK.latitude, { e: Math.sin(yaw), n: Math.cos(yaw) });
        const state = sundial.getState();
        expect(ghostHour).toBeCloseTo(hoursToHourAngle(/** @type {number} */ (state.localMeanHours)), 9);
        const gapMinutes = hourAngleToMinutes(
            hoursToHourAngle(/** @type {number} */ (state.apparentSolarHours)) - ghostHour
        );
        expect(gapMinutes).toBeCloseTo(/** @type {number} */ (state.equationOfTimeMin), 6);
        expect(gapMinutes).toBeGreaterThan(16);
    });

    it('glows warm while the sun runs ahead of the clock and cool while it lags', () => {
        const sundial = createSundial();
        sundial.update(new Date('2026-11-03T17:00:00Z'), { ...NEW_YORK, sunAltitude: 30 * DEG });
        const november = /** @type {THREE.MeshStandardMaterial} */ (ghostOf(sundial).material).color.clone();
        expect(november.r).toBeGreaterThan(november.b);

        sundial.update(new Date('2026-02-11T17:00:00Z'), { ...NEW_YORK, sunAltitude: 30 * DEG });
        const february = /** @type {THREE.MeshStandardMaterial} */ (ghostOf(sundial).material).color.clone();
        expect(february.b).toBeGreaterThan(february.r);
    });

    it('carries no printed numbers anywhere on the instrument', () => {
        const sundial = createSundial();
        sundial.update(new Date('2026-11-03T17:00:00Z'), NEW_YORK);
        sundial.group.traverse((object) => {
            expect(object).not.toBeInstanceOf(THREE.Sprite);
            const material = /** @type {THREE.Mesh} */ (object).material;
            if (material && !Array.isArray(material)) {
                expect(/** @type {THREE.MeshStandardMaterial} */ (material).map ?? null).toBeNull();
            }
        });
    });
});
