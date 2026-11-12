import * as THREE from "three";
import { NO_LOOK, cameraPivot, createCameraState, createLook, placeCamera, resolveClip, stepCamera, stepLook } from "../sim/camera.js";
import { cameraFxOffsets, createCameraFx, stepCameraFx } from "../sim/camera-fx.js";
import { ALL_GROUPS, GROUP, collisionGroups } from "../physics/world.js";

// Applies the pure camera state to a Three.js camera and keeps it out of
// walls with a Rapier ray from the skater pivot toward the camera.
//
// The camera effects (#253, src/sim/camera-fx.js) go on top of the placed
// pose: the FOV offset on the base FOV (`camera.userData.baseFov`, from
// fitToWindow), a shake and a dip in the camera's own right and up axes, and
// a roll. They go on after the wall clip. While the clip holds the camera
// in front of a wall, the dip and the shake stop: they move the camera off
// the clip ray, where the clip margin does not protect it.
export function createFollowCamera(camera, { RAPIER, world, skater }) {
  let state = createCameraState(skater);
  let fx = createCameraFx();
  let offsets = cameraFxOffsets(fx);
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
    // `events` are the sim events since the last frame. `fxOpts.reduced`
    // keeps only a smaller speed FOV (prefers-reduced-motion, ?camfx=0).
    update(current, dt, lookDelta = null, events = [], fxOpts = {}) {
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

      fx = stepCameraFx(fx, current, events, dt, fxOpts);
      offsets = cameraFxOffsets(fx);
      const clipped = allowed < full - 1e-3;
      if (!clipped && offsets.right !== 0) camera.translateX(offsets.right);
      if (!clipped && offsets.up !== 0) camera.translateY(offsets.up);
      if (offsets.roll !== 0) camera.rotateZ(offsets.roll);
      const base = camera.userData.baseFov ?? camera.fov;
      const fov = base + offsets.fov;
      if (camera.fov !== fov) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
    },
    reset(current) {
      state = createCameraState(current);
      fx = createCameraFx();
      offsets = cameraFxOffsets(fx);
      look = createLook();
      allowed = Infinity;
    },
    get state() {
      return state;
    },
    get look() {
      return look;
    },
    // The effect offsets of the last frame: { fov, right, up, roll, flash }.
    get fx() {
      return offsets;
    },
    get lastHit() {
      return lastHit;
    },
  };
}
