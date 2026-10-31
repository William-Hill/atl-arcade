import { describe, expect, it } from "vitest";
import { nearestOnPolyline, pointAtDistance, polylineLength, sampleSpline } from "./splines.js";

const straight = [[-20, 0.6, -2], [-8, 0.6, -2]];
const kinked = [[-4, 0.6, 2.5], [3, 0.6, 2.5], [9, 0.6, 0]];

describe("sampleSpline", () => {
  it("copies a polyline", () => {
    const pts = sampleSpline({ points: straight });
    expect(pts).toEqual(straight);
    expect(pts[0]).not.toBe(straight[0]);
  });

  it("samples a quadratic Bezier through its end points", () => {
    const pts = sampleSpline({ start: [14, 0.6, -1], control: [21, 0.6, -1], end: [21, 0.6, -5.5] }, 8);
    expect(pts).toHaveLength(9);
    expect(pts[0]).toEqual([14, 0.6, -1]);
    expect(pts[8]).toEqual([21, 0.6, -5.5]);
    // The curve bows toward the control point.
    expect(pts[4][0]).toBeGreaterThan(17.5);
    expect(pts[4][2]).toBeGreaterThan(-3.25);
  });

  it("rejects a spline with no shape", () => {
    expect(() => sampleSpline({})).toThrow();
  });
});

describe("polyline math", () => {
  it("measures length", () => {
    expect(polylineLength(straight)).toBeCloseTo(12);
    expect(polylineLength(kinked)).toBeCloseTo(7 + Math.hypot(6, 2.5));
  });

  it("walks a point along the straight rail", () => {
    const r = pointAtDistance(straight, 3);
    expect(r.point).toEqual([-17, 0.6, -2]);
    expect(r.tangent).toEqual([1, 0, 0]);
    expect(r.segment).toBe(0);
  });

  it("clamps the distance to the ends", () => {
    expect(pointAtDistance(straight, -5).point).toEqual([-20, 0.6, -2]);
    expect(pointAtDistance(straight, 50).point).toEqual([-8, 0.6, -2]);
  });

  it("crosses the kink into the second segment", () => {
    const r = pointAtDistance(kinked, 8);
    expect(r.segment).toBe(1);
    expect(r.point[0]).toBeGreaterThan(3);
    expect(r.tangent[2]).toBeLessThan(0);
  });

  it("finds the nearest point on the straight rail", () => {
    const r = nearestOnPolyline(straight, [-15, 1.2, -1.5]);
    expect(r.point).toEqual([-15, 0.6, -2]);
    expect(r.distance).toBeCloseTo(Math.hypot(0.6, 0.5));
    expect(r.s).toBeCloseTo(5);
  });

  it("clamps the nearest point to the rail ends", () => {
    const r = nearestOnPolyline(straight, [-30, 0.6, -2]);
    expect(r.point).toEqual([-20, 0.6, -2]);
    expect(r.s).toBe(0);
  });

  it("picks the right segment on the kinked rail", () => {
    const r = nearestOnPolyline(kinked, [7, 0.6, 0.5]);
    expect(r.segment).toBe(1);
    expect(r.distance).toBeLessThan(0.5);
  });
});
