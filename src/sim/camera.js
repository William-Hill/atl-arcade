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
// On vert (a steep transition, or the air above one) the orbit yaw holds, so
// the camera stays on the street side while the skater flips at the top.

import { CAMERA, SKATE } from "./skate/constants.js";
import { heading } from "./skate/controller.js";

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
export function cameraGoal(skater, yaw, k = CAMERA) {
  const h = heading(yaw);
  const pullback = Math.min(Math.abs(skater.speed) * k.speedPullback, k.maxPullback);
  const dist = k.distance + pullback;
  const p = skater.position;
  const position = [p[0] - h[0] * dist, p[1] + k.height, p[2] - h[2] * dist];
  const v = skater.velocity ?? [0, 0, 0];
  const forward = Math.max(0, v[0] * h[0] + v[2] * h[2]);
  const ahead = k.lookAhead * Math.min(forward / SKATE.maxSpeed, 1);
  const lookAt = [p[0] + h[0] * ahead, p[1] + k.lookHeight, p[2] + h[2] * ahead];
  return { position, lookAt, distance: dist };
}

export function stepCamera(cam, skater, dt, k = CAMERA) {
  // Chase the skater yaw by the shortest turn, except on vert, where it holds.
  // The swing is capped at maxYawRate.
  const yawF = isVert(skater, k) ? 0 : smoothFactor(k.yawSmoothing, dt);
  const maxStep = k.maxYawRate * dt;
  const turn = Math.max(-maxStep, Math.min(maxStep, wrap(skater.yaw - cam.yaw) * yawF));
  const yaw = wrap(cam.yaw + turn);
  const goal = cameraGoal(skater, yaw, k);
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
