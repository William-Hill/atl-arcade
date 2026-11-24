import { describe, expect, it } from "vitest";
import { airPoints, beatFactor, beatOffsetMs, comboBail, comboBank, comboMove, comboTick, createCombo, grindPoints } from "./scoring.js";

describe("F3 air points", () => {
  it("ramp air, Japan Grab held 0.8 s, no half turn: 268", () => {
    expect(airPoints({ airBase: 100, grab: "dir", tHold: 0.8 })).toBe(268);
  });
  it("vert air, 180, grab held 0.8 s: 408", () => {
    expect(airPoints({ airBase: 200, grab: "dir", tHold: 0.8, yawDeg: 180 })).toBe(408);
  });
  it("a neutral grab has trickBase 80", () => {
    expect(airPoints({ airBase: 0, grab: "neutral" })).toBe(80);
  });
  it("a grab held 3 s pays 90 for the hold", () => {
    expect(airPoints({ airBase: 100, grab: "dir", tHold: 3 }) - 220).toBe(90);
  });
  it("8 half turns pay 240 (cap 6)", () => {
    expect(airPoints({ airBase: 0, yawDeg: 8 * 180 })).toBe(240);
  });
  it("a hop with no trick stays 50; a partial turn pays nothing", () => {
    expect(airPoints({ airBase: 50, yawDeg: 170 })).toBe(50);
  });
});

describe("F4 grind points", () => {
  it("adds the stance bonus for a direction stance only", () => {
    expect(grindPoints(4, "n")).toBe(240);
    expect(grindPoints(4, "u")).toBe(270);
  });
});

describe("F6 beat factor", () => {
  it("20 ms 1.75, 21 ms 1.5, 60 ms 1.5, 61 ms 1", () => {
    expect(beatFactor(20)).toBe(1.75);
    expect(beatFactor(-21)).toBe(1.5);
    expect(beatFactor(60)).toBe(1.5);
    expect(beatFactor(61)).toBe(1);
  });
  it("a stumble on a beat is 1; no beat clock is 1", () => {
    expect(beatFactor(0, true)).toBe(1);
    expect(beatFactor(null)).toBe(1);
  });
  it("beatOffsetMs finds the nearest beat at 100 bpm", () => {
    expect(beatOffsetMs(0.62)).toBeCloseTo(20, 6);
    expect(beatOffsetMs(0.58)).toBeCloseTo(-20, 6);
  });
});

describe("F5 and F7 combo", () => {
  it("the full example: 520, 510, 268 banks 3894", () => {
    let c = createCombo();
    c = comboMove(c, { move: "grind", name: "Long Ledge Grind", points: 520, offsetMs: 200 });
    c = comboMove(c, { move: "manual", name: "Manual", points: 340, offsetMs: 40 });
    c = comboMove(c, { move: "air", name: "Japan Grab", points: 268, offsetMs: 80 });
    expect(c.pending).toBe(1298);
    expect(c.multiplier).toBe(3);
    for (let i = 0; i < 47; i++) c = comboTick(c, 1 / 60, false);
    expect(c.active).toBe(true);
    c = comboTick(c, 1 / 60, false);
    expect(c.score).toBe(3894);
  });
  it("a stumble on link 3 pays 134 and the bank is 3492", () => {
    let c = createCombo();
    c = comboMove(c, { move: "grind", name: "Long Ledge Grind", points: 520 });
    c = comboMove(c, { move: "manual", name: "Manual", points: 340, offsetMs: 40 });
    c = { ...c, style: 0.5 };
    c = comboMove(c, { move: "air", name: "Japan Grab", points: 268, offsetMs: 0, landing: "stumble" });
    expect(c.links[2].earned).toBe(134);
    expect(c.links[2].tag).toBe("WOBBLE");
    expect(c.style).toBe(0.25);
    expect(comboBank(c).score).toBe(3492);
  });
  it("a bail banks 25% at multiplier 1: 325, style minus 0.5", () => {
    const c = { ...createCombo(), pending: 1298, multiplier: 3, active: true, style: 0.75 };
    const b = comboBail(c);
    expect(b.score).toBe(325);
    expect(b.style).toBe(0.25);
  });
  it("a bail with 0 pending banks 0 and the style still drops", () => {
    const b = comboBail({ ...createCombo(), active: true, style: 0.5 });
    expect(b.score).toBe(0);
    expect(b.style).toBe(0);
  });
  it("repeat decay: P, P/2, P/4, 0, and the 4th adds no multiplier", () => {
    let c = createCombo();
    for (let i = 0; i < 4; i++) c = comboMove(c, { move: "air", name: "Japan Grab", points: 268 });
    expect(c.links.map((l) => l.earned)).toEqual([268, 134, 67, 0]);
    expect(c.multiplier).toBe(3);
  });
  it("the second Japan Grab pays 134", () => {
    let c = comboMove(createCombo(), { move: "air", name: "Japan Grab", points: 268 });
    c = comboMove(c, { move: "air", name: "Japan Grab", points: 268 });
    expect(c.links[1].earned).toBe(134);
  });
  it("the multiplier caps at 10", () => {
    let c = createCombo();
    for (let i = 0; i < 11; i++) c = comboMove(c, { move: "air", name: `T${i}`, points: 10 });
    expect(c.multiplier).toBe(10);
  });
  it("an open move keeps the window full", () => {
    let c = comboMove(createCombo(), { move: "air", name: "Hop", points: 50 });
    for (let i = 0; i < 200; i++) c = comboTick(c, 1 / 60, true);
    expect(c.active).toBe(true);
  });
});
