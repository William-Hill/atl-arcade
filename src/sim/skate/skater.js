// The skater orchestrator: rolling and air from the controller, rails from
// the grind system. Pure. `stepSkater` is what the game loop and the tests
// call. Stats count snaps, exits, and falls for the playtest metrics.

import { GRIND, SKATE } from "./constants.js";
import { FLAT_GROUND, createSkateState, stepSkate } from "./controller.js";
import { findSnap, prepareGrindables, startGrind, stepGrind } from "./grind.js";

export function createSkater(level, { position, yaw } = {}) {
  const spawn = level?.spawn ?? { position: [0, 0, 0], yaw: 0 };
  const state = createSkateState({ position: position ?? spawn.position, yaw: yaw ?? spawn.yaw });
  return { ...state, grind: null, grindCooldown: 0, grindHeld: false, justSnapped: false, justFell: false, justExited: false, exitReason: null, stats: { snaps: 0, falls: 0, exits: 0, grindTime: 0, respawns: 0 } };
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
    if ((wantsGrind || grindEdge) && s.grindCooldown <= 0 && grindables.length) {
      const snap = findSnap(grindables, s, k.grind);
      if (snap) {
        s = startGrind(s, snap, lean, k.grind);
        s.tick = prev.tick + 1;
        stats.snaps += 1;
      }
    }
  }
  s.grindHeld = wantsGrind;
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
