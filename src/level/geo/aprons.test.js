import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { APRON, WALK_STRIP, apronRing, curbBox, shopWalk, storefrontAprons, walkStrip } from "./aprons.js";
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
    // The flat quads at the apron height: the strips, the corner squares,
    // and the walks. The curbs are higher or vertical.
    const y = (LEVEL.surfaces?.ground ?? 0) + APRON.lift;
    const flat = tiles.flatMap((t) => triangles(t.mesh)).filter((tri) => [tri.a, tri.b, tri.c].every((q) => Math.abs(q[1] - y) < 1e-4));
    expect(shops.length).toBeGreaterThan(0);
    expect(flat.length).toBeGreaterThan(0);
    // One strip and at most one corner square for each wall, and one walk
    // for each shop.
    const walls = shops.reduce((s, b) => s + b.outer.length, 0);
    expect(flat.length / 2).toBeLessThanOrEqual(walls * 2 + shops.length);
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
        // On the apron plane, up to the curb top.
        const dy = d.positions[i + 1] - (ground + APRON.lift + (terrain.flat ? 0 : terrain.height(x, z)));
        expect(dy).toBeGreaterThan(-5e-4);
        expect(dy).toBeLessThan(WALK_STRIP.curb[1] + 5e-4);
      }
    }
  });

  it("stays under the streets and the sidewalks", () => {
    expect(APRON.lift).toBeLessThan(LEVEL.surfaces.park);
    expect(APRON.lift).toBeGreaterThan(LEVEL.surfaces.ground);
  });
});

describe("the walk from a shop door", () => {
  // Wall 0 of RECT runs along +x at z = 6; its outward normal is +z.
  const bay = 2;

  it("runs from the front apron to the street edge, in front of the door bay", () => {
    const front = { edge: 0, street: false, wraps: [], door: 3, walk: 14 };
    const w = walkStrip(RECT, front, bay);
    expect(w.d0).toBe(APRON.front);
    expect(w.d1).toBe(14);
    expect((w.a0 + w.a1) / 2).toBeCloseTo(3.5 * 2, 6);
    expect(w.a1 - w.a0).toBeCloseTo(WALK_STRIP.width, 6);
    expect(w.n[0]).toBeCloseTo(0, 6);
    expect(w.n[1]).toBeCloseTo(1, 6);
  });

  it("builds no walk with no street, or a street at the apron edge", () => {
    expect(walkStrip(RECT, { edge: 0, door: 2, walk: null }, bay)).toBeNull();
    expect(walkStrip(RECT, { edge: 0, door: 2, walk: APRON.front + 0.2 }, bay)).toBeNull();
    expect(walkStrip(RECT, null, bay)).toBeNull();
  });

  it("builds the walk over a park and the curbs on the apron edge and the walk sides", () => {
    const m = empty();
    const c = shopWalk(m, RECT, { edge: 0, door: 2, walk: 12 }, bay, APRON.lift);
    // Two apron curb pieces (open at the walk) and two walk curbs.
    expect(c).toEqual({ walk: 1, curb: 4 });
    const tris = triangles(m);
    const walk = tris.filter((t) => [t.a, t.b, t.c].every((q) => Math.abs(q[1] - WALK_STRIP.lift) < 1e-6));
    expect(walk.length).toBe(2);
    expect(WALK_STRIP.lift).toBeGreaterThan(LEVEL.surfaces.park);
    expect(WALK_STRIP.lift).toBeLessThan(LEVEL.surfaces.street);
    // Every curb vertex is on the apron or at the curb top, and no curb
    // reaches the street.
    for (let i = 0; i < m.positions.length; i += 3) {
      const y = m.positions[i + 1];
      const z = m.positions[i + 2];
      expect([APRON.lift, WALK_STRIP.lift, APRON.lift + WALK_STRIP.curb[1]].some((v) => Math.abs(y - v) < 1e-6)).toBe(true);
      if (y > WALK_STRIP.lift + 1e-6) expect(z - 6).toBeLessThanOrEqual(12 - WALK_STRIP.curbGap + 1e-6);
    }
  });

  it("builds a closed curb box with its faces out", () => {
    const m = empty();
    expect(curbBox(m, [0, 0], [1, 0], [0, 1], 0, 2, 0, 0.2, 0, 0.1)).toBe(1);
    // A top and 4 sides.
    expect(m.indices.length / 3).toBe(10);
    const tris = triangles(m);
    // The top faces up, and each side faces away from the box center
    // (1, 0.05, 0.1).
    for (const t of tris) {
      const u = [t.b[0] - t.a[0], t.b[1] - t.a[1], t.b[2] - t.a[2]];
      const v = [t.c[0] - t.a[0], t.c[1] - t.a[1], t.c[2] - t.a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const c = [0, 1, 2].map((k) => (t.a[k] + t.b[k] + t.c[k]) / 3 - [1, 0.05, 0.1][k]);
      expect(n[0] * c[0] + n[1] * c[1] + n[2] * c[2]).toBeGreaterThan(0);
    }
  });

  it("gives the BeltLine shops walks to their streets", () => {
    const fronts = frontEdges(LEVEL);
    let walks = 0;
    for (const b of LEVEL.buildings) {
      const f = fronts.get(b.id);
      if (!f) continue;
      if (walkStrip(orientRing(b.outer, false), f, STYLES[STYLE_INDEX[chooseStyle(b)]].bay)) walks += 1;
    }
    expect(walks).toBeGreaterThan(20);
  });
});
