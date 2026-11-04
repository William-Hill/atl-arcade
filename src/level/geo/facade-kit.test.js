import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEPTH_TILE, FRONT, KIT, buildingKit, crownKit, crownPanel, facadeKit, frontEdge, frontEdges, gableRoof, ledge, minRect, offsetRing, shopFront, solidBox, stairBulkhead, wallBox, wallDepth } from "./facade-kit.js";
import { SIGN_COLORS, STYLES } from "./styles.js";
import { orientRing } from "./extrude.js";
import { muralWalls } from "./geo-mesh.js";
import { labBuildings } from "./lab.js";

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

// Issue #80: no kit geometry (sills, piers, ledges) crosses a mural. Each
// kit triangle near a mural is sampled every 0.2 m; no sample may be in the
// box in front of the mural (out to 0.5 m from the wall).
describe("the facade kit and the murals", () => {
  it("puts no kit geometry on a mural", () => {
    const murals = muralWalls(LEVEL);
    expect(murals.length).toBeGreaterThanOrEqual(10);
    const { tiles, depthTiles } = facadeKit(LEVEL);
    const meshes = [...tiles, ...depthTiles].map((t) => t.mesh);
    const boxes = murals.map((m) => {
      const len = Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1]);
      const t = [(m.b[0] - m.a[0]) / len, (m.b[1] - m.a[1]) / len];
      return { m, len, t, minX: Math.min(m.a[0], m.b[0]) - 1, maxX: Math.max(m.a[0], m.b[0]) + 1, minZ: Math.min(m.a[1], m.b[1]) - 1, maxZ: Math.max(m.a[1], m.b[1]) + 1 };
    });
    const inside = (box, x, y, z) => {
      const dx = x - box.m.a[0];
      const dz = z - box.m.a[1];
      const along = dx * box.t[0] + dz * box.t[1];
      const out = dx * box.m.n[0] + dz * box.m.n[1];
      return along > 0 && along < box.len && out > 0.01 && out < 0.5 && y > box.m.y0 && y < box.m.y1;
    };
    const hits = [];
    for (const mesh of meshes) {
      const p = mesh.positions;
      const idx = mesh.indices;
      for (let i = 0; i < idx.length; i += 3) {
        const v = [idx[i], idx[i + 1], idx[i + 2]].map((k) => [p[k * 3], p[k * 3 + 1], p[k * 3 + 2]]);
        const minX = Math.min(v[0][0], v[1][0], v[2][0]);
        const maxX = Math.max(v[0][0], v[1][0], v[2][0]);
        const minZ = Math.min(v[0][2], v[1][2], v[2][2]);
        const maxZ = Math.max(v[0][2], v[1][2], v[2][2]);
        for (const box of boxes) {
          if (maxX < box.minX || minX > box.maxX || maxZ < box.minZ || minZ > box.maxZ) continue;
          const size = Math.max(Math.hypot(v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]), Math.hypot(v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]));
          const n = Math.max(1, Math.ceil(size / 0.2));
          let hit = false;
          for (let a = 0; a <= n && !hit; a += 1) {
            for (let b = 0; a + b <= n && !hit; b += 1) {
              const u = a / n;
              const w = b / n;
              const q = [0, 1, 2].map((k) => v[0][k] + (v[1][k] - v[0][k]) * u + (v[2][k] - v[0][k]) * w);
              if (inside(box, q[0], q[1], q[2])) hit = true;
            }
          }
          if (hit) hits.push(box.m.id);
        }
      }
    }
    expect([...new Set(hits)]).toEqual([]);
  });
});

// The lab building w270469054: a 27.1 m x 8.7 m brick loft, 9.7 m tall.
const LOFT = STYLES.find((st) => st.id === "brick-loft");
const LAB = orientRing([[0, 0], [27.1, 0], [27.1, 8.7], [0, 8.7]], false);

function vertices(m) {
  const out = [];
  for (let i = 0; i < m.positions.length; i += 3) out.push({ p: [m.positions[i], m.positions[i + 1], m.positions[i + 2]], c: [m.colors[i], m.colors[i + 1], m.colors[i + 2]] });
  return out;
}

// The longest wall of a ring, as crownPanel() and frontEdge() pick it.
function wall(ring, i) {
  const [px, pz] = ring[i];
  const [qx, qz] = ring[(i + 1) % ring.length];
  const len = Math.hypot(qx - px, qz - pz);
  const t = [(qx - px) / len, (qz - pz) / len];
  const n = [-t[1], t[0]];
  // Along the wall and out of the wall, for a point [x, y, z].
  const along = (p) => (p[0] - px) * t[0] + (p[2] - pz) * t[1];
  const out = (p) => (p[0] - px) * n[0] + (p[2] - pz) * n[1];
  return { len, along, out };
}

function longest(ring) {
  let best = 0;
  for (let i = 1; i < ring.length; i += 1) if (wall(ring, i).len > wall(ring, best).len) best = i;
  return best;
}

describe("the crown of a brick loft", () => {
  const top = 9.7;
  const p = LOFT.parapet;

  it("builds a raised center parapet and a stair bulkhead on the lab building", () => {
    expect(crownKit(empty(), LAB, top, LOFT, 0, LOFT.walls[0], 7)).toEqual({ crown: 1, bulkhead: 1 });
  });

  it("puts the panel coping at the parapet top plus the step, on the center 2 bays", () => {
    const m = empty();
    expect(crownPanel(m, LAB, top, LOFT, 0, LOFT.walls[0])).toBe(1);
    const w = wall(LAB, longest(LAB));
    const vs = vertices(m);
    const near = vs.filter(({ p: q }) => Math.abs(w.out(q)) < 0.5);
    const maxY = Math.max(...near.map(({ p: q }) => q[1]));
    expect(maxY).toBeCloseTo(top + p + LOFT.crown.step + KIT.coping.height, 2);
    expect(maxY).toBeCloseTo(11.94, 2);
    // The panel vertices on the wall line are between the bay lines of bays 3 and 5.
    const bl = 27.1 / 8;
    const online = vs.filter(({ p: q }) => Math.abs(w.out(q)) < 1e-6 && q[1] > top + p - 1e-6);
    expect(online.length).toBeGreaterThan(0);
    for (const { p: q } of online) {
      expect(w.along(q)).toBeGreaterThanOrEqual(3 * bl - 1e-6);
      expect(w.along(q)).toBeLessThanOrEqual(5 * bl + 1e-6);
    }
  });

  it("keeps the bulkhead inside the roof, 0.9 m or more from every wall", () => {
    for (const seed of [0, 1]) {
      const m = empty();
      expect(stairBulkhead(m, LAB, top, LOFT, 0, LOFT.walls[0], seed)).toBe(1);
      const ys = vertices(m).map(({ p: q }) => q[1]);
      expect(Math.max(...ys)).toBeCloseTo(9.7 + 2.8 + 0.12, 6);
      expect(Math.min(...ys)).toBeCloseTo(top, 6);
      for (const { p: q } of vertices(m)) {
        expect(q[0]).toBeGreaterThanOrEqual(0.9);
        expect(q[0]).toBeLessThanOrEqual(27.1 - 0.9);
        expect(q[2]).toBeGreaterThanOrEqual(0.9);
        expect(q[2]).toBeLessThanOrEqual(8.7 - 0.9);
      }
    }
  });

  it("puts the bulkhead at the end that the seed picks", () => {
    const xs = [0, 1].map((seed) => {
      const m = empty();
      stairBulkhead(m, LAB, top, LOFT, 0, LOFT.walls[0], seed);
      const v = vertices(m).map(({ p: q }) => q[0]);
      return (Math.min(...v) + Math.max(...v)) / 2;
    });
    expect(Math.abs(xs[0] - 27.1 / 2)).toBeCloseTo(10.55, 6);
    expect(Math.abs(xs[1] - 27.1 / 2)).toBeCloseTo(10.55, 6);
    expect(Math.sign(xs[0] - 27.1 / 2)).toBe(-Math.sign(xs[1] - 27.1 / 2));
  });

  it("gives the same mesh on every build", () => {
    const a = empty();
    const b = empty();
    crownKit(a, LAB, top, LOFT, 0, LOFT.walls[0], 12345);
    crownKit(b, LAB, top, LOFT, 0, LOFT.walls[0], 12345);
    expect(a.positions).toEqual(b.positions);
    expect(a.indices).toEqual(b.indices);
  });

  it("gives a 3-bay building no raised panel and a house no crown", () => {
    const small = orientRing([[0, 0], [10, 0], [10, 6], [0, 6]], false);
    expect(crownKit(empty(), small, 8, LOFT, 0, LOFT.walls[0], 1).crown).toBe(0);
    const house = { id: "h2", type: "house", height: 7, outer: [[0, 0], [12, 0], [12, 8], [0, 8]] };
    expect(buildingKit(empty(), house)).toMatchObject({ crown: 0, bulkhead: 0 });
    const loft = { id: "l1", name: "Stove Works", height: 9.7, outer: [[0, 0], [27.1, 0], [27.1, 8.7], [0, 8.7]] };
    expect(buildingKit(empty(), loft)).toMatchObject({ crown: 1, bulkhead: 1 });
  });

  it("builds a closed box whose faces point away from its center", () => {
    const m = empty();
    solidBox(m, [0, 0], [1, 0], [0, -1], 0, 2, -1, 1, 0, 2, [1, 1, 1], 0);
    expect(m.indices.length / 3).toBe(12);
    for (const { n, c } of normals(m)) expect(n[0] * (c[0] - 1) + n[1] * (c[1] - 1) + n[2] * c[2]).toBeGreaterThan(0);
  });
});

describe("the shop front of a storefront building", () => {
  const floorH = 3.68;

  it("picks the longest wall when no wall faces a street", () => {
    const f = frontEdge(LAB, () => false);
    expect(f.street).toBe(false);
    expect(wall(LAB, f.edge).len).toBeCloseTo(27.1);
  });

  it("picks a short wall when only that wall faces a street", () => {
    const f = frontEdge(LAB, (x) => x > 29);
    expect(f.street).toBe(true);
    expect(wall(LAB, f.edge).len).toBeCloseTo(8.7);
    // The wall at x = 27.1.
    const [px] = LAB[f.edge];
    const [qx] = LAB[(f.edge + 1) % LAB.length];
    expect(px).toBeCloseTo(27.1);
    expect(qx).toBeCloseTo(27.1);
  });

  it("puts a sign band in each bay, between the piers and under the belt course", () => {
    const awningColor = [0.123, 0.456, 0.789];
    // The front wall only: the wrap bands have a test of their own.
    const front = { ...frontEdge(LAB, () => false), wraps: [] };
    const m = empty();
    const c = shopFront(m, LAB, LOFT, 0, 0, floorH, front, 99, awningColor);
    expect(c.sign).toBe(8);
    expect(c.awning).toBeGreaterThanOrEqual(2);
    const w = wall(LAB, front.edge);
    const bl = w.len / 8;
    const piers = Array.from({ length: 9 }, (_, k) => Math.min(Math.max(k * bl, KIT.pier.width / 2), w.len - KIT.pier.width / 2));
    const signs = vertices(m).filter(({ c: col }) => Math.abs(col[0] - awningColor[0]) > 1e-6);
    expect(signs.length).toBeGreaterThan(0);
    for (const { p: q, c: col } of signs) {
      expect(q[1]).toBeGreaterThanOrEqual(0.84 * floorH - 1e-6);
      expect(q[1]).toBeLessThanOrEqual(floorH - 0.14 + 1e-6);
      expect(w.out(q)).toBeLessThanOrEqual(0.1 + 1e-6);
      expect(w.out(q)).toBeGreaterThanOrEqual(-1e-6);
      for (const pc of piers) expect(Math.abs(w.along(q) - pc)).toBeGreaterThan(0.18);
      const known = [...SIGN_COLORS, LOFT.trim].some((k) => k.every((v, i) => Math.abs(v - col[i]) < 1e-6));
      expect(known).toBe(true);
    }
  });

  it("builds no kit awning on a street wall", () => {
    const front = frontEdge(LAB, (x) => x > 29);
    const c = shopFront(empty(), LAB, LOFT, 0, 0, floorH, front, 99);
    expect(c.awning).toBe(0);
    expect(c.sign).toBeGreaterThan(0);
  });

  it("gives the same mesh on every build", () => {
    const front = frontEdge(LAB, () => false);
    const a = empty();
    const b = empty();
    shopFront(a, LAB, LOFT, 0, 0, floorH, front, 4242);
    shopFront(b, LAB, LOFT, 0, 0, floorH, front, 4242);
    expect(a.positions).toEqual(b.positions);
    expect(a.colors).toEqual(b.colors);
  });

  it("builds no shop front without a front wall", () => {
    const loft = { id: "l1", name: "Stove Works", height: 9.7, outer: [[0, 0], [27.1, 0], [27.1, 8.7], [0, 8.7]] };
    expect(buildingKit(empty(), loft)).toMatchObject({ sign: 0, awning: 0 });
    expect(buildingKit(empty(), loft, undefined, undefined, null, frontEdge(orientRing(loft.outer, false), () => false)).sign).toBeGreaterThan(0);
  });
});

// The frames must not read as black outlines at 30 m: on a brick style with
// a frame color, the frame luma is 0.7 to 1.0 of the darkest wall luma.
describe("the window frame colors", () => {
  const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  it("keeps the frames of each brick style near the brick value", () => {
    const framed = STYLES.filter((st) => st.brick && st.frame);
    expect(framed.map((st) => st.id).sort()).toEqual(["brick-loft", "brick-warehouse"]);
    for (const st of framed) {
      const r = luma(st.frame) / Math.min(...st.walls.map(luma));
      expect(r).toBeGreaterThanOrEqual(0.7);
      expect(r).toBeLessThanOrEqual(1.0);
    }
  });
});

// The outward normal z of wall i of a ring (the walls of LAB are along x or z).
function wallNormal(ring, i) {
  const [px, pz] = ring[i];
  const [qx, qz] = ring[(i + 1) % ring.length];
  const len = Math.hypot(qx - px, qz - pz);
  return [-(qz - pz) / len, (qx - px) / len];
}
// The wall of LAB whose outward normal is n.
function labWall(n) {
  return LAB.findIndex((_, i) => {
    const w = wallNormal(LAB, i);
    return Math.abs(w[0] - n[0]) < 1e-6 && Math.abs(w[1] - n[1]) < 1e-6;
  });
}

describe("the front wall of a building with no street wall", () => {
  const SOUTH = labWall([0, -1]); // the long wall at z = 0
  const NORTH = labWall([0, 1]); // the long wall at z = 8.7
  const EAST = labWall([1, 0]); // the short wall at x = 27.1
  const WEST = labWall([-1, 0]);

  it("does not face the back of a neighbor 8 m away", () => {
    const neighbor = (x, z) => z < -8 && z > -20 && x > -5 && x < 32;
    for (const isStreet of [() => false, (x, z) => z < -30 || z > 40]) {
      const f = frontEdge(LAB, isStreet, neighbor);
      expect(f.edge).toBe(NORTH);
      expect(f.street).toBe(false);
    }
  });

  it("takes the long wall with the nearest street", () => {
    const f = frontEdge(LAB, (x, z) => z < -30 || z > 8.7 + 14);
    expect(f.edge).toBe(NORTH);
    const g = frontEdge(LAB, (x, z) => z < -12 || z > 8.7 + 30);
    expect(g.edge).toBe(SOUTH);
  });

  it("ignores one stray street sample between the wall and a neighbor", () => {
    // A short drive in front of one sample line only, then a neighbor.
    const drive = (x, z) => x > 18 && x < 23 && z < -8 && z > -10;
    const neighbor = (x, z) => z < -14 && z > -30;
    const f = frontEdge(LAB, (x, z) => drive(x, z) || z > 8.7 + 40, neighbor);
    expect(f.edge).toBe(NORTH);
  });

  it("does not take a short wall when no wall faces a street", () => {
    // Only the short east wall has open ground; it is too short to be the front.
    const blocked = (x, z) => x < 27.1 && (z < -6 || z > 14.7);
    const f = frontEdge(LAB, () => false, blocked);
    expect(wall(LAB, f.edge).len).toBeGreaterThan(27.1 * FRONT.minLength);
  });

  it("wraps the sign band onto a next wall that faces open ground", () => {
    const f = frontEdge(LAB, () => false, (x, z) => z < -8);
    expect(f.edge).toBe(NORTH);
    expect([...f.wraps].sort()).toEqual([EAST, WEST].sort());
    // A neighbor 10 m off the west wall: no wrap there.
    const g = frontEdge(LAB, () => false, (x, z) => z < -8 || x < -10);
    expect(g.wraps).toEqual([EAST]);
  });

  it("builds the wrap band in the corner bay of the next wall", () => {
    const floorH = 3.68;
    const front = frontEdge(LAB, () => false, (x, z) => z < -8 || x < -10);
    const plain = shopFront(empty(), LAB, LOFT, 0, 0, floorH, { ...front, wraps: [] }, 99);
    const m = empty();
    const c = shopFront(m, LAB, LOFT, 0, 0, floorH, front, 99);
    expect(c.sign).toBe(plain.sign + 1);
    // The bands on the east wall: in its corner bay next to the north wall.
    const w = wall(LAB, EAST);
    const bay = w.len / Math.max(1, Math.round(w.len / LOFT.bay));
    const sign = SIGN_COLORS[99 % SIGN_COLORS.length];
    const east = vertices(m).filter(({ p: q, c: col }) => q[0] > 27.1 + 1e-6 && sign.every((v, i) => Math.abs(v - col[i]) < 1e-6));
    expect(east.length).toBeGreaterThan(0);
    for (const { p: q } of east) {
      expect(w.out(q)).toBeLessThanOrEqual(KIT.sign.out + 1e-6);
      expect(q[2]).toBeGreaterThan(8.7 - bay - 1e-6);
      expect(q[1]).toBeGreaterThanOrEqual(0.84 * floorH - 1e-6);
    }
  });

  it("keeps the old front on a street wall", () => {
    const f = frontEdge(LAB, (x) => x > 29);
    expect(f.street).toBe(true);
    expect(f.edge).toBe(EAST);
  });

  it("gives the BeltLine lab building a front on open ground", () => {
    const lab = labBuildings(LEVEL, "brick-loft")[0];
    const ring = orientRing(lab.outer, false);
    const f = frontEdges(LEVEL).get(lab.id);
    expect(f.street).toBe(false);
    // The front is a long wall, and its normal points to the open side (+z):
    // the other long wall faces the back of a neighbor.
    expect(wall(ring, f.edge).len).toBeGreaterThan(27);
    expect(wallNormal(ring, f.edge)[1]).toBeGreaterThan(0.99);
    expect(f.wraps.length).toBeGreaterThan(0);
  });
});
