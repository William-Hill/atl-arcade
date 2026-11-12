// Camera effects (#253). Pure: plain numbers, no Three.js.
//
// The follow camera (src/sim/camera.js) gives the base pose. This module
// adds short offsets on top of it for the big moments of a run:
//
//   speed FOV    the view gets wider as the skater goes faster.
//   landing dip  the camera drops on a hard landing, then springs back.
//   shake        a hard landing or a fall shakes the camera. It decays.
//   grind lean   the camera rolls with the grind balance.
//   zoom punch   a gap or a big bank narrows the view, then springs back.
//   flash        a gap or a big bank tints the screen for a moment.
//
// `stepCameraFx` reads the skater and the sim events of this frame. It
// returns a new state. `cameraFxOffsets` gives the offsets to apply:
// { fov (deg), right (m), up (m), roll (rad), flash (0..1) }. At a
// standstill with no event, every offset is exactly 0.
//
// The shake is a sum of sines, not Math.random, so a replay gives the same
// frames. With `reduced` (prefers-reduced-motion, ?camfx=0) only the speed
// FOV stays, at a smaller size.

import { SKATE } from "./skate/constants.js";

export const CAMERA_FX = {
  speedFov: 7, // deg added at the top speed. min 0 / typical 7 / max 12.
  fovStart: 1.5, // m/s under which the speed FOV is 0, so a slow creep keeps the base view. min 0 / typical 1.5 / max 4.
  fovRate: 4, // 1/s rate the speed FOV chases its target. min 2 / typical 4 / max 10.
  reducedFovScale: 0.5, // fraction of the speed FOV kept with reduced motion. min 0 / typical 0.5 / max 1.
  dipStart: 3, // m/s fall speed under which a landing gives no dip. min 1 / typical 3 / max 6.
  dipPerSpeed: 0.03, // m of dip per m/s of fall speed over dipStart. min 0.01 / typical 0.03 / max 0.06.
  maxDip: 0.22, // m cap on the landing dip. min 0.05 / typical 0.22 / max 0.4.
  dipOmega: 12, // 1/s spring rate of the dip. The dip peaks at 1/dipOmega s. min 6 / typical 12 / max 20.
  hardLand: 6, // m/s fall speed from which a landing shakes the camera. min 4 / typical 6 / max 10.
  hardLandMax: 14, // m/s fall speed that gives the landing trauma cap. min 10 / typical 14 / max 20.
  landTrauma: 0.5, // trauma cap from a landing. min 0.2 / typical 0.5 / max 0.8.
  fallTrauma: 0.7, // trauma from a fall. min 0.3 / typical 0.7 / max 1.
  traumaDecay: 1.6, // trauma lost per s. min 0.8 / typical 1.6 / max 3.
  shakeOffset: 0.08, // m of shake at full trauma. Keep it under CAMERA.clipMargin. min 0.02 / typical 0.08 / max 0.15.
  shakeRoll: 0.021, // rad (1.2 deg) of shake roll at full trauma. min 0 / typical 0.021 / max 0.05.
  shakeFreq: 14, // Hz of the shake. min 8 / typical 14 / max 25.
  grindRoll: 0.052, // rad (3 deg) of roll at the full grind balance. min 0 / typical 0.052 / max 0.1.
  rollRate: 6, // 1/s rate the grind roll chases its target. min 3 / typical 6 / max 12.
  punchFov: -4, // deg of the zoom punch peak. min -8 / typical -4 / max 0.
  punchOmega: 8, // 1/s spring rate of the zoom punch. min 4 / typical 8 / max 16.
  bigBank: 2000, // points of a bank that gives a punch and a flash. min 500 / typical 2000 / max 5000.
  gapFlash: 0.35, // flash strength on a gap. min 0 / typical 0.35 / max 0.6.
  bankFlash: 0.25, // flash strength on a big bank. min 0 / typical 0.25 / max 0.6.
  flashDecay: 3, // flash lost per s. min 1.5 / typical 3 / max 6.
};

// A critically damped spring at rest.
const REST = Object.freeze({ x: 0, v: 0 });

export function createCameraFx() {
  return { time: 0, fov: 0, dip: REST, punch: REST, trauma: 0, roll: 0, flash: 0, airVy: 0, reduced: false };
}

// Exact step of a critically damped spring toward 0, stable for any dt.
export function stepSpring({ x, v }, omega, dt) {
  const e = Math.exp(-omega * dt);
  const c = v + omega * x;
  const nx = (x + c * dt) * e;
  const nv = (v - omega * c * dt) * e;
  // Snap to rest, so a still camera has offsets of exactly 0.
  if (Math.abs(nx) < 1e-5 && Math.abs(nv) < 1e-4) return REST;
  return { x: nx, v: nv };
}

// The start velocity that gives a critically damped spring a peak of `peak`.
// The peak comes at t = 1 / omega, where x = v0 / (omega * e).
export function kickFor(peak, omega) {
  return peak * omega * Math.E;
}

function chase(value, target, rate, dt) {
  const next = target + (value - target) * Math.exp(-rate * dt);
  return Math.abs(next - target) < 1e-5 ? target : next;
}

const clamp01 = (v) => Math.min(Math.max(v, 0), 1);

// The fall speed (m/s) of a landing to its dip (m) and its trauma (0..1).
export function landingImpact(fallSpeed, k = CAMERA_FX) {
  const dip = Math.min(Math.max(fallSpeed - k.dipStart, 0) * k.dipPerSpeed, k.maxDip);
  const trauma = k.landTrauma * clamp01((fallSpeed - k.hardLand) / (k.hardLandMax - k.hardLand));
  return { dip, trauma };
}

// One frame. `events` are the sim events pushed since the last frame
// (src/main.js). `opts.reduced` turns off all but the speed FOV.
export function stepCameraFx(fx, skater, events = [], dt = 0, opts = {}, k = CAMERA_FX) {
  const reduced = Boolean(opts.reduced);
  let { dip, punch, trauma, flash } = fx;

  for (const ev of events) {
    if (ev.type === "land") {
      const hit = landingImpact(Math.max(-fx.airVy, 0), k);
      if (hit.dip > 0) dip = { x: dip.x, v: dip.v - kickFor(hit.dip, k.dipOmega) };
      trauma = Math.max(trauma, hit.trauma);
    } else if (ev.type === "fall") {
      trauma = Math.max(trauma, k.fallTrauma);
    } else if (ev.type === "gap") {
      punch = { x: punch.x, v: kickFor(k.punchFov, k.punchOmega) };
      flash = Math.max(flash, k.gapFlash);
    } else if (ev.type === "bank" && ev.points >= k.bigBank) {
      punch = { x: punch.x, v: kickFor(k.punchFov, k.punchOmega) };
      flash = Math.max(flash, k.bankFlash);
    }
  }

  const speed = clamp01((Math.abs(skater.speed ?? 0) - k.fovStart) / (SKATE.maxSpeed - k.fovStart));
  const fovTarget = k.speedFov * speed * (reduced ? k.reducedFovScale : 1);
  const balance = skater.state === "grind" ? Math.max(-1, Math.min(1, skater.grind?.balance ?? 0)) : 0;

  return {
    time: fx.time + dt,
    fov: chase(fx.fov, fovTarget, k.fovRate, dt),
    dip: reduced ? REST : stepSpring(dip, k.dipOmega, dt),
    punch: reduced ? REST : stepSpring(punch, k.punchOmega, dt),
    trauma: reduced ? 0 : Math.max(trauma - k.traumaDecay * dt, 0),
    roll: reduced ? 0 : chase(fx.roll, balance * k.grindRoll, k.rollRate, dt),
    flash: reduced ? 0 : Math.max(flash - k.flashDecay * dt, 0),
    // The last vertical velocity in the air: the fall speed of the next landing.
    airVy: skater.state === "air" ? (skater.velocity?.[1] ?? 0) : fx.airVy,
    reduced,
  };
}

// A smooth value in -1..1 with no repeat in a run: three sines at
// frequencies with no common factor.
export function shakeNoise(t, seed) {
  return (Math.sin(t * 1.0 + seed) * 0.5 + Math.sin(t * 2.31 + seed * 1.7) * 0.3 + Math.sin(t * 4.17 + seed * 2.9) * 0.2);
}

export function cameraFxOffsets(fx, k = CAMERA_FX) {
  // Trauma squared: a small hit gives a very small shake.
  const amount = fx.trauma * fx.trauma;
  const t = fx.time * k.shakeFreq;
  const shake = amount > 0;
  return {
    fov: fx.fov + fx.punch.x,
    right: shake ? amount * k.shakeOffset * shakeNoise(t, 1.3) : 0,
    up: fx.dip.x + (shake ? amount * k.shakeOffset * shakeNoise(t, 4.1) : 0),
    roll: fx.roll + (shake ? amount * k.shakeRoll * shakeNoise(t, 7.7) : 0),
    flash: fx.flash,
  };
}
