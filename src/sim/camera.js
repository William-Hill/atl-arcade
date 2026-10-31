// Follow camera math. Pure: plain arrays, no Three.js.
//
// `cameraGoal` gives the ideal camera pose for a skater pose: behind the
// skater along its heading, above it, looking at a point ahead of it.
// `stepCamera` chases that goal with exponential smoothing on the orbit yaw,
// the position, and the look-at point. The renderer then shortens the camera
// along the ray from the look-at point when a wall is in the way.

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
export function smoothFactor(rate, dt) {
  return 1 - Math.exp(-rate * dt);
}

// Ideal pose for a skater, using orbit yaw `yaw` (normally the skater yaw).
export function cameraGoal(skater, yaw, k = CAMERA) {
  const h = heading(yaw);
  const speedFactor = Math.min(Math.abs(skater.speed) / SKATE.maxSpeed, 1);
  const pullback = Math.min(Math.abs(skater.speed) * k.speedPullback, k.maxPullback);
  const dist = k.distance + pullback;
  const p = skater.position;
  const position = [p[0] - h[0] * dist, p[1] + k.height, p[2] - h[2] * dist];
  const ahead = k.lookAhead * speedFactor;
  const lookAt = [p[0] + h[0] * ahead, p[1] + k.lookHeight, p[2] + h[2] * ahead];
  return { position, lookAt, distance: dist };
}

export function stepCamera(cam, skater, dt, k = CAMERA) {
  // Chase the skater yaw by the shortest turn.
  const yawF = smoothFactor(k.yawSmoothing, dt);
  const yaw = wrap(cam.yaw + wrap(skater.yaw - cam.yaw) * yawF);
  const goal = cameraGoal(skater, yaw, k);
  const pF = smoothFactor(k.positionSmoothing, dt);
  const lF = smoothFactor(k.lookSmoothing, dt);
  return {
    yaw,
    position: [0, 1, 2].map((i) => lerp(cam.position[i], goal.position[i], pF)),
    lookAt: [0, 1, 2].map((i) => lerp(cam.lookAt[i], goal.lookAt[i], lF)),
  };
}

// Shorten the camera toward the look-at point when a blocker sits at
// `hitDistance` along the ray from lookAt to position. Pure helper for the
// renderer's raycast result.
export function clipCamera(cam, hitDistance, k = CAMERA) {
  const d = [0, 1, 2].map((i) => cam.position[i] - cam.lookAt[i]);
  const len = Math.hypot(d[0], d[1], d[2]);
  if (!(hitDistance < len)) return cam;
  const allowed = Math.max(k.minDistance, hitDistance - k.clipMargin);
  const f = allowed / len;
  return { ...cam, position: [0, 1, 2].map((i) => cam.lookAt[i] + d[i] * f) };
}
