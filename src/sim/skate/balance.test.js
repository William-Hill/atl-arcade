// Balance test (#75). It replays the three degenerate inputs from the
// fun-gameplay audit (production/audits/2026-11-playability/fun-gameplay/
// balance-sim.json) for 120 s on flat ground and checks a score ceiling.
// Before #75 these inputs held 1,470,150, 3,432,120 and 1,462,050 points.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMBO, STYLE, styleDuration } from "./constants.js";
import { createRun, stepRun } from "./run.js";
import { FLAT_GROUND } from "./controller.js";
import { comboMove, comboValue, createCombo } from "./combo.js";

const DT = 1 / 60;
const SECONDS = 120;
const level = { spawn: { position: [0, 0, 0], yaw: 0 } };

// The audit inputs, frame by frame (60 Hz). Same as scripts/balance-sim.mjs.
const INPUTS = {
  // Push 1 s, then hold push and Q (one press, held) for 119 s.
  holdQLate: (i) => ({ push: true, style1: i >= 60 }),
  // Push, and alternate Q and E each 1.2 s.
  altQE: (i) => ({ push: true, style1: Math.floor(i / 72) % 2 === 0, style2: Math.floor(i / 72) % 2 === 1 }),
  // Push, and tap jump every 0.7 s.
  hops: (i) => ({ push: true, jump: i % 42 < 2 }),
};

// balance-sim.json holds two JSON documents, one after the other.
const SIM = readFileSync(new URL("../../../production/audits/2026-11-playability/fun-gameplay/balance-sim.json", import.meta.url), "utf8");
const OLD = Object.assign({}, ...SIM.split(/\n(?=\{)/).map((doc) => JSON.parse(doc)));

// The banked score plus the value of the open combo after 120 s.
function play(input) {
  let run = createRun(level);
  let peakMultiplier = 1;
  for (let i = 0; i < SECONDS * 60; i += 1) {
    run = stepRun(run, input(i), DT, FLAT_GROUND, { grindables: [] }, null);
    peakMultiplier = Math.max(peakMultiplier, run.combo.multiplier);
  }
  return { total: run.combo.score + comboValue(run.combo), links: run.combo.links.length, peakMultiplier };
}

// The ceiling for 120 s of one degenerate input. The old values were more
// than 1,400,000. After #75: holdQLate 789, altQE 21,380, hops 264.
const CEILING = 25_000;

describe("score ceiling for degenerate inputs (#75)", () => {
  for (const [id, input] of Object.entries(INPUTS)) {
    it(`${id} for ${SECONDS} s stays under ${CEILING.toLocaleString("en-US")} points`, () => {
      const old = OLD[id].score + OLD[id].pendingValue;
      expect(old).toBeGreaterThan(1_000_000);
      const r = play(input);
      expect(r.links).toBeGreaterThan(0);
      expect(r.peakMultiplier).toBeLessThanOrEqual(COMBO.maxMultiplier);
      expect(r.total).toBeLessThan(CEILING);
    });
  }
});

describe("repeat decay", () => {
  it("earns 100 %, 50 %, 25 %, then 0 for the same move name in one combo", () => {
    const hop = { move: "air", name: "Hop", points: 100 };
    let c = createCombo();
    const earned = [];
    for (let i = 0; i < 5; i += 1) {
      c = comboMove(c, hop);
      earned.push(c.links[i].points);
    }
    expect(earned).toEqual([100, 50, 25, 0, 0]);
    expect(c.multiplier).toBe(3);
  });

  it("adds no multiplier link when the decayed points round to 0", () => {
    const k = { ...COMBO, repeatDecay: [1, 0.001] };
    const tick = { move: "air", name: "Tick", points: 50 };
    const c = comboMove(comboMove(createCombo(), tick, k), tick, k);
    expect(c.links[1].points).toBe(0);
    expect(c.multiplier).toBe(1);
  });

  it("resets in a new combo", () => {
    const hop = { move: "air", name: "Hop", points: 100 };
    const a = comboMove(comboMove(createCombo(), hop), hop);
    const b = comboMove({ ...createCombo(), score: 999 }, hop);
    expect(a.links[1].points).toBe(50);
    expect(b.links[0].points).toBe(100);
  });
});

describe("multiplier cap", () => {
  it("stops at maxMultiplier", () => {
    let c = createCombo();
    for (let i = 0; i < 20; i += 1) c = comboMove(c, { move: "air", name: `Move ${i}`, points: 10 });
    expect(c.links).toHaveLength(20);
    expect(c.multiplier).toBe(COMBO.maxMultiplier);
  });
});

describe("move balance", () => {
  it("a grind earns more per second than any dance, for any grind length", () => {
    const best = Math.max(...STYLE.moves.map((m) => m.points / styleDuration(m)));
    for (const t of [0.5, 1, 2, 3, 5, 10]) {
      const grind = (COMBO.grindBase + COMBO.grindPerSecond * t) / t;
      expect(grind).toBeGreaterThan(best);
    }
    expect(COMBO.grindPerSecond).toBeGreaterThan(best);
  });
});
