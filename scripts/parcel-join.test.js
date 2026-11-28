import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { STORY_RANGE, YEAR_RANGE, inRing, inRings, interiorPoint, joinParcels, parcelFields, projectRows, structureFor } from "./parcel-join.mjs";
import { featureRow } from "./fulton-structures.mjs";
import { styleCoverage } from "./style-coverage.mjs";

// Issue #406: the join of the level buildings to the Fulton County
// structure footprints.

const SQUARE = (x, z, s) => [[x, z], [x + s, z], [x + s, z + s], [x, z + s]];
// A projection for the tests: one degree is one meter.
const toLocal = (lat, lon) => [lon, lat];
// `fields.rings` sets all the rings (an outer ring and its courtyards).
const row = (ring, fields) => ({ OBJECTID: 1, ParcelID: "14 0001", LUC: "101", YearBuilt: "1925", Stories: 2, StructForm: "Conventional", rings: [ring.map(([x, z]) => [x, z])], ...fields });

describe("inRing and interiorPoint", () => {
  it("tests a point in a square", () => {
    expect(inRing([5, 5], SQUARE(0, 0, 10))).toBe(true);
    expect(inRing([15, 5], SQUARE(0, 0, 10))).toBe(false);
  });

  it("finds a point inside a U footprint, whose vertex mean is outside", () => {
    const u = [[0, 0], [30, 0], [30, 30], [20, 30], [20, 6], [10, 6], [10, 30], [0, 30]];
    let x = 0, z = 0;
    for (const p of u) { x += p[0]; z += p[1]; }
    expect(inRing([x / u.length, z / u.length], u)).toBe(false);
    expect(inRing(interiorPoint(u), u)).toBe(true);
  });
});

describe("courtyards (holes)", () => {
  const outer = SQUARE(0, 0, 20);
  const court = SQUARE(4, 4, 12);

  it("keeps the interior point out of a courtyard", () => {
    const p = interiorPoint(outer, [court]);
    expect(inRings(p, [outer, court])).toBe(true);
    expect(inRing(p, court)).toBe(false);
  });

  it("does not give a courtyard building the data of the structure around it", () => {
    // A county structure with a courtyard, and a separate small structure
    // in the courtyard. The OSM building is the small one.
    const structures = projectRows([row(outer, { OBJECTID: 1, LUC: "2C1", rings: [outer, court] }), row(SQUARE(6, 6, 6), { OBJECTID: 2, LUC: "101" })], toLocal);
    for (const s of structures) s.point = interiorPoint(s.rings[0], s.rings.slice(1));
    expect(inRing(structures[0].point, court)).toBe(false);
    expect(structureFor(SQUARE(6.5, 6.5, 5), structures).row.OBJECTID).toBe(2);
    // With no small structure, the courtyard building gets no data.
    expect(structureFor(SQUARE(6.5, 6.5, 5), structures.slice(0, 1))).toBeNull();
  });

  it("does not give a building with a courtyard the data of a structure in the courtyard", () => {
    const structures = projectRows([row(SQUARE(6, 6, 6), { OBJECTID: 2 })], toLocal);
    for (const s of structures) s.point = interiorPoint(s.rings[0]);
    expect(structureFor(outer, structures, [court])).toBeNull();
    expect(structureFor(outer, structures)).not.toBeNull();
  });
});

describe("parcelFields", () => {
  it("keeps only the land use, the year built, and the stories", () => {
    expect(parcelFields({ row: row(SQUARE(0, 0, 10)) })).toEqual({ landUse: "101", yearBuilt: 1925, stories: 2 });
  });

  it("drops a year or a story count out of range", () => {
    const f = parcelFields({ row: row(SQUARE(0, 0, 10), { YearBuilt: "0", Stories: 0 }) });
    expect(f).toEqual({ landUse: "101" });
    expect(parcelFields({ row: row(SQUARE(0, 0, 10), { YearBuilt: String(YEAR_RANGE[1] + 1), Stories: STORY_RANGE[1] + 1 }) })).toEqual({ landUse: "101" });
  });

  it("gives null with no structure or no field", () => {
    expect(parcelFields(null)).toBeNull();
    expect(parcelFields({ row: row(SQUARE(0, 0, 10), { LUC: null, YearBuilt: null, Stories: null }) })).toBeNull();
  });
});

describe("structureFor", () => {
  const structures = projectRows([row(SQUARE(0, 0, 10), { OBJECTID: 1 }), row(SQUARE(0, 0, 30), { OBJECTID: 2, LUC: "374" }), row(SQUARE(100, 0, 10), { OBJECTID: 3 })], toLocal);
  for (const s of structures) s.point = interiorPoint(s.rings[0]);

  it("takes the largest structure that holds the footprint point", () => {
    expect(structureFor(SQUARE(2, 2, 6), structures).row.OBJECTID).toBe(2);
  });

  it("takes a structure whose point is in the footprint when the outlines differ", () => {
    // The footprint point (106, -2.5) is outside structure 3, but the
    // structure point (105, 5) is inside the footprint.
    expect(structureFor([[103, -10], [109, -10], [109, 5.5], [103, 5.5]], structures).row.OBJECTID).toBe(3);
  });

  it("gives null with no structure near", () => {
    expect(structureFor(SQUARE(500, 500, 10), structures)).toBeNull();
  });
});

describe("joinParcels", () => {
  it("joins each building and counts the coverage", () => {
    const data = { structures: [row(SQUARE(0, 0, 10)), row(SQUARE(50, 0, 10), { YearBuilt: null, Stories: null, LUC: "374" })] };
    const buildings = [{ id: "w1", outer: SQUARE(1, 1, 8) }, { id: "w2", outer: SQUARE(51, 1, 8) }, { id: "w3", outer: SQUARE(200, 0, 8) }];
    const { byId, counts } = joinParcels(buildings, data, toLocal);
    expect(byId.get("w1")).toEqual({ landUse: "101", yearBuilt: 1925, stories: 2 });
    expect(byId.get("w2")).toEqual({ landUse: "374" });
    expect(byId.has("w3")).toBe(false);
    expect(counts).toEqual({ buildings: 3, joined: 2, none: 1, landUse: 2, yearBuilt: 1, stories: 1 });
  });
});

describe("featureRow", () => {
  it("trims the text, keeps the asked fields, and rounds the rings", () => {
    const f = { attributes: { OBJECTID: 7, LUC: " 101 ", StructForm: "  ", Owner: "not asked" }, geometry: { rings: [[[-84.36123456, 33.76123456]]] } };
    const r = featureRow(f, ["OBJECTID", "LUC", "StructForm"]);
    expect(r).toEqual({ OBJECTID: 7, LUC: "101", StructForm: null, rings: [[[-84.361235, 33.761235]]] });
    expect("Owner" in r).toBe(false);
  });
});

describe("the BeltLine Eastside level (#406)", () => {
  const ROOT = resolve(import.meta.dirname, "..");
  const LEVEL = JSON.parse(readFileSync(resolve(ROOT, "levels/beltline-eastside/level.json"), "utf8"));

  it("has the coverage counts in the level stats", () => {
    expect(LEVEL.stats.parcels).toEqual({ buildings: 1042, joined: 988, none: 54, landUse: 988, yearBuilt: 960, stories: 814 });
  });

  it("lets the hash decide the style of fewer than 30 buildings (191 before #406)", () => {
    const c = styleCoverage(LEVEL);
    expect(c.buildings).toBe(1042);
    expect(c.hash).toBeLessThan(30);
  });
});
