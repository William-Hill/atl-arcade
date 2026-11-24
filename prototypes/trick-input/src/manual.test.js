import { describe, expect, it } from "vitest";
import { manualPoints, manualStep } from "./manual.js";

describe("F1 manual balance", () => {
  it("the GDD example: m 0.3, side +1, s 0.2, dt 1/60 gives 0.3043", () => {
    expect(manualStep(0.3, 1, 0.2, 1 / 60)).toBeCloseTo(0.3043, 4);
  });
  it("with no input the lean goes from 0 to the limit in about 1.25 s", () => {
    let m = 0;
    let f = 0;
    while (Math.abs(m) < 1 && f < 600) {
      m = manualStep(m, 1, 0, 1 / 60);
      f += 1;
    }
    expect(f / 60).toBeGreaterThan(1.2);
    expect(f / 60).toBeLessThan(1.3);
  });
  it("stick up 0.64 at m 0.9 moves the lean down (recovery near the limit)", () => {
    expect(manualStep(0.9, 1, 0.64, 1 / 60)).toBeLessThan(0.9);
  });
  it("the drift side -1 leans the other way", () => {
    expect(manualStep(0, -1, 0, 0.1)).toBeLessThan(0);
  });
  it("clamps to -1..1", () => {
    expect(manualStep(0.99, 1, 0, 1)).toBe(1);
  });
});

describe("F2 manual points", () => {
  it("20 m pays 340", () => expect(manualPoints(20)).toBe(340));
  it("caps at 30 m: 490", () => {
    expect(manualPoints(30)).toBe(490);
    expect(manualPoints(80)).toBe(490);
  });
  it("a Toe Roll adds 20", () => expect(manualPoints(10, true)).toBe(40 + 150 + 20));
});
