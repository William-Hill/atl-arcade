// A new player who follows the grind pin of the teach prompts (#76), in the
// pure simulation with the level, env and skater of the page. From the spawn
// the player steers to the point the pin shows (src/ui/teach-steps.js
// teachTarget), lines up with the feature, holds grind, jumps off the end,
// and spins after the landing, so the combo has 3 links.
// The spec plays the script in the page with window.__atl.runScript.

import { BALANCE, at, park, startAt, uv } from "./skatepark-ride.js";
import { createCombo } from "../src/sim/skate/combo.js";
import { GRIND, TRICK } from "../src/sim/skate/constants.js";
import { simTricks } from "../src/input/trick-constants.js";
import { yawFromHeading } from "../src/sim/skate/controller.js";
import { stepRun } from "../src/sim/skate/run.js";
import { createSkater } from "../src/sim/skate/skater.js";
import { createCardState } from "../src/sim/fact-cards.js";
import { TEACH_SPOTS, teachTarget } from "../src/ui/teach-steps.js";

const wrap = (y) => Math.atan2(Math.sin(y), Math.cos(y));

function compress(inputs) {
  const script = [];
  for (const input of inputs) {
    const key = JSON.stringify(input);
    if (script.length && JSON.stringify(script[script.length - 1].input) === key) script[script.length - 1].frames += 1;
    else script.push({ frames: 1, input });
  }
  return script;
}

// Returns { script, start, target, snapAt, links, ticks }. The ride starts
// at the spawn; with `approach` (m) it starts at rest that far before the
// lead point, on the line from the spawn (a short ride for a slow browser).
export function pinRide({ maxFrames = 60 * 40, approach = null } = {}) {
  const { level, env, skaterEnv } = park();
  let start = { position: [...level.spawn.position], yaw: level.spawn.yaw };
  const target = teachTarget(skaterEnv.grindables, start.position, TEACH_SPOTS[level.name]);
  if (!target) throw new Error("teach-ride: no target");
  const g = skaterEnv.grindables.find((x) => x.id === target.id);
  const a = g.points[0];
  const b = g.points[g.points.length - 1];
  const da = Math.hypot(a[0] - start.position[0], a[2] - start.position[2]);
  const db = Math.hypot(b[0] - start.position[0], b[2] - start.position[2]);
  const [near, far] = da < db ? [a, b] : [b, a];
  const len = Math.hypot(near[0] - far[0], near[2] - far[2]);
  const t = [(near[0] - far[0]) / len, (near[2] - far[2]) / len];
  // A lead point 8 m out on the line of the feature, then the far end.
  const lead = [near[0] + t[0] * 8, near[2] + t[1] * 8];
  if (approach !== null) {
    const dx = start.position[0] - lead[0];
    const dz = start.position[2] - lead[1];
    const d = Math.hypot(dx, dz);
    const x = lead[0] + (dx / d) * approach;
    const z = lead[1] + (dz / d) * approach;
    start = { position: [x, env.sampleGround(x, z).height, z], yaw: yawFromHeading(-dx, -dz) };
  }

  let run = { skater: createSkater(level, start), combo: createCombo(), tick: 0, time: 0, moves: [], lastMove: null, moveSeq: 0, banked: 0, cards: createCardState() };
  const inputs = [];
  let phase = "lead";
  let snapAt = null;
  let landed = 0;
  for (let i = 0; i < maxFrames; i += 1) {
    const s = run.skater;
    let input;
    if (s.state === "grind") {
      const left = s.grind.direction > 0 ? g.total - s.grind.s : s.grind.s;
      input = { grind: true, steer: BALANCE, ...(left < 0.35 ? { jump: true } : {}) };
    } else if (phase === "after") {
      // After the rail: roll, then spin (the short dance) once on the ground.
      if (s.state === "rolling") landed += 1;
      input = { push: s.speed < 4, ...(landed > 2 && landed < 8 ? { style2: true } : {}) };
    } else {
      const aim = phase === "lead" ? lead : [far[0], far[2]];
      const dx = aim[0] - s.position[0];
      const dz = aim[1] - s.position[2];
      if (phase === "lead" && Math.hypot(dx, dz) < 2) phase = "rail";
      const err = wrap(yawFromHeading(dx, dz) - s.yaw);
      input = { steer: Math.max(-1, Math.min(1, err * 2)), push: s.speed < 7, ...(phase === "rail" ? { grind: true } : {}) };
    }
    run = stepRun(run, input, 1 / 60, env, skaterEnv);
    inputs.push(input);
    if (run.skater.justSnapped && snapAt === null) snapAt = i + 1;
    if (snapAt !== null && run.skater.state !== "grind" && phase !== "after") phase = "after";
    if (run.combo.links.length >= 3 || (phase === "after" && landed > 240)) break;
  }
  for (let i = 0; i < 30; i += 1) inputs.push({});
  return { script: compress(inputs), start, target, snapAt, links: run.combo.links.map((l) => l.name), ticks: inputs.length };
}

// The ride of the 3 trick steps of #331 in the skatepark, heading +u: the
// 9 m flat bar with a flick at the GRIND press (the stance step; "l" gives a
// Soul Grind), GRIND held off the bar end (the grind-to-manual link, R8), the
// manual balanced with the W/S input (F1) out of the rail lane, and a JUMP
// out of the manual (the link step). The landing adds the air link, so the
// combo has 3 or more links (the combo tip).
// Returns { script, start, links, stance, manualFrom, launch, ticks }.
export function linkRide({ stance = "l", startU = -22, manualTicks = 24, maxFrames = 60 * 12 } = {}) {
  const { level, env, skaterEnv: base } = park();
  // The trick rules on, as in the game (src/main.js).
  const skaterEnv = { ...base, tricks: simTricks({}) };
  const start = startAt(startU, -3.5, 1, 0);
  let run = { skater: createSkater(level, start), combo: createCombo(), tick: 0, time: 0, moves: [], lastMove: null, moveSeq: 0, banked: 0, cards: createCardState() };
  const inputs = [];
  let phase = "rail";
  let pressed = false;
  let stanceOut = null;
  let manualFrom = null;
  let manualAge = 0;
  let launch = null;
  let landed = 0;
  const steerTo = (s, p) => {
    const err = wrap(yawFromHeading(p[0] - s.position[0], p[1] - s.position[2]) - s.yaw);
    return Math.max(-1, Math.min(1, err * 4));
  };
  for (let i = 0; i < maxFrames; i += 1) {
    const s = run.skater;
    const [u] = uv(s.position[0], s.position[2]);
    let input;
    if (s.state === "grind") {
      // Hold GRIND to the bar end, with no jump. The steer that pulls the
      // rail balance back to 0 (grind.js).
      const b = s.grind.balance;
      input = { grind: true, steer: Math.max(-1, Math.min(1, (GRIND.balanceDrift * s.grind.lean + GRIND.balanceGravity * b) / GRIND.balanceCorrect + 2 * b)) };
    } else if (s.manual) {
      // F1: m_next = m + dt * (side * d + g * m - c * s). The balance s that
      // pulls m back to 0. Out of the rail lane, away from the line ledge.
      const m = s.manual;
      const balance = Math.max(-1, Math.min(1, (m.side * TRICK.manualDrift + TRICK.manualGravity * m.balance) / TRICK.manualCorrect + 2 * m.balance));
      manualAge += 1;
      input = manualAge >= manualTicks ? { jump: true } : { grind: true, balance, steer: steerTo(s, at(2, -0.5)) };
    } else if (phase === "rail") {
      // Push along the rail lane; GRIND with the flick near the bar.
      input = { steer: steerTo(s, at(-4, -3.5)), push: s.speed < 7 };
      if (u > -14.2) {
        input = { ...input, push: false, grind: true, ...(pressed ? {} : { flick: { grind: stance } }) };
        pressed = true;
      }
    } else if (phase === "off") {
      // Off the bar end: GRIND held with no release through the air.
      input = { grind: true };
    } else {
      // After the jump: no input to the landing and a short roll.
      if (s.state === "rolling") landed += 1;
      input = {};
    }
    const before = s;
    run = stepRun(run, input, 1 / 60, env, skaterEnv);
    inputs.push(input);
    const n = run.skater;
    if (n.justSnapped && stanceOut === null) stanceOut = n.grind.stance;
    if (n.manual && !before.manual && manualFrom === null) manualFrom = n.manual.link ? "link" : "press";
    if (before.manual && !n.manual && launch === null) {
      launch = { tick: i + 1, state: n.state, reason: n.manualEnd?.reason };
      phase = "after";
    }
    if (phase === "rail" && before.state === "grind" && n.state !== "grind") phase = "off";
    if (phase === "after" && landed > 20) break;
  }
  for (let i = 0; i < 30; i += 1) inputs.push({});
  return { script: compress(inputs), start, links: run.combo.links.map((l) => l.name), stance: stanceOut, manualFrom, launch, ticks: inputs.length };
}
