import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AWNING_COLORS, awningsFor, boundsDistance, buildGeoMeshes, buildingColor, buildPropMeshes, GEO_MATERIALS, GEO_TILE, meshBounds, muralWalls, PROP_TILE, roofColorOf, streetTest, streetWalls } from "./geo-mesh.js";
import { FACE, orientRing } from "./extrude.js";
import { STYLES, STYLE_INDEX, chooseStyle } from "./styles.js";
import { buildingSpan } from "./terrain.js";

const LEVEL = JSON.parse(readFileSync(new URL("../../../levels/beltline-eastside/level.json", import.meta.url), "utf8"));

describe("geo meshes for the BeltLine Eastside block", () => {
  const meshes = buildGeoMeshes(LEVEL);

  it("merges every building and surface into one mesh per material per tile", () => {
    const tilesX = Math.ceil((LEVEL.bounds.maxX - LEVEL.bounds.minX) / GEO_TILE) + 1;
    const tilesZ = Math.ceil((LEVEL.bounds.maxZ - LEVEL.bounds.minZ) / GEO_TILE) + 1;
    expect(meshes.length).toBeLessThanOrEqual(GEO_MATERIALS.length * tilesX * tilesZ);
    // 125 m tiles (for culling of the draped terrain): still far fewer meshes than buildings.
    expect(meshes.length).toBeLessThan(LEVEL.buildings.length / 3);
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
    // The building tops stand on the terrain (terrain.js buildingSpan).
    const tallest = Math.max(...LEVEL.buildings.map((b) => buildingSpan(LEVEL, b).top)) + Math.max(...STYLES.map((s) => s.parapet));
    let maxY = 0;
    for (const { material, mesh } of meshes) {
      if (material !== "building") continue;
      for (let i = 1; i < mesh.positions.length; i += 3) maxY = Math.max(maxY, mesh.positions[i]);
    }
    expect(maxY).toBeLessThanOrEqual(tallest + 1e-4);
    expect(maxY).toBeGreaterThanOrEqual(buildingSpan(LEVEL, LEVEL.buildings.find((b) => b.name === "Ponce City Market")).top);
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

describe("the bounds of the far terrain tiles (#87)", () => {
  const far = buildGeoMeshes(LEVEL, { terrainStep: 2, surfacesOnly: true });
  const [sx, , sz] = LEVEL.spawn.position;

  it("gives a bounds distance no larger than the distance to any vertex", () => {
    for (const { mesh } of far) {
      const d = boundsDistance(meshBounds(mesh), sx, sz);
      const p = mesh.positions;
      for (let i = 0; i < p.length; i += 3) expect(Math.hypot(p[i] - sx, p[i + 2] - sz)).toBeGreaterThanOrEqual(d - 1e-6);
    }
  });

  it("finds the trail of tile 1,-3 under the spawn, 264 m from its tile square", () => {
    // Tile 1,-3 is 264 m from the spawn by its square, but its trail strip
    // runs under the spawn. The old square test showed the coarse drape there.
    const tile = far.find((t) => t.tile === "1,-3");
    expect(tile).toBeDefined();
    const [ix, iz] = [1, -3];
    const square = { minX: ix * GEO_TILE, maxX: (ix + 1) * GEO_TILE, minZ: iz * GEO_TILE, maxZ: (iz + 1) * GEO_TILE };
    expect(boundsDistance(square, sx, sz)).toBeGreaterThan(60);
    expect(boundsDistance(meshBounds(tile.mesh), sx, sz)).toBe(0);
  });

  it("keeps more than half of the tiles far from the spawn", () => {
    const farCount = far.filter(({ mesh }) => boundsDistance(meshBounds(mesh), sx, sz) > 60).length;
    expect(farCount).toBeGreaterThan(far.length / 2);
  });
});

describe("the roofs and the street walls of the brick styles", () => {
  it("gives a brick loft a dark gray roof, and the other styles a light tint of the wall", () => {
    const loft = STYLES[STYLE_INDEX["brick-loft"]];
    expect(roofColorOf(loft, loft.walls[0])).toEqual([0.3, 0.3, 0.31]);
    const stucco = STYLES[STYLE_INDEX["stucco-apartment"]];
    const r = roofColorOf(stucco, [0.5, 0.5, 0.5]);
    for (const v of r) expect(v).toBeCloseTo(0.725);
  });

  it("colors the roof vertices of every brick loft on the BeltLine level 0.30, 0.30, 0.31", () => {
    const meshes = buildGeoMeshes(LEVEL);
    const si = STYLE_INDEX["brick-loft"];
    let roofs = 0;
    for (const { material, mesh } of meshes) {
      if (material !== "building") continue;
      for (let i = 0; i < mesh.facade.length / 4; i += 1) {
        if (mesh.facade[i * 4] !== si || mesh.facade[i * 4 + 3] !== FACE.roof) continue;
        const c = [mesh.colors[i * 3], mesh.colors[i * 3 + 1], mesh.colors[i * 3 + 2]];
        // The awnings also have the roof face kind (and style 0); they keep their colors.
        if (AWNING_COLORS.some((a) => a.every((v, k) => Math.abs(v - c[k]) < 1e-6))) continue;
        expect(c[0]).toBeCloseTo(0.3, 6);
        expect(c[1]).toBeCloseTo(0.3, 6);
        expect(c[2]).toBeCloseTo(0.31, 6);
        roofs += 1;
      }
    }
    expect(roofs).toBeGreaterThan(39 * 3);
  });

  it("finds the walls that face a street", () => {
    const ring = orientRing([[0, 0], [27.1, 0], [27.1, 8.7], [0, 8.7]], false);
    expect(streetWalls(ring, () => false)).toEqual([]);
    expect(streetWalls(ring, () => true).length).toBe(4);
    const east = streetWalls(ring, (x) => x > 29);
    expect(east.length).toBe(1);
    expect(ring[east[0]][0]).toBeCloseTo(27.1);
  });

  it("keeps the street awnings of the BeltLine level as they were before streetWalls()", () => {
    // 3,184 vertices: the count before the refactor to streetWalls().
    const isStreet = streetTest(LEVEL);
    let vertices = 0;
    for (const b of LEVEL.buildings) vertices += awningsFor(b, STYLES[STYLE_INDEX[chooseStyle(b)]], isStreet).positions.length / 3;
    expect(vertices).toBe(3184);
  });
});
