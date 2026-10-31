import { describe, expect, it } from "vitest";
import { extrudeOutline, signedArea } from "./extrude.js";
import { quarterPipeHeightAt, quarterPipeOutline } from "./quarter-pipe.js";

const square = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

function triangles({ vertices }) {
  const out = [];
  for (let i = 0; i < vertices.length; i += 9) {
    out.push([
      { x: vertices[i], y: vertices[i + 1], z: vertices[i + 2] },
      { x: vertices[i + 3], y: vertices[i + 4], z: vertices[i + 5] },
      { x: vertices[i + 6], y: vertices[i + 7], z: vertices[i + 8] },
    ]);
  }
  return out;
}

function normalOf([a, b, c]) {
  const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const v = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  const n = { x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x };
  const len = Math.hypot(n.x, n.y, n.z);
  return { x: n.x / len, y: n.y / len, z: n.z / len };
}

describe("extrude", () => {
  it("measures signed area and spots the winding", () => {
    expect(signedArea(square)).toBeCloseTo(1, 10);
    expect(signedArea([...square].reverse())).toBeCloseTo(-1, 10);
  });

  it("builds two caps and one wall quad per edge", () => {
    const solid = extrudeOutline(square, 2);
    // 2 cap triangles per cap for a quad, plus 2 per side wall.
    expect(solid.triangleCount).toBe(2 * 2 + 4 * 2);
    expect(solid.indices).toHaveLength(solid.triangleCount * 3);
  });

  it("centres the solid on Z", () => {
    const { vertices } = extrudeOutline(square, 3);
    const zs = [];
    for (let i = 2; i < vertices.length; i += 3) zs.push(vertices[i]);
    expect(Math.min(...zs)).toBeCloseTo(-1.5, 6);
    expect(Math.max(...zs)).toBeCloseTo(1.5, 6);
  });

  it("points every face outward whichever way the outline was written", () => {
    for (const outline of [square, [...square].reverse()]) {
      const centre = { x: 0.5, y: 0.5, z: 0 };
      for (const tri of triangles(extrudeOutline(outline, 2))) {
        const n = normalOf(tri);
        const out = { x: tri[0].x - centre.x, y: tri[0].y - centre.y, z: tri[0].z - centre.z };
        expect(n.x * out.x + n.y * out.y + n.z * out.z).toBeGreaterThan(0);
      }
    }
  });

  it("extrudes a quarter-pipe outline into a closed solid", () => {
    const solid = extrudeOutline(quarterPipeOutline(2.5, 10), 8);
    expect(solid.triangleCount).toBeGreaterThan(30);
    expect(Number.isNaN(solid.vertices[0])).toBe(false);
  });

  // A fan is only valid from a point the whole outline can see. The
  // quarter-pipe outline is clockwise, so normalising the winding used to move
  // the hub to the roll-in origin, which the region under the transition
  // cannot see. One triangle then covered the whole diagonal wedge and the
  // rest subtracted it again, back-facing. These three tests pin that shut.
  const RADIUS = 2.6;
  const DEPTH = 9;
  const SEGMENTS = 16;

  const frontCap = (solid) =>
    triangles(solid).filter((t) => t.every((p) => Math.abs(p.z - DEPTH / 2) < 1e-6));

  const area2d = ([a, b, c]) => ((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;

  it("covers the cap once, with no overlapping triangles", () => {
    const cap = frontCap(extrudeOutline(quarterPipeOutline(RADIUS, SEGMENTS), DEPTH));
    const signed = cap.reduce((sum, t) => sum + area2d(t), 0);
    const absolute = cap.reduce((sum, t) => sum + Math.abs(area2d(t)), 0);
    // Overlap shows up as absolute area far exceeding signed area. Before the
    // hub fix this read 5.30 against a signed 1.46.
    expect(absolute).toBeCloseTo(Math.abs(signed), 6);
  });

  it("refuses an outline it cannot fan from its last point", () => {
    // Reversed, the quarter-pipe outline ends at the roll-in origin, which the
    // region under the transition cannot see.
    const reversed = [...quarterPipeOutline(RADIUS, SEGMENTS)].reverse();
    expect(() => extrudeOutline(reversed, DEPTH)).toThrow(/star-shaped/);
  });

  it("gives the cap the real area under the transition", () => {
    const cap = frontCap(extrudeOutline(quarterPipeOutline(RADIUS, 64), DEPTH));
    const signed = Math.abs(cap.reduce((sum, t) => sum + area2d(t), 0));
    // The exact area under a quarter circle of radius r is r^2 - pi*r^2/4.
    const exact = RADIUS * RADIUS - (Math.PI * RADIUS * RADIUS) / 4;
    expect(signed).toBeCloseTo(exact, 2);
  });

  it("keeps every cap triangle under the transition surface", () => {
    const cap = frontCap(extrudeOutline(quarterPipeOutline(RADIUS, SEGMENTS), DEPTH));
    for (const tri of cap) {
      const centroid = {
        x: (tri[0].x + tri[1].x + tri[2].x) / 3,
        y: (tri[0].y + tri[1].y + tri[2].y) / 3,
      };
      expect(centroid.y).toBeLessThanOrEqual(quarterPipeHeightAt(RADIUS, centroid.x) + 1e-6);
    }
  });

  it("points every cap triangle the same way", () => {
    const cap = frontCap(extrudeOutline(quarterPipeOutline(RADIUS, SEGMENTS), DEPTH));
    const signs = new Set(cap.map((t) => Math.sign(area2d(t))));
    expect(signs.size).toBe(1);
  });

  it("rejects a degenerate outline", () => {
    expect(() => extrudeOutline([{ x: 0, y: 0 }, { x: 1, y: 1 }], 1)).toThrow();
    expect(() => extrudeOutline(square, 0)).toThrow();
  });
});
