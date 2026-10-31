import { describe, expect, it } from "vitest";
import { arcPoints, closestPointOnPolyline, pointAt, polylineLength, tangentAt } from "./spline.js";

const straight = [
  { x: 0, y: 1, z: 0 },
  { x: 10, y: 1, z: 0 },
];

const kinked = [
  { x: 0, y: 1, z: 0 },
  { x: 6, y: 1, z: 0 },
  { x: 6, y: 1, z: 8 },
];

describe("spline", () => {
  it("measures length across segments", () => {
    expect(polylineLength(straight)).toBe(10);
    expect(polylineLength(kinked)).toBe(14);
  });

  it("walks by arc length, not by segment index", () => {
    // Half of the 14 m kinked rail is 1 m past the 6 m corner.
    expect(pointAt(kinked, 0.5)).toEqual({ x: 6, y: 1, z: 1 });
    expect(pointAt(straight, 0.25)).toEqual({ x: 2.5, y: 1, z: 0 });
  });

  it("clamps t to the ends", () => {
    expect(pointAt(straight, -3)).toEqual({ x: 0, y: 1, z: 0 });
    expect(pointAt(straight, 7)).toEqual({ x: 10, y: 1, z: 0 });
  });

  it("gives the tangent of the segment t sits in", () => {
    expect(tangentAt(kinked, 0.1)).toEqual({ x: 1, y: 0, z: 0 });
    expect(tangentAt(kinked, 0.9)).toEqual({ x: 0, y: 0, z: 1 });
  });

  it("finds the closest point beside the rail", () => {
    const hit = closestPointOnPolyline(straight, { x: 4, y: 1.4, z: 0.3 });
    expect(hit.point).toEqual({ x: 4, y: 1, z: 0 });
    expect(hit.distance).toBeCloseTo(Math.hypot(0.4, 0.3), 10);
    expect(hit.t).toBeCloseTo(0.4, 10);
    expect(hit.segment).toBe(0);
  });

  it("clamps the closest point to the rail ends", () => {
    const before = closestPointOnPolyline(straight, { x: -5, y: 1, z: 0 });
    expect(before.point).toEqual({ x: 0, y: 1, z: 0 });
    expect(before.t).toBe(0);

    const after = closestPointOnPolyline(straight, { x: 55, y: 1, z: 0 });
    expect(after.point).toEqual({ x: 10, y: 1, z: 0 });
    expect(after.t).toBe(1);
  });

  it("picks the nearer leg of a kinked rail", () => {
    const hit = closestPointOnPolyline(kinked, { x: 6.5, y: 1, z: 7 });
    expect(hit.segment).toBe(1);
    expect(hit.point.z).toBeCloseTo(7, 10);
  });

  it("samples an arc on the radius", () => {
    const pts = arcPoints({ center: { x: 0, y: 0, z: 0 }, radius: 5, startAngle: 0, endAngle: Math.PI / 2, y: 1, segments: 4 });
    expect(pts).toHaveLength(5);
    for (const p of pts) {
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(5, 10);
      expect(p.y).toBe(1);
    }
  });

  it("rejects a polyline with fewer than two points", () => {
    expect(() => polylineLength([{ x: 0, y: 0, z: 0 }])).toThrow();
    expect(() => closestPointOnPolyline([], { x: 0, y: 0, z: 0 })).toThrow();
  });
});
