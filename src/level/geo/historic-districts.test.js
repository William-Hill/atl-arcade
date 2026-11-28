import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { HISTORIC_MIX, districtAt, districtSlug, districtStyleMix, projectDistricts, withHistoricDistricts } from "./historic-districts.js";
import { STYLE_INDEX, chooseStyle } from "./styles.js";
import { labBuildings } from "./lab.js";

const DIR = resolve(import.meta.dirname, "../../../levels/beltline-eastside");
const LEVEL = JSON.parse(readFileSync(resolve(DIR, "level.json"), "utf8"));
const FILE = JSON.parse(readFileSync(resolve(DIR, "historic-districts.json"), "utf8"));
const ORIGIN = { lat: 33.76, lon: -84.36 };
// A district of 0.01 by 0.01 degrees with a hole in the middle, and a
// house in it, on the hole, and out of it.
const D = 0.01;
const SAMPLE = {
  attribution: "Historic districts: City",
  districts: [{ id: "inman-park", name: "Inman Park Historic District", rings: [
    [[-84.365, 33.755], [-84.355, 33.755], [-84.355, 33.765], [-84.365, 33.765]],
    [[-84.361, 33.759], [-84.359, 33.759], [-84.359, 33.761], [-84.361, 33.761]],
  ] }],
};
const box = (id, x, z, s = 5) => ({ id, height: 7, outer: [[x - s, z - s], [x + s, z - s], [x + s, z + s], [x - s, z + s]] });

describe("historic districts (#407)", () => {
  it("makes the district id from the City name", () => {
    expect(districtSlug("Inman Park Historic District")).toBe("inman-park");
    expect(districtSlug("Cabbagetown Landmark District")).toBe("cabbagetown");
    expect(districtSlug("Martin Luther King Jr. Landmark District")).toBe("martin-luther-king-jr");
    expect(districtSlug("Peachtree Circle Histroric District")).toBe("peachtree-circle");
  });

  it("finds the district of a point, with the hole out of it", () => {
    const ds = projectDistricts(SAMPLE, ORIGIN);
    expect(ds[0].rings[0][0][0]).toBeCloseTo(-0.005 * 111320 * Math.cos((33.76 * Math.PI) / 180), -2);
    expect(districtAt(300, 300, ds)).toBe("inman-park");
    expect(districtAt(0, 0, ds)).toBeNull();
    expect(districtAt(2000, 0, ds)).toBeNull();
    expect(D).toBe(0.01);
  });

  it("tags the buildings in a district and keeps the input level", () => {
    const level = { origin: ORIGIN, attribution: "Map data", buildings: [box("a", 300, 300), box("b", 0, 0), box("c", 2000, 0), { id: "d", outer: [] }] };
    const out = withHistoricDistricts(level, SAMPLE);
    expect(out.buildings.map((b) => b.historicDistrict ?? null)).toEqual(["inman-park", null, null, null]);
    expect(level.buildings[0].historicDistrict).toBeUndefined();
    expect(out.attribution).toBe("Map data. Historic districts: City");
    expect(out.historicDistricts).toEqual([{ id: "inman-park", name: "Inman Park Historic District" }]);
    expect(withHistoricDistricts(level, null)).toBe(level);
    expect(withHistoricDistricts(level, { districts: [] })).toBe(level);
  });

  it("gives each mix weights that sum to 100 and only known styles", () => {
    for (const mix of Object.values(HISTORIC_MIX)) {
      expect(mix.reduce((s, [, w]) => s + w, 0)).toBe(100);
      for (const [id] of mix) expect(STYLE_INDEX[id]).toBeDefined();
    }
  });

  it("changes only a house in a district with a mix", () => {
    const b = { id: "w1", historicDistrict: "inman-park" };
    expect(districtStyleMix(b, "storefront")).toBe("storefront");
    expect(districtStyleMix(b, "modern-apartment")).toBe("modern-apartment");
    expect(districtStyleMix({ id: "w1" }, "craftsman-house")).toBe("craftsman-house");
    expect(districtStyleMix({ id: "w1", historicDistrict: "no-mix" }, "craftsman-house")).toBe("craftsman-house");
    const one = districtStyleMix(b, "craftsman-house");
    expect(districtStyleMix(b, "craftsman-house")).toBe(one);
    expect(districtStyleMix(b, "shotgun-house")).toBe(one);
  });

  it("makes about 70 percent of the Inman Park houses Victorian", () => {
    let v = 0;
    for (let i = 0; i < 2000; i += 1) if (districtStyleMix({ id: `w${i}`, historicDistrict: "inman-park" }, "craftsman-house") === "victorian-house") v += 1;
    expect(v / 2000).toBeGreaterThan(0.64);
    expect(v / 2000).toBeLessThan(0.76);
  });

  it("has the Inman Park and MLK districts in the BeltLine level file, with the City terms", () => {
    expect(FILE.districts.map((d) => d.id).sort()).toEqual(["inman-park", "martin-luther-king-jr"]);
    expect(FILE.layer).toMatch(/gis\.atlantaga\.gov\/dpcd\/rest\/services\/OpenDataService1\/MapServer\/15$/);
    expect(FILE.terms).toMatch(/No license is stated/);
    expect(FILE.attribution).toMatch(/City of Atlanta/);
  });

  it("makes most Inman Park houses Victorian in the BeltLine level, and keeps the landmarks", () => {
    const level = withHistoricDistricts(LEVEL, FILE);
    const ip = level.buildings.filter((b) => b.historicDistrict === "inman-park");
    const houses = ip.map((b) => chooseStyle(b, level)).filter((s) => /-house$/.test(s));
    const v = houses.filter((s) => s === "victorian-house").length;
    expect(houses.length).toBeGreaterThan(150);
    expect(v / houses.length).toBeGreaterThan(0.6);
    // Out of the districts, no Victorian house.
    expect(level.buildings.filter((b) => !b.historicDistrict && chooseStyle(b, level) === "victorian-house")).toEqual([]);
    const krog = level.buildings.find((b) => /krog street market/i.test(b.name ?? ""));
    expect(chooseStyle(krog, level)).toBe("brick-market-hall");
    // The tag is on the building, so the calls without the level (the
    // porch fronts, the lab) also see the mix.
    const plain = ip.map((b) => chooseStyle(b)).filter((s) => /-house$/.test(s));
    expect(plain.filter((s) => s === "victorian-house").length / plain.length).toBeGreaterThan(0.6);
    // The lab finds a Victorian house in the tagged level.
    expect(labBuildings(level, "victorian-house").length).toBeGreaterThan(0);
  });
});
