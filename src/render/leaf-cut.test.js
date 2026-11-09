import { describe, expect, it } from "vitest";
import { CORE_CODE, CORE_SHADE, CROWN_AO, LEAF_AA, LEAF_BAKE, LEAF_CUT_OF, TREE_UNIFORMS, bakeLeafCut, createLeafDepthMaterial, crownOcclusion, decodeLeafTexel, encodeLeafTexel, leafBakeLayer, leafBakeLayout, leafCutFor, LEAF_SHAPES, leafClump, leafCoverage, leafShadeRange, markCrownCores, patchLeafFragment } from "./leaf-cut.js";
import { ALBEDO, srgbToLinear } from "./pbr-palette.js";
import { PUFF_CORE_CODE, SEASONS, TREE_SPECIES, seasonColors, treeTemplate } from "../level/geo/trees.js";
import { createPropMaterial, treeTint } from "./geo-view.js";

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

describe("baked leaf cut (#191)", () => {
  it("gives the phone and low tiers the baked cut and keeps the procedural cut on high", () => {
    expect(leafCutFor("phone")).toBe("baked");
    expect(leafCutFor("low")).toBe("baked");
    expect(leafCutFor("high")).toBe("procedural");
    expect(leafCutFor("unknown")).toBe("procedural");
    // ?leafcut= wins, for an A/B check.
    expect(leafCutFor("phone", "procedural")).toBe("procedural");
    expect(leafCutFor("high", "baked")).toBe("baked");
    expect(leafCutFor("phone", "other")).toBe("baked");
    expect(Object.keys(LEAF_CUT_OF).sort()).toEqual(["high", "low", "phone"]);
  });

  it("maps a leaf code to the layer of its shape and to the nearest variant", () => {
    const { variants } = LEAF_BAKE;
    expect(leafBakeLayer(0.01)).toEqual({ layer: 0, code: 0.5 / variants });
    expect(leafBakeLayer(1.999)).toEqual({ layer: 2 * variants - 1, code: 1 + (variants - 0.5) / variants });
    for (let code = 0.001; code < LEAF_SHAPES.length; code += 0.0137) {
      const { layer, code: drawn } = leafBakeLayer(code);
      // The same shape, a seed within half a variant step.
      expect(Math.floor(drawn)).toBe(Math.floor(code));
      expect(Math.abs(drawn - code)).toBeLessThanOrEqual(0.5 / variants + 1e-9);
      expect(layer).toBeGreaterThanOrEqual(0);
      expect(layer).toBeLessThan(leafBakeLayout().layers);
      // The bake draws the code of the layer: the layer of that code is the same.
      expect(leafBakeLayer(drawn).layer).toBe(layer);
    }
  });

  it("keeps the leaf edge within a quarter texel after the 8-bit field", () => {
    // The field changes fastest (1 / size) across a leaf and slowest along it
    // (1 / length). The quantization moves the edge by the field error over
    // the slowest gradient.
    const step = (LEAF_BAKE.field[1] - LEAF_BAKE.field[0]) / 255;
    let worst = 0;
    for (let f = LEAF_BAKE.field[0]; f <= LEAF_BAKE.field[1]; f += 0.001) worst = Math.max(worst, Math.abs(decodeLeafTexel(encodeLeafTexel(f, 1)).field - f));
    expect(worst).toBeLessThanOrEqual(step / 2 + 1e-9);
    for (const [, w, l] of LEAF_SHAPES) {
      const shiftUv = worst * Math.max(w, l);
      expect(shiftUv * LEAF_BAKE.size).toBeLessThan(0.25);
    }
    // The edge (0) and the leaf center (1) are inside the kept range.
    expect(LEAF_BAKE.field[0]).toBeLessThan(0);
    expect(LEAF_BAKE.field[1]).toBeGreaterThanOrEqual(1);
    // Out of range values clamp.
    expect(encodeLeafTexel(-50, 1)[0]).toBe(0);
    expect(encodeLeafTexel(50, 1)[0]).toBe(255);
  });

  it("keeps every leaf tone, the veins too, in the tone range", () => {
    // The tone is 0.9 to 1.12, a vein multiplies it by 0.82 or 0.85.
    expect(LEAF_BAKE.tone[0]).toBeLessThanOrEqual(0.9 * 0.82);
    expect(LEAF_BAKE.tone[1]).toBeGreaterThanOrEqual(0.9 + 0.22);
    for (const tone of [0.9 * 0.82, 0.9 * 0.85, 1, 1.12]) expect(Math.abs(decodeLeafTexel(encodeLeafTexel(0, tone)).tone - tone)).toBeLessThan(1 / 255);
  });

  it("lays the layers out in a near square grid and counts the GPU bytes", () => {
    const { layers, columns, rows, bytes } = leafBakeLayout();
    expect(layers).toBe(LEAF_SHAPES.length * LEAF_BAKE.variants);
    expect(columns * rows).toBeGreaterThanOrEqual(layers);
    expect(columns * (rows - 1)).toBeLessThan(layers);
    // The bake target stays inside the WebGL2 minimum texture size (2048).
    expect(Math.max(columns, rows) * LEAF_BAKE.size).toBeLessThanOrEqual(2048);
    expect(bytes).toBe(Math.round(LEAF_BAKE.size * LEAF_BAKE.size * 2 * layers * (4 / 3)));
    // Under 3 MB on the GPU (2.45 MB at 128 px and 8 variants).
    expect(bytes).toBeLessThan(3 * 1024 * 1024);
  });

  it("puts the LEAF_BAKED define first only for the baked cut", () => {
    const frag = () => ({ fragmentShader: "void main() {\n#include <clipping_planes_fragment>\n#include <color_fragment>\n}" });
    const baked = frag();
    patchLeafFragment(baked, { baked: true });
    expect(baked.fragmentShader.startsWith("#define LEAF_BAKED\n")).toBe(true);
    expect(baked.fragmentShader).toContain("uniform highp sampler2DArray uLeafBake;");
    const proc = frag();
    patchLeafFragment(proc);
    expect(proc.fragmentShader).not.toContain("#define LEAF_BAKED");
  });
});

// Review findings of #237.
describe("baked leaf cut: texture, shadow and program cache", () => {
  // A renderer stub: bakeLeafCut() only sets targets, draws and reads back.
  const stubRenderer = () => ({
    autoClear: true,
    getRenderTarget: () => null,
    setRenderTarget() {},
    render() {},
    readRenderTargetPixels(_t, _x, _y, w, h, out) {
      out.fill(128, 0, w * h * 4);
    },
  });
  const small = { ...LEAF_BAKE, size: 4 };

  it("frees the old texture when a new bake replaces it", () => {
    const first = bakeLeafCut(stubRenderer(), small).texture;
    expect(TREE_UNIFORMS.uLeafBake.value).toBe(first);
    let freed = 0;
    first.addEventListener("dispose", () => (freed += 1));
    const second = bakeLeafCut(stubRenderer(), small).texture;
    expect(TREE_UNIFORMS.uLeafBake.value).toBe(second);
    expect(freed).toBe(1);
  });

  it("gives the shadow pass the baked cut when the cards use it", () => {
    const shader = () => ({ uniforms: {}, vertexShader: "#include <common>\nvoid main() {\n#include <begin_vertex>\n}", fragmentShader: "void main() {\n#include <clipping_planes_fragment>\n}" });
    const baked = createLeafDepthMaterial({ baked: true });
    const procedural = createLeafDepthMaterial();
    const b = shader();
    baked.onBeforeCompile(b);
    const p = shader();
    procedural.onBeforeCompile(p);
    expect(b.fragmentShader.startsWith("#define LEAF_BAKED\n")).toBe(true);
    expect(p.fragmentShader).not.toContain("#define LEAF_BAKED");
    expect(b.uniforms.uLeafBake).toBe(TREE_UNIFORMS.uLeafBake);
    expect(baked.customProgramCacheKey()).not.toBe(procedural.customProgramCacheKey());
  });

  it("changes the prop material program cache key with leafBaked", () => {
    const { material } = createPropMaterial({ look: "pbr", leaves: true });
    const before = material.customProgramCacheKey();
    material.userData.leafBaked = true;
    const after = material.customProgramCacheKey();
    expect(after).not.toBe(before);
    expect(after).toContain("-baked");
    expect(before).not.toContain("-baked");
  });
});
