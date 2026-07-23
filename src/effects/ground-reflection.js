// Real-time planar reflection for wet ground: a mirrored camera renders the
// scene (minus the ground itself) into a low-res render target. The camera
// reflection math is ported from three/addons/objects/Reflector.js — we don't
// import that class directly because it hardcodes a WebGL ShaderMaterial mesh;
// here we only need the mirrored-camera computation, and consume the resulting
// texture from our own WebGL (onBeforeCompile) and WebGPU (TSL) ground materials.
import * as THREE from 'three';

const DEFAULT_SIZE = 384;

export class GroundReflectionController {
    /**
     * @param {THREE.Scene} scene
     * @param {number} [planeY] world-space Y of the reflective ground plane
     * @param {number} [size] render target resolution (square)
     */
    constructor(scene, planeY = 0, size = DEFAULT_SIZE) {
        this.scene = scene;
        this.planeY = planeY;
        this.enabled = false;

        this.renderTarget = new THREE.RenderTarget(size, size, {
            depthBuffer: true,
            generateMipmaps: false
        });

        this.mirrorCamera = new THREE.PerspectiveCamera();
        this.textureMatrix = new THREE.Matrix4();

        this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
        this._normal = new THREE.Vector3(0, 1, 0);
        this._cameraWorldPosition = new THREE.Vector3();
        this._rotationMatrix = new THREE.Matrix4();
        this._view = new THREE.Vector3();
        this._target = new THREE.Vector3();
        this._lookAtPosition = new THREE.Vector3(0, 0, -1);
        this._reflectorWorldPosition = new THREE.Vector3(0, planeY, 0);
    }

    get texture() {
        return this.renderTarget.texture;
    }

    setSize(size) {
        this.renderTarget.setSize(size, size);
    }

    /**
     * Update the mirrored camera to reflect `camera` across the ground plane.
     * @param {THREE.Camera} camera
     */
    _updateMirrorCamera(camera) {
        const normal = this._normal;
        const reflectorWorldPosition = this._reflectorWorldPosition;
        const cameraWorldPosition = this._cameraWorldPosition.setFromMatrixPosition(camera.matrixWorld);
        const rotationMatrix = this._rotationMatrix;
        const view = this._view;
        const target = this._target;
        const lookAtPosition = this._lookAtPosition.set(0, 0, -1);

        view.subVectors(reflectorWorldPosition, cameraWorldPosition);
        view.reflect(normal).negate();
        view.add(reflectorWorldPosition);

        rotationMatrix.extractRotation(camera.matrixWorld);
        lookAtPosition.applyMatrix4(rotationMatrix);
        lookAtPosition.add(cameraWorldPosition);

        target.subVectors(reflectorWorldPosition, lookAtPosition);
        target.reflect(normal).negate();
        target.add(reflectorWorldPosition);

        this.mirrorCamera.position.copy(view);
        this.mirrorCamera.up.set(0, 1, 0).applyMatrix4(rotationMatrix).reflect(normal);
        this.mirrorCamera.lookAt(target);
        this.mirrorCamera.far = camera.far;
        this.mirrorCamera.near = camera.near;
        this.mirrorCamera.fov = camera.fov;
        this.mirrorCamera.aspect = camera.aspect;
        this.mirrorCamera.updateProjectionMatrix();
        this.mirrorCamera.updateMatrixWorld();

        this.textureMatrix.set(0.5, 0.0, 0.0, 0.5, 0.0, 0.5, 0.0, 0.5, 0.0, 0.0, 0.5, 0.5, 0.0, 0.0, 0.0, 1.0);
        this.textureMatrix.multiply(this.mirrorCamera.projectionMatrix);
        this.textureMatrix.multiply(this.mirrorCamera.matrixWorldInverse);
    }

    /**
     * Render the reflection texture for this frame.
     * @param {THREE.WebGLRenderer|import('three/webgpu').WebGPURenderer} renderer
     * @param {THREE.Camera} camera
     * @param {THREE.Object3D[]} hiddenObjects objects to temporarily hide (e.g. the ground mesh, particle systems)
     */
    render(renderer, camera, hiddenObjects = []) {
        this._updateMirrorCamera(camera);

        const previouslyVisible = hiddenObjects.map((obj) => obj.visible);
        hiddenObjects.forEach((obj) => {
            obj.visible = false;
        });

        const currentRenderTarget = renderer.getRenderTarget();
        renderer.setRenderTarget(this.renderTarget);
        renderer.render(this.scene, this.mirrorCamera);
        renderer.setRenderTarget(currentRenderTarget);

        hiddenObjects.forEach((obj, i) => {
            obj.visible = previouslyVisible[i];
        });
    }

    dispose() {
        this.renderTarget.dispose();
    }
}
