// State -> clip table for the skater model. Pure: no Three.js.
//
// stepAnim() reads one controller state per frame and returns the clip to
// play and the crossfade time. The renderer applies it to an AnimationMixer.

import { SKATE } from "../sim/skate/constants.js";

// Clip names in assets/skaters/nia/skater.glb. `once` clips play one time
// and hold the last frame. `lock` is the time a clip holds before the
// state can change it.
export const CLIPS = {
  idle: { once: false },
  push: { once: false },
  coast: { once: false },
  carve_left: { once: false },
  carve_right: { once: false },
  jump: { once: true },
  air_trick_1: { once: false },
  air_trick_2: { once: false },
  grind: { once: false },
  manual: { once: false }, // No manual input in M0. The table binds it to state.manual.
  bail: { once: true, lock: 0.9 },
  dance_1: { once: false },
  dance_2: { once: false },
  dance_3: { once: false },
  dance_4: { once: false },
};

// Each style move has two dances. The skater alternates between them.
export const STYLE_CLIPS = {
  shuffle: ["dance_1", "dance_3"],
  spin: ["dance_2", "dance_4"],
};

export const ANIM = {
  idleSpeed: 0.3, // m/s. Under this speed the skater stands.
  carveRate: 0.6, // rad/s of yaw change that counts as a carve.
  trickAirTime: 0.25, // s in the air off a ramp before the air trick starts.
  fade: 0.15, // s default crossfade.
  fastFade: 0.06, // s crossfade into a bail, a push, a jump, or a dance.
};

const FAST = new Set(["bail", "push", "jump", "dance_1", "dance_2", "dance_3", "dance_4"]);

export function createAnimState() {
  return { clip: "idle", time: 0, lock: 0, airVariant: 0, styleVariant: 0, wasAirTrick: false, styleId: null, prevYaw: null };
}

function wrapAngle(a) {
  let y = a;
  while (y > Math.PI) y -= 2 * Math.PI;
  while (y < -Math.PI) y += 2 * Math.PI;
  return y;
}

// Picks the clip for one controller state. `ctx` holds the values that the
// state does not carry: the yaw rate and the two variant counters.
export function clipFor(state, ctx = {}) {
  const { yawRate = 0, airVariant = 0, styleVariant = 0 } = ctx;
  if (state.style) {
    const pair = STYLE_CLIPS[state.style.id] ?? STYLE_CLIPS.shuffle;
    return pair[styleVariant % 2];
  }
  if (state.state === "grind") return "grind";
  if (state.state === "air") {
    if (state.airFrom === "fall") return "bail";
    if (state.airFrom === "ramp" && state.airTime >= ANIM.trickAirTime) return airVariant % 2 === 0 ? "air_trick_1" : "air_trick_2";
    return "jump";
  }
  if (state.manual) return "manual";
  if (Math.abs(state.speed) < ANIM.idleSpeed) return "idle";
  // pushCooldown counts down from SKATE.pushCooldown after each push, and the
  // push clip is as long as the cooldown.
  if (state.pushCooldown > 0 && state.pushCooldown <= SKATE.pushCooldown) return "push";
  if (yawRate > ANIM.carveRate) return "carve_left";
  if (yawRate < -ANIM.carveRate) return "carve_right";
  return "coast";
}

// One frame. Returns the next anim state and, when the clip changes,
// `change: { from, to, fade }`.
export function stepAnim(prev, state, dt) {
  const yawRate = prev.prevYaw === null || dt <= 0 ? 0 : wrapAngle(state.yaw - prev.prevYaw) / dt;
  const next = { ...prev, prevYaw: state.yaw, time: prev.time + dt, lock: Math.max(0, prev.lock - dt) };

  // The variant counters change once per air trick and once per style move.
  const styleId = state.style ? state.style.id : null;
  if (!styleId && prev.styleId) next.styleVariant = prev.styleVariant + 1;
  next.styleId = styleId;

  let wanted = clipFor(state, { yawRate, airVariant: next.airVariant, styleVariant: next.styleVariant });
  const airTrick = wanted === "air_trick_1" || wanted === "air_trick_2";
  if (!airTrick && prev.wasAirTrick) next.airVariant = prev.airVariant + 1;
  next.wasAirTrick = airTrick;

  // A bail holds for its lock time, also after the skater lands.
  if (prev.lock > 0 && wanted !== "bail") wanted = prev.clip;
  if (wanted === prev.clip) return { anim: next, change: null };

  next.clip = wanted;
  next.time = 0;
  next.lock = CLIPS[wanted].lock ?? 0;
  const fade = FAST.has(wanted) ? ANIM.fastFade : ANIM.fade;
  return { anim: next, change: { from: prev.clip, to: wanted, fade } };
}
