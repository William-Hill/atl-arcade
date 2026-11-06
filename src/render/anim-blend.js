// Clip blends and the carve lean (#107). Pure: no Three.js.
//
// - The fade times for each state change are in skater-anim.js (fadeFor).
// - The blender: each clip has a weight. A change starts a fade from the
//   weights of this frame, so a change in the middle of a fade does not
//   reset a clip to 0 (no pop). The weights always sum to 1.
// - The lean: the body banks into a carve by the angle of the centripetal
//   acceleration, and the carve clips add a lean pose on top of the coast
//   and the push.

import { ANIM } from "./skater-anim.js";

// --- The blender ---------------------------------------------------------

const EPS = 1e-4;

// smoothstep: the fade starts and ends with zero slope.
const ease = (k) => k * k * (3 - 2 * k);

export function createBlend(clip) {
  return { target: clip, start: { [clip]: 1 }, weights: { [clip]: 1 }, t: 0, fade: 0 };
}

// Starts a fade to `to` from the weights of this frame.
export function startBlend(blend, to, fade) {
  const start = { ...blend.weights };
  if (!(to in start)) start[to] = 0;
  return { target: to, start, weights: { ...start }, t: 0, fade: Math.max(0, fade) };
}

// Advances the fade by dt. Clips with no weight leave the map.
export function stepBlend(blend, dt) {
  const t = blend.t + Math.max(0, dt);
  const s = blend.fade > 0 ? ease(Math.min(1, t / blend.fade)) : 1;
  const weights = {};
  for (const [name, w0] of Object.entries(blend.start)) {
    const w = name === blend.target ? w0 + (1 - w0) * s : w0 * (1 - s);
    if (w > EPS || name === blend.target) weights[name] = w;
  }
  return { ...blend, t, weights };
}

// True while a fade runs.
export const blending = (blend) => Object.keys(blend.weights).length > 1;

// --- The lean ------------------------------------------------------------

export const LEAN = {
  g: 9.81, // m/s^2
  scale: 0.6, // part of the physical bank angle. The carve clips lean too.
  maxBank: 0.22, // rad (12.6 degrees) body bank at the hardest carve.
  tau: 0.12, // s time constant of the lean smoothing.
  layer: 0.6, // weight of the carve lean pose at full lean.
  // The lean pose adds on top of these base clips. A carve clip shows the
  // full lean by itself, and the air, rail, and dance clips do not lean.
  bases: ["coast", "push"],
};

// The bank angle (rad) for one controller state and its yaw rate. Positive
// banks to the skater's left (a left turn: a positive yaw rate). The
// physical angle is atan(v * yawRate / g); the bank is a part of it.
export function leanTarget(state, yawRate, k = LEAN) {
  if (!state || state.state !== "rolling" || state.style || state.manual) return 0;
  const v = Math.abs(state.speed ?? 0);
  if (v < ANIM.idleSpeed || !Number.isFinite(yawRate)) return 0;
  const bank = k.scale * Math.atan((v * yawRate) / k.g);
  return Math.max(-k.maxBank, Math.min(k.maxBank, bank));
}

// Moves the lean toward its target with an exponential smoothing. The
// result does not depend on the frame rate.
export function stepLean(current, target, dt, tau = LEAN.tau) {
  if (!(dt > 0)) return current;
  if (!(tau > 0)) return target;
  return target + (current - target) * Math.exp(-dt / tau);
}

// The weights of the additive lean poses for a lean (rad) on a base clip.
export function leanLayers(lean, base, k = LEAN) {
  const out = { carve_left: 0, carve_right: 0 };
  if (!k.bases.includes(base)) return out;
  const amount = Math.min(1, Math.abs(lean) / k.maxBank) * k.layer;
  if (lean > 0) out.carve_left = amount;
  else if (lean < 0) out.carve_right = amount;
  return out;
}

// The model roll (rad) about its forward axis for a bank. A positive roll
// tilts the top toward +z, which is the skater's right at yaw 0
// (heading [cos yaw, 0, -sin yaw]). A left bank tilts it toward -z.
export const rollFor = (bank) => -bank;
