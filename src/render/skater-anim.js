// State -> clip table for the skater model. Pure: no Three.js.
//
// stepAnim() reads one controller state per frame and returns the clip to
// play and the crossfade time. The renderer applies it to an AnimationMixer.
//
// Free skate uses Atlanta rink style, and rails and air use X Games style.
// The sources are in docs/characters/skate-style-references.md.

import { BEAT, STYLE } from "../sim/skate/constants.js";
import { FIXED_DT } from "../sim/fixed-step.js";

// Clip names in assets/skaters/nia/skater.glb.
//   once: the clip plays one time and holds the last frame.
//   lock: the time (s) that the clip holds before a ground clip can replace it.
//   beat: a groove clip. It is a whole number of clip beats (ANIM.clipBeat),
//         and the renderer plays it in phase with the game beat clock.
//   tempo: a dance clip. The renderer plays it from its start at the game
//          tempo, so one clip beat lasts one game beat.
export const CLIPS = {
  idle: { beat: true },
  push: {},
  coast: { beat: true },
  ride_back: { beat: true },
  carve_left: { beat: true },
  carve_right: { beat: true },
  jump: { once: true },
  land: { once: true, lock: 0.3 },
  air_mute: {},
  air_japan: {},
  air_liukang: {},
  grind_frontside: {},
  grind_soul: {},
  grind_unity: {},
  manual: {}, // No manual input in M0. The table binds it to state.manual.
  bail: { once: true, lock: 0.9 },
  dance_bankhead: { tempo: true },
  dance_walkitout: { tempo: true },
  dance_prep: { tempo: true },
  dance_swagsurf: { tempo: true },
  dance_snaplean: { tempo: true },
  dance_crisscross: { tempo: true },
  dance_smoothquad: { tempo: true },
  dance_spin: { tempo: true },
  dance_sitspin: { tempo: true },
};

// The game cycles through these in order: one air trick per ramp air and
// one grind stance per rail.
export const AIR_TRICKS = ["air_mute", "air_japan", "air_liukang"];
export const GRINDS = ["grind_frontside", "grind_soul", "grind_unity"];

// The dance clips of all style moves (src/sim/skate/constants.js STYLE).
export const DANCE_CLIPS = STYLE.moves.flatMap((m) => m.dances.map((d) => d.clip));

export const ANIM = {
  clipBeat: 0.8, // s. The clips are keyed at 24 frames (30 fps) per beat. The renderer scales them to the game beat.
  idleSpeed: 0.3, // m/s. Under this speed the skater stands.
  carveRate: 0.6, // rad/s of yaw change that counts as a carve.
  trickAirTime: 0.25, // s in the air off a ramp before the air trick starts.
  fade: 0.15, // s default crossfade.
  fastFade: 0.06, // s crossfade into a bail, a push, a jump, a landing, a grind, or a dance.
  turnTime: 0.35, // s for the half turn into and out of the backward ride.
};

const FAST = new Set(["bail", "push", "jump", "land", ...GRINDS, ...DANCE_CLIPS]);
const AIR = new Set(["jump", ...AIR_TRICKS]);
const GROUND = new Set(["idle", "push", "coast", "ride_back", "carve_left", "carve_right", "manual"]);

export const beatLength = (bpm = BEAT.bpm) => 60 / bpm;

// The playback rate that makes one clip beat last one game beat.
export const grooveRate = (bpm = BEAT.bpm) => ANIM.clipBeat / beatLength(bpm);

// The clip time that is in phase with the game beat clock. `clock` is the
// time in seconds since beat 0.
export function beatPhase(clock, clipDuration, bpm = BEAT.bpm) {
  if (!(clipDuration > 0)) return 0;
  const t = clock * grooveRate(bpm);
  return ((t % clipDuration) + clipDuration) % clipDuration;
}

export function createAnimState() {
  return {
    clip: "idle",
    time: 0,
    lock: 0,
    airVariant: 0,
    grindVariant: 0,
    wasAirTrick: false,
    wasGrind: false,
    prevYaw: null,
    prevTick: null,
    yawRate: 0,
    facing: 0,
  };
}

function wrapAngle(a) {
  let y = a;
  while (y > Math.PI) y -= 2 * Math.PI;
  while (y < -Math.PI) y += 2 * Math.PI;
  return y;
}

// Picks the clip for one controller state. `ctx` holds the values that the
// state does not carry: the yaw rate and the variant counters.
export function clipFor(state, ctx = {}) {
  const { yawRate = 0, airVariant = 0, grindVariant = 0 } = ctx;
  // The sim picks the dance (state.style.clip). The fallback is the first dance.
  if (state.style) return CLIPS[state.style.clip] ? state.style.clip : DANCE_CLIPS[0];
  if (state.state === "grind") return GRINDS[grindVariant % GRINDS.length];
  if (state.state === "air") {
    if (state.airFrom === "fall") return "bail";
    if (state.airFrom === "ramp" && state.airTime >= ANIM.trickAirTime) return AIR_TRICKS[airVariant % AIR_TRICKS.length];
    return "jump";
  }
  if (state.manual) return "manual";
  if (Math.abs(state.speed) < ANIM.idleSpeed) return "idle";
  // Backward (the switch button): the backward ride swizzles the skates, so
  // it is the clip for the push, the coast, and the carves.
  if (state.backward) return "ride_back";
  // The push clip plays only while the push button is held. The cooldown
  // continues after a release, so it is not the check.
  if (state.pushing) return "push";
  if (yawRate > ANIM.carveRate) return "carve_left";
  if (yawRate < -ANIM.carveRate) return "carve_right";
  return "coast";
}

// One frame. Returns the next anim state and, when the clip changes,
// `change: { from, to, fade }`.
// The yaw rate in rad/s. The simulation steps at a fixed tick, but a render
// frame can come with no tick (a display above 60 Hz). So with a tick count,
// the rate changes only when the tick advances, over the ticks' time, and a
// frame with no tick keeps the last rate. A state with no tick uses `dt`.
export function measureYawRate(prev, state, dt) {
  if (prev.prevYaw === null) return 0;
  const tick = state.tick;
  if (Number.isFinite(tick) && Number.isFinite(prev.prevTick)) {
    if (tick === prev.prevTick) return prev.yawRate ?? 0;
    if (tick < prev.prevTick) return 0; // (a reset)
    return wrapAngle(state.yaw - prev.prevYaw) / ((tick - prev.prevTick) * FIXED_DT);
  }
  return dt > 0 ? wrapAngle(state.yaw - prev.prevYaw) / dt : 0;
}

export function stepAnim(prev, state, dt) {
  const yawRate = measureYawRate(prev, state, dt);
  const next = { ...prev, prevYaw: state.yaw, prevTick: state.tick ?? null, yawRate, time: prev.time + dt, lock: Math.max(0, prev.lock - dt) };

  // The variant counters change once per air trick and per rail.
  const onRail = state.state === "grind";
  if (!onRail && prev.wasGrind) next.grindVariant = prev.grindVariant + 1;
  next.wasGrind = onRail;

  const ctx = { yawRate, airVariant: next.airVariant, grindVariant: next.grindVariant };
  let wanted = clipFor(state, ctx);
  const airTrick = AIR_TRICKS.includes(wanted);
  if (!airTrick && prev.wasAirTrick) next.airVariant = prev.airVariant + 1;
  next.wasAirTrick = airTrick;

  // The skater lands from a jump or an air trick with the land clip.
  if (AIR.has(prev.clip) && GROUND.has(wanted)) wanted = "land";
  // A bail or a landing holds for its lock time before a ground clip.
  if (prev.lock > 0 && GROUND.has(wanted)) wanted = prev.clip;
  next.facing = facingFor(wanted, state);
  if (wanted === prev.clip) return { anim: next, change: null };

  next.clip = wanted;
  next.time = 0;
  next.lock = CLIPS[wanted].lock ?? 0;
  const fade = FAST.has(wanted) ? ANIM.fastFade : ANIM.fade;
  return { anim: next, change: { from: prev.clip, to: wanted, fade } };
}

// The model yaw offset: PI faces backward. The skater faces backward on the
// ground when the switch is on. Air, rails, and dances face forward.
export const facingFor = (clip, state = {}) => (state.backward && GROUND.has(clip) && clip !== "manual" ? Math.PI : 0);

// Moves the facing offset toward its target at a fixed turn rate.
export function stepFacing(current, target, dt, turnTime = ANIM.turnTime) {
  const d = target - current;
  const max = (Math.PI / turnTime) * dt;
  if (Math.abs(d) <= max) return target;
  return current + Math.sign(d) * max;
}
