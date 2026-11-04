import { describe, expect, it } from "vitest";
import { carTemplates, templateBounds } from "./car-kit.js";
import { CAR_KINDS, CAR_SIZE } from "../sim/traffic/traffic.js";

const templates = carTemplates();

describe("car kit", () => {
  it("has a near and a far shape for each car kind", () => {
    for (const kind of CAR_KINDS) {
      expect(templates[kind]).toBeDefined();
      expect(templates[`${kind}_lod1`]).toBeDefined();
    }
  });

  it("builds each body to the collision box: the length, the width, and the height", () => {
    for (const kind of CAR_KINDS) {
      const { length, width, height } = CAR_SIZE[kind];
      for (const t of [templates[kind], templates[`${kind}_lod1`]]) {
        const b = templateBounds(t);
        // The blob shadow reaches 0.2 m past the ends and 0.15 m past the sides.
        expect(b.maxX).toBeLessThanOrEqual(length / 2 + 0.2 + 1e-6);
        expect(b.minX).toBeGreaterThanOrEqual(-length / 2 - 0.2 - 1e-6);
        expect(b.maxZ).toBeLessThanOrEqual(width / 2 + 0.15 + 1e-6);
        expect(b.maxY).toBeCloseTo(height, 5);
        expect(b.minY).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("keeps the triangle count low: under 300 near and 24 far", () => {
    for (const kind of CAR_KINDS) {
      expect(templates[kind].indices.length / 3).toBeLessThan(300);
      expect(templates[`${kind}_lod1`].indices.length / 3).toBeLessThanOrEqual(24);
    }
  });

  it("has valid indices, unit normals, and a paint value of 0 or 1 on each vertex", () => {
    for (const t of Object.values(templates)) {
      const n = t.positions.length / 3;
      expect(t.normals).toHaveLength(n * 3);
      expect(t.colors).toHaveLength(n * 3);
      expect(t.paint).toHaveLength(n);
      for (const i of t.indices) expect(i).toBeLessThan(n);
      for (let i = 0; i < n; i += 1) expect(Math.hypot(t.normals[i * 3], t.normals[i * 3 + 1], t.normals[i * 3 + 2])).toBeCloseTo(1, 5);
      for (const p of t.paint) expect([0, 1]).toContain(p);
    }
  });

  it("paints the body of each car, and keeps the bus in its own colors", () => {
    for (const kind of ["sedan", "hatchback", "pickup", "van"]) expect(templates[kind].paint.some((p) => p === 1)).toBe(true);
    expect(templates.bus.paint.every((p) => p === 0)).toBe(true);
  });

  it("turns each face outward: the normal points away from the body center", () => {
    for (const kind of CAR_KINDS) {
      const t = templates[kind];
      const { height } = CAR_SIZE[kind];
      // The top faces point up.
      let up = 0;
      for (let i = 0; i < t.normals.length; i += 3) if (t.normals[i + 1] > 0.99 && t.positions[i + 1] > height - 1e-6) up += 1;
      expect(up).toBeGreaterThan(0);
      // The triangle winding agrees with the normal (front faces show).
      for (let k = 0; k < t.indices.length; k += 3) {
        const [a, b, c] = [t.indices[k], t.indices[k + 1], t.indices[k + 2]];
        const P = (i) => [t.positions[i * 3], t.positions[i * 3 + 1], t.positions[i * 3 + 2]];
        const [pa, pb, pc] = [P(a), P(b), P(c)];
        const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
        const v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
        const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const dot = cross[0] * t.normals[a * 3] + cross[1] * t.normals[a * 3 + 1] + cross[2] * t.normals[a * 3 + 2];
        expect(dot).toBeGreaterThanOrEqual(-1e-9);
      }
    }
  });
});
