import { describe, expect, it } from "vitest";
import { SESSIONS, comboMetrics, fpsMetrics } from "./sessions.js";
import { createRun, runScriptOnRun } from "../sim/skate/run.js";
import { createSkaterEnv } from "../sim/skate/skater.js";
import { GREYBOX } from "../level/greybox.js";
import { createGroundSampler } from "../level/ground.js";

const env = { sampleGround: createGroundSampler(GREYBOX) };
const skaterEnv = createSkaterEnv(GREYBOX);

// Replays a session through the pure run layer and builds the same event
// list the game loop records.
function play(session) {
  const { run, states } = runScriptOnRun(createRun(GREYBOX, session.start), session.script, { env, skaterEnv, trace: true });
  const events = [];
  let lastBanked = 0;
  for (const r of states) {
    for (const m of r.moves) events.push({ tick: r.tick, type: "move", name: m.name });
    if (r.skater.justFell) events.push({ tick: r.tick, type: "bail" });
    if (!r.combo.active && r.combo.lastBanked && r.combo.score !== lastBanked) {
      events.push({ tick: r.tick, type: "bank" });
      lastBanked = r.combo.score;
    }
  }
  return { run, events };
}

describe("playtest sessions", () => {
  it("has three sessions with scripts", () => {
    expect(SESSIONS).toHaveLength(3);
    for (const s of SESSIONS) expect(s.script.reduce((n, e) => n + e.frames, 0)).toBeGreaterThan(300);
  });

  it("lap: no falls, no rails, no wall hits", () => {
    const s = SESSIONS[0];
    const { run } = play(s);
    expect(run.skater.stats.falls).toBe(0);
    expect(run.skater.stats.snaps).toBe(0);
  });

  it("rails: at least one fall and two snaps", () => {
    const { run } = play(SESSIONS[1]);
    expect(run.skater.stats.falls).toBeGreaterThanOrEqual(1);
    expect(run.skater.stats.snaps).toBeGreaterThanOrEqual(2);
  });

  it("combo: a 3-link combo and a vert air", () => {
    const { run, events } = play(SESSIONS[2]);
    const m = comboMetrics(events);
    expect(m.maxCombo).toBeGreaterThanOrEqual(3);
    expect(m.timeToFirstThreeLinkSec).toBeGreaterThan(0);
    expect(m.vertAirs).toBeGreaterThanOrEqual(1);
    expect(run.combo.score).toBeGreaterThan(0);
  });
});

describe("metrics", () => {
  it("counts combos, max links, and time to the first 3-link combo", () => {
    const events = [
      { type: "move", tick: 60 },
      { type: "move", tick: 120 },
      { type: "bail", tick: 130 },
      { type: "move", tick: 200 },
      { type: "move", tick: 260 },
      { type: "move", tick: 300, name: "Vert Air" },
      { type: "bank", tick: 360 },
      { type: "move", tick: 400 },
      { type: "bank", tick: 460 },
    ];
    expect(comboMetrics(events)).toEqual({ comboCount: 2, maxCombo: 3, timeToFirstThreeLinkSec: 5, vertAirs: 1 });
    expect(comboMetrics([]).timeToFirstThreeLinkSec).toBeNull();
  });

  it("derives median, average, and 5th percentile FPS from frame times", () => {
    const f = fpsMetrics([16.7, 16.7, 16.7, 33.3, 16.7]);
    expect(f.frames).toBe(5);
    expect(f.medianFps).toBeCloseTo(59.9, 0);
    expect(f.p5Fps).toBeCloseTo(30, 0);
    expect(fpsMetrics([]).medianFps).toBe(0);
  });
});
