// Balance check for the combo system. Runs the pure run layer in node.
// Usage: node production/audits/2026-11-playability/fun-gameplay/scripts/balance-sim.mjs
// It reads src/ and writes nothing.

import { createRun, stepRun } from "../../../../../src/sim/skate/run.js";
import { FLAT_GROUND } from "../../../../../src/sim/skate/controller.js";
import { COMBO, STYLE, styleDuration } from "../../../../../src/sim/skate/constants.js";

const dt = 1 / 60;
const level = { spawn: { position: [0, 0, 0], yaw: 0 } };

function play(seconds, inputAt) {
  let run = createRun(level);
  let firstBank = null;
  let maxLinks = 0;
  for (let i = 0; i < seconds * 60; i += 1) {
    run = stepRun(run, inputAt(i), dt, FLAT_GROUND, { grindables: [] }, null);
    maxLinks = Math.max(maxLinks, run.combo.links.length);
    if (run.banked && firstBank === null) firstBank = { t: (i / 60).toFixed(1), points: run.banked };
  }
  return { score: run.combo.score, pendingValue: run.combo.pending * run.combo.multiplier, links: run.combo.links.length, maxLinks, best: run.combo.best, firstBank, style: run.combo.style, speed: run.skater.speed.toFixed(2) };
}

// A: hold push and style1 (Q) for 120 s. Never touch a rail.
const holdQ = play(120, () => ({ push: true, style1: true }));
// B: hold push for 2 s, then hold Q only (no push): how long does the combo live?
const coastQ = play(30, (i) => (i < 120 ? { push: true } : { style1: true }));
// C: alternate Q and E each 1.2 s while pushing.
const altQE = play(120, (i) => ({ push: true, style1: Math.floor(i / 72) % 2 === 0, style2: Math.floor(i / 72) % 2 === 1 }));
// D: hop spam: push and tap jump every 0.7 s.
const hops = play(120, (i) => ({ push: true, jump: i % 42 < 2 }));

const per = STYLE.moves.map((m) => ({ id: m.id, seconds: styleDuration(m).toFixed(2), points: m.points, pointsPerSecond: Math.round(m.points / styleDuration(m)) }));
const grind = { oneSecond: COMBO.grindBase + COMBO.grindPerSecond, threeSeconds: COMBO.grindBase + 3 * COMBO.grindPerSecond };

// Quadratic growth: n links of p points bank n * n * p.
const curve = [3, 5, 10, 20, 50, 100].map((n) => ({ links: n, bankAt150: n * n * 150 }));

console.log(JSON.stringify({ per, grind, hopPoints: COMBO.hopPoints, curve, holdQ, coastQ, altQE, hops }, null, 2));

// E: push 1 s, then hold push and Q (one press, held) for 119 s.
const holdQLate = play(120, (i) => ({ push: true, style1: i >= 60 }));
console.log(JSON.stringify({ holdQLate }, null, 2));
