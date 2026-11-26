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
  // The brake: Nia does a T-stop, Marcus a toe-stop drag. It holds 0.25 s,
  // so a short tap does not flicker.
  brake: { beat: true, lock: 0.25 },
  coast: { beat: true },
  ride_back: { beat: true },
  carve_left: { beat: true },
  carve_right: { beat: true },
  jump: { once: true },
  land: { once: true, lock: 0.3 },
  // The stumble landing (#329, docs/gdd/trick-input.md R10): a deeper hit
  // and a 0.2 s arm wave. It holds longer than land, so the wave shows.
  land_stumble: { once: true, lock: 0.4 },
  air_mute: {},
  air_japan: {},
  air_liukang: {},
  air_rocket: {},
  air_tuckknee: {},
  grind_frontside: {},
  grind_soul: {},
  grind_unity: {},
  grind_makio: {},
  grind_royale: {},
  manual: {},
  manual_toe: {}, // The toe roll: the front wheels down (#329).
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
  // Marcus only: the clips are in his GLB alone.
  dance_jamgroove: { tempo: true, skaters: ["marcus"] },
  dance_drumline: { tempo: true, skaters: ["marcus"] },
  dance_jamstep: { tempo: true, skaters: ["marcus"] },
};

// The clip names in the GLB of one skater.
export const clipNamesFor = (skater) => Object.keys(CLIPS).filter((n) => !CLIPS[n].skaters || CLIPS[n].skaters.includes(skater));

// The clip groups of the trick input (docs/gdd/trick-input.md). The sim
// picks the trick (state.trick.clip); the renderer plays it when it is a clip
// of the group of the state, and else the base clip of the state.
export const GRAB_CLIPS = ["air_mute", "air_japan", "air_liukang", "air_rocket", "air_tuckknee"];
export const GRIND_CLIPS = ["grind_frontside", "grind_soul", "grind_unity", "grind_makio", "grind_royale"];
export const MANUAL_CLIPS = ["manual", "manual_toe"];
export const LAND_CLIPS = ["land", "land_stumble"];

// The dance clips of all style moves (src/sim/skate/constants.js STYLE).
export const DANCE_CLIPS = STYLE.moves.flatMap((m) => m.dances.map((d) => d.clip));

export const ANIM = {
  clipBeat: 0.8, // s. The clips are keyed at 24 frames (30 fps) per beat. The renderer scales them to the game beat.
  idleSpeed: 0.3, // m/s. Under this speed the skater stands.
  carveRate: 0.6, // rad/s of yaw change that counts as a carve.
  fade: 0.2, // s default crossfade. FADES sets the time for each change.
  turnTime: 0.35, // s for the half turn into and out of the backward ride.
  brakeDecel: 5, // m/s^2. A harder slow-down plays the brake clip. The roll friction and drag stay under 4.8 at the top speed, and the brake is 8.
  brakeHold: 0.1, // s. The slow-down must last this long, so a one-tick drop (a wall slide, a landing) does not play the brake.
};

const AIR = new Set(["jump", ...GRAB_CLIPS]);
const GROUND = new Set(["idle", "push", "brake", "coast", "ride_back", "carve_left", "carve_right", ...MANUAL_CLIPS]);

// --- Fade times for each state change (#107) ---------------------------
//
// The table keys on clip names and clip groups, not on bone data, so new
// clip GLBs (#170) keep the same blends.

const GROUPS = {
  idle: ["idle"],
  roll: ["push", "coast", ...MANUAL_CLIPS],
  brake: ["brake"],
  carve: ["carve_left", "carve_right"],
  back: ["ride_back"],
  jump: ["jump"],
  trick: GRAB_CLIPS,
  land: LAND_CLIPS,
  grind: GRIND_CLIPS,
  bail: ["bail"],
  dance: DANCE_CLIPS,
};

const GROUP_OF = new Map();
for (const [g, clips] of Object.entries(GROUPS)) for (const c of clips) GROUP_OF.set(c, g);

// The group of a clip name. An unknown clip has the group "other".
export const groupOf = (clip) => GROUP_OF.get(clip) ?? "other";

// The fade rules. The first rule that matches wins. A side is a clip name,
// a group name, or "*". The times are in seconds.
export const FADES = [
  ["*", "bail", 0.05], // A fall reads at once.
  ["bail", "*", 0.3],
  ["jump", "trick", 0.15],
  ["trick", "trick", 0.15],
  ["*", "land", 0.05], // The impact reads at once.
  ["land", "*", 0.25],
  ["*", "jump", 0.06], // The pop reads at once.
  ["grind", "grind", 0.12],
  ["*", "grind", 0.08],
  ["grind", "*", 0.15],
  ["*", "dance", 0.08],
  ["dance", "*", 0.25],
  ["*", "brake", 0.12],
  ["brake", "*", 0.25],
  // 0.15 s, not 0.12 s (#363): the push clips start at a pose far from the
  // coast (Marcus's left knee: 0.56 to 0.68 rad). A shorter fade turns the
  // knee faster than the push clip does by itself.
  ["coast", "push", 0.15],
  ["push", "coast", 0.25],
  ["carve", "carve", 0.35],
  ["roll", "carve", 0.3],
  ["carve", "roll", 0.3],
  ["*", "back", ANIM.turnTime], // The fade matches the half turn.
  ["back", "*", ANIM.turnTime],
  ["idle", "*", 0.3],
  ["*", "idle", 0.4],
  ["*", "*", ANIM.fade],
];

const sideMatches = (side, clip) => side === "*" || side === clip || side === groupOf(clip);

// The crossfade time (s) from one clip to another.
export function fadeFor(from, to, rules = FADES) {
  for (const [a, b, t] of rules) if (sideMatches(a, from) && sideMatches(b, to)) return t;
  return ANIM.fade;
}

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
    prevYaw: null,
    prevTick: null,
    prevSpeed: null,
    yawRate: 0,
    decel: 0,
    slowing: 0,
    facing: 0,
  };
}

export function wrapAngle(a) {
  let y = a;
  while (y > Math.PI) y -= 2 * Math.PI;
  while (y < -Math.PI) y += 2 * Math.PI;
  return y;
}

// The clip of the sim's trick (state.trick.clip, #327) when it is in the
// group, else the fallback.
const trickClip = (state, group, fallback) => {
  const clip = state.trick?.clip;
  return clip && group.includes(clip) ? clip : fallback;
};

// The landing result of the sim (docs/gdd/trick-input.md R10). The sim
// (#327) can give it as a string or as { result }.
export const landingResult = (state) => {
  const l = state.landing;
  return (l && typeof l === "object" ? l.result : l) ?? null;
};

// Picks the clip for one controller state. `ctx` holds the values that the
// state does not carry: the yaw rate and the slow-down time.
export function clipFor(state, ctx = {}) {
  const { yawRate = 0, slowing = 0 } = ctx;
  // The sim picks the dance (state.style.clip). The fallback is the first dance.
  if (state.style) return CLIPS[state.style.clip] ? state.style.clip : DANCE_CLIPS[0];
  // The sim picks the stance; with no stance it is the edge grind.
  if (state.state === "grind") return trickClip(state, GRIND_CLIPS, "grind_frontside");
  if (state.state === "air") {
    if (state.airFrom === "fall") return "bail";
    // A grab plays its clip. An air with no grab (a ramp air too) plays jump.
    return trickClip(state, GRAB_CLIPS, "jump");
  }
  if (state.manual) return trickClip(state, MANUAL_CLIPS, "manual");
  if (Math.abs(state.speed) < ANIM.idleSpeed) return "idle";
  // Backward (the switch button): the backward ride swizzles the skates, so
  // it is the clip for the push, the coast, and the carves.
  if (state.backward) return "ride_back";
  // The brake: the brake button, or a hard slow-down for ANIM.brakeHold
  // (slowing: the time in s over ANIM.brakeDecel).
  if (state.braking || slowing >= ANIM.brakeHold) return "brake";
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

// The slow-down in m/s^2 (positive when the speed falls), per simulation
// tick as measureYawRate().
export function measureDecel(prev, state, dt) {
  if (prev.prevSpeed === null || prev.prevSpeed === undefined) return 0;
  const drop = Math.abs(prev.prevSpeed) - Math.abs(state.speed);
  const tick = state.tick;
  if (Number.isFinite(tick) && Number.isFinite(prev.prevTick)) {
    if (tick === prev.prevTick) return prev.decel ?? 0;
    if (tick < prev.prevTick) return 0;
    return drop / ((tick - prev.prevTick) * FIXED_DT);
  }
  return dt > 0 ? drop / dt : 0;
}

export function stepAnim(prev, state, dt) {
  const yawRate = measureYawRate(prev, state, dt);
  const decel = measureDecel(prev, state, dt);
  const next = { ...prev, prevYaw: state.yaw, prevSpeed: state.speed, prevTick: state.tick ?? null, yawRate, decel, slowing: decel > ANIM.brakeDecel ? (prev.slowing ?? 0) + dt : 0, time: prev.time + dt, lock: Math.max(0, prev.lock - dt) };

  let wanted = clipFor(state, { yawRate, slowing: next.slowing });

  // The skater lands from a jump or an air trick with the land clip, or
  // with its stumble variant when the sim says the landing is a stumble.
  if (AIR.has(prev.clip) && GROUND.has(wanted)) wanted = landingResult(state) === "stumble" ? "land_stumble" : "land";
  // A bail or a landing holds for its lock time before a ground clip.
  if (prev.lock > 0 && GROUND.has(wanted)) wanted = prev.clip;
  next.facing = facingFor(wanted, state);
  if (wanted === prev.clip) return { anim: next, change: null };

  next.clip = wanted;
  next.time = 0;
  next.lock = CLIPS[wanted].lock ?? 0;
  const fade = fadeFor(prev.clip, wanted);
  return { anim: next, change: { from: prev.clip, to: wanted, fade } };
}

// The anim state for a skater that respawns (#231): the clip and the facing
// of the new state at once, with no fade, and the yaw, the speed and the
// tick of the new state as the last values, so the next frame measures no
// turn from the old place.
export function respawnAnim(state) {
  const clip = clipFor(state);
  return { ...createAnimState(), clip, lock: 0, facing: facingFor(clip, state), prevYaw: state.yaw, prevSpeed: state.speed, prevTick: state.tick ?? null };
}

// The model yaw offset: PI faces backward. The skater faces backward on the
// ground when the switch is on. Air, rails, and dances face forward.
export const facingFor = (clip, state = {}) => (state.backward && GROUND.has(clip) && !MANUAL_CLIPS.includes(clip) ? Math.PI : 0);

// Moves the facing offset toward its target at a fixed turn rate.
export function stepFacing(current, target, dt, turnTime = ANIM.turnTime) {
  const d = target - current;
  const max = (Math.PI / turnTime) * dt;
  if (Math.abs(d) <= max) return target;
  return current + Math.sign(d) * max;
}
