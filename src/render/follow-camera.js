import * as THREE from "three";
import { NO_LOOK, cameraPivot, canopyVolumes, createCanopyIndex, createCameraState, createLook, placeCamera, resolveClip, stepCamera, stepLook } from "../sim/camera.js";
import { ALL_GROUPS, GROUP, collisionGroups } from "../physics/world.js";
import { fenceRayDistance } from "../level/edge-fence.js";
import { createShake, feelTriggers, fovTarget, motionPolicy, shakeAngles, startShake, stepFov, stepShake } from "./effects/feel.js";

// Applies the pure camera state to a Three.js camera and keeps it out of
// walls with a Rapier ray from the skater pivot toward the camera. The
// trees have no colliders, so the same ray also tests the canopy volumes of
// the tree props (src/sim/camera.js, #230); `canopy: false` turns that off.
// The edge fence has no collider either, so the ray also stops at the inner
// face of `fence` (src/level/edge-fence.js, playtest 2026-11-08).
//
// Game feel (#105, src/render/effects/feel.js): a short shake on a bonk and
// a wider field of view at high speed. `motion()` gives the reduced-motion
// and ?fx=0 state ({ reducedMotion, off }); with either, both stay off. The
// shake is a small rotation after the placement, so it cannot move the
// camera into a wall. The base field of view is camera.userData.baseFov
// (renderer.js sets it for the screen shape).
export function createFollowCamera(camera, { RAPIER, world, skater, props = [], canopy: canopyOn = true, fence = null, motion = () => ({}) }) {
  let state = createCameraState(skater);
  const canopy = createCanopyIndex(canopyVolumes(props));
  const rayGroups = collisionGroups(ALL_GROUPS, GROUP.wall | GROUP.ground | GROUP.ledge);
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  let look = createLook();
  let lastHit = null;
  let lastCanopyHit = null;
  let allowed = Infinity;
  let shake = createShake();
  let fovBoost = 0;
  let forcedBoost = null;
  let shakeAt = null;
  if (camera.isPerspectiveCamera && camera.userData.baseFov === undefined) camera.userData.baseFov = camera.fov;

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

  function applyFeel(current, dt) {
    const policy = motionPolicy(motion());
    if (!policy.shake) shake = createShake();
    else shake = shakeAt === null ? stepShake(shake, dt) : { ...shake, t: shakeAt };
    const a = shakeAngles(shake);
    if (a.pitch || a.yaw || a.roll) {
      camera.rotateX(a.pitch);
      camera.rotateY(a.yaw);
      camera.rotateZ(a.roll);
    }
    if (camera.isPerspectiveCamera) {
      const target = forcedBoost ?? (policy.fov ? fovTarget(current.speed ?? 0) : 0);
      fovBoost = forcedBoost ?? stepFov(fovBoost, target, dt);
      const fov = camera.userData.baseFov + fovBoost;
      if (Math.abs(fov - camera.fov) > 1e-4) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
    }
  }

  return {
    // `lookDelta` is { yaw, pitch } in rad for this frame (mapLook), or null.
    update(current, dt, lookDelta = null) {
      look = stepLook(look, lookDelta ?? NO_LOOK, dt);
      state = stepCamera(state, current, dt, undefined, look);
      const pivot = cameraPivot(current);
      const wall = Math.min(wallDistance(state, pivot), fenceRayDistance(fence, pivot, state.position));
      const leaves = canopyOn && canopy.count ? canopy.distance(pivot, state.position) : Infinity;
      const distance = Math.min(wall, leaves);
      lastHit = Number.isFinite(wall) ? wall : null;
      lastCanopyHit = Number.isFinite(leaves) ? leaves : null;
      const full = Math.hypot(state.position[0] - pivot[0], state.position[1] - pivot[1], state.position[2] - pivot[2]);
      allowed = resolveClip(allowed, full, distance, dt);
      const placed = placeCamera(state, pivot, allowed);
      camera.position.set(placed.position[0], placed.position[1], placed.position[2]);
      camera.lookAt(placed.lookAt[0], placed.lookAt[1], placed.lookAt[2]);
      applyFeel(current, dt);
    },
    // A simulation tick: the skater before and after. A bonk starts a shake.
    observe(prev, next) {
      if (!motionPolicy(motion()).shake) return;
      const { bonk } = feelTriggers(prev, next);
      if (bonk > 0) shake = startShake(shake, bonk);
    },
    // The screenshot hooks: a shake of strength 0..1 now (`hold`: keep it
    // at that age in s), and a held field-of-view boost in degrees (null to
    // let go).
    bump(strength = 1, hold = null) {
      shakeAt = hold === null ? null : Number(hold);
      if (motionPolicy(motion()).shake) shake = startShake(createShake(), strength);
    },
    holdFov(boost) {
      forcedBoost = boost == null ? null : Number(boost);
    },
    get feel() {
      return { fovBoost, fov: camera.fov, shake: { ...shake, ...shakeAngles(shake) } };
    },
    reset(current) {
      state = createCameraState(current);
      look = createLook();
      allowed = Infinity;
      shake = createShake();
      fovBoost = 0;
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
    get lastCanopyHit() {
      return lastCanopyHit;
    },
    // The canopy volumes, for the Playwright tests.
    canopy,
  };
}
