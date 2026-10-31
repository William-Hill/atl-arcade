import { describe, expect, it } from "vitest";
import { IDENTITY, quatFromAxisAngle, quatFromUnitVectors, quatFromYaw, rotateVector } from "./quat.js";
import { distance, normalize, v3 } from "./vec3.js";

const UP = v3(0, 1, 0);

describe("quat", () => {
  it("leaves a vector alone under the identity", () => {
    expect(rotateVector(IDENTITY, v3(1, 2, 3))).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("turns a quarter circle about Y", () => {
    const rotated = rotateVector(quatFromYaw(Math.PI / 2), v3(0, 0, 1));
    expect(rotated.x).toBeCloseTo(1, 10);
    expect(rotated.z).toBeCloseTo(0, 10);
  });

  it("maps one unit vector onto another", () => {
    const targets = [v3(1, 0, 0), v3(0, 0, 1), normalize(v3(1, 1, 1)), normalize(v3(-2, 0.5, 3))];
    for (const target of targets) {
      const q = quatFromUnitVectors(UP, target);
      expect(distance(rotateVector(q, UP), target)).toBeLessThan(1e-9);
    }
  });

  it("handles the opposite-vector case instead of producing NaN", () => {
    const q = quatFromUnitVectors(UP, v3(0, -1, 0));
    const rotated = rotateVector(q, UP);
    expect(Number.isFinite(rotated.y)).toBe(true);
    expect(distance(rotated, v3(0, -1, 0))).toBeLessThan(1e-9);
  });

  it("stays a unit quaternion", () => {
    for (const q of [quatFromYaw(2.3), quatFromAxisAngle(v3(1, 2, 3), 1.1), quatFromUnitVectors(UP, v3(3, -1, 2))]) {
      expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 10);
    }
  });
});
