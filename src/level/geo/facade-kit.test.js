import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEPTH_TILE, KIT, buildingKit, facadeKit, gableRoof, ledge, minRect, offsetRing, wallBox, wallDepth } from "./facade-kit.js";
import { STYLES } from "./styles.js";
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
    expect(c).toMatchObject({ cornice: 1, coping: 1, belt: 1, roof: 0 });
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

  it("builds a wall box whose faces point out, up, down, and to the ends", () => {
    const m = empty();
    // A wall along +x; its outward normal is -z.
    wallBox(m, [0, 0], [1, 0], [0, -1], 2, 3, 1, 1.1, 0.12, [1, 1, 1], 0);
    expect(m.indices.length / 3).toBe(10);
    for (const { n, c } of normals(m)) {
      const len = Math.hypot(...n);
      const u = n.map((x) => x / len);
      if (Math.abs(u[1]) > 0.99) expect(Math.sign(u[1])).toBe(c[1] > 1.05 ? 1 : -1);
      else if (Math.abs(u[2]) > 0.99) expect(u[2]).toBeCloseTo(-1);
      else expect(Math.sign(u[0])).toBe(c[0] > 2.5 ? 1 : -1);
    }
    for (let i = 2; i < m.positions.length; i += 3) expect(m.positions[i]).toBeLessThanOrEqual(1e-9);
  });

  it("puts one sill under each upper-floor window of the shader, outside the wall", () => {
    const style = STYLES.find((s) => s.id === "brick-loft");
    // 4 floors of 4.2 m; the 17 m wall has 5 bays of 3.4 m.
    const ring = orientRing([[0, 0], [17, 0], [17, 10.2], [0, 10.2]], false);
    const m = empty();
    const c = wallDepth(m, ring, 16.8, style, 0);
    // Walls of 5 and 3 bays, two of each; floors 1 to 3 (the shop floor has no sill).
    expect(c.sill).toBe((5 + 3) * 2 * 3);
    // Piers at each bay line of each wall, corners included.
    expect(c.pier).toBe((6 + 4) * 2);
    // Each part is outside the footprint or on its wall line.
    for (let i = 0; i < m.positions.length; i += 3) {
      const x = m.positions[i];
      const z = m.positions[i + 2];
      const inside = x > 1e-6 && x < 17 - 1e-6 && z > 1e-6 && z < 10.2 - 1e-6;
      expect(inside).toBe(false);
    }
    // The sill tops are at the bottom of the window frame on each floor.
    const [, wh] = style.window;
    const tops = new Set();
    for (let i = 1; i < m.positions.length; i += 3) tops.add(m.positions[i].toFixed(3));
    for (let level = 1; level < 4; level += 1) expect(tops.has(((level + 0.55 - (wh + 0.07) / 2) * 4.2).toFixed(3))).toBe(true);
  });

  it("gives a sill soft normals, under the ink crease angle from the wall", () => {
    const m = { positions: [], indices: [], colors: [], facade: [], normals: [] };
    wallBox(m, [0, 0], [1, 0], [0, -1], 2, 3, 1, 1.1, 0.12, [1, 1, 1], 0, true, true);
    expect(m.normals.length).toBe(m.positions.length);
    let minDot = 1;
    for (let i = 0; i < m.normals.length; i += 3) {
      const nv = [m.normals[i], m.normals[i + 1], m.normals[i + 2]];
      expect(Math.hypot(...nv)).toBeCloseTo(1, 6);
      // The dot with the wall normal (0, 0, -1).
      minDot = Math.min(minDot, -nv[2]);
    }
    // The ink pass draws a crease at 1 - dot > 0.35.
    expect(1 - minDot).toBeLessThan(0.35);
  });

  it("puts the sills and the piers on the terrain span of the building", () => {
    const style = STYLES.find((s) => s.id === "brick-loft");
    const ring = orientRing([[0, 0], [17, 0], [17, 10.2], [0, 10.2]], false);
    const flat = empty();
    const raised = empty();
    wallDepth(flat, ring, 16.8, style, 0);
    // The same walls, standing from y = 10 to y = 26.8.
    wallDepth(raised, ring, 26.8, style, 0, 10);
    expect(raised.positions.length).toBe(flat.positions.length);
    for (let i = 1; i < flat.positions.length; i += 3) expect(raised.positions[i]).toBeCloseTo(flat.positions[i] + 10, 6);
  });

  it("gives a glass office no sills and a house no piers", () => {
    const ring = orientRing([[0, 0], [20, 0], [20, 12], [0, 12]], false);
    expect(wallDepth(empty(), ring, 30, STYLES.find((s) => s.id === "glass-office"), 0).sill).toBe(0);
    const house = wallDepth(empty(), ring, 7, STYLES.find((s) => s.id === "craftsman-house"), 0);
    expect(house.sill).toBeGreaterThan(0);
    expect(house.pier).toBe(0);
  });

  it("puts the sills and the piers in small depth tiles, not in the building tiles", () => {
    const { tiles, depthTiles, counts } = facadeKit(LEVEL);
    expect(counts.sill).toBeGreaterThan(10000);
    expect(counts.pier).toBeGreaterThan(1000);
    let tris = 0;
    let max = 0;
    for (const { tile, center, mesh } of depthTiles) {
      const [i, j] = tile.split(",").map(Number);
      expect(center).toEqual([(i + 0.5) * DEPTH_TILE, (j + 0.5) * DEPTH_TILE]);
      expect(mesh.facade.length / 4).toBe(mesh.positions.length / 3);
      expect(mesh.normals.length).toBe(mesh.positions.length);
      const n = mesh.indices.length / 3;
      tris += n;
      max = Math.max(max, n);
    }
    // The building tiles keep the old kit budget.
    let kitTris = 0;
    for (const { mesh } of tiles) kitTris += mesh.indices.length / 3;
    expect(kitTris).toBeLessThan(60000);
    // The view draws the depth tiles under 120 m from the camera
    // (DEPTH_DISTANCE in src/render/geo-view.js). On a 25 m grid of camera
    // points, keep the near depth triangles under 150,000.
    let worst = 0;
    for (let x = -1500; x <= 1500; x += 25) {
      for (let z = -1500; z <= 1500; z += 25) {
        let near = 0;
        for (const d of depthTiles) if (Math.hypot(d.center[0] - x, d.center[1] - z) < 120) near += d.mesh.indices.length / 3;
        worst = Math.max(worst, near);
      }
    }
    expect(worst).toBeLessThan(150000);
    expect(max).toBeLessThan(60000);
    expect(tris).toBeGreaterThan(kitTris);
  });
});
