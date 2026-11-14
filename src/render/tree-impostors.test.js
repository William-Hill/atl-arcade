import { describe, expect, it } from "vitest";
import { treeTemplate, treeTemplates, withProceduralTrees } from "../level/geo/trees.js";
import { FAR_TREES, FAR_TREE_DISTANCE, IMPOSTOR_CELLS, cardColors, createTreeImpostors, farTreeCards, farTreeFade, impostorCellFor, selectFarTrees, templateBounds, treeSpeciesOf } from "./tree-impostors.js";
import { PROP_DRAW_DISTANCE } from "./geo-view.js";

const RANGE = { near: PROP_DRAW_DISTANCE, far: FAR_TREE_DISTANCE };

describe("farTreeFade", () => {
  it("is 0 before the near band, 1 at the draw distance, and 1 in the middle of the layer", () => {
    expect(farTreeFade(0, RANGE)).toBe(0);
    expect(farTreeFade(PROP_DRAW_DISTANCE - FAR_TREES.nearBand, RANGE)).toBe(0);
    expect(farTreeFade(PROP_DRAW_DISTANCE, RANGE)).toBe(1);
    expect(farTreeFade(300, RANGE)).toBe(1);
  });

  it("rises smoothly over the near band, so the cards are full when the LOD1 trees hide", () => {
    const mid = farTreeFade(PROP_DRAW_DISTANCE - FAR_TREES.nearBand / 2, RANGE);
    expect(mid).toBeCloseTo(0.5, 5);
    let last = 0;
    for (let d = PROP_DRAW_DISTANCE - FAR_TREES.nearBand; d <= PROP_DRAW_DISTANCE; d += 1) {
      const f = farTreeFade(d, RANGE);
      expect(f).toBeGreaterThanOrEqual(last);
      // No step bigger than a smoothstep slope over the band.
      expect(f - last).toBeLessThan(0.1);
      last = f;
    }
  });

  it("falls to 0 at the far edge", () => {
    expect(farTreeFade(FAR_TREE_DISTANCE - FAR_TREES.farBand, RANGE)).toBe(1);
    expect(farTreeFade(FAR_TREE_DISTANCE - FAR_TREES.farBand / 2, RANGE)).toBeCloseTo(0.5, 5);
    expect(farTreeFade(FAR_TREE_DISTANCE, RANGE)).toBe(0);
    expect(farTreeFade(FAR_TREE_DISTANCE + 50, RANGE)).toBe(0);
  });

  it("gives 0 for a bad distance", () => {
    expect(farTreeFade(Number.NaN, RANGE)).toBe(0);
    expect(farTreeFade(-1, RANGE)).toBe(0);
  });
});

describe("selectFarTrees", () => {
  // Trees on the +x axis every 10 m, from 0 to 600 m.
  const xs = Array.from({ length: 61 }, (_, i) => i * 10);
  const xz = Float32Array.from(xs.flatMap((x) => [x, 0]));

  it("picks the trees in the ring from the near band (less the margin) to the far edge (plus the margin)", () => {
    const out = new Uint32Array(xs.length);
    const n = selectFarTrees(xz, 0, 0, { ...RANGE, nearBand: 20, margin: 10 }, out);
    const picked = [...out.slice(0, n)].map((i) => xs[i]);
    expect(picked[0]).toBe(170);
    expect(picked[picked.length - 1]).toBe(450);
    expect(picked).not.toContain(160);
    expect(picked).not.toContain(460);
  });

  it("follows the camera", () => {
    const out = new Uint32Array(xs.length);
    const n = selectFarTrees(xz, 300, 0, { ...RANGE, nearBand: 20, margin: 10 }, out);
    const picked = [...out.slice(0, n)].map((i) => xs[i]);
    // The trees near the camera are props, not cards.
    expect(picked).not.toContain(300);
    expect(picked).not.toContain(400);
    expect(picked).toContain(0);
    expect(picked).toContain(500);
    expect(picked).toContain(600);
  });

  it("picks every tree that has a fade over 0 for each camera in the margin", () => {
    const out = new Uint32Array(xs.length);
    const n = selectFarTrees(xz, 0, 0, RANGE, out);
    const picked = new Set(out.slice(0, n));
    for (const shift of [0, 4, -7, FAR_TREES.step - 0.01]) {
      xs.forEach((x, i) => {
        if (farTreeFade(Math.abs(x - shift), RANGE) > 0) expect(picked.has(i)).toBe(true);
      });
    }
  });

  it("picks nothing with no trees", () => {
    expect(selectFarTrees(new Float32Array(0), 0, 0, RANGE, new Uint32Array(1))).toBe(0);
  });
});

describe("the card data", () => {
  it("gives the cell of a species and the species of a kind", () => {
    expect(impostorCellFor("pine")).toBe(1);
    expect(impostorCellFor("oak")).toBe(0);
    expect(impostorCellFor("magnolia")).toBe(0);
    expect(IMPOSTOR_CELLS.map((c) => c.kind)).toEqual(["tree_round", "tree_tall"]);
    expect(treeSpeciesOf("tree:oak:2")).toBe("oak");
    expect(treeSpeciesOf("tree_round")).toBe(null);
    expect(treeSpeciesOf("bench")).toBe(null);
  });

  it("frames the whole tree", () => {
    const t = treeTemplate("oak", 0, 0);
    const b = templateBounds(t);
    for (let i = 0; i < t.positions.length; i += 3) {
      expect(Math.hypot(t.positions[i], t.positions[i + 2])).toBeLessThanOrEqual(b.halfWidth + 1e-6);
      expect(t.positions[i + 1]).toBeLessThanOrEqual(b.height + 1e-6);
    }
    expect(b.height).toBeGreaterThan(8);
  });

  it("takes the leaf and the bark colors of the LOD1 template, so the cards follow the season", () => {
    const summer = cardColors(treeTemplate("street", 0, 1, "summer"));
    const fall = cardColors(treeTemplate("street", 0, 1, "fall"));
    // The summer leaves are green; the red maple goes red in the fall.
    expect(summer.leaf[1]).toBeGreaterThan(summer.leaf[0]);
    expect(fall.leaf[0]).toBeGreaterThan(fall.leaf[1]);
    // The bark does not change with the season, and it is brown (more red than blue).
    expect(fall.bark).toEqual(summer.bark);
    expect(summer.bark[0]).toBeGreaterThan(summer.bark[2]);
  });

  it("makes one card for each procedural tree and none for the other props", () => {
    const templates = treeTemplates({ season: "fall" });
    const placements = withProceduralTrees([
      { kind: "tree_round", x: 10, y: 1, z: 20, scale: 2 },
      { kind: "tree_tall", x: -40, y: 0, z: 5 },
      { kind: "bench", x: 0, y: 0, z: 0 },
    ]);
    const cards = farTreeCards(placements, templates);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ x: 10, y: 1, z: 20 });
    const one = farTreeCards([{ ...placements[0], scale: 1 }], templates)[0];
    expect(cards[0].height).toBeCloseTo(one.height * 2, 6);
    expect(cards[0].halfWidth).toBeCloseTo(one.halfWidth * 2, 6);
    for (const c of cards) {
      expect([0, 1]).toContain(c.cell);
      expect([0, 1]).toContain(c.flip);
    }
  });
});

describe("createTreeImpostors", () => {
  it("is one instanced mesh that shows only the picked trees", () => {
    const templates = treeTemplates();
    const placements = withProceduralTrees(Array.from({ length: 60 }, (_, i) => ({ kind: "tree_round", x: i * 10, y: 0, z: 0 })));
    const layer = createTreeImpostors(placements, templates, { ...RANGE, map: {} });
    expect(layer.mesh.isInstancedMesh).toBe(true);
    expect(layer.info.trees).toBe(60);
    layer.update({ x: 0, y: 2, z: 0 });
    // 170 m to 450 m, every 10 m.
    expect(layer.info.picked).toBe(29);
    expect(layer.mesh.count).toBe(29);
    expect(layer.mesh.visible).toBe(true);
    // A small move does not pick again.
    layer.update({ x: 3, y: 2, z: 0 });
    expect(layer.info.picks).toBe(1);
    layer.update({ x: 12, y: 2, z: 0 });
    expect(layer.info.picks).toBe(2);
    layer.dispose();
  });
});
