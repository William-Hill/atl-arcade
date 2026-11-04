import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { levelProps } from "../src/level/geo/props.js";
import { shortName, streetIntersections } from "../src/level/geo/signs.js";
import { createStreetNamer, REVIEWED, withOsmCase } from "./street-names.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const load = (p) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));
const LEVEL = load("levels/beltline-eastside/level.json");
const CITY = load("levels/beltline-eastside/raw/city-streets.json");

// A city line along z = 0 from x = 0 to x = 100, and a strip on it.
const line = (label, z = 0) => ({ label, points: [[0, z], [100, z]] });
const strip = (name, z = 0) => ({ id: "w1", kind: "street", highway: "residential", name, width: 8, points: [[10, z], [90, z]] });

describe("street names from the city centerlines", () => {
  it("keeps the OSM name when a city line near the strip has the same name", () => {
    const nameOf = createStreetNamer([line("Ralph Mcgill Blvd NE")]);
    expect(nameOf(strip("Ralph McGill Boulevard Northeast"))).toEqual({ signName: "Ralph McGill Blvd NE", nameSource: "city" });
  });

  it("takes the city quadrant and spelling, with the OSM capitals", () => {
    expect(createStreetNamer([line("Ralph Mcgill Blvd NE")])(strip("Ralph McGill Boulevard"))).toEqual({ signName: "Ralph McGill Blvd NE", nameSource: "city" });
    expect(createStreetNamer([line("Patterson Way")])(strip("Patterson Way Northeast")).signName).toBe("Patterson Way");
    expect(createStreetNamer([line("Bishops Way NE")])(strip("Bishop Way Northeast")).signName).toBe("Bishops Way NE");
    expect(withOsmCase("Ponce De Leon Ave NE", "Ponce de Leon Avenue Northeast")).toBe("Ponce de Leon Ave NE");
  });

  it("replaces a mapper note with the city line that runs along the strip", () => {
    const nameOf = createStreetNamer([line("Brickworks Cir NE")]);
    expect(nameOf(strip("Closed Lake Avenue"))).toEqual({ signName: "Brickworks Cir NE", nameSource: "city" });
  });

  it("does not take the name of a city line that crosses the strip", () => {
    const cross = { label: "Glen Iris Dr NE", points: [[50, -100], [50, 100]] };
    expect(createStreetNamer([cross])(strip("Example Street"))).toEqual({ nameSource: "osm" });
  });

  it("keeps a reviewed OSM name where the city layer is out of date", () => {
    const nameOf = createStreetNamer([line("Freedom Pkwy North NE")]);
    expect(nameOf(strip("John Lewis Freedom Parkway Northeast"))).toEqual({ signName: "John Lewis Freedom Pkwy NE", nameSource: "reviewed" });
    for (const reason of Object.values(REVIEWED)) expect(reason).toMatch(/Source: /);
  });

  it("keeps the OSM name as a fallback when no city line is near, and the sign leaves it out", () => {
    const nameOf = createStreetNamer([line("Far St NE", 500)]);
    const a = { ...strip("Prospect Way Northeast"), ...nameOf(strip("Prospect Way Northeast")) };
    expect(a).toMatchObject({ name: "Prospect Way Northeast", nameSource: "osm" });
    expect(a.signName).toBeUndefined();
    const b = { id: "w2", kind: "street", highway: "residential", name: "East Avenue Northeast", signName: "East Ave NE", nameSource: "city", width: 8, points: [[50, -40], [50, 0], [50, 40]] };
    const level = { strips: [{ ...a, points: [[10, 0], [50, 0], [90, 0]] }, b] };
    const [ix] = streetIntersections(level);
    expect(ix.confirmed).toBe(false);
  });
});

describe("the BeltLine level signs and the city layer", () => {
  const cityLabels = new Set(CITY.segments.map((s) => shortName(s.label).toLowerCase()));
  const reviewed = new Set(Object.keys(REVIEWED).map((n) => shortName(n)));
  const signs = levelProps(LEVEL).filter((p) => p.kind === "street_sign");

  it("reads the centerlines from the open-data-atl catalog layer", () => {
    expect(CITY.catalogId).toBe("atl-street-centerlines");
    expect(CITY.segments.length).toBeGreaterThan(100);
    expect(LEVEL.attribution).toContain("Street names: City of Atlanta Department of City Planning");
  });

  it("shows on every sign a name from the city layer, or a reviewed name", () => {
    expect(signs.length).toBeGreaterThan(80);
    const names = [...new Set(signs.flatMap((s) => s.names))].sort();
    const bad = names.filter((n) => !cityLabels.has(n.toLowerCase()) && !reviewed.has(n));
    expect(bad).toEqual([]);
  });

  it("fixes the names from the audit (GEO-1, GEO-4)", () => {
    const names = new Set(signs.flatMap((s) => s.names));
    for (const wrong of ["Closed Lake Ave", "Bishop Way NE", "Prospect Way NE", "Austin Ave NE", "Ralph McGill Blvd"]) expect(names.has(wrong)).toBe(false);
    for (const right of ["Brickworks Cir NE", "West Ashland Ave NE", "Bishops Way NE", "Lake Ave NE", "Ralph McGill Blvd NE", "John Lewis Freedom Pkwy NE"]) expect(names.has(right)).toBe(true);
    // No sign has the same street on its two blades.
    for (const s of signs) expect(s.names[0]).not.toBe(s.names[1]);
  });

  it("marks the source of every street name in the level, and keeps the OSM name", () => {
    for (const s of LEVEL.strips.filter((q) => q.kind === "street" && q.name)) {
      expect(["city", "reviewed", "osm"]).toContain(s.nameSource);
      expect(s.nameSource === "osm" ? s.signName : typeof s.signName).toBe(s.nameSource === "osm" ? undefined : "string");
    }
    expect(LEVEL.strips.find((q) => q.id === "w586825917")).toMatchObject({ name: "Closed Lake Avenue", signName: "Brickworks Cir NE" });
  });
});
