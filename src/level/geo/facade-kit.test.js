import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { KIT, buildingKit, facadeKit, gableRoof, ledge, minRect, offsetRing } from "./facade-kit.js";
import { orientRing } from "./extrude.js";

const LEVEL = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../levels/beltline-eastside/level.json"), "utf8"));
const SQUARE = orientRing([[0, 0], [10, 0], [10, 10], [0, 10]], false);

function empty() {
  return { positions: [], indices: [], colors: [], facade: [] };
}

// The face normal of each triangle.
function normals(m) {
  const out = [];
  const p = m.positions;
  for (let i = 0; i < m.indices.length; i += 3) {
    const [a, b, c] = [m.indices[i], m.indices[i + 1], m.indices[i + 2]].map((k) => [p[k * 3], p[k * 3 + 1], p[k * 3 + 2]]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    out.push({ n: [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], c: [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3] });
  }
  return out;
}

describe("facade kit", () => {
  it("moves a square ring out by the offset on each side", () => {
    const o = offsetRing(SQUARE, 0.5);
    const xs = o.map((p) => p[0]);
    const zs = o.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(-0.5);
    expect(Math.max(...xs)).toBeCloseTo(10.5);
    expect(Math.min(...zs)).toBeCloseTo(-0.5);
    expect(Math.max(...zs)).toBeCloseTo(10.5);
  });

  it("builds a ledge whose faces point out, up, and down", () => {
    const m = empty();
    ledge(m, SQUARE, 4, 4.5, 0.3, [1, 1, 1], 0);
    // 4 edges x 3 quads x 2 triangles.
    expect(m.indices.length / 3).toBe(24);
    for (const { n, c } of normals(m)) {
      if (Math.abs(n[1]) > 1e-9) {
        // A cap: the top points up, the bottom points down.
        expect(Math.sign(n[1])).toBe(c[1] > 4.25 ? 1 : -1);
      } else {
        // A side: it points away from the square center.
        expect(n[0] * (c[0] - 5) + n[2] * (c[2] - 5)).toBeGreaterThan(0);
      }
    }
  });

  it("finds the long axis of a turned rectangle", () => {
    const t = Math.PI / 6;
    const ring = [[0, 0], [12, 0], [12, 5], [0, 5]].map(([x, z]) => [x * Math.cos(t) - z * Math.sin(t), x * Math.sin(t) + z * Math.cos(t)]);
    const r = minRect(ring);
    expect(r.long).toBeCloseTo(12);
    expect(r.short).toBeCloseTo(5);
    expect(Math.abs(r.ux * Math.cos(t) + r.uz * Math.sin(t))).toBeCloseTo(1);
  });

  it("puts a gable roof on a house box, with the ridge over the center", () => {
    const m = empty();
    const ring = orientRing([[0, 0], [12, 0], [12, 6], [0, 6]], false);
    expect(gableRoof(m, ring, 4, [1, 1, 1], [0.3, 0.3, 0.3], 0)).toBe(true);
    const ys = [];
    for (let i = 1; i < m.positions.length; i += 3) ys.push(m.positions[i]);
    expect(Math.max(...ys)).toBeCloseTo(4 + 3 * Math.tan(KIT.roof.pitch));
    // The eave is under the wall top, so the roof covers it.
    expect(Math.min(...ys)).toBeLessThan(4);
  });

  it("does not put a gable roof on an L-shaped or a wide footprint", () => {
    const L = orientRing([[0, 0], [12, 0], [12, 4], [4, 4], [4, 12], [0, 12]], false);
    expect(gableRoof(empty(), L, 4, [1, 1, 1], [0, 0, 0], 0)).toBe(false);
    const wide = orientRing([[0, 0], [30, 0], [30, 20], [0, 20]], false);
    expect(gableRoof(empty(), wide, 4, [1, 1, 1], [0, 0, 0], 0)).toBe(false);
  });

  it("gives a brick warehouse a cornice, a coping, and a belt course", () => {
    const b = { id: "w1", type: "industrial", height: 15, outer: [[0, 0], [30, 0], [30, 20], [0, 20]] };
    const c = buildingKit(empty(), b);
    expect(c).toEqual({ cornice: 1, coping: 1, belt: 1, roof: 0 });
  });

  it("gives no house roof to a tall building", () => {
    const b = { id: "h1", type: "house", height: 20, outer: [[0, 0], [12, 0], [12, 8], [0, 8]] };
    expect(buildingKit(empty(), b).roof).toBe(0);
    expect(buildingKit(empty(), { ...b, height: 7 }).roof).toBe(1);
  });

  it("builds the kit for the BeltLine level in each building tile", () => {
    const { tiles, counts } = facadeKit(LEVEL);
    expect(tiles.length).toBeGreaterThan(5);
    expect(counts.roof).toBeGreaterThan(100);
    expect(counts.cornice).toBeGreaterThan(100);
    let tris = 0;
    for (const { tile, mesh } of tiles) {
      expect(tile).toMatch(/^-?\d+,-?\d+$/);
      expect(mesh.facade.length / 4).toBe(mesh.positions.length / 3);
      expect(mesh.colors.length).toBe(mesh.positions.length);
      tris += mesh.indices.length / 3;
    }
    // A budget for the high tier.
    expect(tris).toBeLessThan(300000);
  });
});
