import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { APRON, apronRing, storefrontAprons } from "./aprons.js";
import { orientRing } from "./extrude.js";
import { frontEdges } from "./facade-kit.js";
import { pointInRings } from "./geo-ground.js";
import { SURFACE_COLORS } from "./geo-mesh.js";
import { labBuildings } from "./lab.js";
import { STYLES, STYLE_INDEX, chooseStyle } from "./styles.js";
import { drapeMesh, terrainOf } from "./terrain.js";

const LEVEL = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../levels/beltline-eastside/level.json"), "utf8"));
const RECT = orientRing([[0, 0], [10, 0], [10, 6], [0, 6]], false);

function empty() {
  return { positions: [], indices: [], colors: [] };
}

// Each triangle as 3 points [x, y, z], with the y of its face normal.
function triangles(m) {
  const out = [];
  const p = m.positions;
  for (let i = 0; i < m.indices.length; i += 3) {
    const [a, b, c] = [m.indices[i], m.indices[i + 1], m.indices[i + 2]].map((k) => [p[k * 3], p[k * 3 + 1], p[k * 3 + 2]]);
    const u = [b[0] - a[0], b[2] - a[2]];
    const v = [c[0] - a[0], c[2] - a[2]];
    // The y of (b - a) x (c - a).
    const ny = u[1] * v[0] - u[0] * v[1];
    out.push({ a, b, c, ny, area: Math.abs(ny) / 2 });
  }
  return out;
}

function inTriangle(x, z, { a, b, c }) {
  const s = (p, q) => (q[0] - p[0]) * (z - p[2]) - (q[2] - p[2]) * (x - p[0]);
  const d1 = s(a, b);
  const d2 = s(b, c);
  const d3 = s(c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

function covered(tris, x, z) {
  return tris.some((t) => inTriangle(x, z, t));
}

// The wall i of a ring: its midpoint and outward normal.
function wallMid(ring, i) {
  const [px, pz] = ring[i];
  const [qx, qz] = ring[(i + 1) % ring.length];
  const len = Math.hypot(qx - px, qz - pz);
  return { m: [(px + qx) / 2, (pz + qz) / 2], n: [-(qz - pz) / len, (qx - px) / len] };
}

describe("apronRing", () => {
  it("covers a band of the given width around a rectangle, with the corners", () => {
    const m = empty();
    expect(apronRing(m, RECT, RECT.map(() => 1.8), 0.01)).toBe(4);
    const tris = triangles(m);
    const area = tris.reduce((s, t) => s + t.area, 0);
    expect(area).toBeCloseTo(13.6 * 9.6 - 60, 6);
    // The four corners of the band are covered.
    for (const [x, z] of [[-1.7, -1.7], [11.7, -1.7], [11.7, 7.7], [-1.7, 7.7]]) expect(covered(tris, x, z)).toBe(true);
    expect(covered(tris, -1.9, 3)).toBe(false);
  });

  it("makes every triangle face up, at the given height, in the sidewalk color", () => {
    const m = empty();
    apronRing(m, RECT, [1.8, 3.5, 1.8, 1.8], 0.01);
    for (const t of triangles(m)) expect(t.ny).toBeGreaterThan(0);
    for (let i = 1; i < m.positions.length; i += 3) expect(m.positions[i]).toBe(0.01);
    for (let i = 0; i < m.colors.length; i += 3) expect([m.colors[i], m.colors[i + 1], m.colors[i + 2]]).toEqual(SURFACE_COLORS.sidewalk);
  });

  it("makes the front strip wider", () => {
    const front = RECT.findIndex((_, i) => wallMid(RECT, i).n[1] > 0.99);
    const widths = RECT.map((_, i) => (i === front ? 3.5 : 1.8));
    const m = empty();
    apronRing(m, RECT, widths, 0);
    const tris = triangles(m);
    expect(tris.reduce((s, t) => s + t.area, 0)).toBeCloseTo(13.6 * (6 + 1.8 + 3.5) - 60, 6);
    expect(covered(tris, 5, 6 + 3.3)).toBe(true);
    expect(covered(tris, 5, -3.3)).toBe(false);
  });

  it("puts nothing inside the footprint", () => {
    const ring = orientRing([[0, 0], [12, 0], [12, 5], [7, 5], [7, 9], [0, 9]], false);
    const m = empty();
    apronRing(m, ring, ring.map(() => 1.8), 0);
    for (const t of triangles(m)) {
      const cx = (t.a[0] + t.b[0] + t.c[0]) / 3;
      const cz = (t.a[2] + t.b[2] + t.c[2]) / 3;
      expect(pointInRings(cx, cz, [ring])).toBe(false);
    }
  });
});

describe("storefrontAprons", () => {
  const tiles = storefrontAprons(LEVEL);

  it("gives the same meshes on every build", () => {
    const again = storefrontAprons(LEVEL);
    expect(again.map((t) => t.tile)).toEqual(tiles.map((t) => t.tile));
    expect(Array.from(again[0].mesh.positions)).toEqual(Array.from(tiles[0].mesh.positions));
  });

  it("paves around the lab building, with a deep strip on its front wall", () => {
    const lab = labBuildings(LEVEL, "brick-loft")[0];
    const ring = orientRing(lab.outer, false);
    const front = frontEdges(LEVEL).get(lab.id);
    const tris = tiles.flatMap((t) => triangles(t.mesh));
    for (let i = 0; i < ring.length; i += 1) {
      const { m, n } = wallMid(ring, i);
      expect(covered(tris, m[0] + n[0] * 1.0, m[1] + n[1] * 1.0)).toBe(true);
      if (i === front.edge) expect(covered(tris, m[0] + n[0] * 3.2, m[1] + n[1] * 3.2)).toBe(true);
    }
  });

  it("paves only around storefront buildings", () => {
    const shops = (LEVEL.buildings ?? []).filter((b) => b.outer?.length >= 3 && b.height > 0 && STYLES[STYLE_INDEX[chooseStyle(b)]].storefront);
    const strips = tiles.reduce((s, t) => s + t.mesh.indices.length, 0);
    expect(shops.length).toBeGreaterThan(0);
    expect(strips).toBeGreaterThan(0);
    // One strip and at most one corner square for each wall.
    const walls = shops.reduce((s, b) => s + b.outer.length, 0);
    expect(strips / 6).toBeLessThanOrEqual(walls * 2);
  });

  it("follows the terrain like the other ground pieces", () => {
    const terrain = terrainOf(LEVEL);
    const ground = LEVEL.surfaces?.ground ?? 0;
    for (const { mesh } of tiles.slice(0, 20)) {
      const d = drapeMesh(mesh, terrain);
      expect(d.indices.length).toBeGreaterThan(0);
      for (let i = 0; i < d.positions.length; i += 3) {
        const x = d.positions[i];
        const z = d.positions[i + 2];
        expect(d.positions[i + 1]).toBeCloseTo(ground + APRON.lift + (terrain.flat ? 0 : terrain.height(x, z)), 3);
      }
    }
  });

  it("stays under the streets and the sidewalks", () => {
    expect(APRON.lift).toBeLessThan(LEVEL.surfaces.park);
    expect(APRON.lift).toBeGreaterThan(LEVEL.surfaces.ground);
  });
});
