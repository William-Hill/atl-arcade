import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { facadeKitPlacements, houseFront } from "./facade-kit-glb.js";
import { frontEdges, houseFronts } from "./facade-kit.js";
import { withHistoricDistricts } from "./historic-districts.js";
import { HOUSE_STYLES, chooseStyle } from "./styles.js";

const DIR = resolve(import.meta.dirname, "../../../levels/beltline-eastside");
const LEVEL = withHistoricDistricts(JSON.parse(readFileSync(resolve(DIR, "level.json"), "utf8")), JSON.parse(readFileSync(resolve(DIR, "historic-districts.json"), "utf8")));
const FRONTS = frontEdges(LEVEL);
const HOUSES = houseFronts(LEVEL);
const BY_ID = new Map(LEVEL.buildings.map((b) => [b.id, b]));
// A porch wall of a building that the kit draws as a house.
const onPorch = (id, it) => {
  const h = HOUSE_STYLES.has(chooseStyle(BY_ID.get(id), LEVEL)) ? HOUSES.get(id) : null;
  return !!h && (it.wallIndex === h.edge || it.wallIndex === h.wrap?.edge);
};

describe("no wall AC unit on a house porch wall", () => {
  it("makes the house front from the porch wall and the wrap wall", () => {
    expect(houseFront(null)).toBeNull();
    expect(houseFront({ edge: -1 })).toBeNull();
    expect(houseFront({ edge: 2 })).toEqual({ edge: 2, wraps: [] });
    expect(houseFront({ edge: 2, wrap: { edge: 3, b0: 0, b1: 3.6, clear: 5 } })).toEqual({ edge: 2, wraps: [3] });
  });

  it("puts no AC unit on a porch wall, and keeps every other placement", () => {
    const before = facadeKitPlacements(LEVEL, FRONTS, { houses: new Map() });
    const after = facadeKitPlacements(LEVEL, FRONTS);
    const ac = (k, test) => k.buildings.reduce((n, b) => n + b.list.filter((it) => it.module === "ac_unit_wall" && test(b.id, it)).length, 0);
    // The bug: AC units on porch walls next to the door.
    expect(ac(before, onPorch)).toBeGreaterThan(0);
    expect(ac(after, onPorch)).toBe(0);
    // Every other placement is the same, in the same order.
    const byId = new Map(after.buildings.map((b) => [b.id, b.list]));
    for (const b of before.buildings) {
      const kept = b.list.filter((it) => !(it.module === "ac_unit_wall" && onPorch(b.id, it)));
      expect(byId.get(b.id) ?? []).toEqual(kept);
    }
    expect(after.instances).toBe(before.instances - ac(before, onPorch));
  });
});
