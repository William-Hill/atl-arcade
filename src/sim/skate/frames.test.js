import { describe, expect, it } from "vitest";
import { FRAME_DT, FRAME_HZ, frameToSec, msToFrame, secToFrame } from "./frames.js";

describe("frame helper for the timing criteria (#343)", () => {
  it("steps at 60 Hz", () => {
    expect(FRAME_HZ).toBe(60);
    expect(FRAME_DT).toBeCloseTo(1 / 60, 12);
  });

  it("gives the GDD frames: 100 ms = 6, 150 ms = 9, 160 ms = 10, 20 ms = 1, 60 ms = 4", () => {
    expect(msToFrame(100)).toBe(6);
    expect(msToFrame(150)).toBe(9);
    expect(msToFrame(160)).toBe(10);
    expect(msToFrame(20)).toBe(1);
    expect(msToFrame(60)).toBe(4);
  });

  it("gives the nearest whole frame, also before an event", () => {
    expect(msToFrame(0)).toBe(0);
    expect(msToFrame(-0.1)).toBe(0);
    expect(Object.is(msToFrame(-0.1), -0)).toBe(false);
    expect(msToFrame(250)).toBe(15);
    expect(msToFrame(300)).toBe(18);
    expect(msToFrame(-100)).toBe(-6);
    expect(msToFrame(8)).toBe(0);
    expect(msToFrame(9)).toBe(1);
  });

  it("converts seconds both ways", () => {
    expect(secToFrame(0.1)).toBe(6);
    expect(secToFrame(0.15)).toBe(9);
    expect(secToFrame(0.05)).toBe(3);
    expect(frameToSec(6)).toBeCloseTo(0.1, 12);
  });

  it("refuses a time that is not a number", () => {
    expect(() => msToFrame(NaN)).toThrow();
    expect(() => msToFrame(undefined)).toThrow();
  });
});
