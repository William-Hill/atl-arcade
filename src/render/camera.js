import * as THREE from "three";

export function createPerspectiveCamera() {
  return new THREE.PerspectiveCamera(60, 1, 0.1, 500);
}

// The camera pose the screenshot test uses. Fixed, so the reference image only
// changes when the level changes.
export function applyFixedCamera(camera, fixedCamera) {
  camera.position.set(fixedCamera.position.x, fixedCamera.position.y, fixedCamera.position.z);
  camera.lookAt(fixedCamera.target.x, fixedCamera.target.y, fixedCamera.target.z);
  camera.updateMatrixWorld(true);
  return camera;
}
