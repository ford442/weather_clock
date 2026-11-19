import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
    DEG,
    RAD_TO_DEG,
    equatorialToHorizontal,
    equatorialToVector,
    julianCenturies,
    localSiderealTime,
    meanObliquity
} from '../sky/celestialCoordinates.js';
import {
    GALACTIC_NORTH_POLE_J2000,
    MILKY_WAY_HALF_WIDTH_DEG,
    galacticToEquatorial,
    galacticToEquatorialJ2000,
    getGalacticFrame,
    milkyWayBrightness
} from '../sky/milkyWay.js';
import { MILKY_WAY_CONFIG, MilkyWayBand, createMilkyWayTexture } from '../effects/milky-way.js';
import { StarField } from '../effects/star-field.js';

const NYC = { lat: 40.7128, lon: -74.006 };
const NIGHT = new THREE.Vector3(0, -15, 0);
const DAY = new THREE.Vector3(0, 15, 0);
/** Local midnight (EDT) in mid-July: the galactic centre is near the meridian, low in the south. */
const SUMMER_MIDNIGHT = new Date('2026-07-15T04:00:00Z');

/**
 * Great-circle separation between two equatorial positions, in degrees.
 * @param {{ra: number, dec: number}} a
 * @param {{ra: number, dec: number}} b
 */
function separationDeg(a, b) {
    const va = equatorialToVector(a.ra, a.dec);
    const vb = equatorialToVector(b.ra, b.dec);
    const dot = va.x * vb.x + va.y * vb.y + va.z * vb.z;
    return Math.acos(Math.max(-1, Math.min(1, dot))) * RAD_TO_DEG;
}

describe('galactic coordinates', () => {
    it('puts l = 0, b = 0 on the published galactic centre (Sgr A*)', () => {
        // Sgr A*: RA 17h 45m 40.04s, Dec −29° 00′ 28.2″ (J2000).
        const sgrA = { ra: (17 + 45 / 60 + 40.04 / 3600) * 15 * DEG, dec: -(29 + 0 / 60 + 28.2 / 3600) * DEG };
        const centre = galacticToEquatorialJ2000(0, 0);
        expect(separationDeg(centre, sgrA)).toBeLessThan(0.1);
        expect(separationDeg(getGalacticFrame(0).centre, sgrA)).toBeLessThan(1);
    });

    it('maps b = 90° onto the north galactic pole', () => {
        expect(separationDeg(galacticToEquatorialJ2000(1.234, Math.PI / 2), GALACTIC_NORTH_POLE_J2000)).toBeLessThan(
            1e-6
        );
    });

    it('lays the band in the plane 90° from the pole, at J2000 and of date', () => {
        for (const centuries of [0, julianCenturies(SUMMER_MIDNIGHT)]) {
            const { pole } = getGalacticFrame(centuries);
            for (let l = 0; l < 360; l += 15) {
                expect(separationDeg(galacticToEquatorial(l * DEG, 0, centuries), pole)).toBeCloseTo(90, 6);
            }
        }
    });

    it('carries the frame with the same precession as the catalog', () => {
        const centuries = julianCenturies(SUMMER_MIDNIGHT);
        const drift = separationDeg(getGalacticFrame(0).centre, getGalacticFrame(centuries).centre);
        // ~50″ a year for 26.5 years ≈ 0.37°.
        expect(drift).toBeGreaterThan(0.3);
        expect(drift).toBeLessThan(0.45);
    });

    it('keeps the galactic plane well away from the ecliptic', () => {
        // The galactic and ecliptic poles sit ~60° apart, so the band and the
        // zodiac arc cross at two points and are otherwise distinct.
        const { pole } = getGalacticFrame(0);
        const eclipticPole = { ra: 270 * DEG, dec: (90 - meanObliquity(0) * RAD_TO_DEG) * DEG };
        expect(separationDeg(pole, eclipticPole)).toBeCloseTo(60.2, 0);
    });
});

describe('Milky Way brightness profile', () => {
    it('is brightest toward the centre and dimmest toward the anticentre', () => {
        expect(milkyWayBrightness(0, -2)).toBeGreaterThan(milkyWayBrightness(90, 0));
        expect(milkyWayBrightness(90, 0)).toBeGreaterThan(milkyWayBrightness(180, 0));
        expect(milkyWayBrightness(180, 0)).toBeGreaterThan(0);
    });

    it('fades away from the plane and stays inside 0…1', () => {
        for (const l of [0, 60, 120, 180, 270]) {
            expect(milkyWayBrightness(l, 20)).toBeLessThan(milkyWayBrightness(l, 4));
            for (let b = -MILKY_WAY_HALF_WIDTH_DEG; b <= MILKY_WAY_HALF_WIDTH_DEG; b += 4) {
                const value = milkyWayBrightness(l, b);
                expect(value).toBeGreaterThanOrEqual(0);
                expect(value).toBeLessThanOrEqual(1);
            }
        }
    });

    it('cuts the Great Rift into the band between Cygnus and Ophiuchus', () => {
        expect(milkyWayBrightness(45, 1.5)).toBeLessThan(milkyWayBrightness(45, -5));
    });

    it('bakes a seamless texture with no hard rim', () => {
        const texture = createMilkyWayTexture({ width: 64, height: 24 });
        const { data, width, height } = /** @type {{data: Uint8Array, width: number, height: number}} */ (
            texture.image
        );
        // Top and bottom rows taper to (nearly) nothing.
        for (let x = 0; x < width; x++) {
            expect(data[x * 4 + 3]).toBeLessThan(8);
            expect(data[((height - 1) * width + x) * 4 + 3]).toBeLessThan(8);
        }
        texture.dispose();
    });
});

describe('MilkyWayBand on the star field', () => {
    /** A field that has seen one clear, dark frame, which is when the band is first built. */
    const makeField = (quality = 'high') => {
        const field = new StarField(new THREE.Scene(), { faintStarCount: 32, quality });
        field.update(NIGHT);
        return field;
    };

    it('is not built until the sky is dark enough to show it', () => {
        const field = new StarField(new THREE.Scene(), { faintStarCount: 32 });
        expect(field.milkyWay).toBeNull();
        field.update(DAY);
        expect(field.milkyWay).toBeNull();
        field.setObserver({ cloudCover: 100 });
        field.update(NIGHT);
        expect(field.getMilkyWayState()).toMatchObject({ enabled: true, built: false, opacity: 0 });
        field.setObserver({ cloudCover: 0 });
        field.update(NIGHT);
        expect(field.milkyWay).toBeInstanceOf(MilkyWayBand);
        field.dispose();
    });

    it('is one mesh on the star sphere inside the sky group', () => {
        const field = makeField();
        const band = /** @type {MilkyWayBand} */ (field.milkyWay);
        expect(band).toBeInstanceOf(MilkyWayBand);
        expect(band.mesh.parent).toBe(field.skyGroup);
        expect(field.skyGroup.children.filter((child) => child.name === 'milky-way')).toHaveLength(1);

        const positions = band.geometry.getAttribute('position');
        for (let i = 0; i < positions.count; i += 97) {
            const length = Math.hypot(positions.getX(i), positions.getY(i), positions.getZ(i));
            expect(length).toBeCloseTo(field.radius, 1);
        }
        field.dispose();
    });

    it('uses log-depth chunks and never writes depth itself', () => {
        const field = makeField();
        const material = /** @type {THREE.ShaderMaterial} */ (/** @type {MilkyWayBand} */ (field.milkyWay).material);
        expect(material.vertexShader).toContain('USE_LOGARITHMIC_DEPTH_BUFFER');
        expect(material.fragmentShader).toContain('logdepthbuf_fragment');
        expect(material.fragmentShader).not.toContain('gl_FragDepth');
        expect(material.vertexShader).not.toMatch(/gl_Position\.z\s*=/);
        expect(material.depthWrite).toBe(false);
        field.dispose();
    });

    it('crosses the southern sky at midnight in a northern summer', () => {
        const field = makeField();
        field.setObserver({ date: SUMMER_MIDNIGHT, latitude: NYC.lat, longitude: NYC.lon, cloudCover: 0 });
        field.setLightPollution(0);
        field.update(NIGHT);
        field.skyGroup.updateMatrixWorld(true);

        const band = /** @type {MilkyWayBand} */ (field.milkyWay);
        expect(band.mesh.visible).toBe(true);
        expect(band.opacity).toBeGreaterThan(0.9);

        // The centre vertex (l = 0, b = 0) lands where the horizontal formula
        // puts the galactic centre: up, and in the south (Z−).
        const { longitudeSegments: columns, latitudeRows: rows } = MILKY_WAY_CONFIG;
        const positions = band.geometry.getAttribute('position');
        const centreIndex = (rows / 2) * (columns + 1);
        const world = new THREE.Vector3(
            positions.getX(centreIndex),
            positions.getY(centreIndex),
            positions.getZ(centreIndex)
        ).applyMatrix4(field.skyGroup.matrixWorld);

        const { centre } = getGalacticFrame(band.layoutCenturies);
        const { altitude, azimuth } = equatorialToHorizontal(
            centre.ra,
            centre.dec,
            localSiderealTime(SUMMER_MIDNIGHT, NYC.lon),
            NYC.lat
        );
        expect(world.y / field.radius).toBeCloseTo(Math.sin(altitude), 3);
        expect(altitude * RAD_TO_DEG).toBeGreaterThan(10);
        expect(Math.abs(azimuth * RAD_TO_DEG)).toBeLessThan(35); // SunCalc azimuth: 0 = south
        expect(world.z).toBeLessThan(0);
        field.dispose();
    });

    it('is gone in daylight, under overcast, and under heavy skyglow', () => {
        const field = makeField();
        const band = /** @type {MilkyWayBand} */ (field.milkyWay);
        field.setObserver({ date: SUMMER_MIDNIGHT, latitude: NYC.lat, longitude: NYC.lon, cloudCover: 0 });

        field.update(DAY);
        expect(band.opacity).toBe(0);
        expect(field.getMilkyWayState().opacity).toBe(0);

        field.update(NIGHT);
        const clear = band.opacity;
        expect(clear).toBeGreaterThan(0);

        field.setObserver({ cloudCover: 100 });
        field.update(NIGHT);
        expect(band.opacity).toBe(0);
        expect(band.mesh.visible).toBe(false);

        field.setObserver({ cloudCover: 0 });
        field.setLightPollution(1);
        field.update(NIGHT);
        expect(band.opacity).toBe(0);

        // Partial skyglow dims the band harder than it dims the faint stars.
        field.setLightPollution(0.5);
        field.update(NIGHT);
        const faint = field.faintMaterial.uniforms.uOpacity.value;
        expect(band.opacity).toBeGreaterThan(0);
        expect(band.opacity).toBeLessThan(faint);
        field.dispose();
    });

    it('is off on the low tier (with the constellations) and on from medium up', () => {
        const low = makeField('low');
        expect(low.milkyWay).toBeNull();
        expect(low.getMilkyWayState()).toMatchObject({ enabled: false, built: false, opacity: 0 });
        low.dispose();

        const medium = makeField('medium');
        expect(medium.getMilkyWayState()).toMatchObject({ enabled: true, built: true });
        // Dropping to low hides the built band rather than disposing it.
        medium.setQuality('low');
        medium.update(NIGHT);
        expect(/** @type {MilkyWayBand} */ (medium.milkyWay).mesh.visible).toBe(false);
        medium.dispose();

        // Raising the tier builds it on the next dark frame.
        const raised = makeField('low');
        raised.setQuality('high');
        raised.update(NIGHT);
        expect(raised.milkyWay).toBeInstanceOf(MilkyWayBand);
        raised.dispose();
    });

    it('lays out only when precession moves', () => {
        const field = makeField();
        const positions = /** @type {MilkyWayBand} */ (field.milkyWay).geometry.getAttribute('position');
        field.setObserver({ date: SUMMER_MIDNIGHT });
        const version = positions.version;
        field.setObserver({ date: new Date(SUMMER_MIDNIGHT.getTime() + 30 * 86400000) });
        expect(positions.version).toBe(version);
        field.setObserver({ date: new Date('2126-07-15T04:00:00Z') });
        expect(positions.version).toBeGreaterThan(version);
        field.dispose();
    });

    it('leaves the zodiac overlay untouched', () => {
        const field = makeField();
        field.setZodiacVisible(true);
        field.update(NIGHT);
        expect(field.zodiac.group.parent).toBe(field.skyGroup);
        expect(field.zodiac.group.visible).toBe(true);
        field.dispose();
    });

    it('removes its mesh and frees its resources on dispose', () => {
        const field = makeField();
        const band = /** @type {MilkyWayBand} */ (field.milkyWay);
        field.dispose();
        expect(band.mesh.parent).toBeNull();
        expect(field.milkyWay).toBeNull();
    });
});

describe('MilkyWayBand WebGPU path', () => {
    it('swaps to a TSL material and drives it through bandUniforms', async () => {
        const field = new StarField(new THREE.Scene(), { faintStarCount: 32 });
        field.update(NIGHT);
        await field.initWebGPU();
        const band = /** @type {MilkyWayBand} */ (field.milkyWay);
        const material = /** @type {any} */ (band.material);
        expect(material.isMeshBasicNodeMaterial).toBe(true);
        expect(material.uniforms).toBeUndefined();
        expect(band.mesh.material).toBe(material);

        field.setObserver({ date: SUMMER_MIDNIGHT, latitude: NYC.lat, longitude: NYC.lon, cloudCover: 0 });
        field.update(NIGHT);
        expect(material.userData.bandUniforms.uOpacity.value).toBeGreaterThan(0);
        expect(material.userData.bandUniforms.uHorizonRadius.value).toBe(field.radius);
        expect(field.getMilkyWayState().backend).toBe('webgpu');
        field.dispose();
    });

    it('is born on the TSL path when the tier rises after WebGPU init', async () => {
        const field = new StarField(new THREE.Scene(), { faintStarCount: 32, quality: 'low' });
        await field.initWebGPU();
        expect(field.milkyWay).toBeNull();
        field.setQuality('high');
        field.update(NIGHT);
        expect(/** @type {any} */ (/** @type {MilkyWayBand} */ (field.milkyWay).material).isNodeMaterial).toBe(true);
        field.dispose();
    });
});
