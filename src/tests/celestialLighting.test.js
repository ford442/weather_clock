import { describe, it, expect } from 'vitest';
import {
    CELESTIAL_CONFIG,
    getAirmass,
    getAltitudeRadFromPosition,
    getAtmosphericTransmission,
    getEarthSunDistanceAu,
    getHorizonReddening,
    getMoonDistanceFactor,
    getMoonOppositionSurge,
    getMoonPhaseAngleDeg,
    getMoonlightModel,
    getSolarIrradianceFactor,
    getSunlightModel
} from '../celestialLighting.js';

const DEG = Math.PI / 180;

describe('Earth–Sun distance and solar irradiance', () => {
    it('stays inside the real orbital bounds all year', () => {
        for (let day = 0; day < 366; day += 7) {
            const distance = getEarthSunDistanceAu(new Date(Date.UTC(2026, 0, 1 + day)));
            expect(distance).toBeGreaterThan(0.982);
            expect(distance).toBeLessThan(1.018);
        }
    });

    it('puts perihelion in early January and aphelion in early July', () => {
        const perihelion = getEarthSunDistanceAu(new Date('2026-01-03T00:00:00Z'));
        const aphelion = getEarthSunDistanceAu(new Date('2026-07-05T00:00:00Z'));
        const equinox = getEarthSunDistanceAu(new Date('2026-03-20T00:00:00Z'));

        expect(perihelion).toBeLessThan(equinox);
        expect(aphelion).toBeGreaterThan(equinox);
    });

    it('modulates irradiance by roughly ±3.4%, never more', () => {
        const perihelion = getSolarIrradianceFactor(new Date('2026-01-03T00:00:00Z'));
        const aphelion = getSolarIrradianceFactor(new Date('2026-07-05T00:00:00Z'));

        expect(perihelion).toBeGreaterThan(aphelion);
        expect(perihelion).toBeCloseTo(1.034, 2);
        expect(aphelion).toBeCloseTo(0.967, 2);
        // "Delicate", not dramatic: the whole annual swing stays under 7.5%.
        expect(perihelion / aphelion).toBeLessThan(1.075);
    });

    it('falls back to unity irradiance for an unusable date', () => {
        expect(getSolarIrradianceFactor(new Date('not a date'))).toBe(1);
        expect(getEarthSunDistanceAu(null)).toBe(1);
    });
});

describe('Atmospheric extinction', () => {
    it('is 1 airmass at the zenith and grows toward the horizon', () => {
        expect(getAirmass(90 * DEG)).toBeCloseTo(1, 2);
        expect(getAirmass(30 * DEG)).toBeGreaterThan(1.9);
        expect(getAirmass(30 * DEG)).toBeLessThan(2.1);
        expect(getAirmass(10 * DEG)).toBeGreaterThan(5);
    });

    it('transmits fully at the zenith and fades continuously to nothing at the horizon', () => {
        expect(getAtmosphericTransmission(90 * DEG)).toBeCloseTo(1, 3);

        let previous = getAtmosphericTransmission(90 * DEG);
        for (let altitudeDeg = 85; altitudeDeg >= 0; altitudeDeg -= 5) {
            const transmission = getAtmosphericTransmission(altitudeDeg * DEG);
            expect(transmission).toBeLessThanOrEqual(previous);
            expect(transmission).toBeGreaterThanOrEqual(0);
            previous = transmission;
        }

        expect(getAtmosphericTransmission(-10 * DEG)).toBe(0);
    });

    it('ramps horizon reddening from the zenith to saturation near the horizon', () => {
        expect(getHorizonReddening(90 * DEG)).toBeCloseTo(0, 3);
        expect(getHorizonReddening(20 * DEG)).toBeGreaterThan(0);
        expect(getHorizonReddening(20 * DEG)).toBeLessThan(1);
        expect(getHorizonReddening(5 * DEG)).toBe(1);
        expect(getHorizonReddening(-20 * DEG)).toBe(1);
    });
});

describe('Lunar phase photometry', () => {
    it('maps the illuminated fraction onto a phase angle', () => {
        expect(getMoonPhaseAngleDeg(1)).toBeCloseTo(0, 5);
        expect(getMoonPhaseAngleDeg(0.5)).toBeCloseTo(90, 5);
        expect(getMoonPhaseAngleDeg(0)).toBeCloseTo(180, 5);
    });

    it('reproduces the ~11:1 full-to-half brightness ratio a naive fraction misses', () => {
        const full = getMoonOppositionSurge(0);
        const quarter = getMoonOppositionSurge(90);

        expect(full).toBeCloseTo(1, 5);
        expect(1 / quarter).toBeGreaterThan(8);
        expect(1 / quarter).toBeLessThan(14);
        expect(getMoonOppositionSurge(180)).toBeLessThan(0.01);
    });

    it('surges sharply within a few degrees of full', () => {
        expect(getMoonOppositionSurge(2)).toBeLessThan(getMoonOppositionSurge(0));
        expect(getMoonOppositionSurge(2) / getMoonOppositionSurge(10)).toBeGreaterThan(1.05);
    });

    it('brightens a perigee supermoon over an apogee micromoon', () => {
        const supermoon = getMoonDistanceFactor(356500);
        const micromoon = getMoonDistanceFactor(406700);

        expect(supermoon).toBeGreaterThan(1.1);
        expect(micromoon).toBeLessThan(0.91);
        expect(getMoonDistanceFactor(CELESTIAL_CONFIG.moonMeanDistanceKm)).toBeCloseTo(1, 5);
        expect(getMoonDistanceFactor(null)).toBe(1);
    });
});

describe('Moonlight model', () => {
    const atZenith = (fraction, distanceKm = CELESTIAL_CONFIG.moonMeanDistanceKm) =>
        getMoonlightModel({ fraction, phase: 0.5 }, { altitudeRad: Math.PI / 2, distanceKm });

    it('ranks full over quarter over crescent, compressed but still ordered', () => {
        const full = atZenith(1);
        const quarter = atZenith(0.5);
        const crescent = atZenith(0.1);

        expect(full.intensityFactor).toBeGreaterThan(quarter.intensityFactor);
        expect(quarter.intensityFactor).toBeGreaterThan(crescent.intensityFactor);
        // Tone mapping keeps a half moon visible where the raw 11:1 ratio would not.
        expect(quarter.intensityFactor).toBeGreaterThan(quarter.physicalIntensityFactor);
        expect(full.intensityFactor).toBeCloseTo(1, 2);
    });

    it('fades to nothing once the moon is below the horizon', () => {
        const belowHorizon = getMoonlightModel({ fraction: 1 }, { altitudeRad: -10 * DEG });
        expect(belowHorizon.intensityFactor).toBe(0);
        expect(belowHorizon.transmission).toBe(0);
    });

    it('fades continuously as the moon sinks, with no step', () => {
        let previous = Infinity;
        for (let altitudeDeg = 80; altitudeDeg >= -5; altitudeDeg -= 5) {
            const model = getMoonlightModel({ fraction: 1 }, { altitudeRad: altitudeDeg * DEG });
            expect(model.intensityFactor).toBeLessThan(previous);
            previous = model.intensityFactor;
        }
        expect(previous).toBe(0);
    });

    it('cools dim phases and warms a low moon', () => {
        const fullZenith = atZenith(1);
        const crescentZenith = atZenith(0.08);
        const fullLow = getMoonlightModel({ fraction: 1 }, { altitudeRad: 4 * DEG });

        expect(crescentZenith.coolShift).toBeGreaterThan(fullZenith.coolShift);
        expect(fullZenith.coolShift).toBeLessThan(0.1);
        expect(fullLow.horizonReddening).toBeGreaterThan(fullZenith.horizonReddening);
    });

    it('peaks earthshine near new moon and suppresses it at full', () => {
        expect(atZenith(0.02).earthshine).toBeGreaterThan(0.9);
        expect(atZenith(1).earthshine).toBeCloseTo(0, 5);
    });

    it('tracks the super/micromoon distance swing in light and apparent size', () => {
        const supermoon = atZenith(1, 356500);
        const micromoon = atZenith(1, 406700);

        expect(supermoon.intensityFactor).toBeGreaterThan(micromoon.intensityFactor);
        expect(supermoon.apparentSizeFactor).toBeGreaterThan(1.03);
        expect(micromoon.apparentSizeFactor).toBeLessThan(0.97);
    });

    it('reports waxing from SunCalc synodic phase', () => {
        expect(getMoonlightModel({ fraction: 0.5, phase: 0.2 }, {}).waxing).toBe(true);
        expect(getMoonlightModel({ fraction: 0.5, phase: 0.8 }, {}).waxing).toBe(false);
    });

    it('tolerates a missing illumination payload', () => {
        const model = getMoonlightModel(null, {});
        expect(Number.isFinite(model.intensityFactor)).toBe(true);
        expect(model.illuminatedFraction).toBe(0.5);
    });
});

describe('Sunlight model', () => {
    it('carries orbital distance into intensity but leaves altitude to the day factor', () => {
        const high = getSunlightModel(new Date('2026-01-03T12:00:00Z'), 70 * DEG);
        const low = getSunlightModel(new Date('2026-01-03T12:00:00Z'), 3 * DEG);

        // Same instant, so the same irradiance regardless of altitude.
        expect(low.intensityFactor).toBeCloseTo(high.intensityFactor, 10);
        // Altitude still shows up in the colour terms.
        expect(low.horizonReddening).toBeGreaterThan(high.horizonReddening);
        expect(low.transmission).toBeLessThan(high.transmission);
    });
});

describe('Scene-space altitude', () => {
    it('recovers altitude from a position on the celestial sphere', () => {
        expect(getAltitudeRadFromPosition({ x: 0, y: 20, z: 0 })).toBeCloseTo(Math.PI / 2, 5);
        expect(getAltitudeRadFromPosition({ x: 20, y: 0, z: 0 })).toBeCloseTo(0, 5);
        expect(getAltitudeRadFromPosition({ x: 0, y: -20, z: 0 })).toBeCloseTo(-Math.PI / 2, 5);
        expect(getAltitudeRadFromPosition({ x: 0, y: 0, z: 0 })).toBe(0);
        expect(getAltitudeRadFromPosition(null)).toBe(0);
    });
});
