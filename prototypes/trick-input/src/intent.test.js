import { describe, expect, it } from "vitest";
import { createIntentLog, feed, intend, intentMetrics, restartClock, setConfig } from "./intent.js";
import { createInput } from "./input.js";
import { key, run, T, tap } from "./harness.js";
import { createSim, place } from "./sim.js";

const trick = (t, dir, kind = "grab") => ({ type: "trick", kind, dir, t, name: "x", ...(kind === "dance" ? { button: "trick" } : {}) });
// One frame of input: the button flags and the direction history.
const fr = (t, o = {}) => ({ t, trick: false, spin: false, grind: false, dirHist: [], ...o });

describe("intent log (agent playtest)", () => {
  it("pairs an intention with the next press and its trick, and counts tricks as wanted", () => {
    const log = createIntentLog();
    intend(log, "l", 1.0);
    feed(log, fr(1.05, { trick: true }), [trick(1.05, "l")]);
    feed(log, fr(1.1), []);
    intend(log, "n", 2.0);
    feed(log, fr(2.05, { trick: true }), []);
    feed(log, fr(2.1), [trick(2.1, "u")]);
    const m = intentMetrics(log);
    expect(m.trials).toBe(2);
    expect(m.wantedShare).toBe(0.5);
  });
  it("a press with no trick is a failed trial in the denominator", () => {
    const log = createIntentLog();
    intend(log, "n", 1.0);
    feed(log, fr(1.0, { trick: true }), [{ type: "no-dance", t: 1.0 }]);
    feed(log, fr(1.2), []);
    intend(log, "l", 1.5);
    feed(log, fr(1.5, { trick: true }), [trick(1.5, "l")]);
    feed(log, fr(2.6), []);
    const m = intentMetrics(log);
    expect(m.trials).toBe(2);
    expect(m.noTrick).toBe(1);
    expect(m.wantedShare).toBe(0.5);
  });
  it("rejects a bad direction; an old intention or a press with no intention makes no trial", () => {
    const log = createIntentLog();
    expect(intend(log, "x", 0).error).toBeDefined();
    intend(log, "u", 0);
    feed(log, fr(3, { trick: true }), [trick(3, "u")]);
    expect(intentMetrics(log).trials).toBe(0);
    expect(intentMetrics(log).unpairedIntents).toBe(1);
  });
  it("reads the push and carve context from the press time, not the trick time", () => {
    const log = createIntentLog();
    // Q at 0.1667 with no fresh direction; W starts at 0.2000 and the dance comes out Up then.
    intend(log, "n", 0.15);
    feed(log, fr(0.1667, { trick: true }), []);
    feed(log, fr(0.2, { trick: true, dirHist: [{ dir: "u", at: 0.2, up: null }] }), [trick(0.2, "u", "dance")]);
    const m = intentMetrics(log);
    expect(m.rows[0]).toMatchObject({ pressAt: 0.1667, resultAt: 0.2, pushed: false });
    expect(m.pushTrials).toBe(0);
  });
  it("counts the push and carve leaks as the bots do", () => {
    const log = createIntentLog();
    // A neutral press with a W start 1 s before: it came out Up (a push leak).
    feed(log, fr(0, { dirHist: [{ dir: "u", at: 0, up: 0.1 }] }), []);
    intend(log, "n", 0.9);
    feed(log, fr(1.0, { trick: true }), [trick(1.0, "u")]);
    feed(log, fr(1.1), []);
    // A down press with a D start 0.1 s after it: it came out Right (a carve leak).
    intend(log, "d", 4.9);
    feed(log, fr(5.0, { trick: true, dirHist: [{ dir: "d", at: 4.95, up: null }] }), [trick(5.0, "r")]);
    feed(log, fr(5.1, { dirHist: [{ dir: "r", at: 5.1, up: null }] }), []);
    // An up press with a carve: in the carve count, and no leak.
    intend(log, "u", 9.85);
    feed(log, fr(10.0, { trick: true, dirHist: [{ dir: "l", at: 9.9, up: null }, { dir: "u", at: 9.95, up: null }] }), [trick(10.0, "u")]);
    const m = intentMetrics(log);
    expect(m.pushTrials).toBe(1);
    expect(m.unwantedUpFromPush).toBe(1);
    expect(m.carveTrials).toBe(2);
    expect(m.unwantedLRFromCarve).toBe(0.5);
  });
  it("a restart starts a new run: the old directions and intentions do not reach the new run", () => {
    const log = createIntentLog();
    feed(log, fr(0.5, { dirHist: [{ dir: "r", at: 0.5, up: null }] }), []);
    intend(log, "l", 0.6);
    restartClock(log, 0);
    // The new sim clock starts at 0 again: a neutral press at 0.6 with no carve in this run.
    intend(log, "n", 0.55);
    feed(log, fr(0.6, { trick: true }), [trick(0.6, "n")]);
    const m = intentMetrics(log);
    expect(m.trials).toBe(1);
    expect(m.rows[0]).toMatchObject({ intended: "n", carve: false, wanted: true });
    expect(m.carveTrials).toBe(0);
  });
  it("a restart closes a press with no trick as a failed trial", () => {
    const log = createIntentLog();
    intend(log, "d", 1);
    feed(log, fr(1, { trick: true }), []);
    restartClock(log, 0);
    expect(intentMetrics(log)).toMatchObject({ trials: 1, noTrick: 1, pendingPresses: 0 });
  });
  it("keeps the rule setting of each press, and counts one setting at a time", () => {
    const log = createIntentLog();
    setConfig(log, "axis");
    intend(log, "l", 1);
    feed(log, fr(1, { trick: true }), [trick(1, "l")]);
    restartClock(log, 0);
    setConfig(log, "gdd");
    intend(log, "l", 1);
    feed(log, fr(1, { trick: true }), [trick(1, "n")]);
    expect(intentMetrics(log)).toMatchObject({ config: "gdd", trials: 1, wantedShare: 0, byConfig: { axis: 1, gdd: 1 } });
    expect(intentMetrics(log, "axis")).toMatchObject({ config: "axis", trials: 1, wantedShare: 1 });
  });
  it("a stance change updates only the grind on the rail, not an older grind trial", () => {
    const log = createIntentLog();
    intend(log, "l", 1);
    feed(log, fr(1, { grind: true }), [trick(1.05, "l", "grind")]);
    feed(log, fr(2), []);
    // A later grind with no intention, then its stance change.
    feed(log, fr(5, { grind: true }), [trick(5, "n", "grind")]);
    feed(log, fr(5.1, { grind: true }), [{ type: "stance-change", dir: "u", t: 5.1 }]);
    expect(intentMetrics(log).rows[0].result).toBe("l");
    // A grind trial on the rail takes its own stance change.
    feed(log, fr(6), []);
    intend(log, "n", 7.9);
    feed(log, fr(8, { grind: true }), [trick(8, "n", "grind")]);
    feed(log, fr(8.1, { grind: true }), [{ type: "stance-change", dir: "d", t: 8.1 }]);
    expect(intentMetrics(log).rows[1].result).toBe("d");
  });
  it("times the first 3-link combo with a manual from the last restart", () => {
    const log = createIntentLog();
    restartClock(log, 10);
    feed(log, fr(20.5), [{ type: "bank", t: 12, links: 2, manual: true }, { type: "bank", t: 15, links: 3, manual: false }, { type: "bank", t: 20.5, links: 3, manual: true, names: ["a", "b", "c"], banked: 900 }]);
    expect(intentMetrics(log).firstCombo).toEqual({ seconds: 10.5, names: ["a", "b", "c"], banked: 900 });
  });
  it("works on the real sim and input: A then Q in the air is a wanted Japan Grab", () => {
    const log = createIntentLog();
    const s = createSim({ beat: false });
    const inp = createInput();
    place(s, { x: 10, z: 8, yaw: 0, speed: 6, mode: "air", vy: 5, base: 100, baseName: "Ramp Air" });
    intend(log, "l", T(10));
    run(s, inp, [...tap("KeyA", T(12), 0.2), key("KeyQ", true, T(18))], 20, (sim, f) => feed(log, f, sim.events));
    const m = intentMetrics(log);
    expect(m.trials).toBe(1);
    expect(m.rows[0]).toMatchObject({ intended: "l", result: "l", wanted: true, carve: true, button: "trick" });
    expect(m.rows[0].pressAt).toBeCloseTo(T(18), 6);
  });
});
