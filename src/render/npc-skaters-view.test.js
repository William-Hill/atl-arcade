import { describe, expect, it } from "vitest";
import { OUTFITS, inOutfitBand, rgbToHsv } from "./npc-skaters-view.js";
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
});
