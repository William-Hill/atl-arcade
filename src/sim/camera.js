// Follow camera math. Pure: plain arrays, no Three.js.
//
// `cameraGoal` gives the ideal camera pose for a skater pose: behind the
// skater along its heading, above it, looking at a point ahead of it.
// `stepCamera` chases that goal with exponential smoothing on the orbit yaw,
// the position, and the look-at point. The renderer casts a ray from the
// `cameraPivot` (off the surface, never inside geometry) toward the camera;
// `resolveClip` snaps the camera in front of a blocker and eases it back out,
// and `placeCamera` puts it on that ray.
//
// The player look offset (`look`: yaw and pitch, from `stepLook`) turns the
// camera about the skater. After `lookHold` s with no look input, the offset
// goes back to zero, and the camera goes back behind the skater.
//
// On vert (a steep transition, or the air above one) the orbit yaw holds, so
// the camera stays on the street side while the skater flips at the top.

import { CAMERA, SKATE } from "./skate/constants.js";
import { heading } from "./skate/controller.js";

export const NO_LOOK = Object.freeze({ yaw: 0, pitch: 0 });

export function createLook() {
  return { yaw: 0, pitch: 0, idle: Infinity };
}

// One frame of the look offset. `delta` is { yaw, pitch } in rad for this
// frame (from mapLook). A zero delta starts the hold, then the return.
export function stepLook(look, delta, dt, k = CAMERA) {
  const dy = delta?.yaw ?? 0;
  const dp = delta?.pitch ?? 0;
  if (dy !== 0 || dp !== 0) {
    const pitch = Math.max(k.minPitch, Math.min(k.maxPitch, look.pitch + dp));
    return { yaw: wrap(look.yaw + dy), pitch, idle: 0 };
  }
  const idle = look.idle + dt;
  if (idle < k.lookHold) return { ...look, idle };
  const f = 1 - smoothFactor(k.lookReturn, dt);
  const yaw = Math.abs(look.yaw * f) < 1e-4 ? 0 : look.yaw * f;
  const pitch = Math.abs(look.pitch * f) < 1e-4 ? 0 : look.pitch * f;
  return { yaw, pitch, idle };
}

// Mouse drag pixels and the right stick to a look delta in rad. Drag or push
// right to look right; drag or push down to raise the camera and look down.
export function mapLook({ dx = 0, dy = 0, stick = [0, 0] } = {}, dt = 0, k = CAMERA) {
  const dead = (v) => {
    if (!Number.isFinite(v) || Math.abs(v) < k.stickDeadzone) return 0;
    return Math.sign(v) * ((Math.abs(v) - k.stickDeadzone) / (1 - k.stickDeadzone));
  };
  const yaw = -dx * k.mouseLookRate - dead(stick[0]) * k.stickLookRate * dt;
  const pitch = dy * k.mouseLookRate + dead(stick[1]) * k.stickLookRate * dt;
  return { yaw: yaw || 0, pitch: pitch || 0 };
}

export function createCameraState(skater, k = CAMERA) {
  const goal = cameraGoal(skater, skater.yaw, k);
  return { yaw: skater.yaw, position: [...goal.position], lookAt: [...goal.lookAt] };
}

function wrap(a) {
  let y = a;
  while (y > Math.PI) y -= 2 * Math.PI;
  while (y < -Math.PI) y += 2 * Math.PI;
  return y;
}

function lerp(a, b, f) {
  return a + (b - a) * f;
}

// Exponential smoothing factor for rate `rate` over `dt`.
// m the camera always keeps in front of a ray hit.
const CLIP_EPSILON = 0.05;

export function smoothFactor(rate, dt) {
  return 1 - Math.exp(-rate * dt);
}

export function isVert(skater, k = CAMERA) {
  return Boolean(skater.groundNormal) && skater.groundNormal[1] < k.vertNormalY;
}

// The point the wall ray starts from: lookHeight off the surface along the
// ground normal. On a ramp wall that is a meter out from the wall, not inside it.
export function cameraPivot(skater, k = CAMERA) {
  const n = skater.groundNormal ?? [0, 1, 0];
  const p = skater.position;
  return [p[0] + n[0] * k.lookHeight, p[1] + n[1] * k.lookHeight, p[2] + n[2] * k.lookHeight];
}

// Ideal pose for a skater, using orbit yaw `yaw` (normally the skater yaw).
// The look-ahead leads only by the horizontal velocity along the orbit
// heading, so it never leads into a ramp wall or backward toward the camera.
// `look` turns the camera about the skater: yaw about the vertical, pitch up
// or down from the rest angle at the same range. The look-ahead stays on the
// orbit heading.
export function cameraGoal(skater, yaw, k = CAMERA, look = NO_LOOK) {
  const h = heading(yaw);
  const pullback = Math.min(Math.abs(skater.speed) * k.speedPullback, k.maxPullback);
  const dist = k.distance + pullback;
  const p = skater.position;
  let position;
  if (look.yaw === 0 && look.pitch === 0) {
    position = [p[0] - h[0] * dist, p[1] + k.height, p[2] - h[2] * dist];
  } else {
    const hv = heading(yaw + look.yaw);
    const range = Math.hypot(dist, k.height);
    const angle = Math.atan2(k.height, dist) + look.pitch;
    const back = range * Math.cos(angle);
    position = [p[0] - hv[0] * back, p[1] + range * Math.sin(angle), p[2] - hv[2] * back];
  }
  const v = skater.velocity ?? [0, 0, 0];
  const forward = Math.max(0, v[0] * h[0] + v[2] * h[2]);
  const ahead = k.lookAhead * Math.min(forward / SKATE.maxSpeed, 1);
  const lookAt = [p[0] + h[0] * ahead, p[1] + k.lookHeight, p[2] + h[2] * ahead];
  return { position, lookAt, distance: dist };
}

export function stepCamera(cam, skater, dt, k = CAMERA, look = NO_LOOK) {
  // Chase the skater yaw by the shortest turn, except on vert, where it holds.
  // The swing is capped at maxYawRate.
  const yawF = isVert(skater, k) ? 0 : smoothFactor(k.yawSmoothing, dt);
  const maxStep = k.maxYawRate * dt;
  const turn = Math.max(-maxStep, Math.min(maxStep, wrap(skater.yaw - cam.yaw) * yawF));
  const yaw = wrap(cam.yaw + turn);
  const goal = cameraGoal(skater, yaw, k, look);
  const pF = smoothFactor(k.positionSmoothing, dt);
  const lF = smoothFactor(k.lookSmoothing, dt);
  return {
    yaw,
    position: [0, 1, 2].map((i) => lerp(cam.position[i], goal.position[i], pF)),
    lookAt: [0, 1, 2].map((i) => lerp(cam.lookAt[i], goal.lookAt[i], lF)),
  };
}

// The allowed camera distance from the pivot this frame. `prevAllowed` is
// last frame's value (Infinity at start), `fullLength` the unclipped pivot
// to camera distance, `hitDistance` the ray hit (Infinity for none). A new
// blocker snaps the camera in at once so it never shows through a wall; a
// cleared blocker lets it ease back out at `clipRelease`.
// The wall always wins over the preferred `minDistance`: the camera never
// goes past the hit point.
export function resolveClip(prevAllowed, fullLength, hitDistance, dt, k = CAMERA) {
  const inFront = Math.max(0, hitDistance - CLIP_EPSILON);
  const target = hitDistance < fullLength ? Math.min(inFront, Math.max(k.minDistance, hitDistance - k.clipMargin)) : fullLength;
  if (!Number.isFinite(prevAllowed) || target <= prevAllowed) return target;
  return prevAllowed + (target - prevAllowed) * smoothFactor(k.clipRelease, dt);
}

// The camera on the ray from `pivot` toward the smoothed position, at most
// `allowed` meters from the pivot.
export function placeCamera(cam, pivot, allowed) {
  const d = [0, 1, 2].map((i) => cam.position[i] - pivot[i]);
  const len = Math.hypot(d[0], d[1], d[2]);
  if (!(allowed < len) || len < 1e-9) return cam;
  const f = allowed / len;
  return { ...cam, position: [0, 1, 2].map((i) => pivot[i] + d[i] * f) };
}
