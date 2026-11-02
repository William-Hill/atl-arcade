import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildingHeight, buildLevel, classifyWay, clipPolyline, joinRings, overpassQuery, parseHeight } from "./build-block.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const BBOX = { south: 33.756, west: -84.3685, north: 33.7735, east: -84.358 };

describe("build-block tags", () => {
  it("parses heights in meters and feet", () => {
    expect(parseHeight("50")).toBe(50);
    expect(parseHeight("12.5 m")).toBe(12.5);
    expect(parseHeight("100 ft")).toBeCloseTo(30.48, 6);
    expect(parseHeight("tall")).toBeNull();
  });

  it("takes height, then levels, then a default by building type", () => {
    expect(buildingHeight({ building: "yes", height: "50" })).toEqual({ height: 50, source: "height" });
    expect(buildingHeight({ building: "apartments", "building:levels": "5" })).toEqual({ height: 17, source: "levels" });
    expect(buildingHeight({ building: "house" })).toEqual({ height: 7, source: "default" });
  });

  it("uses the Overture height after the OSM tags and before the default", () => {
    expect(buildingHeight({ building: "yes", height: "50" }, { height: 20 })).toEqual({ height: 50, source: "height" });
    expect(buildingHeight({ building: "house" }, { height: 9.4 })).toEqual({ height: 9.4, source: "overture" });
    expect(buildingHeight({ building: "shed" }, { height: 1.8 })).toEqual({ height: 2.5, source: "overture" });
    expect(buildingHeight({ building: "yes" }, { height: null, floors: 3 })).toEqual({ height: 3 * 3.2 + 1, source: "overture" });
    expect(buildingHeight({ building: "house" }, { height: null, floors: null })).toEqual({ height: 7, source: "default" });
    expect(buildingHeight({ building: "yes" }).source).toBe("default");
  });

  it("sorts ways into street, sidewalk, path, and trail, and skips the rest", () => {
    expect(classifyWay({ highway: "cycleway", name: "Atlanta BeltLine Eastside Trail" })).toEqual({ kind: "trail", width: 4.3 });
    expect(classifyWay({ highway: "footway", footway: "sidewalk" })).toEqual({ kind: "sidewalk", width: 2 });
    expect(classifyWay({ highway: "residential" })).toEqual({ kind: "street", width: 8 });
    expect(classifyWay({ highway: "secondary", lanes: "4" }).width).toBeCloseTo(13.2, 6);
    expect(classifyWay({ highway: "service", service: "driveway" })).toEqual({ kind: "street", width: 3 });
    expect(classifyWay({ highway: "footway" })).toEqual({ kind: "path", width: 2 });
    expect(classifyWay({ highway: "footway", footway: "crossing" })).toBeNull();
    expect(classifyWay({ highway: "steps" })).toBeNull();
    expect(classifyWay({ highway: "primary", tunnel: "yes" })).toBeNull();
  });
});

describe("build-block geometry", () => {
  it("clips a polyline to the bbox", () => {
    const box = { minX: 0, maxX: 10, minZ: 0, maxZ: 10 };
    expect(clipPolyline([[-5, 5], [15, 5]], box)).toEqual([[[0, 5], [10, 5]]]);
    expect(clipPolyline([[-5, -5], [-1, -1]], box)).toEqual([]);
    // In, out, and in again gives two pieces.
    expect(clipPolyline([[1, 1], [1, 20], [2, 20], [2, 1]], box).length).toBe(2);
  });

  it("joins relation member ways into a closed ring", () => {
    const rings = joinRings([
      [[0, 0], [10, 0]],
      [[10, 10], [10, 0]],
      [[10, 10], [0, 10], [0, 0]],
    ]);
    expect(rings.length).toBe(1);
    expect(rings[0].length).toBe(5);
  });

  it("builds a level from a small Overpass answer, with the origin at the bbox center", () => {
    const c = { lat: (BBOX.south + BBOX.north) / 2, lon: (BBOX.west + BBOX.east) / 2 };
    const d = 0.0002;
    const square = [
      { lat: c.lat, lon: c.lon },
      { lat: c.lat, lon: c.lon + d },
      { lat: c.lat + d, lon: c.lon + d },
      { lat: c.lat + d, lon: c.lon },
      { lat: c.lat, lon: c.lon },
    ];
    const raw = {
      elements: [
        { type: "way", id: 1, tags: { building: "yes", height: "20", name: "Test Hall" }, geometry: square },
        { type: "way", id: 2, tags: { highway: "cycleway", name: "Atlanta Beltline Eastside Trail" }, geometry: [{ lat: c.lat - 0.001, lon: c.lon - 0.0005 }, { lat: c.lat + 0.001, lon: c.lon - 0.0005 }] },
        { type: "way", id: 3, tags: { highway: "steps" }, geometry: [{ lat: c.lat, lon: c.lon }, { lat: c.lat, lon: c.lon + d }] },
      ],
    };
    const level = buildLevel(raw, { bbox: BBOX, name: "t", title: "t" });
    expect(level.format).toBe("geo-level/1");
    expect(level.attribution).toMatch(/OpenStreetMap contributors/);
    expect(level.buildings).toHaveLength(1);
    expect(level.buildings[0]).toMatchObject({ id: "w1", height: 20, heightSource: "height", name: "Test Hall" });
    expect(level.buildings[0].outer[0]).toEqual([0, 0]);
    expect(level.strips).toHaveLength(1);
    expect(level.strips[0].kind).toBe("trail");
    // The spawn is on the trail and faces north (-z).
    expect(level.spawn.position[2]).toBeCloseTo(0, 0);
    expect(Math.sin(level.spawn.yaw)).toBeGreaterThan(0.99);
    expect(level.bounds.minX).toBeCloseTo(-level.bounds.maxX, 6);
  });

  it("puts every bbox edge in the Overpass query", () => {
    const q = overpassQuery(BBOX);
    expect(q).toContain("33.756,-84.3685,33.7735,-84.358");
    expect(q).toContain('way["building"]');
    expect(q).toContain('way["highway"]');
  });
});

describe("build-block offline run", () => {
  it("rebuilds the committed level from the cached fetch with no network, byte for byte", () => {
    const out = mkdtempSync(join(tmpdir(), "build-block-"));
    cpSync(resolve(ROOT, "levels/beltline-eastside/raw"), join(out, "raw"), { recursive: true });
    const log = execFileSync(
      process.execPath,
      ["scripts/build-block.mjs", "--bbox", "33.7560,-84.3685,33.7735,-84.3580", "--out", out, "--name", "beltline-eastside", "--title", "BeltLine Eastside Trail: Ponce City Market to Krog Street Market", "--offline"],
      { cwd: ROOT, encoding: "utf8" },
    );
    expect(log).toContain("cache hit");
    expect(readFileSync(join(out, "level.json"), "utf8")).toBe(readFileSync(resolve(ROOT, "levels/beltline-eastside/level.json"), "utf8"));
  });
});
