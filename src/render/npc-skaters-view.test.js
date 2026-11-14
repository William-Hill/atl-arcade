import { describe, expect, it } from "vitest";
import { LOD_HYSTERESIS, NPC_DRAW, OUTFITS, inOutfitBand, pickDrawn, pickLods, rgbToHsv } from "./npc-skaters-view.js";
import { BELTLINE_SKATERS, GREYBOX_SKATERS } from "../sim/npc/skaters.js";

// Colors read from the turnaround renders in assets/skaters/*/views/front.png (sRGB, 0..1).
const NIA = { skin: [0.42, 0.22, 0.13], jacket: [0.88, 0.52, 0.36], pants: [0.24, 0.33, 0.17], top: [0.9, 0.88, 0.84] };
const MARCUS = { skin: [0.48, 0.28, 0.17], jacket: [0.1, 0.62, 0.62], shorts: [0.13, 0.19, 0.31], shirt: [0.92, 0.92, 0.92], boots: [0.1, 0.1, 0.1] };

describe("NPC skater outfits", () => {
  it("converts RGB to HSV", () => {
    expect(rgbToHsv([1, 0, 0])).toEqual([0, 1, 1]);
    expect(rgbToHsv([0, 1, 0])[0]).toBeCloseTo(120);
    expect(rgbToHsv([0, 0, 1])[0]).toBeCloseTo(240);
    expect(rgbToHsv([0.5, 0.5, 0.5])).toEqual([0, 0, 0.5]);
  });

  it("recolors Nia's pants and keeps her skin, jacket, and top", () => {
    for (const name of ["cobalt", "plum"]) {
      const o = OUTFITS[name];
      expect(inOutfitBand(o, NIA.pants)).toBe(true);
      expect(inOutfitBand(o, NIA.skin)).toBe(false);
      expect(inOutfitBand(o, NIA.jacket)).toBe(false);
      expect(inOutfitBand(o, NIA.top)).toBe(false);
    }
  });

  it("recolors Marcus's jacket and shorts and keeps his skin, shirt, and boots", () => {
    for (const name of ["sunset", "lime", "berry"]) {
      const o = OUTFITS[name];
      expect(inOutfitBand(o, MARCUS.jacket)).toBe(true);
      expect(inOutfitBand(o, MARCUS.shorts)).toBe(true);
      for (const keep of [MARCUS.skin, MARCUS.shirt, MARCUS.boots]) expect(inOutfitBand(o, keep)).toBe(false);
    }
  });

  it("gives every NPC skater an outfit made for its model", () => {
    for (const spec of [...BELTLINE_SKATERS, ...GREYBOX_SKATERS]) {
      expect(OUTFITS[spec.outfit], spec.id).toBeTruthy();
      expect(OUTFITS[spec.outfit].model).toBe(spec.model);
    }
  });

  it("draws only the nearest NPCs within the tier distance", () => {
    const items = [
      { id: "a", d: 30 },
      { id: "b", d: 10 },
      { id: "c", d: 44 },
      { id: "d", d: 60 },
    ];
    expect([...pickDrawn(items, { distance: 45, max: 2 })].sort()).toEqual(["a", "b"]);
    expect([...pickDrawn(items, NPC_DRAW.high)].sort()).toEqual(["a", "b", "c", "d"]);
    expect([...pickDrawn(items, NPC_DRAW.phone)].sort()).toEqual(["a", "b", "c", "d"]);
    expect(pickDrawn(items, { distance: 5, max: 5 }).size).toBe(0);
  });
});

// #280: far NPC skaters use the LOD1 model.
describe("the NPC skater LOD choice", () => {
  const tier = { lod1From: 25, full: 5 };

  it("uses the full model near the eye and LOD1 from lod1From", () => {
    const lods = pickLods([{ id: "a", d: 10 }, { id: "b", d: 24.9 }, { id: "c", d: 25 }, { id: "d", d: 80 }], new Map(), tier);
    expect(Object.fromEntries(lods)).toEqual({ a: 0, b: 0, c: 1, d: 1 });
  });

  it("does not flicker at the edge: an NPC on LOD1 comes back only inside the hysteresis", () => {
    const prev = new Map([["a", 1]]);
    expect(pickLods([{ id: "a", d: 24 }], prev, tier).get("a")).toBe(1);
    expect(pickLods([{ id: "a", d: 25 - LOD_HYSTERESIS - 0.1 }], prev, tier).get("a")).toBe(0);
    // An NPC on LOD0 stays on LOD0 up to lod1From.
    expect(pickLods([{ id: "a", d: 24 }], new Map([["a", 0]]), tier).get("a")).toBe(0);
  });

  it("gives the full model only to the `full` nearest NPCs", () => {
    const items = [{ id: "a", d: 12 }, { id: "b", d: 3 }, { id: "c", d: 8 }];
    expect(Object.fromEntries(pickLods(items, new Map(), { lod1From: 25, full: 2 }))).toEqual({ a: 1, b: 0, c: 0 });
    expect([...pickLods(items, new Map(), { lod1From: 25, full: 0 }).values()]).toEqual([1, 1, 1]);
  });

  it("gives a level to each item and none to other ids", () => {
    const lods = pickLods([{ id: "a", d: 40 }], new Map([["gone", 0]]), tier);
    expect([...lods.keys()]).toEqual(["a"]);
    expect(pickLods([], new Map(), tier).size).toBe(0);
  });

  it("has a LOD1 distance and a full-model cap on each tier", () => {
    for (const [name, t] of Object.entries(NPC_DRAW)) {
      expect(t.lod1From, name).toBeGreaterThan(LOD_HYSTERESIS);
      expect(t.lod1From, name).toBeLessThan(t.distance);
      expect(t.full, name).toBeGreaterThanOrEqual(1);
      expect(t.full, name).toBeLessThanOrEqual(t.max);
    }
  });
});
