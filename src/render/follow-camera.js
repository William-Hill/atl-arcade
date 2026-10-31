import * as THREE from "three";
import { clipCamera, createCameraState, stepCamera } from "../sim/camera.js";
import { ALL_GROUPS, GROUP, collisionGroups } from "../physics/world.js";

// Applies the pure camera state to a Three.js camera and keeps it out of
// walls with a Rapier ray from the look-at point toward the camera.
export function createFollowCamera(camera, { RAPIER, world, skater }) {
  let state = createCameraState(skater);
  const rayGroups = collisionGroups(ALL_GROUPS, GROUP.wall | GROUP.ground | GROUP.ledge);
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  let lastHit = null;

  function wallDistance(cam) {
    origin.set(cam.lookAt[0], cam.lookAt[1], cam.lookAt[2]);
    dir.set(cam.position[0] - cam.lookAt[0], cam.position[1] - cam.lookAt[1], cam.position[2] - cam.lookAt[2]);
    const len = dir.length();
    if (len < 1e-6) return Infinity;
    dir.divideScalar(len);
    const ray = new RAPIER.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: dir.x, y: dir.y, z: dir.z });
    const hit = world.castRay(ray, len, true, undefined, rayGroups);
    if (!hit) return Infinity;
    return hit.timeOfImpact ?? hit.toi;
  }

  return {
    update(current, dt) {
      state = stepCamera(state, current, dt);
      const distance = wallDistance(state);
      lastHit = Number.isFinite(distance) ? distance : null;
      const placed = clipCamera(state, distance);
      camera.position.set(placed.position[0], placed.position[1], placed.position[2]);
      camera.lookAt(placed.lookAt[0], placed.lookAt[1], placed.lookAt[2]);
    },
    reset(current) {
      state = createCameraState(current);
    },
    get state() {
      return state;
    },
    get lastHit() {
      return lastHit;
    },
  };
}
