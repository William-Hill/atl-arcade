import * as THREE from "three";
import { NO_LOOK, cameraPivot, createCameraState, createLook, placeCamera, resolveClip, stepCamera, stepLook } from "../sim/camera.js";
import { ALL_GROUPS, GROUP, collisionGroups } from "../physics/world.js";

// Applies the pure camera state to a Three.js camera and keeps it out of
// walls with a Rapier ray from the skater pivot toward the camera.
export function createFollowCamera(camera, { RAPIER, world, skater }) {
  let state = createCameraState(skater);
  const rayGroups = collisionGroups(ALL_GROUPS, GROUP.wall | GROUP.ground | GROUP.ledge);
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  let look = createLook();
  let lastHit = null;
  let allowed = Infinity;

  function wallDistance(cam, pivot) {
    origin.set(pivot[0], pivot[1], pivot[2]);
    dir.set(cam.position[0] - pivot[0], cam.position[1] - pivot[1], cam.position[2] - pivot[2]);
    const len = dir.length();
    if (len < 1e-6) return Infinity;
    dir.divideScalar(len);
    const ray = new RAPIER.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: dir.x, y: dir.y, z: dir.z });
    const hit = world.castRay(ray, len, true, undefined, rayGroups);
    if (!hit) return Infinity;
    return hit.timeOfImpact ?? hit.toi;
  }

  return {
    // `lookDelta` is { yaw, pitch } in rad for this frame (mapLook), or null.
    update(current, dt, lookDelta = null) {
      look = stepLook(look, lookDelta ?? NO_LOOK, dt);
      state = stepCamera(state, current, dt, undefined, look);
      const pivot = cameraPivot(current);
      const distance = wallDistance(state, pivot);
      lastHit = Number.isFinite(distance) ? distance : null;
      const full = Math.hypot(state.position[0] - pivot[0], state.position[1] - pivot[1], state.position[2] - pivot[2]);
      allowed = resolveClip(allowed, full, distance, dt);
      const placed = placeCamera(state, pivot, allowed);
      camera.position.set(placed.position[0], placed.position[1], placed.position[2]);
      camera.lookAt(placed.lookAt[0], placed.lookAt[1], placed.lookAt[2]);
    },
    reset(current) {
      state = createCameraState(current);
      look = createLook();
      allowed = Infinity;
    },
    get state() {
      return state;
    },
    get look() {
      return look;
    },
    get lastHit() {
      return lastHit;
    },
  };
}
