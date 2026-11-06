// The fast drapeMesh() (#98) gives the same mesh, to the bit, as its first
// version (kept here as the reference): same vertices, same order, same welds.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { coarseTerrainOf, createTerrain, drapeMesh, terrainOf } from "./terrain.js";
import { flatPolygon, stripMesh } from "./extrude.js";
import { seededRandom } from "./styles.js";

const LEVEL = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../levels/beltline-eastside/level.json"), "utf8"));

const ATTRS = [
  ["colors", 3],
  ["facade", 4],
  ["uvs", 2],
];

// Clips a polygon (a list of vertices { p: [x, y, z], a: { attr: [] } }) to
// the half-plane f(x, z) >= 0, where f is linear.
function clip(poly, f) {
  const out = [];
  for (let i = 0; i < poly.length; i += 1) {
    const A = poly[i];
    const B = poly[(i + 1) % poly.length];
    const fa = f(A.p[0], A.p[2]);
    const fb = f(B.p[0], B.p[2]);
    if (fa >= 0) out.push(A);
    if ((fa >= 0) !== (fb >= 0)) {
      const k = fa / (fa - fb);
      const p = [A.p[0] + (B.p[0] - A.p[0]) * k, A.p[1] + (B.p[1] - A.p[1]) * k, A.p[2] + (B.p[2] - A.p[2]) * k];
      const a = {};
      for (const name in A.a) a[name] = A.a[name].map((v, n) => v + (B.a[name][n] - v) * k);
      out.push({ p, a });
    }
  }
  return out;
}

function area3(a, b, c) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
}

// Returns a new mesh: each triangle cut on the terrain triangles, and each
// vertex moved up by the terrain height under it. The colors, the facade
// attribute, and the uvs are kept (interpolated on the cut edges).
function drapeMeshReference(mesh, terrain) {
  if (terrain.flat) return mesh;
  const { cell, x0, z0 } = terrain;
  const P = mesh.positions;
  const names = ATTRS.filter(([n]) => mesh[n]);
  const out = { positions: [], indices: [] };
  for (const [n] of names) out[n] = [];
  const vert = (k) => {
    const a = {};
    for (const [n, size] of names) a[n] = Array.from(mesh[n].slice(k * size, k * size + size));
    return { p: [P[k * 3], P[k * 3 + 1], P[k * 3 + 2]], a };
  };
  // Shared vertices are welded (same position and attributes, to 0.1 mm),
  // so a draped mesh keeps about one vertex per corner. Only the faces of one
  // orientation weld (`facing`, from the flat triangle): the terrain gets
  // smooth normals, and a curb keeps a hard edge between its top and side.
  const welded = new Map();
  let facing = "";
  const vertexIndex = (V) => {
    let key = `${facing}:${Math.round(V.p[0] * 1e4)},${Math.round(V.p[1] * 1e4)},${Math.round(V.p[2] * 1e4)}`;
    for (const [n] of names) key += `|${V.a[n].map((v) => Math.round(v * 1e4)).join(",")}`;
    let k = welded.get(key);
    if (k === undefined) {
      k = out.positions.length / 3;
      welded.set(key, k);
      out.positions.push(V.p[0], V.p[1], V.p[2]);
      for (const [n] of names) out[n].push(...V.a[n]);
    }
    return k;
  };
  const I = mesh.indices;
  for (let t = 0; t < I.length; t += 3) {
    const tri = [vert(I[t]), vert(I[t + 1]), vert(I[t + 2])];
    {
      const [a, b, c] = tri.map((v) => v.p);
      const ux = b[0] - a[0];
      const uy = b[1] - a[1];
      const uz = b[2] - a[2];
      const vx = c[0] - a[0];
      const vy = c[1] - a[1];
      const vz = c[2] - a[2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      facing = `${Math.round((nx / l) * 4)},${Math.round((ny / l) * 4)},${Math.round((nz / l) * 4)}`;
    }
    const xs = tri.map((v) => v.p[0]);
    const zs = tri.map((v) => v.p[2]);
    const i0 = Math.floor((Math.min(...xs) - x0) / cell);
    const i1 = Math.floor((Math.max(...xs) - x0) / cell);
    const j0 = Math.floor((Math.min(...zs) - z0) / cell);
    const j1 = Math.floor((Math.max(...zs) - z0) / cell);
    // A triangle with a position that is not finite has no cells. Without
    // this check an infinite range makes the cell loop run without end.
    if (![i0, i1, j0, j1].every(Number.isFinite)) continue;
    for (let i = i0; i <= i1; i += 1) {
      for (let j = j0; j <= j1; j += 1) {
        const cx = x0 + i * cell;
        const cz = z0 + j * cell;
        const u = (x) => (x - cx) / cell;
        const v = (z) => (z - cz) / cell;
        let cellPoly = clip(clip(clip(clip(tri, (x) => u(x)), (x) => 1 - u(x)), (x, z) => v(z)), (x, z) => 1 - v(z));
        if (cellPoly.length < 3) continue;
        for (const half of [(x, z) => 1 - u(x) - v(z), (x, z) => u(x) + v(z) - 1]) {
          const poly = clip(cellPoly, half);
          if (poly.length < 3) continue;
          const moved = poly.map(({ p, a }) => ({ p: [p[0], p[1] + terrain.height(p[0], p[2]), p[2]], a }));
          for (let k = 1; k < moved.length - 1; k += 1) {
            const A = moved[0];
            const B = moved[k];
            const C = moved[k + 1];
            if (area3(A.p, B.p, C.p) < 1e-6) continue;
            for (const V of [A, B, C]) out.indices.push(vertexIndex(V));
          }
        }
        cellPoly = null;
      }
    }
  }
  const res = { positions: Float32Array.from(out.positions), indices: Uint32Array.from(out.indices) };
  for (const [n] of names) res[n] = Float32Array.from(out[n]);
  return res;
}

function same(a, b) {
  expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
  for (const k of Object.keys(a)) {
    expect(a[k].constructor).toBe(b[k].constructor);
    expect(Buffer.from(a[k].buffer, a[k].byteOffset, a[k].byteLength).equals(Buffer.from(b[k].buffer, b[k].byteOffset, b[k].byteLength)), k).toBe(true);
  }
}

function bowl() {
  const heights = [];
  for (let j = 0; j < 5; j += 1) for (let i = 0; i < 5; i += 1) heights.push(0.2 * ((i - 2) ** 2 + (j - 1.5) ** 2));
  return createTerrain({ cell: 10, x0: 0, z0: 0, cols: 5, rows: 5, heights });
}

// A random triangle soup with colors, the facade attribute, and uvs, some
// vertices shared, on the 40 m bowl.
function soup(seed) {
  const rand = seededRandom(seed);
  const n = 30;
  const positions = [];
  const colors = [];
  const facade = [];
  const uvs = [];
  for (let i = 0; i < n; i += 1) {
    positions.push(rand() * 40, rand() * 3 - 1, rand() * 40);
    colors.push(rand(), rand(), rand());
    facade.push(Math.floor(rand() * 9), rand() * 40, rand() * 8, Math.floor(rand() * 4));
    uvs.push(rand(), rand());
  }
  const indices = [];
  for (let t = 0; t < 40; t += 1) indices.push(Math.floor(rand() * n), Math.floor(rand() * n), Math.floor(rand() * n));
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices), colors: Float32Array.from(colors), facade: Float32Array.from(facade), uvs: Float32Array.from(uvs) };
}

describe("drapeMesh is the same as its first version (#98)", () => {
  it("on random meshes with every attribute", () => {
    const t = bowl();
    for (let seed = 1; seed <= 20; seed += 1) same(drapeMesh(soup(seed), t), drapeMeshReference(soup(seed), t));
  });

  it("on a mesh with only some attributes, a NaN, and a -0", () => {
    const t = bowl();
    const m = soup(7);
    delete m.facade;
    delete m.uvs;
    m.colors[0] = Number.NaN;
    m.colors[3] = -0;
    m.positions[4] = -0;
    same(drapeMesh(m, t), drapeMeshReference(m, t));
  });

  it("on the BeltLine streets, sidewalks, and areas, on the exact and the coarse terrain", () => {
    const fine = terrainOf(LEVEL);
    const coarse = coarseTerrainOf(LEVEL, 2);
    expect(fine.flat).toBe(false);
    const strips = (LEVEL.strips ?? []).filter((_, i) => i % 25 === 0);
    const areas = (LEVEL.areas ?? []).slice(0, 6);
    expect(strips.length).toBeGreaterThan(10);
    for (const t of [fine, coarse]) {
      for (const s of strips) {
        const m = stripMesh(s.points, s.width, 0.15, { curb: s.kind === "sidewalk", bottom: 0, color: [0.5, 0.5, 0.5] });
        same(drapeMesh(m, t), drapeMeshReference(m, t));
      }
      for (const a of areas) {
        const m = flatPolygon(a.outer, a.holes ?? [], 0.02, { color: [0.4, 0.7, 0.4] });
        same(drapeMesh(m, t), drapeMeshReference(m, t));
      }
    }
  });

  it("leaves a mesh on flat ground as it is", () => {
    const m = soup(3);
    expect(drapeMesh(m, { flat: true })).toBe(m);
  });
});
