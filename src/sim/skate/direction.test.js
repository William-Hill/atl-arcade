// The fresh direction rule (docs/gdd/trick-input.md R3, R3a), pure, and the
// trick input switch of the skater. Times go through the frame helper (#343).
import { describe, expect, it } from "vitest";
import { TRICK } from "./constants.js";
import { dirHistory, freshDir, isFreshEvent, resolvePending, resolvePress } from "./direction.js";
import { at, fr, rig } from "./trick-rig.js";

const P = at(100); // a press at frame 100
const ev = (dir, downMs, upMs = null) => ({ dir, at: P + downMs / 1000, up: upMs == null ? null : P + upMs / 1000 });

describe("R3: fresh", () => {
  it("a direction that started up to dirBefore (150 ms = 9 frames) before the press is fresh; 160 ms (10 frames) is not", () => {
    expect(fr(150)).toBe(9);
    expect(isFreshEvent({ dir: "r", at: P - at(fr(150)), up: P - at(fr(100)) }, P)).toBe(true);
    expect(isFreshEvent({ dir: "r", at: P - at(fr(160)), up: P - at(fr(100)) }, P)).toBe(false);
  });

  it("a direction that starts after the press is not fresh at the press", () => {
    expect(freshDir([ev("u", 20)], P)).toBe("n");
  });

  it("the later of two fresh directions wins; with the axis rule an up or down wins over a later left or right", () => {
    expect(freshDir([ev("l", -100, -80), ev("r", -50)], P)).toBe("r");
    expect(freshDir([ev("u", -100, -80), ev("r", -50)], P)).toBe("u");
    expect(freshDir([ev("u", -100, -80), ev("r", -50)], P, { ...TRICK, axisRule: false })).toBe("r");
  });

  it("the up/down hold: an up still held at the press counts from udHold (300 ms); let go, it keeps dirBefore", () => {
    expect(freshDir([ev("u", -300)], P)).toBe("u");
    expect(freshDir([ev("u", -320)], P)).toBe("n");
    expect(freshDir([ev("u", -250, -200)], P)).toBe("n");
    expect(freshDir([ev("l", -250)], P)).toBe("n"); // left and right keep the R3 window
  });

  it("with no fresh direction the press waits dirAfter (60 ms = 4 frames): the first direction in that time sets the trick, else neutral", () => {
    const pend = resolvePress(P, { dirHist: [] });
    expect(pend).toEqual({ pending: P });
    // The input sends its events on frame times: 20 ms is frame 1.
    expect(resolvePending(pend, P + at(fr(20)), { dirHist: [{ dir: "u", at: P + at(fr(20)), up: null }] })).toEqual({ dir: "u" });
    expect(resolvePending(pend, P + at(fr(40)), { dirHist: [] })).toEqual(pend);
    expect(resolvePending(pend, P + at(fr(60)), { dirHist: [] })).toEqual({ dir: "n" });
    expect(resolvePress(P, { dirHist: [] }, null, { ...TRICK, dirAfter: 0 })).toEqual({ dir: "n" });
  });

  it("a direction that starts after dirAfter does not set a pending press, also when the sim first sees it late", () => {
    const pend = { pending: P };
    const late = { dir: "u", at: P + at(fr(83)), up: null }; // 5 frames: after the 60 ms window
    expect(resolvePending(pend, P + at(fr(83)), { dirHist: [late] })).toEqual({ dir: "n" });
    const inWindow = { dir: "u", at: P + at(fr(50)), up: null }; // frame 3
    expect(resolvePending(pend, P + at(fr(83)), { dirHist: [inWindow] })).toEqual({ dir: "u" });
  });

  it("a touch flick wins over the keys", () => {
    expect(resolvePress(P, { flick: { style1: "d" }, dirHist: [ev("l", -20)] }, "style1")).toEqual({ dir: "d" });
    expect(resolvePending({ pending: P }, P + at(1), { flick: { style1: "r" } }, "style1")).toEqual({ dir: "r" });
  });

  it("with no dirHist, lastDir and lastDirAt make a history of one event (held when dir is the same)", () => {
    expect(dirHistory({ dir: "u", lastDir: "u", lastDirAt: 1 })).toEqual([{ dir: "u", at: 1, up: null }]);
    expect(dirHistory({ dir: "n", lastDir: "u", lastDirAt: 1 })).toEqual([{ dir: "u", at: 1, up: 1 }]);
    expect(dirHistory({})).toEqual([]);
  });
});

describe("the trick input switch", () => {
  it("off (no skaterEnv.tricks), the old rules play: Q starts the next dance of the list and the state has no trick", () => {
    const r = rig({ tricks: false, speed: 5 });
    r.step({ style1: true });
    expect(r.s.style.name).toBe("Bankhead Bounce");
    expect(r.s.trick).toBe(null);
    r.steps(100, {}, (run) => run.skater.justStyled);
    r.step({ style1: true });
    expect(r.s.style.name).toBe("Walk It Out");
  });

  it("on, the sim clock (skater.time) counts the frames", () => {
    const r = rig({ speed: 5 });
    r.steps(fr(1000), {});
    expect(r.s.time).toBeCloseTo(1, 9);
    expect(r.run.time).toBeCloseTo(r.s.time, 9);
  });
});
