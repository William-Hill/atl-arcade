import * as THREE from "three";
import { NO_LOOK, cameraGoal, cameraPivot, canopyVolumes, chooseSwing, createCanopyIndex, createCameraState, createLook, isVert, orbitAbout, placeCamera, resolveClip, stepCamera, stepLook, stepSwing } from "../sim/camera.js";
import { CAMERA } from "../sim/skate/constants.js";
import { ALL_GROUPS, GROUP, collisionGroups } from "../physics/world.js";
import { fenceRayDistance } from "../level/edge-fence.js";
import { createShake, feelTriggers, fovTarget, motionPolicy, shakeAngles, shakePunch, startShake, stepFov, stepShake } from "./effects/feel.js";

// Applies the pure camera state to a Three.js camera and keeps it out of
// walls with a Rapier ray from the skater pivot toward the camera. The
// trees have no colliders, so the same ray also tests the canopy volumes of
// the tree props (src/sim/camera.js, #230); `canopy: false` turns that off.
// The edge fence has no collider either, so the ray also stops at the inner
// face of `fence` (src/level/edge-fence.js, playtest 2026-11-08).
//
// A wall or the fence close to the skater would pull the camera in to her
// back, so the camera swings around her to a clear side first (`swing`, an
// orbit offset like the look yaw; src/sim/camera.js, playtest 2026-11-09).
//
// Game feel (#105, src/render/effects/feel.js): a short shake on a bonk and
// a wider field of view at high speed. `motion()` gives the reduced-motion
// and ?fx=0 state ({ reducedMotion, off }); with either, both stay off. The
// shake is a small rotation after the placement and a short push toward the
// skater along the clear ray, so it cannot move the camera into a wall. The base field of view is camera.userData.baseFov
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
  let swing = 0;
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

  // The blockers on the ray from the pivot to a camera point: the walls
  // (Rapier), the edge fence and the tree canopies.
  function blockers(pivot, position) {
    const wall = Math.min(wallDistance({ position }, pivot), fenceRayDistance(fence, pivot, position));
    const leaves = canopyOn && canopy.count ? canopy.distance(pivot, position) : Infinity;
    return { wall, leaves, distance: Math.min(wall, leaves) };
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
      const orbit = (offset) => (offset === 0 ? look : { yaw: look.yaw + offset, pitch: look.pitch });
      state = stepCamera(state, current, dt, undefined, orbit(swing));
      const pivot = cameraPivot(current);
      let hits = blockers(pivot, state.position);
      let full = Math.hypot(state.position[0] - pivot[0], state.position[1] - pivot[1], state.position[2] - pivot[2]);
      // Swing around the skater when a blocker is close (not on vert, where
      // the orbit yaw holds). The probes test the camera goal at each offset.
      if (!isVert(current) && (swing !== 0 || hits.distance < CAMERA.swingBelow * full)) {
        const goalAt = (offset) => cameraGoal(current, state.yaw, CAMERA, orbit(offset)).position;
        const g = goalAt(0);
        const range = Math.hypot(g[0] - pivot[0], g[1] - pivot[1], g[2] - pivot[2]);
        const target = chooseSwing((offset) => blockers(pivot, goalAt(offset)).distance, range, swing);
        const next = stepSwing(swing, target, dt);
        if (next !== swing) {
          state = { ...state, position: orbitAbout(state.position, current.position, next - swing) };
          swing = next;
          hits = blockers(pivot, state.position);
          full = Math.hypot(state.position[0] - pivot[0], state.position[1] - pivot[1], state.position[2] - pivot[2]);
        }
      }
      lastHit = Number.isFinite(hits.wall) ? hits.wall : null;
      lastCanopyHit = Number.isFinite(hits.leaves) ? hits.leaves : null;
      allowed = resolveClip(allowed, full, hits.distance, dt);
      const placed = placeCamera(state, pivot, allowed);
      // The bonk punch: toward the pivot on the clear ray, never past 1 m from it.
      const punch = motionPolicy(motion()).shake ? Math.min(shakePunch(shake), Math.max(0, Math.min(allowed, full) - 1)) : 0;
      const pos = placed.position;
      if (punch > 0) {
        const d = Math.hypot(pos[0] - pivot[0], pos[1] - pivot[1], pos[2] - pivot[2]);
        const f = d > 1e-6 ? (d - punch) / d : 1;
        camera.position.set(pivot[0] + (pos[0] - pivot[0]) * f, pivot[1] + (pos[1] - pivot[1]) * f, pivot[2] + (pos[2] - pivot[2]) * f);
      } else camera.position.set(pos[0], pos[1], pos[2]);
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
      swing = 0;
      shake = createShake();
      fovBoost = 0;
    },
    get state() {
      return state;
    },
    get look() {
      return look;
    },
    // The orbit offset (rad) of the swing around a close blocker.
    get swing() {
      return swing;
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
