import { describe, expect, it } from "vitest";
import { leashPoints, leashSag } from "./leash.js";

const arc = (pts) =>
  pts
    .slice(1)
    .reduce(
      (t, p, i) =>
        t + Math.hypot(p.x - pts[i].x, p.y - pts[i].y, p.z - pts[i].z),
      0,
    );

describe("leash", () => {
  it("runs from end to end", () => {
    const pts = leashPoints(
      { x: 0, y: 1, z: 0 },
      { x: 0.6, y: 0.4, z: 0.3 },
      1.2,
    );
    expect(pts).toHaveLength(13);
    expect(pts[0]).toEqual({ x: 0, y: 1, z: 0 });
    expect(pts[12].x).toBeCloseTo(0.6);
    expect(pts[12].y).toBeCloseTo(0.4);
    expect(pts[12].z).toBeCloseTo(0.3);
  });
  it("is straight when taut", () => {
    expect(leashSag(1.5, 0, 1.2)).toBe(0);
    const pts = leashPoints({ x: 0, y: 1, z: 0 }, { x: 1.5, y: 1, z: 0 }, 1.2);
    for (const p of pts) expect(p.y).toBeCloseTo(1);
  });
  it("hangs by its slack, about its length long", () => {
    const a = { x: 0, y: 1, z: 0 };
    const b = { x: 0.8, y: 1, z: 0 };
    const pts = leashPoints(a, b, 1.0, 32);
    expect(pts[16].y).toBeCloseTo(1 - leashSag(0.8, 0, 1.0));
    expect(pts[16].y).toBeLessThan(1);
    expect(arc(pts)).toBeGreaterThan(0.99);
    expect(arc(pts)).toBeLessThan(1.01);
  });
  it("keeps its length with the ends at different heights", () => {
    for (const [b, length] of [
      [{ x: 0.79, y: 0.45, z: 0 }, 1.1],
      [{ x: 0.3, y: 0.4, z: 0.2 }, 1.1],
      [{ x: 0, y: 0.2, z: 0 }, 1.1],
    ]) {
      const pts = leashPoints({ x: 0, y: 1, z: 0 }, b, length, 256);
      expect(arc(pts)).toBeCloseTo(length, 2);
    }
  });
  it("reuses the output points", () => {
    const out = [];
    const first = leashPoints(
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      2,
      4,
      out,
    );
    const again = leashPoints(
      { x: 0, y: 0, z: 0 },
      { x: 0.5, y: 0, z: 0 },
      2,
      4,
      out,
    );
    expect(again).toBe(first);
    expect(again[0]).toBe(first[0]);
  });
});
