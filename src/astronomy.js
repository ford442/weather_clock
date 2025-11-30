import SunCalc from 'suncalc';
import * as THREE from 'three';

export class AstronomyService {
    constructor() {
        this.sunPosition = new THREE.Vector3();
        this.moonPosition = new THREE.Vector3();
        this.moonPhase = 0;
    }

    /**
     * Calculate Sun and Moon positions for a given date and location.
     * @param {Date} date - The date/time to calculate for.
     * @param {number} lat - Latitude.
     * @param {number} lon - Longitude.
     * @param {number} distance - Distance from origin for the returned vectors.
     * @returns {Object} { sunPosition: Vector3, moonPosition: Vector3, moonIllumination: Object }
     */
    update(date, lat, lon, distance = 20) {
        // Default to New York if no location
        const latitude = lat || 40.7128;
        const longitude = lon || -74.0060;

        // Get Sun position
        const sunPos = SunCalc.getPosition(date, latitude, longitude);
        this.sphericalToCartesian(sunPos.azimuth, sunPos.altitude, distance, this.sunPosition);

        // Get Moon position
        const moonPos = SunCalc.getMoonPosition(date, latitude, longitude);
        this.sphericalToCartesian(moonPos.azimuth, moonPos.altitude, distance, this.moonPosition);

        // Get Moon Illumination (Phase)
        const moonIllum = SunCalc.getMoonIllumination(date);

        return {
            sunPosition: this.sunPosition,
            moonPosition: this.moonPosition,
            moonIllumination: moonIllum
        };
    }

    /**
     * Convert SunCalc spherical coordinates to Three.js Cartesian.
     * Mapping assumptions:
     * Y = Up
     * Z+ = North (12 o'clock on sundial)
     * X+ = East
     *
     * SunCalc Azimuth: 0 = South, increases Westward (Clockwise from South if looking down? No, standard azimuth is usually from North, but SunCalc says "radians from South to West").
     * SunCalc Azimuth: 0 = South, PI/2 = West, PI = North, -PI/2 = East.
     *
     * Target:
     * South (Az=0) -> Z-
     * West (Az=PI/2) -> X-
     * North (Az=PI) -> Z+
     * East (Az=-PI/2) -> X+
     */
    sphericalToCartesian(azimuth, altitude, radius, targetVector) {
        // We need to invert the Z axis because Azimuth 0 (South) maps to Z-
        // And check X axis.

        // Z = -radius * cos(azimuth) * cos(altitude)
        // If az=0, cos(0)=1 -> Z = -radius (South). Correct.
        // If az=PI, cos(PI)=-1 -> Z = radius (North). Correct.

        // X = -radius * sin(azimuth) * cos(altitude)
        // If az=PI/2 (West), sin=1 -> X = -radius (West). Correct.
        // If az=-PI/2 (East), sin=-1 -> X = radius (East). Correct.

        const phi = (Math.PI / 2) - altitude; // Polar angle from Y-up (Zenith)
        // Actually, easier to just use the direct mapping derived:

        const x = -radius * Math.sin(azimuth) * Math.cos(altitude);
        const y = radius * Math.sin(altitude);
        const z = -radius * Math.cos(azimuth) * Math.cos(altitude);

        targetVector.set(x, y, z);
    }
}
