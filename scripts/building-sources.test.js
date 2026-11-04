import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildLevel } from "./build-block.mjs";
import { buildSources, reportText, sourceFile } from "./building-sources.mjs";
import { createProjection } from "../src/level/geo/projection.js";
import { inFootprint, recordProblems } from "../src/level/geo/building-sources.js";

// Issue #88: the building source file for the BeltLine level.

const ROOT = resolve(import.meta.dirname, "..");
const read = (p) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));
const LEVEL = read("levels/beltline-eastside/level.json");
const FILE = read("data/buildings/beltline-eastside.json");

describe("building source file: beltline-eastside (#88)", () => {
  it("has one record for each building in the level, and no other record", () => {
    const ids = LEVEL.buildings.map((b) => b.id).sort();
    const missing = ids.filter((id) => !FILE.buildings[id]);
    expect(missing).toEqual([]);
    expect(Object.keys(FILE.buildings).sort()).toEqual(ids);
  });

  it("gives each fact of each record a source and a confidence", () => {
    const problems = Object.values(FILE.buildings).flatMap(recordProblems);
    expect(problems).toEqual([]);
  });

  it("builds each level height from its record", () => {
    for (const b of LEVEL.buildings) {
      expect(b.height).toBe(FILE.buildings[b.id].height.value);
      expect(b.heightSource).toBe(FILE.buildings[b.id].height.source);
    }
    expect(LEVEL.stats.buildingHeights).toEqual(FILE.stats.height);
  });

  it("puts each address point inside the footprint of its building", () => {
    const proj = createProjection(LEVEL.origin);
    const outside = [];
    let n = 0;
    for (const b of LEVEL.buildings) {
      const a = FILE.buildings[b.id].address;
      if (a.value === null) continue;
      n += 1;
      const [lon, lat] = a.point;
      if (!inFootprint(proj.toLocal(lat, lon), b)) outside.push(`${b.id} ${a.value}`);
    }
    expect(n).toBeGreaterThan(800);
    expect(outside).toEqual([]);
  });

  it("keeps the 3 addresses that the #65 audit checked", () => {
    const byOsm = (id) => Object.values(FILE.buildings).filter((r) => r.osmId === id);
    // 725 Ponce (office tower) and Krog Street Market come from the city points.
    expect(byOsm("w741961703")[0].address).toMatchObject({ value: "725 PONCE DE LEON AVE NE", source: "city", confidence: "high" });
    const krog = Object.values(FILE.buildings).find((r) => r.name.value === "Krog Street Market");
    expect(krog.address.value).toBe("99 KROG ST NE");
    const pcm = Object.values(FILE.buildings).find((r) => r.name.value === "Ponce City Market");
    expect(pcm.address.value).toBe("675 PONCE DE LEON AVE NE");
  });

  it("uses the type default only where no other height source has a value", () => {
    const raw = read("levels/beltline-eastside/raw/overpass.json");
    const overture = read("levels/beltline-eastside/raw/overture.json").heights;
    const tags = {};
    for (const e of raw.elements) tags[`${e.type === "way" ? "w" : "r"}${e.id}`] = e.tags ?? {};
    for (const r of Object.values(FILE.buildings)) {
      if (r.height.source !== "default") continue;
      const t = tags[r.osmId];
      expect(t.height, r.id).toBeUndefined();
      expect(t["building:levels"], r.id).toBeUndefined();
      const o = overture[r.osmId];
      expect(Boolean(o && (o.height > 0 || o.floors > 0)), r.id).toBe(false);
    }
  });

  it("rebuilds the committed source file and report from the cached inputs, byte for byte", () => {
    const fetch = read("levels/beltline-eastside/raw/fetch.json");
    const overture = read("levels/beltline-eastside/raw/overture.json");
    const city = read("levels/beltline-eastside/raw/city-addresses.json");
    const raw = read("levels/beltline-eastside/raw/overpass.json");
    const heights = read("levels/beltline-eastside/heights.json").heights;
    const name = "beltline-eastside";
    const { records, stats, disagreements } = buildSources({ raw, bbox: fetch.bbox, name, overture, heights, city });
    expect(`${JSON.stringify(sourceFile({ name, records, stats, overture, city }), null, 1)}\n`).toBe(readFileSync(resolve(ROOT, "data/buildings/beltline-eastside.json"), "utf8"));
    expect(reportText({ name, stats, disagreements })).toBe(readFileSync(resolve(ROOT, "data/buildings/beltline-eastside.report.md"), "utf8"));
  });
});

describe("build-block with a building source file", () => {
  it("fails when a building has no record", () => {
    const BBOX = { south: 33.756, west: -84.3685, north: 33.7735, east: -84.358 };
    const c = { lat: (BBOX.south + BBOX.north) / 2, lon: (BBOX.west + BBOX.east) / 2 };
    const d = 0.0002;
    const square = [
      { lat: c.lat, lon: c.lon },
      { lat: c.lat, lon: c.lon + d },
      { lat: c.lat + d, lon: c.lon + d },
      { lat: c.lat + d, lon: c.lon },
      { lat: c.lat, lon: c.lon },
    ];
    const raw = { elements: [{ type: "way", id: 1, tags: { building: "yes" }, geometry: square }] };
    expect(() => buildLevel(raw, { bbox: BBOX, name: "t", title: "t", sources: {} })).toThrow(/w1 has no height record/);
    const level = buildLevel(raw, { bbox: BBOX, name: "t", title: "t", sources: { w1: { height: { value: 33.3, source: "override", confidence: "medium" } } } });
    expect(level.buildings[0]).toMatchObject({ height: 33.3, heightSource: "override" });
  });
});
