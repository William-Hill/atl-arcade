import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createGeoGroundSampler } from "../src/level/geo/geo-ground.js";
import { buildingHeight, buildLevel, classifyWay, clipOffCorridor, clipPolyline, furnitureQuery, hasGroundWalls, joinRings, overpassQuery, parseHeight, trailCorridor } from "./build-block.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const BBOX = { south: 33.756, west: -84.3685, north: 33.7735, east: -84.358 };

describe("build-block street furniture", () => {
  it("queries only nodes, and keeps the useful tags of each point", () => {
    expect(furnitureQuery(BBOX)).toContain('node["amenity"~"^(bench|waste_basket|bicycle_parking|drinking_water)$"]');
    expect(furnitureQuery(BBOX)).not.toContain("way[");
    const raw = { elements: [{ type: "way", id: 1, tags: { building: "yes" } }] };
    const furniture = {
      elements: [
        { type: "node", id: 7, lat: 33.765, lon: -84.363, tags: { amenity: "bench", backrest: "yes", "check_date": "2024" } },
        { type: "node", id: 8, lat: 33.765, lon: -84.3631, tags: { highway: "street_lamp" } },
        { type: "node", id: 9, lat: 34.5, lon: -84.363, tags: { amenity: "bench" } },
      ],
    };
    const level = buildLevel(raw, { bbox: BBOX, name: "t", title: "t", furniture });
    expect(level.furniture.map((f) => [f.id, f.kind])).toEqual([["n7", "bench"], ["n8", "street_lamp"]]);
    expect(level.furniture[0].tags).toEqual({ backrest: "yes" });
    expect(level.stats.furniture).toMatchObject({ bench: 1, street_lamp: 1, bollard: 0 });
  });

  it("matches the 2026-11-03 count of the BeltLine furniture", () => {
    const level = JSON.parse(readFileSync(join(ROOT, "levels/beltline-eastside/level.json"), "utf8"));
    expect(level.stats.furniture).toEqual({ bench: 23, waste_basket: 7, bicycle_parking: 14, drinking_water: 5, street_lamp: 4, bollard: 4 });
    expect(level.furniture.filter((f) => f.tags?.backrest === "yes").length).toBe(12);
  });
});

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
    // An Overture house over the cap is capped; a tag or an override wins over the cap.
    expect(buildingHeight({ building: "house" }, { height: 37.1 })).toEqual({ height: 12, source: "overture-capped" });
    expect(buildingHeight({ building: "house", height: "30" }, { height: 37.1 })).toEqual({ height: 30, source: "height" });
    expect(buildingHeight({ building: "yes" }, { height: 27.7 }, { height: 68.2 })).toEqual({ height: 68.2, source: "override" });
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

describe("build-block footprints off the trail (#57)", () => {
  it("skips roofs and footprints with no walls down to the ground", () => {
    expect(hasGroundWalls({ building: "roof", layer: "1" })).toBe(false);
    expect(hasGroundWalls({ building: "yes", min_height: "6" })).toBe(false);
    expect(hasGroundWalls({ building: "yes", "building:min_level": "2" })).toBe(false);
    expect(hasGroundWalls({ building: "yes", layer: "1" })).toBe(true);
    expect(hasGroundWalls({ building: "office" })).toBe(true);
  });

  it("cuts the trail corridor out of a footprint and keeps a footprint off the trail", () => {
    const corridor = trailCorridor([{ id: "t", kind: "trail", width: 4, points: [[-50, 0], [50, 0]] }]);
    const across = { id: "b", height: 10, outer: [[-10, -10], [10, -10], [10, 10], [-10, 10]] };
    const pieces = clipOffCorridor(across, corridor);
    expect(pieces.map((p) => p.id)).toEqual(["b-0", "b-1"]);
    for (const p of pieces) {
      expect(p.height).toBe(10);
      for (const [, z] of p.outer) expect(Math.abs(z)).toBeGreaterThanOrEqual(2.5 - 1e-9);
    }
    const away = { id: "c", height: 10, outer: [[-10, 20], [10, 20], [10, 30], [-10, 30]] };
    expect(clipOffCorridor(away, corridor)).toEqual([away]);
  });

  it("skips a raised footprint (layer 1) over a path, and keeps one beside it", () => {
    const c = { lat: (BBOX.south + BBOX.north) / 2, lon: (BBOX.west + BBOX.east) / 2 };
    const d = 0.0002;
    const square = (lon) => [
      { lat: c.lat, lon },
      { lat: c.lat, lon: lon + d },
      { lat: c.lat + d, lon: lon + d },
      { lat: c.lat + d, lon },
      { lat: c.lat, lon },
    ];
    const raw = {
      elements: [
        { type: "way", id: 1, tags: { building: "yes", layer: "1" }, geometry: square(c.lon) },
        { type: "way", id: 2, tags: { building: "yes", layer: "1" }, geometry: square(c.lon + 0.001) },
        { type: "way", id: 3, tags: { highway: "footway" }, geometry: [{ lat: c.lat + d / 2, lon: c.lon - d }, { lat: c.lat + d / 2, lon: c.lon + 2 * d }] },
      ],
    };
    const level = buildLevel(raw, { bbox: BBOX, name: "t", title: "t" });
    expect(level.buildings.map((b) => b.id)).toEqual(["w2"]);
  });
});

describe("build-block committed BeltLine level (#57)", () => {
  const level = JSON.parse(readFileSync(resolve(ROOT, "levels/beltline-eastside/level.json"), "utf8"));
  const sample = createGeoGroundSampler(level);
  const buildingIds = new Set(level.buildings.map((b) => b.id));
  // Every point every 0.5 m on the center line of the strips, and the building under it.
  const walls = (strips) => {
    const hits = new Set();
    for (const s of strips) {
      for (let i = 0; i < s.points.length - 1; i += 1) {
        const [ax, az] = s.points[i];
        const [bx, bz] = s.points[i + 1];
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5));
        for (let k = 0; k <= n; k += 1) {
          const g = sample(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n);
          if (g && buildingIds.has(g.id)) hits.add(`${s.id} -> ${g.id}`);
        }
      }
    }
    return [...hits];
  };

  it("has no building wall on the full trail center line", () => {
    const trail = level.strips.filter((s) => s.kind === "trail");
    expect(trail.reduce((n, s) => n + s.points.length - 1, 0)).toBeGreaterThan(50);
    expect(walls(trail)).toEqual([]);
  });

  it("has no roof or shed wall on the paths under them", () => {
    // Stone Mountain Trail, and the paths through the Beltline Shed.
    const ids = ["w44851091", "w1387075148", "w431443667", "w431795703"];
    const paths = level.strips.filter((s) => ids.includes(s.id));
    expect(paths.length).toBe(ids.length);
    expect(walls(paths)).toEqual([]);
    for (const id of ["w1365544414", "w270468871", "w223977988"]) expect(buildingIds.has(id)).toBe(false);
    // 725 Ponce stays, cut back off the trail.
    expect(buildingIds.has("w741961703")).toBe(true);
  });
});

describe("build-block offline run", () => {
  it("rebuilds the committed level from the cached fetch with no network, byte for byte", () => {
    const out = mkdtempSync(join(tmpdir(), "build-block-"));
    cpSync(resolve(ROOT, "levels/beltline-eastside/raw"), join(out, "raw"), { recursive: true });
    // The height overrides (with sources) are an input too. The building
    // source file (data/buildings/beltline-eastside.json, #88) comes from the
    // repository by the level name, and gives every height.
    cpSync(resolve(ROOT, "levels/beltline-eastside/heights.json"), join(out, "heights.json"));
    const log = execFileSync(
      process.execPath,
      ["scripts/build-block.mjs", "--bbox", "33.7560,-84.3685,33.7735,-84.3580", "--out", out, "--name", "beltline-eastside", "--title", "BeltLine Eastside Trail: Ponce City Market to Krog Street Market", "--offline"],
      { cwd: ROOT, encoding: "utf8" },
    );
    expect(log).toContain("cache hit");
    expect(readFileSync(join(out, "level.json"), "utf8")).toBe(readFileSync(resolve(ROOT, "levels/beltline-eastside/level.json"), "utf8"));
  });
});
