import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPropMeshes } from "./geo-mesh.js";
import { levelProps } from "./props.js";
import { LEAF_CARDS, PUFF_CORE_CODE, SEASONS, TREE_SPECIES, TREE_VARIANTS, isTreeKind, seasonColors, treeKindFor, treeTemplate, treeTemplates, withProceduralTrees } from "./trees.js";

const LEVEL = JSON.parse(readFileSync(new URL("../../../levels/beltline-eastside/level.json", import.meta.url), "utf8"));
const SPECIES = Object.keys(TREE_SPECIES);
const triangles = (t) => t.indices.length / 3;

describe("procedural trees", () => {
  it("gives the same mesh for the same species and variant", () => {
    const a = treeTemplate("oak", 1);
    const b = treeTemplate("oak", 1);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.colors)).toEqual(Array.from(b.colors));
  });

  it("gives each variant its own shape", () => {
    for (const s of SPECIES) {
      const shapes = new Set();
      for (let v = 0; v < TREE_VARIANTS; v += 1) shapes.add(Array.from(treeTemplate(s, v).positions.slice(0, 30)).join());
      expect(shapes.size).toBe(TREE_VARIANTS);
    }
  });

  it("keeps each tree inside the triangle budget of the street kit trees", () => {
    // The kit trees are 932 (tree_round) and 200 (tree_tall) triangles at
    // LOD0, and 120 and 94 at LOD1 (assets/kit/provenance.json).
    for (const s of SPECIES) {
      for (let v = 0; v < TREE_VARIANTS; v += 1) {
        expect(triangles(treeTemplate(s, v, 0))).toBeLessThanOrEqual(900);
        expect(triangles(treeTemplate(s, v, 1))).toBeLessThanOrEqual(130);
      }
    }
  });

  it("has the six Atlanta species of issue #137", () => {
    expect(new Set(SPECIES)).toEqual(new Set(["oak", "pine", "magnolia", "myrtle", "dogwood", "street"]));
  });

  it("draws a far tree as a few crossed cards of the same size as the near tree", () => {
    for (const s of SPECIES) {
      for (let v = 0; v < TREE_VARIANTS; v += 1) {
        const near = treeTemplate(s, v, 0);
        const far = treeTemplate(s, v, 1);
        // 3 cards, 2 sides, a trunk quad (2) and a crown fan (8).
        expect(triangles(far)).toBe(60);
        const top = (t) => Math.max(...t.positions.filter((_, i) => i % 3 === 1));
        const width = (t) => Math.max(...t.positions.filter((_, i) => i % 3 === 0)) - Math.min(...t.positions.filter((_, i) => i % 3 === 0));
        expect(top(far) / top(near)).toBeGreaterThan(0.8);
        expect(top(far) / top(near)).toBeLessThan(1.15);
        expect(width(far) / width(near)).toBeGreaterThan(0.7);
        expect(width(far) / width(near)).toBeLessThan(1.3);
      }
    }
  });

  it("changes the colors with the season, and keeps the shape", () => {
    for (const s of SPECIES) {
      const summer = treeTemplate(s, 1, 0, "summer");
      for (const season of SEASONS) {
        const t = treeTemplate(s, 1, 0, season);
        expect(Array.from(t.positions)).toEqual(Array.from(summer.positions));
      }
    }
    // The deciduous trees turn in the fall; the pine stays green.
    for (const s of ["oak", "dogwood", "street", "myrtle"]) expect(seasonColors(s, "fall").leaf).not.toEqual(seasonColors(s, "summer").leaf);
    expect(seasonColors("pine", "fall").leaf).toEqual(seasonColors("pine", "summer").leaf);
    // The dogwood blooms in the spring, the crape myrtle in the summer.
    expect(seasonColors("dogwood", "spring").share).toBeGreaterThan(0.5);
    expect(seasonColors("dogwood", "summer").blooms).toBe(null);
    expect(seasonColors("myrtle", "summer").share).toBeGreaterThan(0.5);
    expect(seasonColors("myrtle", "fall").blooms).toBe(null);
    expect(Object.keys(treeTemplates({ season: "winter" }))).toEqual(Object.keys(treeTemplates()));
  });

  it("keeps a placement species, and its variant from the position", () => {
    expect(treeKindFor({ kind: "tree_round", species: "dogwood", x: 1, z: 2 })).toMatch(/^tree:dogwood:\d$/);
    expect(treeKindFor({ kind: "tree_round", species: "nope", x: 1, z: 2 })).not.toMatch(/nope/);
  });

  it("has well-formed attributes: unit normals, colors in 0..1.1, sway in 0..1", () => {
    for (const [s, lod] of SPECIES.flatMap((x) => [[x, 0], [x, 1]])) {
      const t = treeTemplate(s, 0, lod);
      const n = t.positions.length / 3;
      expect(t.normals.length).toBe(n * 3);
      expect(t.colors.length).toBe(n * 3);
      expect(t.sway.length).toBe(n);
      for (const i of t.indices) expect(i).toBeLessThan(n);
      for (let i = 0; i < n; i += 1) {
        expect(Math.hypot(t.normals[i * 3], t.normals[i * 3 + 1], t.normals[i * 3 + 2])).toBeCloseTo(1, 3);
        expect(t.sway[i]).toBeGreaterThanOrEqual(0);
        expect(t.sway[i]).toBeLessThanOrEqual(1);
      }
      for (const c of t.colors) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1.1);
      }
    }
  });

  it("keeps the trunk base still and moves the crown", () => {
    for (const s of SPECIES) {
      const t = treeTemplate(s, 2);
      let low = 0;
      let high = 0;
      for (let i = 0; i < t.sway.length; i += 1) {
        if (t.positions[i * 3 + 1] < 0.5) low = Math.max(low, t.sway[i]);
        else high = Math.max(high, t.sway[i]);
      }
      expect(low).toBeLessThan(0.05);
      expect(high).toBeGreaterThan(0.5);
    }
  });

  it("keeps the crown over the skater on the trail trees", () => {
    // tree_round goes 2.5 m to 4 m from the trail edge. Its species (oak and
    // crape myrtle) must clear a skater (1.8 m) at the smallest scale, 0.85.
    for (const s of ["oak", "myrtle"]) {
      for (let v = 0; v < TREE_VARIANTS; v += 1) {
        const t = treeTemplate(s, v);
        let crownLow = Infinity;
        for (let i = 0; i < t.sway.length; i += 1) {
          const r = Math.hypot(t.positions[i * 3], t.positions[i * 3 + 2]);
          if (r > 0.6) crownLow = Math.min(crownLow, t.positions[i * 3 + 1]);
        }
        expect(crownLow * 0.85).toBeGreaterThan(1.8);
      }
    }
  });

  it("has a `clear` height at or under the lowest leaf of each species", () => {
    for (const s of SPECIES) {
      let low = Infinity;
      for (let v = 0; v < TREE_VARIANTS; v += 1) {
        const t = treeTemplate(s, v);
        for (let i = 0; i < t.sway.length; i += 1) if (Math.hypot(t.positions[i * 3], t.positions[i * 3 + 2]) > 0.6) low = Math.min(low, t.positions[i * 3 + 1]);
      }
      expect(low, s).toBeGreaterThanOrEqual(TREE_SPECIES[s].clear);
      expect(low - TREE_SPECIES[s].clear, s).toBeLessThan(0.2);
    }
  });

  it("names a template for every tree placement, the same one on each call", () => {
    const templates = treeTemplates();
    expect(Object.keys(templates).length).toBe(SPECIES.length * TREE_VARIANTS * 2);
    const props = levelProps(LEVEL).filter((p) => isTreeKind(p.kind));
    expect(props.length).toBeGreaterThan(100);
    const used = new Set();
    for (const p of props) {
      const k = treeKindFor(p);
      expect(templates[k]).toBeDefined();
      expect(templates[`${k}_lod1`]).toBeDefined();
      expect(treeKindFor(p)).toBe(k);
      used.add(k.split(":")[1]);
    }
    expect(used).toEqual(new Set(SPECIES));
    // Only tall placements get pines.
    for (const p of props.filter((q) => q.kind === "tree_round")) expect(treeKindFor(p)).not.toMatch(/pine/);
  });

  it("changes only the tree kinds, and puts the wind weight in the prop tiles", () => {
    const props = levelProps(LEVEL);
    const swapped = withProceduralTrees(props);
    expect(swapped.length).toBe(props.length);
    for (let i = 0; i < props.length; i += 1) {
      if (isTreeKind(props[i].kind)) {
        expect(swapped[i].kind).toMatch(/^tree:/);
        // The tree stands on the terrain height of its placement (props.js).
        expect(swapped[i].y).toBe(props[i].y);
      }
      else expect(swapped[i]).toBe(props[i]);
    }
    const trees = swapped.filter((p) => p.kind.startsWith("tree:")).slice(0, 40);
    const tiles = buildPropMeshes(trees, treeTemplates());
    expect(tiles.length).toBeGreaterThan(0);
    for (const t of tiles) {
      expect(t.mesh.sway.length).toBe(t.mesh.positions.length / 3);
      expect(Math.max(...t.mesh.sway)).toBeGreaterThan(0.5);
    }
  });
});

describe("leaf cards", () => {
  it("adds cards to a near tree only when asked", () => {
    const plain = treeTemplate("oak", 0, 0);
    const leafy = treeTemplate("oak", 0, 0, "summer", { cards: true });
    const far = treeTemplate("oak", 0, 1, "summer", { cards: true });
    expect(plain.leaf).toBeUndefined();
    expect(far.leaf).toBeUndefined();
    expect(leafy.leaf.length).toBe((leafy.positions.length / 3) * 3);
    const cardVerts = leafy.leaf.filter((_, i) => i % 3 === 2 && leafy.leaf[i] > 0).length;
    expect(cardVerts).toBe(TREE_SPECIES.oak.puffs[0] * LEAF_CARDS.perPuff * 4);
  });

  it("gives each card a seed in (0, 1] and corners in 0..1", () => {
    const t = treeTemplate("magnolia", 1, 0, "summer", { cards: true });
    for (let i = 0; i < t.leaf.length; i += 3) {
      // 0: no texture; PUFF_CORE_CODE: a crown puff (#202).
      if (t.leaf[i + 2] === 0 || t.leaf[i + 2] === PUFF_CORE_CODE) continue;
      expect(t.leaf[i + 2]).toBeGreaterThan(0);
      expect(t.leaf[i + 2]).toBeLessThanOrEqual(1);
      expect([0, 1]).toContain(t.leaf[i]);
      expect([0, 1]).toContain(t.leaf[i + 1]);
    }
  });

  it("keeps the trunk the same with and without cards", () => {
    const plain = treeTemplate("pine", 2, 0);
    const leafy = treeTemplate("pine", 2, 0, "summer", { cards: true });
    // The trunk and branch tubes come first, before the puffs.
    const n = 24;
    expect(Array.from(leafy.positions.slice(0, n))).toEqual(Array.from(plain.positions.slice(0, n)));
  });

  it("is the same in every run (seeded)", () => {
    const a = treeTemplate("myrtle", 0, 0, "summer", { cards: true });
    const b = treeTemplate("myrtle", 0, 0, "summer", { cards: true });
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.leaf)).toEqual(Array.from(b.leaf));
  });
});
