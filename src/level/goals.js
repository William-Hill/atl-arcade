// The goal list of each level (M1-05): data, read by src/sim/skate/goals.js.
// A geodata level keeps its goals in levels/<name>/goals.json, next to the
// built level.json (the level build does not write that file).

import beltline from "../../levels/beltline-eastside/goals.json" with { type: "json" };
import { RUN_TIME } from "../sim/skate/goals.js";

export const GREYBOX_GOALS = {
  level: "greybox",
  time: RUN_TIME,
  overtime: 10,
  goals: [
    { id: "score", type: "score", target: 10000, label: "Score 10,000 points" },
    { id: "combo", type: "combo", target: 1500, label: "Land a 1,500 point combo" },
    { id: "cards", type: "cards", target: 3, label: "Collect 3 fact cards" },
    // Over the four plaza stairs (src/level/greybox.js, x -22 to -20.4), from
    // the plaza to the sidewalk past the last stair.
    { id: "gap-plaza-stairs", type: "gap", label: "Plaza Stair Gap", zone: { x: -21.2, z: 10, r: 1.2 }, landing: { x: -18, z: 10, r: 2.5 } },
    // Air off the quarter pipe at x 26.
    { id: "gap-quarter-pipe", type: "gap", label: "Quarter Pipe Air", zone: { x: 25, z: 0, r: 6 }, from: ["ramp"] },
  ],
  medals: { bronze: 5000, silver: 10000, gold: 20000 },
};

export const LEVEL_GOALS = {
  greybox: GREYBOX_GOALS,
  "beltline-eastside": beltline,
};

// `name` is a resolved level name (src/level/levels.js). Null for a level
// with no goals: that level is free skate.
export function goalsFor(name) {
  return Object.hasOwn(LEVEL_GOALS, name) ? LEVEL_GOALS[name] : null;
}
