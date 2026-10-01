import * as THREE from 'three';

/**
 * In-repo Preetham daylight atmosphere, replacing `three/addons/objects/Sky.js`.
 *
 * Same scattering model and the same uniform names as the addon
 * (`turbidity`, `rayleigh`, `mieCoefficient`, `mieDirectionalG`, `sunPosition`,
 * `up`), so `weatherLighting.js` keeps writing `sky.material.uniforms[name].value`
 * on either backend. Two deliberate differences from the addon make it safe
 * to share a logarithmic depth buffer and the bloom pass:
 *
 * - **No depth tricks.** The addon forces `gl_Position.z = gl_Position.w`; with
 *   log depth on, every other material writes `gl_FragDepth` while the sky
 *   does not, and the two disagree about where "far" is. This material neither
 *   tests nor writes depth and is drawn first via `renderOrder`, so it never
 *   touches the depth buffer at all — the scene composites over it.
 * - **Bounded radiance.** The solar disc term (`vSunE * 19000`) produces
 *   pre-tonemap values in the hundreds, which is what over-bloomed. Output is
 *   capped at `SKY_MATERIAL_CONFIG.maxRadiance`, enough to still cross the
 *   bloom threshold for a soft halo without flooding the frame.
 */
export const SKY_MATERIAL_CONFIG = Object.freeze({
    turbidity: 10,
    rayleigh: 3,
    mieCoefficient: 0.005,
    mieDirectionalG: 0.7,
    /** Pre-tonemap ceiling for any sky fragment (sun disc included). */
    maxRadiance: 4.0
});

/** Shared GLSL constants and scattering helpers (vertex stage). */
const skyVertexShader = /* glsl */ `
uniform vec3 sunPosition;
uniform float rayleigh;
uniform float turbidity;
uniform float mieCoefficient;
uniform vec3 up;

varying vec3 vWorldPosition;
varying vec3 vSunDirection;
varying float vSunfade;
varying vec3 vBetaR;
varying vec3 vBetaM;
varying float vSunE;

const float e = 2.718281828459045;
const vec3 totalRayleigh = vec3(5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5);
const vec3 MieConst = vec3(1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14);
const float cutoffAngle = 1.6110731556870734;
const float steepness = 1.5;
const float EE = 1000.0;

float sunIntensity(float zenithAngleCos) {
    zenithAngleCos = clamp(zenithAngleCos, -1.0, 1.0);
    return EE * max(0.0, 1.0 - pow(e, -((cutoffAngle - acos(zenithAngleCos)) / steepness)));
}

vec3 totalMie(float T) {
    float c = (0.2 * T) * 10E-18;
    return 0.434 * c * MieConst;
}

void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;

    vSunDirection = normalize(sunPosition);
    vSunE = sunIntensity(dot(vSunDirection, up));
    vSunfade = 1.0 - clamp(1.0 - exp(sunPosition.y / 450000.0), 0.0, 1.0);
    float rayleighCoefficient = rayleigh - (1.0 - vSunfade);
    vBetaR = totalRayleigh * rayleighCoefficient;
    vBetaM = totalMie(turbidity) * mieCoefficient;
}`;

const skyFragmentShader = /* glsl */ `
varying vec3 vWorldPosition;
varying vec3 vSunDirection;
varying float vSunfade;
varying vec3 vBetaR;
varying vec3 vBetaM;
varying float vSunE;

uniform float mieDirectionalG;
uniform float maxRadiance;
uniform vec3 up;

const float pi = 3.141592653589793;
const float rayleighZenithLength = 8.4E3;
const float mieZenithLength = 1.25E3;
const float sunAngularDiameterCos = 0.9999566769464484;
const float THREE_OVER_SIXTEENPI = 0.05968310365946075;
const float ONE_OVER_FOURPI = 0.07957747154594767;

float rayleighPhase(float cosTheta) {
    return THREE_OVER_SIXTEENPI * (1.0 + pow(cosTheta, 2.0));
}

float hgPhase(float cosTheta, float g) {
    float g2 = pow(g, 2.0);
    float inverse = 1.0 / pow(1.0 - 2.0 * g * cosTheta + g2, 1.5);
    return ONE_OVER_FOURPI * ((1.0 - g2) * inverse);
}

void main() {
    vec3 direction = normalize(vWorldPosition - cameraPosition);

    float zenithAngle = acos(max(0.0, dot(up, direction)));
    float inverse = 1.0 / (cos(zenithAngle) + 0.15 * pow(93.885 - ((zenithAngle * 180.0) / pi), -1.253));
    float sR = rayleighZenithLength * inverse;
    float sM = mieZenithLength * inverse;

    vec3 Fex = exp(-(vBetaR * sR + vBetaM * sM));

    float cosTheta = dot(direction, vSunDirection);
    vec3 betaRTheta = vBetaR * rayleighPhase(cosTheta * 0.5 + 0.5);
    vec3 betaMTheta = vBetaM * hgPhase(cosTheta, mieDirectionalG);

    vec3 scatter = vSunE * ((betaRTheta + betaMTheta) / (vBetaR + vBetaM));
    vec3 Lin = pow(scatter * (1.0 - Fex), vec3(1.5));
    Lin *= mix(vec3(1.0), pow(scatter * Fex, vec3(0.5)), clamp(pow(1.0 - dot(up, vSunDirection), 5.0), 0.0, 1.0));

    vec3 L0 = vec3(0.1) * Fex;
    float sundisk = smoothstep(sunAngularDiameterCos, sunAngularDiameterCos + 0.00002, cosTheta);
    L0 += (vSunE * 19000.0 * Fex) * sundisk;

    vec3 texColor = (Lin + L0) * 0.04 + vec3(0.0, 0.0003, 0.00075);
    vec3 retColor = pow(texColor, vec3(1.0 / (1.2 + (1.2 * vSunfade))));

    gl_FragColor = vec4(min(retColor, vec3(maxRadiance)), 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}`;

/**
 * Shared render-state for both backends: inside-out box, drawn first, never
 * touching depth or fog.
 * @param {THREE.Material} material
 */
function applySkyRenderState(material) {
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.depthTest = false;
    material.fog = false;
    material.name = 'AetherSkyMaterial';
}

/**
 * WebGL sky material (GLSL).
 * @returns {THREE.ShaderMaterial}
 */
export function createSkyMaterial() {
    const material = new THREE.ShaderMaterial({
        uniforms: {
            turbidity: { value: SKY_MATERIAL_CONFIG.turbidity },
            rayleigh: { value: SKY_MATERIAL_CONFIG.rayleigh },
            mieCoefficient: { value: SKY_MATERIAL_CONFIG.mieCoefficient },
            mieDirectionalG: { value: SKY_MATERIAL_CONFIG.mieDirectionalG },
            maxRadiance: { value: SKY_MATERIAL_CONFIG.maxRadiance },
            sunPosition: { value: new THREE.Vector3(0, 1, 0) },
            up: { value: new THREE.Vector3(0, 1, 0) }
        },
        vertexShader: skyVertexShader,
        fragmentShader: skyFragmentShader
    });
    applySkyRenderState(material);
    return material;
}

/**
 * WebGPU sky material (TSL port of the same shader).
 *
 * The TSL uniform nodes are exposed on `material.uniforms` under the GLSL
 * names; each node has a `.value`, so `weatherLighting.js` drives both
 * backends through one code path.
 *
 * @returns {Promise<THREE.Material & {uniforms: Record<string, {value: any}>}>}
 */
export async function createSkyMaterialWebGPU() {
    const { NodeMaterial } = await import('three/webgpu');
    const tsl = await import('three/tsl');
    const {
        Fn,
        float,
        vec3,
        vec4,
        acos,
        add,
        clamp,
        cos,
        dot,
        exp,
        max,
        min,
        mix,
        normalize,
        positionWorld,
        pow,
        smoothstep,
        sub,
        uniform,
        varyingProperty,
        cameraPosition
    } = tsl;

    const turbidity = uniform(SKY_MATERIAL_CONFIG.turbidity);
    const rayleigh = uniform(SKY_MATERIAL_CONFIG.rayleigh);
    const mieCoefficient = uniform(SKY_MATERIAL_CONFIG.mieCoefficient);
    const mieDirectionalG = uniform(SKY_MATERIAL_CONFIG.mieDirectionalG);
    const maxRadiance = uniform(SKY_MATERIAL_CONFIG.maxRadiance);
    const sunPosition = uniform(new THREE.Vector3(0, 1, 0));
    const up = uniform(new THREE.Vector3(0, 1, 0));

    const vSunDirection = varyingProperty('vec3');
    const vSunE = varyingProperty('float');
    const vSunfade = varyingProperty('float');
    const vBetaR = varyingProperty('vec3');
    const vBetaM = varyingProperty('vec3');

    // Per-vertex terms. Clip position is the plain model-view-projection
    // (no z = w depth trick, unlike the addon's SkyMesh).
    const vertexTerms = Fn(() => {
        const e = float(2.718281828459045);
        const totalRayleigh = vec3(5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5);
        const MieConst = vec3(1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14);
        const cutoffAngle = float(1.6110731556870734);
        const steepness = float(1.5);
        const EE = float(1000.0);

        const sunDirection = normalize(sunPosition);
        vSunDirection.assign(sunDirection);
        const zenithAngleCos = clamp(dot(sunDirection, up), -1, 1);
        vSunE.assign(
            EE.mul(max(0.0, float(1.0).sub(pow(e, cutoffAngle.sub(acos(zenithAngleCos)).div(steepness).negate()))))
        );
        const sunfade = float(1.0).sub(clamp(float(1.0).sub(exp(sunPosition.y.div(450000.0))), 0, 1));
        vSunfade.assign(sunfade);
        vBetaR.assign(totalRayleigh.mul(rayleigh.sub(float(1.0).sub(sunfade))));
        vBetaM.assign(float(0.434).mul(float(0.2).mul(turbidity).mul(10e-18)).mul(MieConst).mul(mieCoefficient));
        return tsl.modelViewProjection;
    })();

    const colorNode = Fn(() => {
        const pi = float(3.141592653589793);
        const sunAngularDiameterCos = float(0.9999566769464484);
        const THREE_OVER_SIXTEENPI = float(0.05968310365946075);
        const ONE_OVER_FOURPI = float(0.07957747154594767);

        const direction = normalize(positionWorld.sub(cameraPosition));
        const zenithAngle = acos(max(0.0, dot(up, direction)));
        const inverse = float(1.0).div(
            cos(zenithAngle).add(float(0.15).mul(pow(float(93.885).sub(zenithAngle.mul(180.0).div(pi)), -1.253)))
        );
        const sR = float(8.4e3).mul(inverse);
        const sM = float(1.25e3).mul(inverse);
        const Fex = exp(vBetaR.mul(sR).add(vBetaM.mul(sM)).negate());

        const cosTheta = dot(direction, vSunDirection);
        const c = cosTheta.mul(0.5).add(0.5);
        const betaRTheta = vBetaR.mul(THREE_OVER_SIXTEENPI.mul(float(1.0).add(pow(c, 2.0))));
        const g2 = pow(mieDirectionalG, 2.0);
        const inv = float(1.0).div(pow(float(1.0).sub(float(2.0).mul(mieDirectionalG).mul(cosTheta)).add(g2), 1.5));
        const betaMTheta = vBetaM.mul(ONE_OVER_FOURPI.mul(float(1.0).sub(g2)).mul(inv));

        const scatter = vSunE.mul(add(betaRTheta, betaMTheta).div(add(vBetaR, vBetaM)));
        const Lin = pow(scatter.mul(sub(1.0, Fex)), vec3(1.5)).toVar();
        Lin.mulAssign(
            mix(
                vec3(1.0),
                pow(scatter.mul(Fex), vec3(0.5)),
                clamp(pow(sub(1.0, dot(up, vSunDirection)), 5.0), 0.0, 1.0)
            )
        );

        const L0 = vec3(0.1).mul(Fex).toVar();
        const sundisk = smoothstep(sunAngularDiameterCos, sunAngularDiameterCos.add(0.00002), cosTheta);
        L0.addAssign(vSunE.mul(19000.0).mul(Fex).mul(sundisk));

        const texColor = add(Lin, L0)
            .mul(0.04)
            .add(vec3(0.0, 0.0003, 0.00075));
        const retColor = pow(texColor, vec3(float(1.0).div(float(1.2).add(vSunfade.mul(1.2)))));
        return vec4(min(retColor, vec3(maxRadiance)), 1.0);
    })();

    const material = /** @type {any} */ (new NodeMaterial());
    material.vertexNode = vertexTerms;
    material.colorNode = colorNode;
    material.uniforms = { turbidity, rayleigh, mieCoefficient, mieDirectionalG, maxRadiance, sunPosition, up };
    applySkyRenderState(material);
    return material;
}
