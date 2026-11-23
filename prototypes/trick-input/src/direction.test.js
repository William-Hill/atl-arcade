import { describe, expect, it } from "vitest";
import { TRICK, withRelaxed } from "./constants.js";
import { createDirTracker, createPadTracker, dirDown, dirUp, heldDir, isFresh, padUpdate, resolvePending, resolvePress, stickDir } from "./direction.js";

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
    tr = dirUp(tr, "l");
    expect(heldDir(tr)).toBe("u");
  });
  it("a tap keeps lastDir after the key is let go", () => {
    let tr = dirDown(createDirTracker(), "u", 0.9);
    tr = dirUp(tr, "u");
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
