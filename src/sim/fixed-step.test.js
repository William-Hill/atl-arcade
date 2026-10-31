import { describe, expect, it } from "vitest";
import { advance, blend, createStepper, FIXED_DT } from "./fixed-step.js";

describe("fixed-step", () => {
  it("runs at 60 Hz by default", () => {
    expect(FIXED_DT).toBeCloseTo(1 / 60, 10);
    expect(createStepper().dt).toBeCloseTo(1 / 60, 10);
  });

  it("owes one step per frame at 60 fps", () => {
    let stepper = createStepper();
    let total = 0;
    for (let i = 0; i < 60; i += 1) {
      const out = advance(stepper, 1 / 60);
      stepper = out.stepper;
      total += out.steps;
    }
    expect(total).toBe(60);
  });

  it("owes two steps per frame at 30 fps", () => {
    const out = advance(createStepper(), 1 / 30);
    expect(out.steps).toBe(2);
    expect(out.dropped).toBe(0);
  });

  it("carries the remainder instead of losing it", () => {
    let stepper = createStepper();
    let total = 0;
    for (let i = 0; i < 100; i += 1) {
      const out = advance(stepper, 0.01);
      stepper = out.stepper;
      total += out.steps;
    }
    expect(total).toBe(60);
    expect(blend(stepper)).toBeLessThan(1);
  });

  it("drops simulation time past the catch-up cap", () => {
    const out = advance(createStepper({ maxStepsPerFrame: 5 }), 2);
    expect(out.steps).toBe(5);
    expect(out.dropped).toBeCloseTo(2 - 5 / 60, 6);
  });

  it("ignores a bad frame time", () => {
    for (const bad of [0, -1, Number.NaN, undefined]) {
      expect(advance(createStepper(), bad).steps).toBe(0);
    }
  });

  it("rejects a nonsense configuration", () => {
    expect(() => createStepper({ dt: 0 })).toThrow();
    expect(() => createStepper({ maxStepsPerFrame: 0 })).toThrow();
  });
});
