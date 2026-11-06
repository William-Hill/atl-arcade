import { describe, expect, it } from "vitest";
import { checkGoalDef, computeResults, createGoals, formatClock, goalsJson, inZone, RUN_TIME, stepGoals } from "./goals.js";
import { createCombo, comboBank, comboMove } from "./combo.js";
import { LEVEL_GOALS, goalsFor } from "../../level/goals.js";
import { LEVELS } from "../../level/levels.js";
import { GREYBOX } from "../../level/greybox.js";
import BELTLINE from "../../../levels/beltline-eastside/level.json";
import { createLevelEnv } from "../../level/ground.js";
import { createSkaterEnv } from "./skater.js";
import { createRun, stepRun } from "./run.js";

const DT = 1 / 60;

const DEF = {
  level: "test",
  time: 10,
  overtime: 2,
  goals: [
    { id: "score", type: "score", target: 1000, label: "Score 1,000" },
    { id: "combo", type: "combo", target: 500, label: "Combo 500" },
    { id: "cards", type: "cards", target: 3, label: "3 cards" },
    { id: "gap-a", type: "gap", label: "Gap A", zone: { x: 0, z: 0, r: 2 } },
    { id: "gap-b", type: "gap", label: "Gap B", zone: { x: 10, z: 0, r: 2 }, from: ["ramp"] },
    { id: "gap-c", type: "gap", label: "Gap C", zone: { x: 0, z: 20, r: 1 }, landing: { x: 5, z: 20, r: 2 } },
  ],
  medals: { bronze: 500, silver: 1000, gold: 2000 },
};

function skater(over = {}) {
  return { state: "ground", position: [50, 0, 50], airFrom: null, justLanded: false, justFell: false, respawned: false, ...over };
}

function run(s = skater(), combo = createCombo()) {
  return { skater: s, combo };
}

// Steps the goals over a list of [skater, frames] pairs.
function play(g, steps, def = DEF, combo = createCombo()) {
  let out = g;
  for (const [s, frames] of steps) for (let i = 0; i < frames; i += 1) out = stepGoals(out, run(s, combo), def, DT);
  return out;
}

describe("the run timer", () => {
  it("is 2:30 by default", () => {
    expect(RUN_TIME).toBe(150);
    expect(createGoals({ goals: [] }).timeLeft).toBe(150);
    expect(formatClock(150)).toBe("2:30");
    expect(formatClock(59.2)).toBe("1:00");
    expect(formatClock(9)).toBe("0:09");
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(-3)).toBe("0:00");
  });

  it("counts down in sim time and ends when the time is out", () => {
    let g = createGoals(DEF);
    g = play(g, [[skater(), 60 * 5]]);
    expect(g.timeLeft).toBeCloseTo(5, 5);
    expect(g.ended).toBe(false);
    g = play(g, [[skater(), 60 * 5 + 1]]);
    expect(g.timeLeft).toBe(0);
    expect(g.ended).toBe(true);
  });

  it("lets an open combo finish, up to the overtime", () => {
    const open = comboMove(createCombo(), { move: "grind", name: "Rail Grind", points: 200 });
    let g = createGoals(DEF);
    g = play(g, [[skater({ state: "grind" }), 60 * 11]], DEF, open);
    expect(g.timeLeft).toBe(0);
    expect(g.ended).toBe(false);
    // The combo banks: the run ends on the next tick.
    const banked = comboBank(open);
    g = stepGoals(g, run(skater(), banked), DEF, DT);
    expect(g.ended).toBe(true);
    expect(g.score).toBe(200);
    // A combo that never closes ends at time + overtime.
    let h = play(createGoals(DEF), [[skater({ state: "grind" }), 60 * 12 + 2]], DEF, open);
    expect(h.ended).toBe(true);
  });

  it("does not change after the end", () => {
    const g = play(createGoals(DEF), [[skater(), 60 * 11]]);
    const after = stepGoals(g, run(skater(), { ...createCombo(), score: 9999 }), DEF, DT);
    expect(after).toBe(g);
  });
});

describe("named gaps", () => {
  it("clears a gap on a landing after air inside the zone", () => {
    let g = createGoals(DEF);
    g = play(g, [
      [skater({ state: "air", airFrom: "jump", position: [-3, 1, 0] }), 10],
      [skater({ state: "air", airFrom: "jump", position: [0.5, 1, 0] }), 10],
      [skater({ state: "air", airFrom: "jump", position: [3, 1, 0] }), 10],
    ]);
    expect(g.gaps).toEqual([]);
    g = stepGoals(g, run(skater({ justLanded: true, position: [4, 0, 0] })), DEF, DT);
    expect(g.gaps).toEqual(["gap-a"]);
    expect(g.justCleared).toEqual(["gap-a"]);
    g = stepGoals(g, run(skater()), DEF, DT);
    expect(g.justCleared).toEqual([]);
  });

  it("does not clear a gap on a bail", () => {
    let g = play(createGoals(DEF), [[skater({ state: "air", airFrom: "jump", position: [0, 1, 0] }), 30]]);
    g = stepGoals(g, run(skater({ justLanded: true, justFell: true })), DEF, DT);
    expect(g.gaps).toEqual([]);
  });

  it("does not clear a gap for a short hop under the minimum air time", () => {
    let g = play(createGoals(DEF), [[skater({ state: "air", airFrom: "jump", position: [0, 1, 0] }), 5]]);
    g = stepGoals(g, run(skater({ justLanded: true })), DEF, DT);
    expect(g.gaps).toEqual([]);
  });

  it("does not clear a gap when the skater rolls through the zone", () => {
    const g = play(createGoals(DEF), [[skater({ position: [0, 0, 0] }), 30], [skater({ justLanded: true, position: [0, 0, 0] }), 1]]);
    expect(g.gaps).toEqual([]);
  });

  it("checks the take-off kind", () => {
    let g = play(createGoals(DEF), [[skater({ state: "air", airFrom: "jump", position: [10, 2, 0] }), 30]]);
    g = stepGoals(g, run(skater({ justLanded: true })), DEF, DT);
    expect(g.gaps).toEqual([]);
    g = play(g, [[skater({ state: "air", airFrom: "ramp", position: [10, 2, 0] }), 30]]);
    g = stepGoals(g, run(skater({ justLanded: true })), DEF, DT);
    expect(g.gaps).toEqual(["gap-b"]);
  });

  it("keeps the air through a grind from the air", () => {
    let g = play(createGoals(DEF), [
      [skater({ state: "air", airFrom: "jump", position: [0, 1, 0] }), 20],
      [skater({ state: "grind", position: [5, 1, 0] }), 30],
      [skater({ state: "air", airFrom: "grind", position: [7, 1, 0] }), 10],
    ]);
    g = stepGoals(g, run(skater({ justLanded: true })), DEF, DT);
    expect(g.gaps).toEqual(["gap-a"]);
  });

  it("counts each gap once", () => {
    const hop = [[skater({ state: "air", airFrom: "jump", position: [0, 1, 0] }), 30], [skater({ justLanded: true }), 1]];
    const g = play(createGoals(DEF), [...hop, ...hop]);
    expect(g.gaps).toEqual(["gap-a"]);
  });

  it("checks the landing zone", () => {
    const over = [skater({ state: "air", airFrom: "jump", position: [0, 1, 20] }), 30];
    let g = play(createGoals(DEF), [over, [skater({ justLanded: true, position: [1.5, 0, 20] }), 1]]);
    expect(g.gaps).toEqual([]);
    g = play(g, [over, [skater({ justLanded: true, position: [5, 0, 20] }), 1]]);
    expect(g.gaps).toEqual(["gap-c"]);
  });

  it("uses a circle zone in x and z", () => {
    expect(inZone({ x: 0, z: 0, r: 2 }, [1.9, 50, 0])).toBe(true);
    expect(inZone({ x: 0, z: 0, r: 2 }, [1.5, 0, 1.5])).toBe(false);
  });
});

describe("the results", () => {
  it("reads the score, the best combo and the fact cards from the run", () => {
    const combo = { ...createCombo(), score: 1200, best: 600 };
    const g = stepGoals(createGoals(DEF), run(skater(), combo), DEF, DT, { cards: 2 });
    const json = goalsJson(g, DEF);
    expect(json).toEqual({ level: "test", time: 0.02, ended: false, score: 1200, bestCombo: 600, cards: 2, gaps: [] });
    const r = computeResults(json, DEF);
    expect(r.goals.map((x) => [x.id, x.done])).toEqual([
      ["score", true],
      ["combo", true],
      ["cards", false],
      ["gap-a", false],
      ["gap-b", false],
      ["gap-c", false],
    ]);
    expect(r.completed).toBe(2);
    expect(r.total).toBe(6);
  });

  it("gives the medal from the score", () => {
    const at = (score) => computeResults({ level: "test", score, bestCombo: 0, cards: 0, gaps: [] }, DEF);
    expect(at(0).medal).toBe(null);
    expect(at(0).next).toEqual({ medal: "bronze", score: 500 });
    expect(at(500).medal).toBe("bronze");
    expect(at(1999).medal).toBe("silver");
    expect(at(1999).next).toEqual({ medal: "gold", score: 2000 });
    expect(at(2000).medal).toBe("gold");
    expect(at(2000).next).toBe(null);
  });

  it("gives the same results from the JSON after a round trip", () => {
    const json = { level: "test", time: 150, ended: true, score: 1500, bestCombo: 700, cards: 3, gaps: ["gap-b"] };
    const r = computeResults(JSON.parse(JSON.stringify(json)), DEF);
    expect(r.medal).toBe("silver");
    expect(r.completed).toBe(4);
  });
});

// The real controller on the greybox: each gap clears with a plain line of
// input, so a player can reach it.
describe("the greybox gaps with the real controller", () => {
  const env = createLevelEnv(GREYBOX);
  const skaterEnv = createSkaterEnv(GREYBOX);
  const def = goalsFor("greybox");
  function ride(start, script) {
    let r = createRun(GREYBOX, start);
    let g = createGoals(def);
    for (const e of script) for (let i = 0; i < e.frames; i += 1) {
      r = stepRun(r, e.input, DT, env, skaterEnv);
      g = stepGoals(g, r, def, DT);
    }
    return g;
  }
  const stairs = (pushFrames) => [{ frames: pushFrames, input: { push: true } }, { frames: 1, input: { push: true, jump: true } }, { frames: 120, input: {} }];

  it("clears the Plaza Stair Gap with a hop from the plaza to the sidewalk", () => {
    expect(ride({ position: [-30, 1, 10], yaw: 0 }, stairs(80)).gaps).toEqual(["gap-plaza-stairs"]);
  });

  it("does not clear the Plaza Stair Gap for a hop that lands on the plaza or the stairs", () => {
    expect(ride({ position: [-30, 1, 10], yaw: 0 }, stairs(65)).gaps).toEqual([]);
    expect(ride({ position: [-30, 1, 10], yaw: 0 }, stairs(75)).gaps).toEqual([]);
  });

  it("clears the Quarter Pipe Air with air off the lip", () => {
    expect(ride({ position: [8, 0, 0], yaw: 0 }, [{ frames: 150, input: { push: true } }, { frames: 300, input: {} }]).gaps).toEqual(["gap-quarter-pipe"]);
  });
});

// The Beltline gaps: a hop on the trail under each bridge. The skater rides
// the trail south to north (-z) at x 336.
describe("the Beltline gaps with the real controller", () => {
  const env = createLevelEnv(BELTLINE);
  const skaterEnv = createSkaterEnv(BELTLINE);
  const def = goalsFor("beltline-eastside");
  function hop(z, pushFrames) {
    // The trail height, under the bridge decks (26.5 m is over the trail, under the decks).
    const y = env.sampleGround(336, z, 26.5).height;
    let r = createRun(BELTLINE, { position: [336, y, z], yaw: Math.PI / 2 });
    let g = createGoals(def);
    const script = [{ frames: pushFrames, input: { push: true } }, { frames: 1, input: { push: true, jump: true } }, { frames: 90, input: {} }];
    for (const e of script) for (let i = 0; i < e.frames; i += 1) {
      r = stepRun(r, e.input, DT, env, skaterEnv);
      g = stepGoals(g, r, def, DT);
    }
    return g.gaps;
  }

  it("clears the Freedom Parkway Underpass Hop under the parkway bridges", () => {
    expect(hop(40, 90)).toEqual(["gap-freedom-parkway"]);
  });

  it("clears the Stone Mountain Trail Bridge Hop under that bridge", () => {
    expect(hop(62, 45)).toEqual(["gap-stone-mountain"]);
  });

  it("does not clear a gap for a hop away from the bridges", () => {
    expect(hop(0, 45)).toEqual([]);
  });
});

describe("the level goal data", () => {
  it("has a valid goal list for every level", () => {
    for (const name of Object.keys(LEVELS)) {
      const def = goalsFor(name);
      expect(def, name).not.toBe(null);
      expect(checkGoalDef(def), name).toEqual([]);
      expect(def.time, name).toBe(150);
    }
    expect(goalsFor("constructor")).toBe(null);
  });

  it("has a score target, a combo target, 3 fact cards and 2 named gaps per level", () => {
    for (const [name, def] of Object.entries(LEVEL_GOALS)) {
      const types = def.goals.map((g) => g.type).sort();
      expect(types, name).toEqual(["cards", "combo", "gap", "gap", "score"]);
      expect(def.goals.find((g) => g.type === "cards").target, name).toBe(3);
    }
  });

  it("finds problems in a bad goal list", () => {
    expect(checkGoalDef({ time: 0, goals: [{ id: "a", type: "gap" }, { id: "a", type: "x", label: "x", target: 1 }], medals: {} })).toEqual([
      "time must be more than 0",
      'goal "a" has no label',
      'gap "a" has no valid zone',
      'duplicate goal id "a"',
      'goal "a" has unknown type "x"',
      "medals must be bronze < silver < gold",
    ]);
  });
});
