import { afterEach, describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { propagate } from 'satellite.js';
import { equatorialToSceneMatrix, equatorialToVector, localSiderealTime } from '../sky/celestialCoordinates.js';
import {
    SATELLITE_CONFIG,
    getSatellitePositions,
    isSatelliteDrawable,
    mergeSatelliteCatalogs,
    parseOmm,
    parseSatelliteCatalog,
    parseTle,
    propagateSatellite,
    satelliteApparentMagnitude
} from '../sky/satellites.js';
import { getSnapshotCatalog, loadLiveCatalog } from '../sky/satelliteCatalog.js';
import { SATELLITE_LAYER_CONFIG, SatelliteLayer } from '../effects/satellite-layer.js';
import { StarField } from '../effects/star-field.js';
import { describeSkyBodies } from '../sky/skyBodies.js';

const NYC = { latitude: 40.7128, longitude: -74.006 };
const RAD_TO_DEG = 180 / Math.PI;

/** ISS (ZARYA), epoch 2026-10-21 15:05:07 UTC. A fixed fixture: no network, independent of the snapshot. */
const ISS_TLE = {
    name: 'ISS (ZARYA)',
    line1: '1 25544U 98067A   26294.62855872  .00009326  00000-0  17730-3 0  9997',
    line2: '2 25544  51.6331  34.3903 0006791 291.7825  68.2441 15.48976265591351'
};
const ISS_EPOCH = Date.UTC(2026, 0, 1) + (294.62855872 - 1) * 86400000;

/** Vallado's SGP4 verification case for Vanguard 1 (catalog 00005), from `tcppver.out`. */
const VANGUARD_TLE = {
    line1: '1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753',
    line2: '2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667'
};

/** Angular separation between two alt/az directions, degrees. */
function separationDeg(alt1, az1, alt2, az2) {
    const a1 = alt1 / RAD_TO_DEG;
    const a2 = alt2 / RAD_TO_DEG;
    const dAz = (az1 - az2) / RAD_TO_DEG;
    const cos = Math.sin(a1) * Math.sin(a2) + Math.cos(a1) * Math.cos(a2) * Math.cos(dAz);
    return Math.acos(Math.max(-1, Math.min(1, cos))) * RAD_TO_DEG;
}

/** Scan forward from `start` for the first instant the ISS is above an observer's horizon. */
function findIssAboveHorizon(elements, start, observer, { minAltitudeDeg = 10, night = false } = {}) {
    for (let t = start; t < start + 2 * 86400000; t += 30000) {
        const position = propagateSatellite(elements, t, observer);
        if (!position || position.altitudeDeg < minAltitudeDeg) continue;
        if (night) {
            const hour = new Date(t).getUTCHours();
            // Local night in New York (UTC−4 in October): 01:00–09:00 UTC.
            if (hour < 1 || hour > 8) continue;
        }
        return t;
    }
    throw new Error('ISS never rose in two days');
}

describe('satellite elements', () => {
    it('reproduces the Vallado SGP4 verification vector at epoch', () => {
        const vanguard = parseTle(VANGUARD_TLE.line1, VANGUARD_TLE.line2);
        expect(vanguard).not.toBeNull();
        const state = propagate(/** @type {any} */ (vanguard).satrec, new Date(vanguard.epochMs));
        expect(state.position.x).toBeCloseTo(7022.46529266, 2);
        expect(state.position.y).toBeCloseTo(-1400.08296755, 2);
        expect(state.position.z).toBeCloseTo(0.03995155, 2);
    });

    it('parses a TLE into elements with its NORAD id, name, epoch, and a standard magnitude', () => {
        const iss = parseTle(ISS_TLE.line1, ISS_TLE.line2, ISS_TLE.name);
        expect(iss.id).toBe(25544);
        expect(iss.name).toBe('ISS (ZARYA)');
        expect(Math.abs(iss.epochMs - ISS_EPOCH)).toBeLessThan(1);
        expect(iss.standardMagnitude).toBe(-1.8);
    });

    it('parses the equivalent Celestrak OMM record to the same orbit', () => {
        const omm = {
            OBJECT_NAME: 'ISS (ZARYA)',
            OBJECT_ID: '1998-067A',
            EPOCH: new Date(ISS_EPOCH).toISOString().replace('Z', ''),
            MEAN_MOTION: 15.48976265,
            ECCENTRICITY: 0.0006791,
            INCLINATION: 51.6331,
            RA_OF_ASC_NODE: 34.3903,
            ARG_OF_PERICENTER: 291.7825,
            MEAN_ANOMALY: 68.2441,
            EPHEMERIS_TYPE: 0,
            CLASSIFICATION_TYPE: 'U',
            NORAD_CAT_ID: 25544,
            ELEMENT_SET_NO: 999,
            REV_AT_EPOCH: 59135,
            BSTAR: 0.0001773,
            MEAN_MOTION_DOT: 0.00009326,
            MEAN_MOTION_DDOT: 0
        };
        const fromOmm = parseOmm(/** @type {any} */ (omm));
        const fromTle = parseTle(ISS_TLE.line1, ISS_TLE.line2, ISS_TLE.name);
        const when = ISS_EPOCH + 3600000;
        const a = propagateSatellite(fromOmm, when, NYC);
        const b = propagateSatellite(fromTle, when, NYC);
        expect(fromOmm.id).toBe(25544);
        expect(separationDeg(a.altitudeDeg, a.azimuthDeg, b.altitudeDeg, b.azimuthDeg)).toBeLessThan(0.01);
    });

    it('drops malformed rows instead of failing the catalog, and keeps the newest duplicate', () => {
        const older = { ...ISS_TLE, line1: ISS_TLE.line1.replace('26294.62855872', '26290.62855872') };
        const catalog = parseSatelliteCatalog([
            { line1: 'garbage', line2: 'more garbage' },
            older,
            ISS_TLE,
            /** @type {any} */ (null)
        ]);
        expect(catalog).toHaveLength(1);
        expect(Math.abs(catalog[0].epochMs - ISS_EPOCH)).toBeLessThan(1);
    });

    it('merges a fresher catalog over an older one without losing anything', () => {
        const fresh = parseTle(ISS_TLE.line1, ISS_TLE.line2, ISS_TLE.name);
        const stale = { ...fresh, epochMs: fresh.epochMs - 86400000, name: 'stale' };
        const hubble = { ...fresh, id: 20580, name: 'HST' };
        const merged = mergeSatelliteCatalogs([stale, hubble], [fresh]);
        expect(merged).toHaveLength(2);
        expect(merged.find((entry) => entry.id === 25544).name).toBe('ISS (ZARYA)');
    });

    it('ships a snapshot that parses whole and includes the ISS', () => {
        const snapshot = getSnapshotCatalog();
        expect(snapshot.source).toBe('snapshot');
        expect(snapshot.satellites.length).toBeGreaterThanOrEqual(20);
        expect(snapshot.satellites.some((entry) => entry.id === SATELLITE_CONFIG.issId)).toBe(true);
        expect(Number.isFinite(snapshot.newestEpochMs)).toBe(true);
    });
});

describe('satellite positions', () => {
    const iss = parseTle(ISS_TLE.line1, ISS_TLE.line2, ISS_TLE.name);

    it('keeps the ISS in its real orbit, ~420 km up', () => {
        for (let k = 0; k < 12; k++) {
            const position = propagateSatellite(iss, ISS_EPOCH + k * 600000, NYC);
            expect(position.heightKm).toBeGreaterThan(380);
            expect(position.heightKm).toBeLessThan(460);
        }
    });

    it('lands on the star sphere exactly where SGP4 look angles say it is', () => {
        // The scene places the topocentric RA/Dec through the same equatorial →
        // scene rotation as every star. That path must agree with satellite.js's
        // independent ECF look-angle solution, above and below the horizon.
        for (let k = 0; k < 48; k++) {
            const when = ISS_EPOCH + k * 397000;
            const position = propagateSatellite(iss, when, NYC);
            const v = equatorialToVector(position.ra, position.dec, 1);
            const m = equatorialToSceneMatrix(localSiderealTime(when, NYC.longitude), NYC.latitude);
            const x = m[0] * v.x + m[1] * v.y + m[2] * v.z;
            const y = m[3] * v.x + m[4] * v.y + m[5] * v.z;
            const z = m[6] * v.x + m[7] * v.y + m[8] * v.z;
            const sceneAlt = Math.asin(y) * RAD_TO_DEG;
            const sceneAz = (((Math.atan2(x, z) * RAD_TO_DEG) % 360) + 360) % 360;
            expect(separationDeg(sceneAlt, sceneAz, position.altitudeDeg, position.azimuthDeg)).toBeLessThan(0.05);
        }
    });

    it('is topocentric: observers 500 km apart see the ISS in different parts of the sky', () => {
        const when = findIssAboveHorizon(iss, ISS_EPOCH, NYC);
        const nyc = propagateSatellite(iss, when, NYC);
        const boston = propagateSatellite(iss, when, { latitude: 42.3601, longitude: -71.0589 });
        const dRa = Math.abs(nyc.ra - boston.ra) * RAD_TO_DEG;
        const dDec = Math.abs(nyc.dec - boston.dec) * RAD_TO_DEG;
        expect(Math.max(dRa, dDec)).toBeGreaterThan(5);
    });

    it('moves with simulated time', () => {
        const when = findIssAboveHorizon(iss, ISS_EPOCH, NYC);
        const a = propagateSatellite(iss, when, NYC);
        const b = propagateSatellite(iss, when + 30000, NYC);
        expect(separationDeg(a.altitudeDeg, a.azimuthDeg, b.altitudeDeg, b.azimuthDeg)).toBeGreaterThan(0.5);
        // Deterministic: the same instant always gives the same answer.
        expect(propagateSatellite(iss, when, NYC)).toEqual(a);
    });

    it('is only sunlit on the day side or high enough to clear Earth’s shadow', () => {
        let sawShadow = false;
        let sawLight = false;
        for (let k = 0; k < 96; k++) {
            const position = propagateSatellite(iss, ISS_EPOCH + k * 60000, NYC);
            if (position.sunlit) sawLight = true;
            else sawShadow = true;
        }
        // A 92-minute orbit spends about a third of each revolution eclipsed.
        expect(sawShadow).toBe(true);
        expect(sawLight).toBe(true);
    });
});

describe('satellite brightness', () => {
    it('returns the standard magnitude at 1000 km and 90° phase', () => {
        expect(satelliteApparentMagnitude(2, 1000, Math.PI / 2)).toBeCloseTo(2, 9);
    });

    it('brightens with proximity by the inverse-square law', () => {
        expect(satelliteApparentMagnitude(2, 500, Math.PI / 2)).toBeCloseTo(2 - 5 * Math.log10(2), 9);
    });

    it('is brightest fully lit and fades toward back-lit', () => {
        const full = satelliteApparentMagnitude(0, 1000, 0);
        const half = satelliteApparentMagnitude(0, 1000, Math.PI / 2);
        const crescent = satelliteApparentMagnitude(0, 1000, 2.8);
        expect(full).toBeCloseTo(-2.5 * Math.log10(Math.PI), 9);
        expect(full).toBeLessThan(half);
        expect(crescent).toBeGreaterThan(half + 2);
    });

    it('draws only satellites that are up and bright enough, plus the ISS whenever it is up', () => {
        const base = {
            id: 1,
            name: 'x',
            ra: 0,
            dec: 0,
            azimuthDeg: 0,
            rangeKm: 800,
            heightKm: 500,
            isIss: false
        };
        expect(isSatelliteDrawable({ ...base, altitudeDeg: 30, aboveHorizon: true, magnitude: 3, sunlit: true })).toBe(
            true
        );
        expect(isSatelliteDrawable({ ...base, altitudeDeg: 30, aboveHorizon: true, magnitude: 5, sunlit: true })).toBe(
            false
        );
        expect(isSatelliteDrawable({ ...base, altitudeDeg: 30, aboveHorizon: true, magnitude: 1, sunlit: false })).toBe(
            false
        );
        expect(isSatelliteDrawable({ ...base, altitudeDeg: -5, aboveHorizon: false, magnitude: 1, sunlit: true })).toBe(
            false
        );
        const issUp = { ...base, isIss: true, altitudeDeg: 20, aboveHorizon: true, magnitude: 6, sunlit: false };
        expect(isSatelliteDrawable(issUp)).toBe(true);
        expect(isSatelliteDrawable({ ...issUp, altitudeDeg: -1, aboveHorizon: false })).toBe(false);
    });

    it('sorts drawn satellites brightest first', () => {
        const catalog = getSnapshotCatalog().satellites;
        let seen = 0;
        for (let t = ISS_EPOCH; t < ISS_EPOCH + 86400000 && seen < 3; t += 120000) {
            const positions = getSatellitePositions(catalog, t, NYC, { includeHidden: true, magnitudeLimit: 99 });
            for (let i = 1; i < positions.length; i++) {
                expect(positions[i].magnitude).toBeGreaterThanOrEqual(positions[i - 1].magnitude);
            }
            if (positions.length > 1) seen++;
        }
        expect(seen).toBeGreaterThan(0);
    });
});

describe('satellite catalog loading', () => {
    afterEach(() => vi.restoreAllMocks());

    it('lays a live Celestrak pull over the snapshot', async () => {
        const omm = [
            {
                OBJECT_NAME: 'NEW BRIGHT THING',
                EPOCH: new Date(ISS_EPOCH).toISOString().replace('Z', ''),
                MEAN_MOTION: 15.2,
                ECCENTRICITY: 0.001,
                INCLINATION: 70,
                RA_OF_ASC_NODE: 100,
                ARG_OF_PERICENTER: 10,
                MEAN_ANOMALY: 20,
                NORAD_CAT_ID: 99999,
                BSTAR: 0.0001,
                MEAN_MOTION_DOT: 0,
                MEAN_MOTION_DDOT: 0
            }
        ];
        const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => omm }));
        const catalog = await loadLiveCatalog({ fetchImpl: /** @type {any} */ (fetchImpl) });
        expect(fetchImpl).toHaveBeenCalledOnce();
        expect(catalog.source).toBe('live');
        expect(catalog.satellites.some((entry) => entry.id === 99999)).toBe(true);
        // Nothing from the snapshot is lost, the ISS least of all.
        expect(catalog.satellites.some((entry) => entry.id === SATELLITE_CONFIG.issId)).toBe(true);
        expect(catalog.satellites.find((entry) => entry.id === 99999).standardMagnitude).toBe(
            SATELLITE_CONFIG.defaultStandardMagnitude
        );
    });

    it('falls back to the snapshot when the live feed fails (offline, CORS, bad status)', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const rejected = await loadLiveCatalog({
            fetchImpl: /** @type {any} */ (
                async () => {
                    throw new TypeError('Failed to fetch');
                }
            )
        });
        const badStatus = await loadLiveCatalog({
            fetchImpl: /** @type {any} */ (async () => ({ ok: false, status: 503, json: async () => [] }))
        });
        for (const catalog of [rejected, badStatus]) {
            expect(catalog.source).toBe('snapshot');
            expect(catalog.satellites.length).toBe(getSnapshotCatalog().satellites.length);
        }
    });
});

describe('SatelliteLayer', () => {
    const snapshot = getSnapshotCatalog();
    const issElements = snapshot.satellites.find((entry) => entry.id === SATELLITE_CONFIG.issId);
    const nightPass = findIssAboveHorizon(issElements, snapshot.newestEpochMs, NYC, { night: true });

    function makeLayer(options = {}) {
        const parent = new THREE.Group();
        const layer = new SatelliteLayer(parent, { radius: 2000, catalog: snapshot, ...options });
        layer.setVisible(true);
        return { parent, layer };
    }

    it('draws the ISS, on the sky sphere, when it is above the horizon', () => {
        const { parent, layer } = makeLayer();
        expect(parent.children).toContain(layer.group);
        layer.setDate(nightPass, NYC);
        const positions = layer.getPositions();
        expect(positions.some((satellite) => satellite.isIss)).toBe(true);
        expect(layer.points.geometry.drawRange.count).toBe(positions.length);
        const position = layer.points.geometry.getAttribute('position');
        const radius = Math.hypot(position.getX(0), position.getY(0), position.getZ(0));
        expect(radius).toBeCloseTo(2000, 3);
    });

    it('re-solves when simulated time moves — the time-warp / setDebugTime path', () => {
        const { layer } = makeLayer();
        layer.setDate(nightPass, NYC);
        const before = layer.getPositions().find((satellite) => satellite.isIss);
        // Under the throttle: nothing changes.
        layer.setDate(nightPass + SATELLITE_LAYER_CONFIG.recomputeMs / 2, NYC);
        expect(layer.getPositions().find((satellite) => satellite.isIss)).toEqual(before);
        layer.setDate(nightPass + 20000, NYC);
        const after = layer.getPositions().find((satellite) => satellite.isIss);
        expect(after).toBeDefined();
        expect(after.ra).not.toBeCloseTo(before.ra, 3);
    });

    it('trails the ISS with its own recent path, and drops the trail under reduced motion', () => {
        const { layer } = makeLayer();
        layer.setDate(nightPass, NYC);
        layer.update(1);
        expect(layer.trail.visible).toBe(true);
        expect(layer.trail.geometry.drawRange.count).toBe(SATELLITE_LAYER_CONFIG.trailSamples);
        // The head of the trail is the ISS itself.
        const head = layer.trail.geometry.getAttribute('position');
        const iss = layer.getPositions().find((satellite) => satellite.isIss);
        const expected = equatorialToVector(iss.ra, iss.dec, 2000);
        expect(head.getX(0)).toBeCloseTo(expected.x, 2);
        expect(head.getZ(0)).toBeCloseTo(expected.z, 2);

        layer.setReducedMotion(true);
        layer.setDate(nightPass, NYC);
        layer.update(1);
        expect(layer.trail.visible).toBe(false);
        expect(layer.points.visible).toBe(true);
    });

    it('fades with the sky and hides entirely when the sky does', () => {
        const { layer } = makeLayer();
        layer.setDate(nightPass, NYC);
        layer.update(0.4);
        expect(layer.group.visible).toBe(true);
        expect(/** @type {any} */ (layer.material).uniforms.uOpacity.value).toBeCloseTo(0.4, 9);
        layer.update(0);
        expect(layer.group.visible).toBe(false);
        layer.setVisible(false);
        layer.update(1);
        expect(layer.group.visible).toBe(false);
    });

    it('holds its points steady rather than twinkling', () => {
        const { layer } = makeLayer();
        expect(/** @type {any} */ (layer.material).defines?.STAR_TWINKLE).toBeUndefined();
    });

    it('reports how stale its elements are', () => {
        const { layer } = makeLayer();
        layer.setDate(snapshot.newestEpochMs + 3 * 86400000, NYC);
        const summary = layer.getSummary();
        expect(summary.source).toBe('snapshot');
        expect(summary.tracked).toBe(snapshot.satellites.length);
        expect(summary.epochAgeDays).toBeCloseTo(3, 6);
    });
});

describe('StarField satellite toggle', () => {
    function makeField() {
        const scene = new THREE.Scene();
        return new StarField(scene, { faintStarCount: 32, liveSatelliteElements: false });
    }

    it('is off by default and never loads the layer until asked', () => {
        const field = makeField();
        expect(field.showSatellites).toBe(false);
        expect(field.satellites).toBeNull();
        expect(field.getSatellitePositions()).toEqual([]);
        expect(field.getCatalogSummary().satellites).toMatchObject({ enabled: false, loaded: false, drawn: 0 });
    });

    it('loads on demand, parents into the sky group, and follows the observer', async () => {
        const field = makeField();
        const snapshot = getSnapshotCatalog();
        const iss = snapshot.satellites.find((entry) => entry.id === SATELLITE_CONFIG.issId);
        const nightPass = findIssAboveHorizon(iss, snapshot.newestEpochMs, NYC, { night: true });

        await field.setSatellitesVisible(true);
        expect(field.satellites).not.toBeNull();
        expect(field.skyGroup.children).toContain(field.satellites.group);

        field.setObserver({ date: new Date(nightPass), latitude: NYC.latitude, longitude: NYC.longitude });
        // Deep night, clear sky.
        field.update(new THREE.Vector3(0, -15, 0));
        expect(field.satellites.group.visible).toBe(true);
        expect(field.getSatellitePositions().some((satellite) => satellite.isIss)).toBe(true);

        const summary = field.getCatalogSummary().satellites;
        expect(summary).toMatchObject({ enabled: true, loaded: true, source: 'snapshot' });
        expect(summary.drawn).toBeGreaterThan(0);

        const report = describeSkyBodies({
            date: nightPass,
            latitude: NYC.latitude,
            longitude: NYC.longitude,
            astro: /** @type {any} */ ({}),
            satellites: field.getSatellitePositions(),
            catalog: field.getCatalogSummary()
        });
        const reportedIss = report.satellites.find((satellite) => satellite.id === '25544');
        expect(reportedIss.aboveHorizon).toBe(true);
        expect(report.catalog.satellites.enabled).toBe(true);

        // Daylight hides it with the rest of the sky.
        field.update(new THREE.Vector3(0, 10, 0));
        expect(field.skyGroup.visible).toBe(false);

        // Cloud cover dims it exactly as it dims the bright stars.
        field.setObserver({ cloudCover: 80 });
        field.update(new THREE.Vector3(0, -15, 0));
        const opacity = /** @type {any} */ (field.satellites.material).uniforms.uOpacity.value;
        expect(opacity).toBeCloseTo(field._opacity, 9);
        expect(opacity).toBeLessThan(0.5);

        await field.setSatellitesVisible(false);
        field.update(new THREE.Vector3(0, -15, 0));
        expect(field.satellites.group.visible).toBe(false);
        expect(field.getSatellitePositions()).toEqual([]);
        field.dispose();
    });

    it('passes reduced motion through to the layer', async () => {
        const field = makeField();
        field.setReducedMotion(true);
        await field.setSatellitesVisible(true);
        expect(field.satellites.reducedMotion).toBe(true);
        field.dispose();
    });
});
