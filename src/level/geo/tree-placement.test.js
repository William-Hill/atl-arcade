import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createGeoGroundSampler, pointInRings } from "./geo-ground.js";
import { streetProps } from "./props.js";
import { CANOPY_SPACING, LOW_CROWN, SCALE_RANGE, SPECIES_MIX, TREE_KIND, canopyCandidates, clearanceIds, crownRadiusAt, decodeCanopy, fitTree, pickSpecies, treeClear } from "./tree-placement.js";
import { TREE_SPECIES, crownReach } from "./trees.js";

const read = (f) => JSON.parse(readFileSync(new URL(`../../../levels/beltline-eastside/${f}`, import.meta.url), "utf8"));
const LEVEL = read("level.json");
const CANOPY = read("canopy.json");
const WITH_CANOPY = { ...LEVEL, canopy: CANOPY };

// A canopy grid from a function of the cell center.
function grid({ x0 = -50, z0 = -50, cols = 50, rows = 50, cell = 2 } = {}, fill) {
  const bits = new Uint8Array(Math.ceil((cols * rows) / 8));
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (!fill(x0 + (c + 0.5) * cell, z0 + (r + 0.5) * cell)) continue;
      const i = r * cols + c;
      bits[i >> 3] |= 1 << (i & 7);
    }
  }
  return { cell, x0, z0, cols, rows, data: Buffer.from(bits).toString("base64") };
}

describe("canopy grid", () => {
  it("decodes the bit mask cell by cell, and is empty outside the grid", () => {
    const m = decodeCanopy(grid({}, (x, z) => x > 0 && z < 10));
    expect(m.has(5, 0)).toBe(true);
    expect(m.has(-5, 0)).toBe(false);
    expect(m.has(5, 20)).toBe(false);
    expect(m.has(500, 0)).toBe(false);
    expect(decodeCanopy(null)).toBe(null);
  });

  it("sizes a crown by the canopy around it", () => {
    // A canopy disc 5.5 m wide: the 2 m cells give a crown of 5 m or 6 m.
    const r = crownRadiusAt(decodeCanopy(grid({}, (x, z) => Math.hypot(x, z) < 5.5)), 0, 0);
    expect(r).toBeGreaterThanOrEqual(5);
    expect(r).toBeLessThanOrEqual(6);
    expect(crownRadiusAt(decodeCanopy(grid({}, () => true)), 0, 0)).toBe(7);
    expect(crownRadiusAt(decodeCanopy(grid({}, () => false)), 0, 0)).toBe(0);
  });

  it("matches the level grid and holds the real canopy", () => {
    expect(CANOPY.cell).toBe(2);
    expect(CANOPY.x0).toBe(LEVEL.bounds.minX);
    expect(CANOPY.z0).toBe(LEVEL.bounds.minZ);
    expect(CANOPY.cols * CANOPY.cell).toBeGreaterThanOrEqual(LEVEL.bounds.maxX - LEVEL.bounds.minX);
    expect(CANOPY.rows * CANOPY.cell).toBeGreaterThanOrEqual(LEVEL.bounds.maxZ - LEVEL.bounds.minZ);
    // About a fifth of the box is canopy (22.7 % on the 2026-11-03 fetch).
    const share = CANOPY.canopyCells / (CANOPY.cols * CANOPY.rows);
    expect(share).toBeGreaterThan(0.1);
    expect(share).toBeLessThan(0.5);
    expect(CANOPY.source).toMatch(/City of Atlanta/);
  });
});

describe("species", () => {
  it("picks the same species for the same key, and only species of the kind asked", () => {
    expect(pickSpecies("park", "a")).toBe(pickSpecies("park", "a"));
    for (let i = 0; i < 200; i += 1) {
      expect(TREE_KIND[pickSpecies("trail", `k${i}`, "tree_tall")]).toBe("tree_tall");
      expect(TREE_KIND[pickSpecies("trail", `k${i}`, "tree_round")]).toBe("tree_round");
    }
  });

  it("has mixes of known species that end at 1", () => {
    for (const mix of Object.values(SPECIES_MIX)) {
      expect(mix[mix.length - 1][1]).toBe(1);
      for (const [s] of mix) expect(TREE_SPECIES[s]).toBeDefined();
    }
    for (const s of Object.keys(TREE_SPECIES)) expect(TREE_KIND[s]).toMatch(/^tree_(round|tall)$/);
  });
});

describe("tree clearance", () => {
  // A level with one street along z = 0 (10 m wide) and a building.
  const level = {
    format: "geo-level/1",
    surfaces: LEVEL.surfaces,
    bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 },
    buildings: [{ id: "b1", height: 8, outer: [[20, 20], [40, 20], [40, 40], [20, 40]] }],
    strips: [{ id: "s1", kind: "street", width: 10, points: [[-50, 0], [50, 0]] }],
    areas: [],
  };
  const sample = createGeoGroundSampler(level);
  const ids = clearanceIds(level);

  it("keeps a low crown off a skate surface, and lets a high crown hang over it", () => {
    // 7 m from the street center: 2 m from the edge.
    expect(treeClear(sample, ids, "magnolia", 0, 7, 1)).toBe(false);
    expect(treeClear(sample, ids, "street", 0, 7, 1)).toBe(true);
    const fit = fitTree(sample, ids, "magnolia", "tree_tall", 0, 7, 1);
    expect(fit.species).toBe("pine");
  });

  it("keeps a crown out of a building", () => {
    expect(treeClear(sample, ids, "oak", 18, 30, 1.2)).toBe(false);
    expect(fitTree(sample, ids, "oak", "tree_round", 15, 30, 1.2)).not.toBe(null);
  });

  it("puts no canopy tree on a street that the canopy covers", () => {
    const covered = { ...level, canopy: grid({}, () => true) };
    const props = streetProps(covered, sample).filter((p) => p.canopy);
    expect(props.length).toBeGreaterThan(20);
    for (const p of props) {
      const g = sample(p.x, p.z);
      expect(g.id).toBe("ground");
      expect(Math.abs(p.z)).toBeGreaterThan(5);
    }
  });
});

describe("tree placement on the BeltLine level", () => {
  const sample = createGeoGroundSampler(LEVEL);
  const props = streetProps(WITH_CANOPY, sample);
  const trees = props.filter((p) => p.species);
  const canopyTrees = trees.filter((p) => p.canopy);
  const areaIds = new Set(LEVEL.areas.map((a) => a.id));
  const ids = clearanceIds(LEVEL);
  const mask = decodeCanopy(CANOPY);

  it("places the row trees and the canopy trees, with every species", () => {
    expect(trees.length).toBeGreaterThan(4000);
    expect(canopyTrees.length).toBeGreaterThan(2500);
    expect(new Set(trees.map((p) => p.species))).toEqual(new Set(Object.keys(TREE_SPECIES)));
    for (const p of trees) expect(p.kind).toBe(TREE_KIND[p.species]);
  });

  it("puts no trunk on a street, sidewalk, path, the trail, a bridge, or in a building", () => {
    for (const p of trees) {
      for (const [ox, oz] of [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]) {
        const g = sample(p.x + ox, p.z + oz);
        expect(g, `tree at ${p.x},${p.z}`).not.toBe(null);
        expect(g.id === "ground" || areaIds.has(g.id), `tree at ${p.x},${p.z} on ${g.id}`).toBe(true);
      }
    }
  });

  it("keeps every low crown off the skate surfaces and every crown out of the buildings", () => {
    for (const p of trees) {
      const scale = p.scale ?? 1;
      expect(treeClear(sample, ids, p.species, p.x, p.z, scale), `${p.species} at ${p.x},${p.z}`).toBe(true);
      if (TREE_SPECIES[p.species].clear * scale < LOW_CROWN) {
        for (let k = 0; k < 8; k += 1) {
          const a = (k / 8) * Math.PI * 2;
          const r = crownReach(p.species) * scale * 0.85;
          const g = sample(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r);
          if (g) expect(ids.skate.has(g.id)).toBe(false);
        }
      }
    }
  });

  it("puts the canopy trees on the city canopy, sized by it", () => {
    for (const p of canopyTrees) {
      expect(mask.has(p.x, p.z)).toBe(true);
      expect(p.scale ?? 1).toBeGreaterThanOrEqual(SCALE_RANGE[0]);
      expect(p.scale ?? 1).toBeLessThanOrEqual(SCALE_RANGE[1]);
    }
    expect(new Set(canopyTrees.map((p) => p.scale ?? 1)).size).toBeGreaterThan(5);
  });

  it("gives Historic Fourth Ward Park and Freedom Park a canopy", () => {
    for (const name of ["Historic Fourth Ward Park", "Freedom Park"]) {
      const parks = LEVEL.areas.filter((a) => a.name === name);
      expect(parks.length).toBeGreaterThan(0);
      const inside = canopyTrees.filter((p) => parks.some((a) => pointInRings(p.x, p.z, [a.outer, ...(a.holes ?? [])])));
      expect(inside.length, name).toBeGreaterThan(30);
      // The park mix has dogwoods and magnolias under the oaks and pines.
      expect(new Set(inside.map((p) => p.species)).size).toBeGreaterThanOrEqual(4);
    }
  });

  it("keeps the trees at least the prop gap apart, and is the same on each call", () => {
    const cell = new Map();
    for (const p of props) {
      const k = `${Math.floor(p.x / 2.5)},${Math.floor(p.z / 2.5)}`;
      cell.set(k, [...(cell.get(k) ?? []), p]);
    }
    for (const p of canopyTrees) {
      for (let a = -1; a <= 1; a += 1) {
        for (let b = -1; b <= 1; b += 1) {
          for (const q of cell.get(`${Math.floor(p.x / 2.5) + a},${Math.floor(p.z / 2.5) + b}`) ?? []) {
            if (q !== p && !q.roof) expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThanOrEqual(2.49);
          }
        }
      }
    }
    expect(streetProps(WITH_CANOPY, sample)).toEqual(props);
    expect(canopyCandidates(LEVEL, mask).length).toBeGreaterThan(canopyTrees.length);
    expect(CANOPY_SPACING).toBeGreaterThan(5);
  });

  it("leaves the lamps, benches, bins, and signs where they were without the canopy", () => {
    const furniture = (ps) => ps.filter((p) => !p.species);
    expect(furniture(props)).toEqual(furniture(streetProps(LEVEL, sample)));
  });
});
