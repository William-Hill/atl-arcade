// A new player who follows the grind pin of the teach prompts (#76), in the
// pure simulation with the level, env and skater of the page. From the spawn
// the player steers to the point the pin shows (src/ui/teach-steps.js
// teachTarget), lines up with the feature, holds grind, jumps off the end,
// and spins after the landing, so the combo has 3 links.
// The spec plays the script in the page with window.__atl.runScript.

import { park } from "./skatepark-ride.js";
import { BALANCE } from "./skatepark-ride.js";
import { createCombo } from "../src/sim/skate/combo.js";
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
