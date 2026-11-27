import { describe, expect, it } from "vitest";
import { COMBO } from "./constants.js";
import { comboMove, createCombo } from "./combo.js";
import { hitStopFor, startHitStop, stepHitStop } from "./hit-stop.js";

describe("the tuning knobs of #338", () => {
  it("perfectHitStopMs is 60 ms (min 0 / typical 60 / max 100)", () => {
    expect(COMBO.perfectHitStopMs).toBe(60);
    expect(COMBO.perfectHitStopMs).toBeGreaterThanOrEqual(0);
    expect(COMBO.perfectHitStopMs).toBeLessThanOrEqual(100);
  });

  it("stumbleStyleLoss is 0.25 (min 0 / typical 0.25 / max 0.5)", () => {
    expect(COMBO.stumbleStyleLoss).toBe(0.25);
  });

  it("a stumble drops the style meter by stumbleStyleLoss", () => {
    const c = { ...createCombo(), style: 0.75 };
    const out = comboMove(c, { move: "air", name: "Japan Grab", points: 200, landing: "stumble" });
    expect(out.style).toBeCloseTo(0.75 - COMBO.stumbleStyleLoss, 9);
    for (const loss of [0, 0.25, 0.5]) {
      const k = { ...COMBO, stumbleStyleLoss: loss };
      expect(comboMove(c, { move: "air", name: "Japan Grab", points: 200, landing: "stumble" }, k).style).toBeCloseTo(0.75 - loss, 9);
    }
    // A clean landing keeps the meter.
    expect(comboMove(c, { move: "air", name: "Japan Grab", points: 200 }).style).toBe(0.75);
  });
});

describe("the PERFECT hit stop (#338)", () => {
  const perfect = { beatTag: "PERFECT", landing: "clean" };
  it("starts at a PERFECT link only", () => {
    expect(hitStopFor([perfect])).toBe(60);
    expect(hitStopFor([{ beatTag: "GOOD", landing: "clean" }])).toBe(0);
    expect(hitStopFor([{ beatTag: null, landing: "clean" }])).toBe(0);
    expect(hitStopFor([{ beatTag: "PERFECT", landing: "stumble" }])).toBe(0);
    expect(hitStopFor([])).toBe(0);
    expect(hitStopFor(null)).toBe(0);
    expect(hitStopFor([{ beatTag: null }, perfect])).toBe(60);
  });

  it("uses the knob: 0 turns it off, 100 is the max", () => {
    expect(hitStopFor([perfect], { ...COMBO, perfectHitStopMs: 0 })).toBe(0);
    expect(hitStopFor([perfect], { ...COMBO, perfectHitStopMs: 100 })).toBe(100);
  });

  it("stops the sim for the wall time of the hit stop, then gives back the rest of the frame", () => {
    expect(stepHitStop(60, 16)).toEqual({ left: 44, simMs: 0 });
    expect(stepHitStop(44, 16)).toEqual({ left: 28, simMs: 0 });
    expect(stepHitStop(28, 16)).toEqual({ left: 12, simMs: 0 });
    expect(stepHitStop(12, 16)).toEqual({ left: 0, simMs: 4 });
    expect(stepHitStop(0, 16)).toEqual({ left: 0, simMs: 16 });
    expect(stepHitStop(60, 60)).toEqual({ left: 0, simMs: 0 });
  });

  it("the sim loses exactly perfectHitStopMs of time, at any frame rate", () => {
    for (const frame of [4, 8.3, 16.7, 33.3, 100]) {
      let left = startHitStop(0, 60);
      let sim = 0;
      for (let i = 0; i < 40; i += 1) {
        const r = stepHitStop(left, frame);
        left = r.left;
        sim += r.simMs;
      }
      expect(sim).toBeCloseTo(40 * frame - 60, 6);
    }
  });

  it("a new hit stop does not add to one that runs", () => {
    expect(startHitStop(30, 60)).toBe(60);
    expect(startHitStop(80, 60)).toBe(80);
    expect(startHitStop(0, 0)).toBe(0);
  });
});
