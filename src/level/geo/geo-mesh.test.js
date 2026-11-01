import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildGeoMeshes, buildingColor, buildPropMeshes, GEO_MATERIALS, GEO_TILE, muralWalls, PROP_TILE } from "./geo-mesh.js";
import { FACE } from "./extrude.js";
import { STYLES } from "./styles.js";

const LEVEL = JSON.parse(readFileSync(new URL("../../../levels/beltline-eastside/level.json", import.meta.url), "utf8"));

describe("geo meshes for the BeltLine Eastside block", () => {
  const meshes = buildGeoMeshes(LEVEL);

  it("merges every building and surface into one mesh per material per tile", () => {
    const tilesX = Math.ceil((LEVEL.bounds.maxX - LEVEL.bounds.minX) / GEO_TILE) + 1;
    const tilesZ = Math.ceil((LEVEL.bounds.maxZ - LEVEL.bounds.minZ) / GEO_TILE) + 1;
    expect(meshes.length).toBeLessThanOrEqual(GEO_MATERIALS.length * tilesX * tilesZ);
    expect(meshes.length).toBeLessThan(LEVEL.buildings.length / 10);
    const keys = new Set(meshes.map((m) => `${m.material}|${m.tile}`));
    expect(keys.size).toBe(meshes.length);
    for (const m of meshes) expect(GEO_MATERIALS).toContain(m.material);
  });

  it("gives every vertex a color (a mural a texture coordinate) and keeps every index in range", () => {
    for (const { material, mesh } of meshes) {
      if (material === "mural") expect(mesh.uvs.length / 2).toBe(mesh.positions.length / 3);
      else expect(mesh.colors.length).toBe(mesh.positions.length);
      const n = mesh.positions.length / 3;
      for (const i of mesh.indices) expect(i).toBeLessThan(n);
    }
  });

  it("reaches the height of Ponce City Market (50 m) and no higher than the tallest building plus its parapet", () => {
    const tallest = Math.max(...LEVEL.buildings.map((b) => b.height)) + Math.max(...STYLES.map((s) => s.parapet));
    let maxY = 0;
    for (const { material, mesh } of meshes) {
      if (material !== "building") continue;
      for (let i = 1; i < mesh.positions.length; i += 3) maxY = Math.max(maxY, mesh.positions[i]);
    }
    expect(maxY).toBeLessThanOrEqual(tallest + 1e-4);
    expect(maxY).toBeGreaterThanOrEqual(50);
    expect(LEVEL.buildings.find((b) => b.name === "Ponce City Market").height).toBe(50);
  });

  it("gives a building the same color on every build", () => {
    expect(buildingColor("w184803195")).toEqual(buildingColor("w184803195"));
  });
});

describe("level detail", () => {
  const meshes = buildGeoMeshes(LEVEL);

  it("gives the building meshes a facade attribute with walls, roofs, and cornices", () => {
    const kinds = new Set();
    for (const { material, mesh } of meshes) {
      if (material !== "building") continue;
      expect(mesh.facade.length / 4).toBe(mesh.positions.length / 3);
      for (let i = 3; i < mesh.facade.length; i += 4) kinds.add(mesh.facade[i]);
      for (let i = 0; i < mesh.facade.length; i += 4) expect(mesh.facade[i]).toBeLessThan(STYLES.length);
    }
    expect([...kinds].sort()).toEqual([FACE.roof, FACE.wall, FACE.cornice]);
  });

  it("puts murals only on walls that face the trail, at most one per building", () => {
    const murals = muralWalls(LEVEL);
    expect(murals.length).toBeGreaterThanOrEqual(10);
    expect(new Set(murals.map((m) => m.id)).size).toBe(murals.length);
    for (const m of murals) {
      expect(m.y1).toBeGreaterThan(m.y0);
      expect(Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1])).toBeGreaterThan(4);
    }
  });

  it("keeps the plain M1-03 boxes with detail: false", () => {
    const plain = buildGeoMeshes(LEVEL, { detail: false });
    expect(plain.some((m) => m.material === "mural")).toBe(false);
    expect(plain.find((m) => m.material === "building").mesh.facade).toBeUndefined();
  });

  it("merges placed kit props into one mesh per prop tile and level of detail", () => {
    const template = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2], colors: [1, 0, 0, 1, 0, 0, 1, 0, 0] };
    const props = [
      { kind: "bench", x: 1, y: 0, z: 1, yaw: 0 },
      { kind: "bench", x: 2, y: 0, z: 2, yaw: Math.PI / 2 },
      { kind: "bench", x: PROP_TILE + 1, y: 0, z: 1, yaw: 0 },
      { kind: "unknown", x: 0, y: 0, z: 0, yaw: 0 },
    ];
    const lod1 = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1], indices: [0, 1, 2, 0, 2, 3], colors: new Array(12).fill(0.5) };
    const out = buildPropMeshes(props, { bench: template, bench_lod1: lod1 });
    // Two tiles, each at LOD0 and LOD1.
    expect(out.length).toBe(4);
    const lod0 = out.filter((t) => t.lod === 0);
    expect(lod0.reduce((n, t) => n + t.mesh.indices.length, 0)).toBe(9);
    expect(out.filter((t) => t.lod === 1).reduce((n, t) => n + t.mesh.indices.length, 0)).toBe(18);
    // Yaw PI/2 turns the template +x toward -z.
    const second = lod0.find((t) => t.tile === "0,0").mesh.positions;
    expect(second[9 + 3]).toBeCloseTo(2, 6);
    expect(second[9 + 5]).toBeCloseTo(1, 6);
  });
});
