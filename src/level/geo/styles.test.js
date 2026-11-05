import { describe, expect, it } from "vitest";
import { LEVEL_FLOOR, STYLES, chooseStyle, floorCount, roofForm } from "./styles.js";

const style = (id) => STYLES.find((s) => s.id === id);
const SQUARE = (s) => [[0, 0], [s, 0], [s, s], [0, s]];

// Issue #135: the OSM building:levels, roof:shape, and building:material tags.
describe("building styles and the OSM tags", () => {
  it("uses the OSM level count when it fits the wall height", () => {
    const loft = style("brick-loft");
    expect(floorCount({}, loft, 12)).toBe(3);
    expect(floorCount({ levels: 2 }, loft, 12)).toBe(2);
    // 12 m in 6 levels is 2 m a floor: under LEVEL_FLOOR, so the tag is not used.
    expect(12 / 6).toBeLessThan(LEVEL_FLOOR[0]);
    expect(floorCount({ levels: 6 }, loft, 12)).toBe(3);
    expect(floorCount({ levels: 1.5 }, loft, 12)).toBe(3);
    expect(floorCount(null, loft, 1)).toBe(1);
  });

  it("gives a gable to houses, and follows the OSM roof shape", () => {
    expect(roofForm({}, style("craftsman-house"))).toBe("gable");
    expect(roofForm({ roofShape: "flat" }, style("craftsman-house"))).toBe("flat");
    expect(roofForm({}, style("garage"))).toBe("flat");
    expect(roofForm({ roofShape: "gabled" }, style("garage"))).toBe("gable");
    // A tall parapet stays flat: the gable would sit behind the parapet.
    expect(roofForm({ roofShape: "gabled" }, style("storefront"))).toBe("flat");
  });

  it("picks a brick style for an untyped brick building", () => {
    const b = { id: "t1", height: 9, outer: SQUARE(20) };
    expect(chooseStyle({ ...b, material: "brick" })).toBe("brick-loft");
    expect(chooseStyle({ ...b, material: "brick", outer: SQUARE(60) })).toBe("brick-warehouse");
    // The OSM building type comes first.
    expect(chooseStyle({ ...b, material: "brick", type: "house" })).toBe("craftsman-house");
  });

  it("gives every solar rate and water tower rate a valid chance", () => {
    for (const s of STYLES) {
      for (const k of ["solar", "water_tower"]) {
        const r = s.roof?.[k];
        if (r !== undefined) expect(r > 0 && r <= 1, `${s.id} ${k}`).toBe(true);
      }
    }
    expect(style("industrial-shed").roof.water_tower).toBeGreaterThan(0);
  });
});
