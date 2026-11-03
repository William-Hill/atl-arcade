// Photo mode (#90): pure state. No Three.js and no DOM.
//
// While photo mode is open the simulation stops, a free camera moves, and
// on the high tier a tilt-shift blur shows (src/render/tilt-shift.js).
// The panel (src/ui/photo-panel.js) reads and changes this state.

import { BAND_LIMITS, TILT_SHIFT, clampBand, clampStrength } from "../render/tilt-shift.js";

// Free camera: speed in m/s, the fast multiplier (Shift), the pitch limit
// in rad, the largest distance from the anchor (the camera position when
// photo mode opens) in m, and the lowest height over the floor in m.
export const FREE_CAM = { speed: 10, fast: 3, pitchLimit: 1.45, maxDistance: 150, minHeight: 0.4 };

// The key that opens and closes photo mode. Escape also closes it.
export const PHOTO_KEY = "KeyP";

// Steps for the keys that change the band and the strength.
export const BAND_STEP = 0.02;
export const STRENGTH_STEP = 0.05;

export function createPhotoState({ center = TILT_SHIFT.center, strength = TILT_SHIFT.strength } = {}) {
  return { open: false, center: clampBand(center), strength: clampStrength(strength), camera: null, anchor: null, saved: 0 };
}

// Pure: the yaw and pitch of a look direction [x, y, z] (yaw 0 looks to -z).
export function lookAngles(dir) {
  const [x, y, z] = dir;
  const len = Math.hypot(x, y, z) || 1;
  return { yaw: Math.atan2(-x, -z), pitch: Math.asin(Math.min(Math.max(y / len, -1), 1)) };
}

// Pure: the unit look direction for a yaw and a pitch.
export function lookDirection(yaw, pitch) {
  const c = Math.cos(pitch);
  return [-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c];
}

// Opens photo mode with the free camera at `position`, looking along `dir`.
export function openPhoto(state, position, dir) {
  if (state.open) return state;
  const { yaw, pitch } = lookAngles(dir);
  return { ...state, open: true, camera: { position: [...position], yaw, pitch }, anchor: [...position] };
}

export function closePhoto(state) {
  if (!state.open) return state;
  return { ...state, open: false, camera: null, anchor: null };
}

export function setBand(state, center) {
  return { ...state, center: clampBand(center) };
}

export function setStrength(state, strength) {
  return { ...state, strength: clampStrength(strength) };
}

export function nudgeBand(state, steps) {
  return setBand(state, state.center + steps * BAND_STEP);
}

export function nudgeStrength(state, steps) {
  return setStrength(state, state.strength + steps * STRENGTH_STEP);
}

// Pure: one free camera step.
// move: { forward, right, up } in -1..1, fast: boolean,
// look: { yaw, pitch } in rad for this step (mapLook in src/sim/camera.js),
// floor(x, z): the ground height under a point, or null.
export function stepFreeCam(state, { forward = 0, right = 0, up = 0, fast = false, look = null } = {}, dt = 0, floor = null, k = FREE_CAM) {
  if (!state.open || !state.camera) return state;
  const cam = state.camera;
  const yaw = cam.yaw + (look?.yaw || 0);
  const pitch = Math.min(Math.max(cam.pitch + (look?.pitch || 0), -k.pitchLimit), k.pitchLimit);
  const v = k.speed * (fast ? k.fast : 1) * (Number.isFinite(dt) && dt > 0 ? dt : 0);
  const [fx, fy, fz] = lookDirection(yaw, pitch);
  // Right is flat: the camera strafes level, as a drone does.
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  let x = cam.position[0] + (fx * forward + rx * right) * v;
  let y = cam.position[1] + (fy * forward + up) * v;
  let z = cam.position[2] + (fz * forward + rz * right) * v;
  // Keep the camera near the anchor, so it stays inside the level.
  const a = state.anchor ?? cam.position;
  const dx = x - a[0];
  const dy = y - a[1];
  const dz = z - a[2];
  const d = Math.hypot(dx, dy, dz);
  if (d > k.maxDistance) {
    const s = k.maxDistance / d;
    x = a[0] + dx * s;
    y = a[1] + dy * s;
    z = a[2] + dz * s;
  }
  const g = floor ? floor(x, z) : null;
  if (Number.isFinite(g)) y = Math.max(y, g + k.minHeight);
  return { ...state, camera: { position: [x, y, z], yaw, pitch } };
}

// Pure: the PNG file name. It holds the game name and the local date and
// time only: no skater name, no score, no position, and no other player data.
export function photoFileName(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `skate-atl-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}.png`;
}

export { BAND_LIMITS };
