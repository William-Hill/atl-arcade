import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { chooseStyle, districtAnchors, withStyleDistricts } from "./styles.js";
import { withHistoricDistricts } from "./historic-districts.js";
import { houseFronts } from "./facade-kit.js";

const DIR = resolve(import.meta.dirname, "../../../levels/beltline-eastside");
const RAW = JSON.parse(readFileSync(resolve(DIR, "level.json"), "utf8"));
const DISTRICTS = JSON.parse(readFileSync(resolve(DIR, "historic-districts.json"), "utf8"));
// The level as src/level/levels.js loads it (the buildings part).
const LEVEL = withStyleDistricts(withHistoricDistricts(RAW, DISTRICTS));

describe("style districts: chooseStyle() with and without the level", () => {
  it("gave a different style to some buildings before the tag (the bug)", () => {
    const diff = RAW.buildings.filter((b) => chooseStyle(b) !== chooseStyle(b, RAW));
    expect(diff.length).toBeGreaterThan(0);
  });

  it("gives every building the same style with and without the level after the tag", () => {
    const diff = LEVEL.buildings.filter((b) => chooseStyle(b) !== chooseStyle(b, LEVEL)).map((b) => b.id);
    expect(diff).toEqual([]);
  });

  it("keeps the style of the call with the level (the mesh build sees no change)", () => {
    const loaded = withHistoricDistricts(RAW, DISTRICTS);
    for (let i = 0; i < LEVEL.buildings.length; i += 1) expect(chooseStyle(LEVEL.buildings[i], LEVEL)).toBe(chooseStyle(loaded.buildings[i], loaded));
  });

  it("tags each building with its anchor district or null, and keeps the input level", () => {
    const ids = new Set(districtAnchors(RAW).map((a) => a.id));
    expect(ids.size).toBeGreaterThan(0);
    for (const b of LEVEL.buildings) {
      if (!(b.outer?.length >= 3)) continue;
      expect(b.styleDistrict === null || ids.has(b.styleDistrict)).toBe(true);
    }
    expect(LEVEL.buildings.some((b) => b.styleDistrict)).toBe(true);
    expect(RAW.buildings[0].styleDistrict).toBeUndefined();
    expect(withStyleDistricts({ buildings: [] }).buildings).toEqual([]);
    const noAnchor = { buildings: [{ id: "x", height: 7, outer: [[0, 0], [9, 0], [9, 9], [0, 9]] }] };
    expect(withStyleDistricts(noAnchor)).toBe(noAnchor);
  });

  it("keeps the tag through a structured clone (the worker gets the same styles)", () => {
    const copy = structuredClone(LEVEL);
    for (let i = 0; i < copy.buildings.length; i += 100) expect(chooseStyle(copy.buildings[i])).toBe(chooseStyle(LEVEL.buildings[i], LEVEL));
  });

  it("gives a porch front to the houses that the mesh build gives a house roof", () => {
    const fronts = houseFronts(LEVEL);
    const houseIds = new Set(LEVEL.buildings.filter((b) => /-house$/.test(chooseStyle(b, LEVEL))).map((b) => b.id));
    for (const id of fronts.keys()) expect(houseIds.has(id)).toBe(true);
  });
});
