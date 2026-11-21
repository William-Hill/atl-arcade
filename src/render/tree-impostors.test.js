import { describe, expect, it } from "vitest";
import { atlasGrid, impostorExtent, impostorTemplate } from "./tree-impostors.js";
import { seasonalGlbTree, treeTint } from "./geo-view.js";

describe("tree impostors", () => {
  const tree = { positions: [0, 0, 0, 3, 8, 0, -2, 10, 1], colors: [1, 1, 1, 1, 1, 1, 1, 1, 1], leaf: [0, 0, -1, 0, 0, 1.5, 0, 0, 1.7], indices: [0, 1, 2] };

  it("fits the cards around the crown and the top", () => {
    const e = impostorExtent(tree);
    expect(e.radius).toBeCloseTo(3);
    expect(e.top).toBe(10);
    expect(e.size).toBeCloseTo(10.2);
    expect(e.bottom).toBeCloseTo(-0.2);
  });

  it("makes one card (2 triangles) per view, each with its atlas cell and impostor code", () => {
    const t = impostorTemplate(impostorExtent(tree), [[0, 0, 0.5, 0.5], [0.5, 0, 1, 0.5], [0, 0.5, 0.5, 1]]);
    expect(t.indices.length / 3).toBe(6);
    expect(t.positions.length / 3).toBe(12);
    const codes = new Set(t.leaf.filter((_, i) => i % 3 === 2));
    expect([...codes].sort((a, b) => a - b)).toEqual([-12, -11, -10]);
    expect(t.leaf.slice(0, 2)).toEqual([0, 0]);
  });

  it("uses a square grid big enough for every cell", () => {
    expect(atlasGrid(54)).toBe(8);
    expect(atlasGrid(1)).toBe(1);
  });
});

describe("seasonal GLB trees", () => {
  // A bark vertex, a leaf card, and a red-over-green bloom card.
  const t = { positions: new Float32Array(9), colors: Float32Array.from([0.3, 0.2, 0.1, 0.2, 0.5, 0.1, 0.6, 0.2, 0.3]), leaf: Float32Array.from([0, 0, -1, 0, 0, 4.3, 0, 0, 4.6]), indices: [0, 1, 2] };

  it("keeps a summer tree as it is", () => {
    expect(seasonalGlbTree(t, "myrtle", "summer")).toBe(t);
  });

  it("turns the summer blooms into leaves in a season with no blooms, and keeps the bark", () => {
    const fall = seasonalGlbTree(t, "myrtle", "fall");
    expect(Array.from(fall.colors.slice(0, 3))).toEqual(Array.from(t.colors.slice(0, 3)));
    // The fall myrtle leaf is red-orange: the leaf and the old bloom card.
    expect(fall.colors[3]).toBeGreaterThan(fall.colors[4]);
    expect(fall.colors[6]).toBeGreaterThan(fall.colors[8]);
  });

  it("puts blooms on a share of the dogwood cards in spring", () => {
    const leaf = new Float32Array(300);
    const colors = new Float32Array(300);
    for (let i = 0; i < 100; i += 1) {
      leaf[i * 3 + 2] = 5 + 0.05 + (0.9 * i) / 100;
      colors.set([0.2, 0.5, 0.1], i * 3);
    }
    const spring = seasonalGlbTree({ positions: new Float32Array(300), colors, leaf, indices: [] }, "dogwood", "spring");
    let white = 0;
    for (let i = 0; i < 100; i += 1) if (spring.colors[i * 3 + 2] > 0.3) white += 1;
    expect(white).toBeGreaterThan(55);
    expect(white).toBeLessThan(95);
  });

  it("tints each placement a little, the same way each time", () => {
    const a = treeTint({ x: 10, z: 20 });
    expect(a).toEqual(treeTint({ x: 10, z: 20 }));
    for (const c of a) expect(c).toBeGreaterThan(0.8);
    for (const c of a) expect(c).toBeLessThan(1.2);
  });
});
