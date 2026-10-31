import { describe, expect, it } from "vitest";
import * as V from "./vec3.js";

describe("vec3", () => {
  it("adds, subtracts and scales", () => {
    expect(V.add(V.v3(1, 2, 3), V.v3(4, 5, 6))).toEqual({ x: 5, y: 7, z: 9 });
    expect(V.sub(V.v3(4, 5, 6), V.v3(1, 2, 3))).toEqual({ x: 3, y: 3, z: 3 });
    expect(V.scale(V.v3(1, -2, 3), 2)).toEqual({ x: 2, y: -4, z: 6 });
  });

  it("measures length and distance", () => {
    expect(V.length(V.v3(3, 4, 0))).toBe(5);
    expect(V.distance(V.v3(1, 0, 0), V.v3(4, 4, 0))).toBe(5);
    expect(V.flatDistance(V.v3(0, 99, 0), V.v3(3, -99, 4))).toBe(5);
  });

  it("normalizes, and returns zero for a zero vector", () => {
    expect(V.length(V.normalize(V.v3(0, 7, 0)))).toBeCloseTo(1, 10);
    expect(V.normalize(V.v3(0, 0, 0))).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("rounds a yaw trip", () => {
    for (const yaw of [0, 0.5, Math.PI / 2, -2.1, 3]) {
      expect(V.yawOf(V.fromYaw(yaw))).toBeCloseTo(yaw, 10);
    }
  });

  it("takes the short way around on angle delta", () => {
    expect(V.angleDelta(0.1, -0.1)).toBeCloseTo(-0.2, 10);
    expect(V.angleDelta(3.0, -3.0)).toBeCloseTo(Math.PI * 2 - 6, 10);
    expect(Math.abs(V.angleDelta(0, Math.PI * 1.9))).toBeLessThanOrEqual(Math.PI);
  });

  it("clamps", () => {
    expect(V.clamp(5, 0, 1)).toBe(1);
    expect(V.clamp(-5, 0, 1)).toBe(0);
    expect(V.clamp(0.5, 0, 1)).toBe(0.5);
  });
});
