import { describe, expect, it } from "vitest";
import { extrudeFootprint, flatPolygon, mergeMeshes, placeTemplate, signedArea, stripMesh } from "./extrude.js";

const SQUARE = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

function triangles(mesh) {
  const out = [];
  const p = mesh.positions;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    out.push([0, 1, 2].map((k) => [p[mesh.indices[i + k] * 3], p[mesh.indices[i + k] * 3 + 1], p[mesh.indices[i + k] * 3 + 2]]));
  }
  return out;
}

function normal([a, b, c]) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(...n);
  return n.map((x) => x / l);
}

function area([a, b, c]) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
}

describe("extrudeFootprint", () => {
  for (const [label, ring] of [
    ["counterclockwise", SQUARE],
    ["clockwise", SQUARE.slice().reverse()],
    ["closed (first point repeated)", [...SQUARE, SQUARE[0]]],
  ]) {
    it(`builds 4 walls and a roof with outward normals from a ${label} ring`, () => {
      const tris = triangles(extrudeFootprint({ outer: ring, top: 12 }));
      expect(tris.length).toBe(4 * 2 + 2);
      for (const t of tris) {
        const n = normal(t);
        const c = [0, 1, 2].map((k) => (t[0][k] + t[1][k] + t[2][k]) / 3);
        if (Math.abs(n[1]) > 0.99) {
          // The roof faces up and sits at the top.
          expect(n[1]).toBeGreaterThan(0.99);
          expect(c[1]).toBeCloseTo(12, 9);
        } else {
          // A wall normal points away from the center of the footprint.
          expect(n[0] * (c[0] - 5) + n[2] * (c[2] - 5)).toBeGreaterThan(0);
          expect(Math.abs(n[1])).toBeLessThan(1e-9);
        }
      }
      // Wall area 4 * 10 * 12 plus the roof 100.
      const total = tris.reduce((s, t) => s + area(t), 0);
      expect(total).toBeCloseTo(480 + 100, 6);
    });
  }

  it("cuts a courtyard out of the roof and turns the hole walls inward", () => {
    const hole = [
      [4, 4],
      [6, 4],
      [6, 6],
      [4, 6],
    ];
    const tris = triangles(extrudeFootprint({ outer: SQUARE, holes: [hole], top: 5 }));
    const roof = tris.filter((t) => normal(t)[1] > 0.99);
    expect(roof.reduce((s, t) => s + area(t), 0)).toBeCloseTo(100 - 4, 6);
    const holeWalls = tris.filter((t) => Math.abs(normal(t)[1]) < 0.5 && t.every((p) => p[0] >= 4 && p[0] <= 6 && p[2] >= 4 && p[2] <= 6));
    expect(holeWalls.length).toBe(8);
    for (const t of holeWalls) {
      const n = normal(t);
      const c = [0, 2].map((k) => (t[0][k] + t[1][k] + t[2][k]) / 3);
      // Toward the courtyard center (5, 5): the hole wall faces into the hole.
      expect(n[0] * (5 - c[0]) + n[2] * (5 - c[1])).toBeGreaterThan(0);
    }
  });

  it("gives every vertex a color when a color is set, and the roof its own color", () => {
    const m = extrudeFootprint({ outer: SQUARE, top: 3 }, { color: [1, 0, 0], roofColor: [0, 0, 1] });
    expect(m.colors.length).toBe(m.positions.length);
    const roofY = [];
    for (let i = 0; i < m.positions.length / 3; i += 1) if (m.colors[i * 3 + 2] === 1) roofY.push(m.positions[i * 3 + 1]);
    expect(roofY.length).toBe(4);
    expect(roofY.every((y) => y === 3)).toBe(true);
  });

  it("returns an empty mesh for a degenerate footprint or a zero height", () => {
    expect(extrudeFootprint({ outer: [[0, 0], [1, 1]], top: 5 }).indices.length).toBe(0);
    expect(extrudeFootprint({ outer: SQUARE, top: 0 }).indices.length).toBe(0);
  });
});

describe("flatPolygon and stripMesh", () => {
  it("triangulates an L-shaped polygon to its exact area, facing up", () => {
    const L = [
      [0, 0],
      [10, 0],
      [10, 4],
      [4, 4],
      [4, 10],
      [0, 10],
    ];
    expect(Math.abs(signedArea(L))).toBe(64);
    const tris = triangles(flatPolygon(L, [], 0.02));
    expect(tris.reduce((s, t) => s + area(t), 0)).toBeCloseTo(64, 9);
    for (const t of tris) expect(normal(t)[1]).toBeGreaterThan(0.99);
  });

  it("builds a ribbon of the right width at the surface height", () => {
    const m = stripMesh(
      [
        [0, 0],
        [20, 0],
      ],
      4,
      0.07,
    );
    const tris = triangles(m);
    expect(tris.reduce((s, t) => s + area(t), 0)).toBeCloseTo(80, 9);
    for (const t of tris) {
      expect(normal(t)[1]).toBeGreaterThan(0.99);
      for (const p of t) expect(p[1]).toBe(0.07);
    }
  });

  it("fills the joint of a bend and adds curb walls to a raised sidewalk", () => {
    const pts = [
      [0, 0],
      [10, 0],
      [10, 10],
    ];
    const plain = triangles(stripMesh(pts, 2, 0.15));
    // 2 segment quads (4 triangles) plus an 8-sided joint disk (6 triangles).
    expect(plain.length).toBe(4 + 6);
    const curb = triangles(stripMesh(pts, 2, 0.15, { curb: true, bottom: 0 }));
    const walls = curb.filter((t) => Math.abs(normal(t)[1]) < 1e-9);
    // 4 walls per segment, 2 triangles each.
    expect(walls.length).toBe(2 * 4 * 2);
    for (const t of walls) for (const p of t) expect([0, 0.15]).toContain(p[1]);
  });

  it("merges meshes and offsets the indices", () => {
    const a = flatPolygon(SQUARE, [], 0, { color: [1, 1, 1] });
    const b = flatPolygon(SQUARE.map(([x, z]) => [x + 20, z]), [], 0, { color: [0, 0, 0] });
    const m = mergeMeshes([a, b]);
    expect(m.positions).toBeInstanceOf(Float32Array);
    expect(m.indices).toBeInstanceOf(Uint32Array);
    expect(m.positions.length).toBe(a.positions.length + b.positions.length);
    expect(m.colors.length).toBe(m.positions.length);
    expect(Math.max(...m.indices)).toBe(m.positions.length / 3 - 1);
    expect(m.indices.slice(a.indices.length).every((i) => i >= a.positions.length / 3)).toBe(true);
  });
});

describe("facade attribute and parapet", () => {
  it("counts whole bays along each wall and floors up it, and adds a parapet ring", () => {
    const m = extrudeFootprint({ outer: SQUARE, top: 9 }, { color: [1, 1, 1], facade: { style: 2, bay: 3, floorHeight: 3, parapet: 0.6, corniceColor: [0.5, 0.5, 0.5] } });
    expect(m.facade.length / 4).toBe(m.positions.length / 3);
    const walls = [];
    const cornice = [];
    for (let i = 0; i < m.facade.length / 4; i += 1) {
      const f = m.facade.slice(i * 4, i * 4 + 4);
      expect(f[0]).toBe(2);
      if (f[3] === 1) walls.push(f);
      if (f[3] === 2) cornice.push(m.positions[i * 3 + 1]);
    }
    // 10 m walls at a 3 m bay: 3 bays. 9 m at 3 m floors: 3 floors.
    expect(Math.max(...walls.map((f) => f[1]))).toBe(3);
    expect(Math.max(...walls.map((f) => f[2]))).toBe(3);
    expect(Math.max(...cornice)).toBeCloseTo(9.6, 9);
    // Outer and inner parapet faces: 2 rings of 4 walls, 4 vertices each.
    expect(cornice.length).toBe(2 * 4 * 4);
  });

  it("places a template turned and moved", () => {
    const mesh = { positions: [], indices: [], colors: [] };
    placeTemplate(mesh, { positions: [1, 0, 0], indices: [0], colors: [0.2, 0.4, 0.6] }, { x: 10, y: 2, z: 5, yaw: Math.PI, scale: 2 });
    expect(mesh.positions[0]).toBeCloseTo(8, 9);
    expect(mesh.positions[1]).toBeCloseTo(2, 9);
    expect(mesh.positions[2]).toBeCloseTo(5, 9);
    expect(mesh.colors).toEqual([0.2, 0.4, 0.6]);
  });
});
