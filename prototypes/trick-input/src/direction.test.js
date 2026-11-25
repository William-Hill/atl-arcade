import { describe, expect, it } from "vitest";
import { GDD_RULE, TRICK, withRelaxed } from "./constants.js";
import { createDirTracker, createPadTracker, dirDown, dirUp, freshDir, heldDir, isFresh, padUpdate, resolvePending, resolvePendingHist, resolvePress, resolvePressHist, stickDir } from "./direction.js";

const F = (n) => n / 60;

describe("R3 fresh direction", () => {
  it("counts a direction 100 ms (frame 6) before the press, not 160 ms (frame 10)", () => {
    expect(isFresh("r", F(60 - 6), F(60))).toBe(true);
    expect(isFresh("r", F(60 - 10), F(60))).toBe(false);
  });
  it("counts the edge of dirBefore (150 ms = frame 9)", () => {
    expect(isFresh("l", F(100 - 9), F(100))).toBe(true);
  });
  it("starts the trick at the press frame when a fresh direction exists", () => {
    expect(resolvePress(F(60), "u", F(57))).toEqual({ dir: "u", at: F(60) });
  });
  it("waits for dirAfter: a direction 1 frame (about 20 ms) after the press sets the trick at that frame", () => {
    const p = resolvePress(F(60), "u", F(1));
    expect(p.pending).toBeCloseTo(F(60));
    const r = resolvePending(p, F(61), "u", F(61));
    expect(r).toEqual({ dir: "u", at: F(61) });
  });
  it("resolves neutral at the first frame at or past 60 ms (frame 4), not before", () => {
    let p = resolvePress(F(60), "n", -Infinity);
    for (const f of [61, 62, 63]) {
      p = resolvePending(p, F(f), "n", -Infinity);
      expect(p.dir).toBeUndefined();
    }
    expect(resolvePending(p, F(64), "n", -Infinity)).toEqual({ dir: "n", at: F(64) });
  });
  it("does not use a held direction that started before the window", () => {
    expect(resolvePress(F(120), "u", F(60)).pending).toBeDefined();
  });
  it("Relaxed timing counts a direction 240 ms before the press", () => {
    expect(isFresh("l", 1 - 0.24, 1, TRICK)).toBe(false);
    expect(isFresh("l", 1 - 0.24, 1, withRelaxed())).toBe(true);
  });
  it("with dirAfter 0 the neutral trick starts at the press", () => {
    expect(resolvePress(1, "n", -Infinity, { ...TRICK, dirAfter: 0 })).toEqual({ dir: "n", at: 1 });
  });
});

describe("keyboard tracker (R2)", () => {
  it("the later of two directions wins", () => {
    let tr = createDirTracker();
    tr = dirDown(tr, "l", 1.0);
    tr = dirDown(tr, "r", 1.05);
    expect(tr.lastDir).toBe("r");
    expect(heldDir(tr)).toBe("r");
  });
  it("W held 1 s, then A: lastDir is left and A is the newest held key", () => {
    let tr = dirDown(createDirTracker(), "u", 0);
    tr = dirDown(tr, "l", 1);
    expect(tr.lastDir).toBe("l");
    expect(heldDir(tr)).toBe("l");
    tr = dirUp(tr, "l", 1.1);
    expect(heldDir(tr)).toBe("u");
  });
  it("a tap keeps lastDir after the key is let go", () => {
    let tr = dirDown(createDirTracker(), "u", 0.9);
    tr = dirUp(tr, "u", 1.2);
    expect(tr.lastDir).toBe("u");
    expect(tr.lastDirAt).toBe(0.9);
    expect(heldDir(tr)).toBe("n");
  });
  it("key repeat is not a new start event", () => {
    let tr = dirDown(createDirTracker(), "u", 0.5);
    tr = dirDown(tr, "u", 0.9);
    expect(tr.lastDirAt).toBe(0.5);
  });
});

describe("gamepad (R2)", () => {
  it("needs 0.5 travel", () => {
    expect(stickDir(0.49, 0)).toBe("n");
    expect(stickDir(0.5, 0)).toBe("r");
    expect(stickDir(-0.5, 0)).toBe("l");
  });
  it("the main axis wins", () => {
    expect(stickDir(0.6, 0.7)).toBe("u");
    expect(stickDir(0.6, -0.7)).toBe("d");
    expect(stickDir(0.8, 0.7)).toBe("r");
  });
  it("a start event is a change to a new non-neutral direction", () => {
    let tr = createPadTracker();
    tr = padUpdate(tr, "l", 1);
    tr = padUpdate(tr, "l", 1.2);
    expect(tr.lastDirAt).toBe(1);
    tr = padUpdate(tr, "n", 1.3);
    tr = padUpdate(tr, "l", 1.4);
    expect(tr.lastDirAt).toBe(1.4);
  });
});

describe("carve guard toggle (prototype, off by default)", () => {
  const guard = { ...TRICK, carveGuard: 0.1 };
  it("is off by default: a held left 140 ms before the press counts", () => {
    expect(isFresh("l", 1 - 0.14, 1, TRICK, true)).toBe(true);
  });
  it("on: a held left that started 140 ms before is a carve; 80 ms before still counts", () => {
    expect(isFresh("l", 1 - 0.14, 1, guard, true)).toBe(false);
    expect(isFresh("l", 1 - 0.08, 1, guard, true)).toBe(true);
  });
  it("on: a tap (let go) 140 ms before still counts, and up/down are not guarded", () => {
    expect(isFresh("l", 1 - 0.14, 1, guard, false)).toBe(true);
    expect(isFresh("u", 1 - 0.14, 1, guard, true)).toBe(true);
  });
});

describe("axis rule (#326 fix, on by default)", () => {
  const ev = (dir, at, up = null) => ({ dir, at, up });
  const gdd = { ...TRICK, ...GDD_RULE };
  it("is on in TRICK, and GDD_RULE turns it off", () => {
    expect(TRICK.axisRule).toBe(true);
    expect(gdd.axisRule).toBe(false);
  });
  it("an up still held at the press counts up to udHold (300 ms); a tap let go keeps dirBefore", () => {
    expect(freshDir([ev("u", 1 - 0.25)], 1)).toBe("u");
    expect(freshDir([ev("u", 1 - 0.32)], 1)).toBe("n");
    expect(freshDir([ev("u", 1 - 0.25, 1 - 0.1)], 1)).toBe("n");
    expect(freshDir([ev("u", 1 - 0.25)], 1, gdd)).toBe("n");
  });
  it("a W held 1 s to push still gives the neutral trick", () => {
    expect(freshDir([ev("u", 0)], 1)).toBe("n");
  });
  it("a held left keeps the R3 window: 200 ms before the press does not count", () => {
    expect(freshDir([ev("l", 1 - 0.2)], 1)).toBe("n");
    expect(freshDir([ev("l", 1 - 0.1)], 1)).toBe("l");
  });
  it("up/down first: a carve that starts after a fresh up does not take the trick", () => {
    const h = [ev("u", 1 - 0.1, 1 - 0.02), ev("r", 1 - 0.05)];
    expect(freshDir(h, 1)).toBe("u");
    expect(freshDir(h, 1, { ...TRICK, udFirst: false })).toBe("r");
  });
  it("two left/right events: the later one wins (R3)", () => {
    expect(freshDir([ev("l", 1 - 0.1), ev("r", 1 - 0.05)], 1)).toBe("r");
  });
  it("starts at the press with a fresh direction, else waits dirAfter for the newest start", () => {
    expect(resolvePressHist(1, [ev("d", 0.9)])).toEqual({ dir: "d", at: 1 });
    const p = resolvePressHist(1, []);
    expect(p.pending).toBe(1);
    expect(resolvePendingHist(p, 1 + F(1), [ev("l", 1 + 0.01)])).toEqual({ dir: "l", at: 1 + F(1) });
    expect(resolvePendingHist(p, 1 + F(4), [])).toEqual({ dir: "n", at: 1 + F(4) });
  });
  it("lrAfter (sweep knob) stops a left/right that starts late in dirAfter", () => {
    const p = resolvePressHist(1, []);
    const k = { ...TRICK, lrAfter: 0.03 };
    expect(resolvePendingHist(p, 1 + F(3), [ev("r", 1 + 0.045)], k).pending).toBe(1);
    expect(resolvePendingHist(p, 1 + F(3), [ev("u", 1 + 0.045)], k)).toEqual({ dir: "u", at: 1 + F(3) });
  });
  it("with the GDD rule knobs, the history gives the same result as the newest event", () => {
    const cases = [[ev("r", 0.9)], [ev("u", 0.5)], [ev("l", 0.88), ev("u", 0.95)], [ev("u", 0.88, 0.9), ev("r", 0.95)]];
    for (const h of cases) {
      const last = h[h.length - 1];
      const held = last.up == null;
      expect(resolvePressHist(1, h, gdd)).toEqual(resolvePress(1, last.dir, last.at, gdd, held));
    }
  });
  it("a W let go before the press (for example on a window blur) does not get the udHold extension", () => {
    let tr = dirDown(createDirTracker(), "u", 0);
    tr = dirUp(tr, "u", 0.1);
    expect(freshDir(tr.hist, 0.25)).toBe("n");
    expect(() => dirUp(dirDown(createDirTracker(), "u", 0), "u")).toThrow();
  });
  it("the trackers keep the release time of each start event", () => {
    let tr = dirDown(createDirTracker(), "l", 1);
    tr = dirUp(tr, "l", 1.2);
    expect(tr.hist).toEqual([{ dir: "l", at: 1, up: 1.2 }]);
    let pt = padUpdate(createPadTracker(), "r", 2);
    pt = padUpdate(pt, "u", 2.1);
    expect(pt.hist).toEqual([{ dir: "r", at: 2, up: 2.1 }, { dir: "u", at: 2.1, up: null }]);
  });
});
