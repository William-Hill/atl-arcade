import { describe, expect, it } from "vitest";
import { CORE_CODE, CORE_SHADE, CROWN_AO, LEAF_AA, crownOcclusion, LEAF_SHAPES, leafClump, leafCoverage, leafShadeRange, markCrownCores, patchLeafFragment } from "./leaf-cut.js";
import { ALBEDO, srgbToLinear } from "./pbr-palette.js";
import { PUFF_CORE_CODE, SEASONS, TREE_SPECIES, seasonColors, treeTemplate } from "../level/geo/trees.js";
import { treeTint } from "./geo-view.js";

const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

describe("leaf edge anti-aliasing (#202)", () => {
  it("ramps the coverage over one pixel, 0.5 on the edge", () => {
    expect(leafCoverage(0, 0.1)).toBe(0.5);
    expect(leafCoverage(0.05, 0.1)).toBeCloseTo(1);
    expect(leafCoverage(-0.05, 0.1)).toBeCloseTo(0);
    expect(leafCoverage(0.02, 0.1)).toBeCloseTo(0.7);
    // The cut without alpha to coverage is the same edge as the old binary cut.
    expect(leafCoverage(1e-3, 0.1) >= LEAF_AA.cut).toBe(true);
    expect(leafCoverage(-1e-3, 0.1) >= LEAF_AA.cut).toBe(false);
  });

  it("keeps big leaves sharp and changes leaves under about 2 px wide to a clump", () => {
    const halfWidth = 0.1;
    // A leaf 20 px wide: px = 0.01 uv.
    expect(leafClump(0.01, halfWidth)).toBe(0);
    // A leaf 1 px wide or less.
    expect(leafClump(0.2, halfWidth)).toBe(1);
    const mid = leafClump(0.08, halfWidth);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    // Monotonic: farther cards are more of a clump.
    let last = 0;
    for (let px = 0; px < 0.3; px += 0.005) {
      const v = leafClump(px, halfWidth);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
  });

  it("puts the clump inside the card, near the size of the leaf cloud", () => {
    expect(LEAF_AA.clump).toBeGreaterThan(0.25);
    // With the lobes (+19 %) the clump stays inside the card (radius 0.5).
    expect(LEAF_AA.clump * 1.19).toBeLessThan(0.5);
    expect(LEAF_AA.minCoverage).toBeLessThan(1 / 8);
    for (const [, w] of LEAF_SHAPES) expect(w).toBeGreaterThan(0);
  });

  it("keeps the darkest leaf above the albedo floor", () => {
    const { min } = leafShadeRange();
    // The darkest card: the crown occlusion of the Blender trees (0.72 x 0.85),
    // the darkest tree tint, and the pbr albedo scale (0.8).
    let darkestTint = 1;
    for (let x = -500; x < 500; x += 37) for (let z = -500; z < 500; z += 41) darkestTint = Math.min(darkestTint, ...treeTint({ x, z }));
    const scale = min * 0.72 * 0.85 * darkestTint * 0.8;
    for (const species of Object.keys(TREE_SPECIES)) {
      for (const season of SEASONS) {
        const leaf = seasonColors(species, season).leaf.map(srgbToLinear);
        expect(luma(leaf) * scale).toBeGreaterThan(ALBEDO.floor);
      }
    }
  });
});

describe("crown cores (#202)", () => {
  it("marks the core vertices of a Blender tree and keeps cards, bark and kit props", () => {
    const t = {
      positions: [1, 5, 2, 0, 6, 0, 0, 1, 0, 3, 4, 0],
      // A core, a leaf card, bark, and a vertex with no sway.
      leaf: [0, 0, -3e-6, 0.5, 0.5, 1.3, 0.2, 0.4, -1, 0, 0, 0],
      sway: [0.6, 0.8, 0, 0],
      colors: [],
      indices: [],
    };
    const out = markCrownCores(t);
    expect(out).not.toBe(t);
    // A Draco code near 0 is a core too.
    expect(t.leaf[2]).toBe(-3e-6);
    expect(out.leaf[2]).toBe(CORE_CODE);
    expect(out.leaf[0]).toBeCloseTo(1 * 0.8 + 2 * 0.6);
    expect(Array.from(out.leaf.slice(3))).toEqual([0.5, 0.5, 1.2999999523162842, 0.20000000298023224, 0.4000000059604645, -1, 0, 0, 0]);
  });

  it("leaves a template with no sway or no leaf data as it is", () => {
    const kit = { positions: [0, 0, 0], leaf: [0, 0, 0], colors: [], indices: [] };
    expect(markCrownCores(kit)).toBe(kit);
    const plain = { positions: [0, 0, 0], colors: [], indices: [] };
    expect(markCrownCores(plain)).toBe(plain);
  });

  it("keeps the darkest core above the albedo floor", () => {
    // The core color in pbr_trees.py: leaf color x 0.85 x 0.9.
    let darkestTint = 1;
    for (let x = -500; x < 500; x += 37) for (let z = -500; z < 500; z += 41) darkestTint = Math.min(darkestTint, ...treeTint({ x, z }));
    for (const species of Object.keys(TREE_SPECIES)) {
      for (const season of SEASONS) {
        const leaf = seasonColors(species, season).leaf.map(srgbToLinear);
        expect(luma(leaf) * 0.85 * 0.9 * CORE_SHADE.min * darkestTint * 0.8).toBeGreaterThan(ALBEDO.floor);
      }
    }
  });
});

describe("crown occlusion (#202)", () => {
  it("lights the top in full and darkens the underside on the sky light", () => {
    expect(crownOcclusion(1)).toBe(1);
    expect(crownOcclusion(-1)).toBe(CROWN_AO.min);
    expect(crownOcclusion(0)).toBeGreaterThan(CROWN_AO.min);
    expect(crownOcclusion(0)).toBeLessThan(1);
    let last = 0;
    for (let up = -1; up <= 1; up += 0.05) {
      expect(crownOcclusion(up)).toBeGreaterThanOrEqual(last);
      last = crownOcclusion(up);
    }
  });
});

describe("procedural crown puffs (#202)", () => {
  it("use the core code in a tree with leaf cards, and no leaf data without cards", () => {
    expect(PUFF_CORE_CODE).toBe(CORE_CODE);
    const t = treeTemplate("oak", 0, 0, "summer", { cards: true });
    const codes = new Set();
    for (let i = 2; i < t.leaf.length; i += 3) codes.add(t.leaf[i] === CORE_CODE ? "core" : t.leaf[i] > 0 ? "card" : t.leaf[i] === 0 ? "none" : "other");
    expect(codes.has("core")).toBe(true);
    expect(codes.has("card")).toBe(true);
    expect(codes.has("other")).toBe(false);
    expect(treeTemplate("oak", 0, 0, "summer").leaf).toBeUndefined();
  });
});

describe("leaf cut shader patch (#202)", () => {
  const frag = () => ({ fragmentShader: "void main() {\n#include <clipping_planes_fragment>\n#include <color_fragment>\n#include <lights_fragment_end>\n}" });

  it("drops the leaf cards from the AO pass and keeps them in the color pass", () => {
    const ao = frag();
    patchLeafFragment(ao, { tone: false, cards: false });
    expect(ao.fragmentShader).toContain("if (vLeaf.z > 0.025) discard;");
    const color = frag();
    patchLeafFragment(color);
    expect(color.fragmentShader).not.toContain("if (vLeaf.z > 0.025) discard;");
  });

  it("sends the coverage to the alpha only with alpha to coverage", () => {
    const s = frag();
    patchLeafFragment(s, { backlight: true });
    expect(s.fragmentShader).toMatch(/#ifdef ALPHA_TO_COVERAGE\nif \(leafHit\.a < 0\.060\) discard;\n#else\nif \(leafHit\.a < 0\.50\) discard;/);
    expect(s.fragmentShader).toMatch(/#ifdef ALPHA_TO_COVERAGE\ndiffuseColor\.a = leafHit\.a;\n#endif/);
    expect(s.fragmentShader).toContain("reflectedLight.indirectDiffuse *= crownAo;");
  });

  it("guards atan(0, 0) at the card center", () => {
    const s = frag();
    patchLeafFragment(s);
    expect(s.fragmentShader).toContain("atan(q.y, q.x + 1e-6)");
  });
});
