import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { DEFAULT_SETS, FORMATS, MAPS, SET_IDS, TIERS, gpuBytes, mapFile, parseSets } from "./ground-pbr-sets.js";

const KINDS = ["ground", "park", "street", "path", "sidewalk", "trail"];

describe("ground-pbr sets", () => {
  it("maps the ridden surfaces by default", () => {
    expect(parseSets(null, KINDS)).toEqual(DEFAULT_SETS);
    expect(parseSets("sidewalk:brick,street:asphalt", KINDS)).toEqual({ sidewalk: "brick", street: "asphalt" });
  });

  it("rejects unknown kinds and sets", () => {
    expect(() => parseSets("roof:brick", KINDS)).toThrow(/kind/);
    expect(() => parseSets("street:marble", KINDS)).toThrow(/set/);
  });

  it("has every map of every set, tier and format on disk", () => {
    for (const set of SET_IDS) {
      expect(existsSync(`assets/textures/ground-pbr/${set}/provenance.json`)).toBe(true);
      expect(existsSync(`assets/textures/ground-pbr/${set}/set.json`)).toBe(true);
      for (const map of MAPS) for (const tier of Object.keys(TIERS)) for (const f of FORMATS) expect(existsSync(mapFile(set, map, tier, f))).toBe(true);
    }
  });

  it("counts the mip chain in the GPU bytes", () => {
    expect(gpuBytes(1, 4)).toBe(4);
    expect(gpuBytes(4, 1)).toBe(16 + 4 + 1);
    // About 4/3 of the top level.
    expect(gpuBytes(1024, 4) / (1024 * 1024 * 4)).toBeCloseTo(4 / 3, 3);
  });
});
