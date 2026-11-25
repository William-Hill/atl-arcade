import { describe, expect, it } from "vitest";
import { createIntentLog, feed, intend, intentMetrics, restartClock } from "./intent.js";
import { createInput } from "./input.js";
import { key, run, T, tap } from "./harness.js";
import { createSim, place } from "./sim.js";

const trick = (t, dir, kind = "grab") => ({ type: "trick", kind, dir, t, name: "x" });

describe("intent log (agent playtest)", () => {
  it("pairs an intention with the next trick, and counts tricks as wanted", () => {
    const log = createIntentLog();
    intend(log, "l", 1.0);
    feed(log, [], [trick(1.1, "l")]);
    intend(log, "n", 2.0);
    feed(log, [], [trick(2.1, "u")]);
    const m = intentMetrics(log);
    expect(m.trials).toBe(2);
    expect(m.wantedShare).toBe(0.5);
  });
  it("rejects a bad direction, and does not pair an old intention or a manual", () => {
    const log = createIntentLog();
    expect(intend(log, "x", 0).error).toBeDefined();
    intend(log, "u", 0);
    feed(log, [], [trick(0.5, "n", "manual"), trick(3, "u")]);
    expect(intentMetrics(log).trials).toBe(0);
    expect(intentMetrics(log).unpairedIntents).toBe(1);
  });
  it("counts the push and carve leaks as the bots do", () => {
    const log = createIntentLog();
    // A neutral press with a W start 1 s before: it came out Up (a push leak).
    feed(log, [{ dir: "u", at: 0, up: 0.1 }], []);
    intend(log, "n", 0.9);
    feed(log, [], [trick(1.0, "u")]);
    // A down press with a D start 0.1 s after it: it came out Right (a carve leak).
    intend(log, "d", 4.9);
    feed(log, [{ dir: "d", at: 4.95, up: null }, { dir: "r", at: 5.1, up: null }], [trick(5.0, "r")]);
    // An up press with a carve: not in the carve count (intended up is counted), and no leak.
    intend(log, "u", 9.9);
    feed(log, [{ dir: "u", at: 9.95, up: null }, { dir: "l", at: 9.9, up: null }], [trick(10.0, "u")]);
    const m = intentMetrics(log);
    expect(m.pushTrials).toBe(1);
    expect(m.unwantedUpFromPush).toBe(1);
    expect(m.carveTrials).toBe(2);
    expect(m.unwantedLRFromCarve).toBe(0.5);
  });
  it("times the first 3-link combo with a manual from the last restart", () => {
    const log = createIntentLog();
    restartClock(log, 10);
    feed(log, [], [{ type: "bank", t: 12, links: 2, manual: true }, { type: "bank", t: 15, links: 3, manual: false }, { type: "bank", t: 20.5, links: 3, manual: true, names: ["a", "b", "c"], banked: 900 }]);
    expect(intentMetrics(log).firstCombo).toEqual({ seconds: 10.5, names: ["a", "b", "c"], banked: 900 });
  });
  it("works on the real sim and input: A then Q in the air is a wanted Japan Grab", () => {
    const log = createIntentLog();
    const s = createSim({ beat: false });
    const inp = createInput();
    place(s, { x: 10, z: 8, yaw: 0, speed: 6, mode: "air", vy: 5, base: 100, baseName: "Ramp Air" });
    intend(log, "l", T(10));
    run(s, inp, [...tap("KeyA", T(12), 0.2), key("KeyQ", true, T(18))], 20, (sim, f) => feed(log, f.dirHist, sim.events));
    const m = intentMetrics(log);
    expect(m.trials).toBe(1);
    expect(m.rows[0]).toMatchObject({ intended: "l", result: "l", wanted: true, carve: true });
  });
});
