import { describe, expect, it } from "vitest";
import { quarterPipeHeightAt, quarterPipeOutline, quarterPipeProfile } from "./quarter-pipe.js";

describe("quarter-pipe profile", () => {
  it("starts flat on the ground and ends at the lip", () => {
    const profile = quarterPipeProfile(3, 8);
    expect(profile).toHaveLength(9);
    expect(profile[0]).toEqual({ x: 0, y: 0 });
    expect(profile.at(-1).x).toBeCloseTo(3, 10);
    expect(profile.at(-1).y).toBeCloseTo(3, 10);
  });

  it("keeps every point on the transition radius", () => {
    for (const p of quarterPipeProfile(2.5, 12)) {
      expect(Math.hypot(p.x, 2.5 - p.y)).toBeCloseTo(2.5, 10);
    }
  });

  it("gets steeper toward the lip", () => {
    const profile = quarterPipeProfile(4, 16);
    let previousSlope = 0;
    for (let i = 1; i < profile.length; i += 1) {
      const slope = (profile[i].y - profile[i - 1].y) / (profile[i].x - profile[i - 1].x);
      expect(slope).toBeGreaterThan(previousSlope);
      previousSlope = slope;
    }
  });

  it("closes the solid outline under the lip", () => {
    const outline = quarterPipeOutline(3, 8);
    expect(outline.at(-1)).toEqual({ x: 3, y: 0 });
    expect(outline).toHaveLength(10);
  });

  it("matches the profile when sampled by height", () => {
    for (const p of quarterPipeProfile(2.5, 10)) {
      expect(quarterPipeHeightAt(2.5, p.x)).toBeCloseTo(p.y, 10);
    }
    expect(quarterPipeHeightAt(2.5, -1)).toBe(0);
    expect(quarterPipeHeightAt(2.5, 9)).toBe(2.5);
  });

  it("rejects a nonsense profile", () => {
    expect(() => quarterPipeProfile(0, 8)).toThrow();
    expect(() => quarterPipeProfile(3, 1)).toThrow();
    expect(() => quarterPipeProfile(3, 2.5)).toThrow();
  });
});
