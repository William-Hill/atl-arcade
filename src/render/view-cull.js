import * as THREE from "three";

// The camera view test for the view syncs (#189): a person or an NPC
// skater out of the view skips its animation update. The margin keeps the
// update on for one just outside the screen edge, whose shadow can still
// fall in the view.

export const VIEW_MARGIN = 2.5; // m added to the radius of each test

// update(camera) once per frame, after the camera moves; sees(x, y, z, r)
// is true when the sphere touches the view. Before the first update, it
// sees everything.
export function createViewCull({ margin = VIEW_MARGIN } = {}) {
  const frustum = new THREE.Frustum();
  const m = new THREE.Matrix4();
  const sphere = new THREE.Sphere();
  let ready = false;
  return {
    update(camera) {
      camera.updateMatrixWorld();
      m.multiplyMatrices(camera.projectionMatrix, m.copy(camera.matrixWorld).invert());
      frustum.setFromProjectionMatrix(m);
      ready = true;
    },
    sees(x, y, z, r = 1) {
      if (!ready) return true;
      sphere.center.set(x, y, z);
      sphere.radius = r + margin;
      return frustum.intersectsSphere(sphere);
    },
  };
}
