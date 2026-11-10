// The scripted rides of the skatepark test (e2e/skatepark.spec.js, #222), in
// the pure simulation: the same level, env and skater constants as the page.
// The combo line is planned here in a closed loop (the planner reads the
// skater state each tick), and the result is a plain input script that the
// page replays tick for tick.

import { readFileSync } from "node:fs";
import { createLevelEnv } from "../src/level/ground.js";
import { withCanopy } from "../src/level/levels.js";
import { padPoint, withSkatepark } from "../src/level/skatepark.js";
import { bodyFor, skateFor } from "../src/sim/skate/body.js";
import { createCombo } from "../src/sim/skate/combo.js";
import { GRIND } from "../src/sim/skate/constants.js";
import { yawFromHeading } from "../src/sim/skate/controller.js";
import { stepRun } from "../src/sim/skate/run.js";
import { createSkater, createSkaterEnv } from "../src/sim/skate/skater.js";
import { createCardState } from "../src/sim/fact-cards.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));

export const PARK = read("../levels/beltline-eastside/skatepark.json");
export const LANDMARKS = read("../levels/beltline-eastside/landmarks.json");
// The steer that holds the balance on a rail.
export const BALANCE = GRIND.balanceDrift / GRIND.balanceCorrect;

let made = null;
// The level as the page loads it, its env, and Nia's skater env.
export function park() {
  if (!made) {
    const level = withSkatepark(withCanopy(read("../levels/beltline-eastside/level.json"), read("../levels/beltline-eastside/canopy.json")), PARK, read("../assets/skate-features/features.json"));
    const env = createLevelEnv(level);
    const skaterEnv = createSkaterEnv(level, env.grindables);
    skaterEnv.skater = "nia";
    skaterEnv.skate = skateFor(bodyFor("nia"));
    made = { level, env, skaterEnv };
  }
  return made;
}

// A pad point [u, v] in level meters, and the yaw of a pad direction.
export const at = (u, v) => padPoint(PARK, u, v);
export function yawOf(du, dv) {
  const a = at(0, 0);
  const b = at(du, dv);
  return yawFromHeading(b[0] - a[0], b[1] - a[1]);
}
// A level point [x, z] in pad meters [u, v].
export function uv(x, z) {
  const [ax, az] = PARK.axis;
  const n = Math.hypot(ax, az);
  const dx = x - PARK.center[0];
  const dz = z - PARK.center[1];
  return [(dx * ax + dz * az) / n, (-dx * az + dz * ax) / n];
}

// The start of a ride: the pad point, on the ground, with a heading.
export function startAt(u, v, du, dv) {
  const { env } = park();
  const [x, z] = at(u, v);
  return { position: [x, env.sampleGround(x, z).height, z], yaw: yawOf(du, dv) };
}

function newRun(start) {
  const { level } = park();
  return { skater: createSkater(level, start), combo: createCombo(), tick: 0, time: 0, moves: [], lastMove: null, moveSeq: 0, banked: 0, cards: createCardState() };
}

// Replays a script in the pure simulation. Returns the end state, the moves,
// the banked combos (with the place of their last link), the ground ids the
// skater rolled on, the lowest gap between the feet and the ground, and the
// top height over the pad.
export function simulate(script, start) {
  const { level, env, skaterEnv } = park();
  let run = newRun(start);
  const out = { moves: [], banks: [], grounds: new Set(), snaps: [], minGap: Infinity, top: -Infinity, respawns: 0, falls: 0, bonks: 0 };
  let last = null;
  for (const entry of script) {
    for (let i = 0; i < entry.frames; i += 1) {
      run = stepRun(run, entry.input ?? {}, 1 / 60, env, skaterEnv);
      const s = run.skater;
      const g = env.sampleGround(s.position[0], s.position[2], s.position[1]);
      if (s.state !== "grind") out.minGap = Math.min(out.minGap, g ? s.position[1] - g.height : -Infinity);
      out.top = Math.max(out.top, s.position[1] - level.skatepark.top);
      if (s.state === "rolling" && s.groundId) out.grounds.add(s.groundId);
      if (s.justSnapped) out.snaps.push(s.grind.id);
      if (s.respawned) out.respawns += 1;
      if (s.justFell) out.falls += 1;
      if (s.bonked) out.bonks += 1;
      for (const m of run.moves) {
        out.moves.push({ tick: run.tick, name: m.name, points: m.points });
        last = [s.position[0], s.position[2]];
      }
      if (run.banked) out.banks.push({ tick: run.tick, points: run.banked, lastLink: last });
    }
  }
  return { ...out, grounds: [...out.grounds], end: run.skater, score: run.combo.score };
}

// The combo line of the park, heading +u along the rail lane (v = -3.5):
// push in from the west, grind the 9 m flat bar, jump to the 6 m ledge, jump
// to the short round rail, ride it off its end, and roll until the combo
// banks. The planner presses grind when the next feature is in reach and
// jumps just before a rail ends.
export function comboLine({ startU = -32, lane = -3.5, frames = 460 } = {}) {
  const { env, skaterEnv } = park();
  const start = startAt(startU, lane, 1, 0);
  // The pad u where the grind press for each feature starts.
  const pressAt = [-14.2, 0, 8.9];
  let run = newRun(start);
  const inputs = [];
  let grinds = 0;
  for (let t = 0; t < frames; t += 1) {
    const s = run.skater;
    const [u] = uv(s.position[0], s.position[2]);
    let input = {};
    if (s.state === "grind") {
      const g = skaterEnv.grindables.find((x) => x.id === s.grind.id);
      const left = s.grind.direction > 0 ? g.total - s.grind.s : s.grind.s;
      input = { grind: true, steer: BALANCE, ...(left < 0.35 && grinds < 3 ? { jump: true } : {}) };
    } else if (grinds < 3 && u > pressAt[grinds]) input = { grind: true, steer: BALANCE };
    else if (grinds === 0) input = { push: true };
    run = stepRun(run, input, 1 / 60, env, skaterEnv);
    inputs.push(input);
    if (run.skater.justSnapped) grinds += 1;
    if (run.banked) break;
  }
  // A short roll after the bank, so the page shows the banked score.
  for (let i = 0; i < 30; i += 1) inputs.push({});
  const script = [];
  for (const input of inputs) {
    const key = JSON.stringify(input);
    if (script.length && JSON.stringify(script[script.length - 1].input) === key) script[script.length - 1].frames += 1;
    else script.push({ frames: 1, input });
  }
  return { script, start };
}

// The ramp rides: [name, script, start].
export function rampRides() {
  return {
    // The lane v = 3 heading +u: over the pyramid, over the manual pad, up
    // the quarter pipe, and back down.
    pyramidAndQuarter: { script: [{ frames: 150, input: { push: true } }, { frames: 100, input: {} }], start: startAt(-11, 3, 1, 0) },
    // The kicker at v = 0: a launch and a landing on the pad.
    kicker: { script: [{ frames: 70, input: { push: true } }, { frames: 50, input: {} }], start: startAt(-14, 0, 1, 0) },
    // The bank at the west end, heading -u: up the face and back.
    bank: { script: [{ frames: 70, input: { push: true } }, { frames: 110, input: {} }], start: startAt(-4, 3, -1, 0) },
  };
}
