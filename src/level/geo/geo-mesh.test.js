import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildGeoMeshes, buildingColor, GEO_MATERIALS, GEO_TILE } from "./geo-mesh.js";

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

  it("gives every vertex a color and keeps every index in range", () => {
    for (const { mesh } of meshes) {
      expect(mesh.colors.length).toBe(mesh.positions.length);
      const n = mesh.positions.length / 3;
      for (const i of mesh.indices) expect(i).toBeLessThan(n);
    }
  });

  it("reaches the height of Ponce City Market (50 m) and no higher than the tallest building", () => {
    const tallest = Math.max(...LEVEL.buildings.map((b) => b.height));
    let maxY = 0;
    for (const { material, mesh } of meshes) {
      if (material !== "building") continue;
      for (let i = 1; i < mesh.positions.length; i += 3) maxY = Math.max(maxY, mesh.positions[i]);
    }
    expect(maxY).toBeCloseTo(tallest, 4);
    expect(LEVEL.buildings.find((b) => b.name === "Ponce City Market").height).toBe(50);
  });

  it("gives a building the same color on every build", () => {
    expect(buildingColor("w184803195")).toEqual(buildingColor("w184803195"));
  });
});
