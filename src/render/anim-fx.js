// Procedural animation layers (#291). Pure: no Three.js, no Math.random.
//
// The renderer plays a clip with the AnimationMixer, then adds these layers
// to the bones (src/render/skater-view.js):
// - beat bounce: a small hip drop on each game beat during a dance and the ride,
// - follow-through: a damped spring on the neck, the head, and the arms, so
//   that they lag a fast body turn and settle after it,
// - upper-body twist: a twist of the spine against the hips from the yaw rate
//   (the steer times the carve rate).
// `?animfx=0` turns the layers off. `prefers-reduced-motion` makes them smaller.

import { BEAT } from "../sim/skate/constants.js";
import { DANCE_CLIPS } from "./skater-anim.js";

export const FX = {
  bounce: 0.03, // m. The hip drop on the beat.
  bounceSharp: 2, // The power of the pulse. A larger value gives a shorter drop.
  gainTime: 0.2, // s. The time for a layer to fade in or out when the clip changes.
  lagTime: 0.09, // s. The head and the arms lag the body turn by this time.
  lagCap: 0.3, // rad. The largest lag (each axis and the vector length). The output never goes past it.
  springHz: 3.2, // Hz. The natural frequency of the follow-through spring.
  springZeta: 0.55, // The damping ratio. Under 1 gives a small settle after a stop.
  twistPerYaw: 0.16, // rad of spine twist for each rad/s of yaw rate.
  twistCap: 0.3, // rad. The largest spine twist.
  twistHz: 2.2, // Hz. The spring of the twist.
  twistZeta: 0.8,
  hipCounter: 0.35, // The hips turn this fraction of the twist the other way.
  reducedScale: 0.4, // The layer scale with prefers-reduced-motion.
};

// The clips with the beat bounce: the dances and the ground ride.
export const BOUNCE_CLIPS = new Set(["coast", "ride_back", "carve_left", "carve_right", "push", ...DANCE_CLIPS]);

// The layer scale: 0 (off), FX.reducedScale (reduced motion), or 1.
export function fxScale({ param = null, reduced = false } = {}) {
  if (param === "0" || param === "off") return 0;
  return reduced ? FX.reducedScale : 1;
}

// The beat phase 0..1 at `clock` (s since beat 0). 0 is on the beat.
export function beatPhase01(clock, bpm = BEAT.bpm) {
  if (!(bpm > 0) || !Number.isFinite(clock)) return 0;
  const p = (clock * bpm) / 60;
  return p - Math.floor(p);
}

// The hip drop (m, >= 0) at a beat phase: the largest drop is on the beat,
// and the hips come back up before the next beat. The shape is smooth and
// periodic, so there is no jump at the beat.
export function bounceDrop(phase, amp = FX.bounce, sharp = FX.bounceSharp) {
  const c = (Math.cos(2 * Math.PI * phase) + 1) / 2;
  return amp * Math.pow(c, sharp);
}

// A damped spring toward `target`: x'' = w^2 (target - x) - 2 zeta w x'.
// It uses the semi-implicit Euler method in sub-steps of 1/120 s or less,
// so a long frame does not make it unstable. `cap` clamps |x| (and stops
// the velocity at the cap), so the output never overshoots past the cap.
export function stepSpring(s, target, dt, { hz, zeta, cap = Infinity }) {
  if (!(dt > 0)) return s;
  const w = 2 * Math.PI * hz;
  const n = Math.max(1, Math.ceil(dt * 120));
  const h = dt / n;
  let { x, v } = s;
  for (let i = 0; i < n; i += 1) {
    v += (w * w * (target - x) - 2 * zeta * w * v) * h;
    x += v * h;
    if (x > cap) {
      x = cap;
      if (v > 0) v = 0;
    } else if (x < -cap) {
      x = -cap;
      if (v < 0) v = 0;
    }
  }
  return { x, v };
}

// The time (s) for a spring from rest at `from` to come within `tol` of
// `target` and stay there. For the tests and the tuning.
export function settleTime(opts, from = 1, target = 0, tol = 0.02, maxTime = 5, dt = 1 / 120) {
  let s = { x: from, v: 0 };
  let last = 0;
  for (let t = dt; t <= maxTime; t += dt) {
    s = stepSpring(s, target, dt, opts);
    if (Math.abs(s.x - target) > tol) last = t;
  }
  return last;
}

const approach = (cur, target, dt, time) => {
  const step = time > 0 ? dt / time : 1;
  return Math.abs(target - cur) <= step ? target : cur + Math.sign(target - cur) * step;
};

const VEC = { x: 0, v: 0 };

export function createFxState() {
  return {
    gain: 0, // The bounce gain 0..1. It fades with the clip.
    lag: [VEC, VEC, VEC], // The follow-through spring for each axis.
    twist: VEC, // The spine twist spring.
    drop: 0, // m. The hip drop of this frame.
    out: [0, 0, 0], // rad. The lag rotation vector of this frame.
    twistOut: 0, // rad. The spine twist of this frame.
  };
}

// One frame of the layers.
// in: { clip, clock (s since beat 0), bpm, yawRate (rad/s), spin (rad/s of
//       the body: the dance spin and the facing turn), omega ([x, y, z] rad/s,
//       the chest turn rate from the clip, in the armature frame), up ([x,
//       y, z], the up axis in the armature frame), scale (fxScale()) }
// out: the next state, with `drop`, `out`, and `twistOut` for this frame.
export function stepFx(prev, inp, dt) {
  const scale = inp.scale ?? 1;
  const next = { ...prev };
  next.gain = approach(prev.gain, BOUNCE_CLIPS.has(inp.clip) ? 1 : 0, dt, FX.gainTime);
  next.drop = scale * next.gain * bounceDrop(beatPhase01(inp.clock, inp.bpm ?? BEAT.bpm));

  // Follow-through: the body turn rate in the armature frame is the clip turn
  // rate plus the body yaw rate about the up axis. The head and the arms
  // lag it: the spring target is the opposite turn over the lag time.
  const up = inp.up ?? [0, 1, 0];
  const yaw = (inp.yawRate ?? 0) + (inp.spin ?? 0);
  const om = inp.omega ?? [0, 0, 0];
  const lagOpts = { hz: FX.springHz, zeta: FX.springZeta, cap: FX.lagCap };
  next.lag = prev.lag.map((s, i) => {
    const target = Math.max(-FX.lagCap, Math.min(FX.lagCap, -(om[i] + yaw * up[i]) * FX.lagTime));
    return stepSpring(s, target, dt, lagOpts);
  });
  // The cap is on each axis in the spring and on the length of the vector here.
  const len = Math.hypot(next.lag[0].x, next.lag[1].x, next.lag[2].x);
  const k = (len > FX.lagCap ? FX.lagCap / len : 1) * scale;
  next.out = next.lag.map((s) => s.x * k);

  // The upper-body twist leads into the carve.
  const twistTarget = Math.max(-FX.twistCap, Math.min(FX.twistCap, (inp.yawRate ?? 0) * FX.twistPerYaw));
  next.twist = stepSpring(prev.twist, twistTarget, dt, { hz: FX.twistHz, zeta: FX.twistZeta, cap: FX.twistCap });
  next.twistOut = next.twist.x * scale;
  return next;
}
