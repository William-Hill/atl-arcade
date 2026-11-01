// The skater orchestrator: rolling and air from the controller, rails from
// the grind system. Pure. `stepSkater` is what the game loop and the tests
// call. Stats count snaps, exits, and falls for the playtest metrics.

import { GRIND, SKATE, STYLE, styleDuration } from "./constants.js";
import { FLAT_GROUND, createSkateState, stepSkate } from "./controller.js";
import { findSnap, prepareGrindables, startGrind, stepGrind } from "./grind.js";

export function createSkater(level, { position, yaw } = {}) {
  const spawn = level?.spawn ?? { position: [0, 0, 0], yaw: 0 };
  const state = createSkateState({ position: position ?? spawn.position, yaw: yaw ?? spawn.yaw });
  return {
    ...state,
    grind: null,
    grindCooldown: 0,
    grindHeld: false,
    grindBuffer: 0, // s left on a buffered grind press
    justSnapped: false,
    justFell: false,
    justExited: false,
    exitReason: null,
    style: null, // { id, name, time, duration, points, anim }
    styleHeld: [false, false],
    styleCount: [0, 0],
    backward: false, // the skater rides backward (ATL style). The travel does not change.
    switchHeld: false,
    justStyled: null, // the move that just completed
    stats: { snaps: 0, falls: 0, exits: 0, grindTime: 0, styles: 0, respawns: 0 },
  };
}

export function createSkaterEnv(level) {
  return { grindables: level ? prepareGrindables(level) : [] };
}

export function stepSkater(prev, input = {}, dt, env = FLAT_GROUND, skaterEnv = { grindables: [] }, k = { skate: SKATE, grind: GRIND }) {
  const grindables = skaterEnv.grindables ?? [];
  const wantsGrind = Boolean(input.grind);
  const grindEdge = wantsGrind && !prev.grindHeld;
  const stats = { ...prev.stats };
  let s;

  if (prev.state === "grind") {
    const jumpEdge = Boolean(input.jump) && !prev.jumpHeld;
    s = stepGrind(prev, { steer: input.steer, jump: jumpEdge }, dt, grindables, k.grind, k.skate);
    s.jumpHeld = Boolean(input.jump);
    s.jumpBuffer = 0;
    s.grindBuffer = 0;
    s.tick = prev.tick + 1;
    stats.grindTime += dt;
    if (s.justFell) stats.falls += 1;
    if (s.justExited) stats.exits += 1;
  } else {
    s = stepSkate(prev, input, dt, env, k.skate);
    if (s.respawned) stats.respawns += 1;
    s.grindCooldown = Math.max(0, (prev.grindCooldown ?? 0) - dt);
    s.justSnapped = false;
    s.justFell = false;
    s.justExited = false;
    s.exitReason = null;
    const lean = input.steer ? Math.sign(input.steer) : stats.snaps % 2 === 0 ? 1 : -1;
    // Input buffer: a grind tap stays live for GRIND.buffer s, so a tap just
    // before the rail comes in range still snaps.
    s.grindBuffer = grindEdge ? k.grind.buffer : Math.max(0, (prev.grindBuffer ?? 0) - dt);
    if ((wantsGrind || s.grindBuffer > 0) && s.grindCooldown <= 0 && grindables.length) {
      const snap = findSnap(grindables, s, k.grind);
      if (snap) {
        s = startGrind(s, snap, lean, k.grind);
        s.grindBuffer = 0;
        s.jumpBuffer = 0;
        s.tick = prev.tick + 1;
        stats.snaps += 1;
      }
    }
  }
  s.grindHeld = wantsGrind;

  // Style moves: a button press starts the next dance in that button's list,
  // while rolling at speed. A dance runs for its beats, and a held button
  // repeats the same dance. A dance stops when the skater leaves the ground.
  const held = [Boolean(input.style1), Boolean(input.style2)];
  s.justStyled = null;
  const counts = prev.styleCount ? [...prev.styleCount] : [0, 0];
  let style = prev.style ? { ...prev.style } : null;
  let repeat = null;
  if (style && s.state !== "rolling") style = null;
  if (style) {
    style.time += dt;
    if (style.time >= style.duration) {
      s.justStyled = { id: style.id, name: style.name, points: style.points };
      stats.styles += 1;
      if (held[style.button]) repeat = style;
      style = null;
    }
  }
  if (!style && s.state === "rolling" && s.speed >= STYLE.minSpeed) {
    if (repeat) {
      style = { ...repeat, time: 0 };
    } else {
      const index = held.findIndex((h, i) => h && !prev.styleHeld[i]);
      const m = STYLE.moves[index];
      if (m) {
        const dance = m.dances[counts[index] % m.dances.length];
        counts[index] += 1;
        style = { id: m.id, button: index, name: dance.name, clip: dance.clip, time: 0, duration: styleDuration(m), points: m.points, anim: m.anim };
      }
    }
  }
  s.styleCount = counts;
  s.style = style;
  s.styleHeld = held;

  // Switch: a press on the ground turns the skater to ride backward or
  // forward again. A fall or a respawn resets the skater to forward.
  const wantsSwitch = Boolean(input.switch);
  s.backward = Boolean(prev.backward);
  if (wantsSwitch && !prev.switchHeld && s.state === "rolling") s.backward = !s.backward;
  if (s.justFell || s.respawned) s.backward = false;
  s.switchHeld = wantsSwitch;
  s.stats = stats;
  return s;
}

export function runSkaterScript(initial, script, { dt = 1 / 60, env = FLAT_GROUND, skaterEnv, trace = false } = {}) {
  let s = initial;
  const states = [];
  for (const entry of script) {
    for (let i = 0; i < entry.frames; i += 1) {
      s = stepSkater(s, entry.input ?? {}, dt, env, skaterEnv);
      if (trace) states.push(s);
    }
  }
  return trace ? { state: s, states } : { state: s };
}
