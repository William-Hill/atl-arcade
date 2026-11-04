import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createGeoGroundSampler } from "./geo-ground.js";
import { createLevelEnv } from "../ground.js";
import { FURNITURE_PROP, levelProps, nearestWay, PROP_SOLID, roofProps, streetProps, yawFrontToward, yawToward } from "./props.js";
import { chooseStyle, hash32, seededRandom, STYLES, wallColor } from "./styles.js";
import { terrainOf } from "./terrain.js";

const LEVEL = JSON.parse(readFileSync(new URL("../../../levels/beltline-eastside/level.json", import.meta.url), "utf8"));

describe("building styles", () => {
  it("has at least 10 variants with unique ids and sane numbers", () => {
    expect(STYLES.length).toBeGreaterThanOrEqual(10);
    expect(new Set(STYLES.map((s) => s.id)).size).toBe(STYLES.length);
    for (const s of STYLES) {
      expect(s.floorHeight).toBeGreaterThan(2.5);
      expect(s.bay).toBeGreaterThan(1);
      expect(s.window[0]).toBeLessThan(1);
      expect(s.window[1]).toBeLessThan(1);
    }
  });

  it("gives every real building a style, and the landmarks their own", () => {
    const used = new Set(LEVEL.buildings.map(chooseStyle));
    expect(used.size).toBeGreaterThanOrEqual(10);
    expect(chooseStyle(LEVEL.buildings.find((b) => b.name === "Ponce City Market"))).toBe("brick-warehouse");
    expect(chooseStyle(LEVEL.buildings.find((b) => b.name === "Krog Street Market"))).toBe("brick-market-hall");
  });

  it("is deterministic: the same id gives the same style, color, and random numbers", () => {
    const b = LEVEL.buildings[123];
    expect(chooseStyle(b)).toBe(chooseStyle({ ...b }));
    const s = STYLES[0];
    expect(wallColor(s, b.id)).toBe(wallColor(s, b.id));
    const r1 = seededRandom(hash32("x"));
    const r2 = seededRandom(hash32("x"));
    for (let i = 0; i < 5; i += 1) expect(r1()).toBe(r2());
  });
});

describe("prop placement", () => {
  const sample = createGeoGroundSampler(LEVEL);
  const props = streetProps(LEVEL, sample);
  const areaIds = new Set(LEVEL.areas.map((a) => a.id));

  it("places trees, lamps, benches, and bins along the trail and sidewalks", () => {
    const count = (k) => props.filter((p) => p.kind === k).length;
    expect(count("tree_round") + count("tree_tall")).toBeGreaterThan(500);
    expect(count("lamp")).toBeGreaterThan(100);
    expect(count("bench")).toBeGreaterThan(10);
    expect(count("bench_painted")).toBeGreaterThan(10);
    expect(count("bin")).toBeGreaterThan(5);
  });

  it("puts no prop on a paved surface or in a building, and keeps 2.5 m between props", () => {
    // A street sign may stand on a sidewalk, as a real sign does.
    const sidewalkIds = new Set(LEVEL.strips.filter((s) => s.kind === "sidewalk").map((s) => s.id));
    for (const p of props) {
      const g = sample(p.x, p.z);
      const open = g.id === "ground" || areaIds.has(g.id) || (p.kind === "street_sign" && sidewalkIds.has(g.id));
      expect(open, `${p.kind} at ${p.x},${p.z} is on ${g.id}`).toBe(true);
    }
    const sorted = props.slice().sort((a, b) => a.x - b.x);
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length && sorted[j].x - sorted[i].x < 2.5; j += 1) {
        expect(Math.hypot(sorted[j].x - sorted[i].x, sorted[j].z - sorted[i].z)).toBeGreaterThanOrEqual(2.5 - 0.02);
      }
    }
  });

  it("gives the same props on every call", () => {
    expect(streetProps(LEVEL, sample)).toEqual(props);
  });

  it("puts roof props inside the footprint, at the roof height", () => {
    const pcm = LEVEL.buildings.find((b) => b.name === "Ponce City Market");
    const roof = roofProps(pcm, STYLES.find((s) => s.id === "brick-warehouse"));
    expect(roof.length).toBeGreaterThan(0);
    for (const p of roof) {
      expect(p.y).toBe(pcm.height);
      expect(createGeoGroundSampler({ ...LEVEL, buildings: [pcm], strips: [], areas: [] })(p.x, p.z).id).toBe(pcm.id);
    }
  });

  it("makes the street props solid in the level env, and keeps the trail clear", () => {
    const env = createLevelEnv(LEVEL);
    const tree = env.props.find((p) => p.kind === "tree_round");
    const g = env.sampleGround(tree.x, tree.z);
    const ground = terrainOf(LEVEL).height(tree.x, tree.z);
    expect(g.height).toBeCloseTo(ground + PROP_SOLID.tree_round.h, 6);
    expect(createLevelEnv(LEVEL, { props: false }).sampleGround(tree.x, tree.z).height).toBeLessThan(ground + 0.1);
    expect(levelProps(LEVEL).length).toBe(env.props.length);
  });

  it("puts a prop at the OSM street furniture points first", () => {
    const report = {};
    const ps = streetProps(LEVEL, sample, report);
    const f = report.furniture;
    expect(f.points).toBe(LEVEL.furniture.length);
    expect(f.placed + Object.values(f.refused).reduce((a, b) => a + b, 0)).toBe(f.points);
    // Only the kinds with no kit prop, and a few points on pavement, are refused.
    expect(f.placed).toBeGreaterThanOrEqual(40);
    const noKit = LEVEL.furniture.filter((p) => !FURNITURE_PROP[p.kind]).length;
    expect(f.refused["no-kit-prop"]).toBe(noKit);
    const byId = new Map(LEVEL.furniture.map((p) => [p.id, p]));
    const placed = ps.filter((p) => p.osm);
    expect(placed.length).toBe(f.placed);
    for (const p of placed) {
      const src = byId.get(p.osm);
      // The prop is the kit prop of its kind, at most 3 m from the OSM point.
      expect(p.kind === "bench_painted" ? "bench" : p.kind).toBe(FURNITURE_PROP[src.kind]);
      expect(Math.hypot(p.x - src.x, p.z - src.z)).toBeLessThanOrEqual(3.01);
      if (p.kind === "bench" || p.kind === "bench_painted") {
        // The bench front (+z turned by yaw) faces the nearest way.
        const w = nearestWay(LEVEL.strips, p.x, p.z);
        if (w.d > 0.1) expect(Math.sin(p.yaw) * (w.x - p.x) + Math.cos(p.yaw) * (w.z - p.z)).toBeGreaterThan(0);
        expect(p.kind === "bench_painted").toBe(src.tags?.backrest === "yes");
      }
    }
  });

  it("makes each mapped point a prop in a small level, and the fixed rule fills only where OSM has nothing near", () => {
    const trail = { id: "t", kind: "trail", width: 4, points: [[0, -200], [0, 200]] };
    const base = { surfaces: LEVEL.surfaces, bounds: { minX: -300, maxX: 300, minZ: -300, maxZ: 300 }, strips: [trail], areas: [], buildings: [] };
    const s = createGeoGroundSampler(base);
    const furniture = [
      { id: "n1", kind: "bench", x: 4, z: 0, tags: { backrest: "yes" } },
      { id: "n2", kind: "waste_basket", x: -4, z: 10 },
      // On the trail: it moves off the trail, away from the center line.
      { id: "n3", kind: "bicycle_parking", x: 1, z: 40 },
      { id: "n4", kind: "drinking_water", x: 4, z: 60 },
    ];
    const report = {};
    const ps = streetProps({ ...base, furniture }, s, report);
    const bench = ps.find((p) => p.osm === "n1");
    expect(bench).toMatchObject({ kind: "bench_painted", x: 4, z: 0 });
    // The front faces -x, toward the trail.
    expect(Math.sin(bench.yaw)).toBeCloseTo(-1, 6);
    expect(ps.find((p) => p.osm === "n2")).toMatchObject({ kind: "bin", x: -4, z: 10 });
    const rack = ps.find((p) => p.osm === "n3");
    expect(rack.kind).toBe("bike_rack");
    expect(rack.x).toBeGreaterThan(2);
    expect(report.furniture).toMatchObject({ points: 4, placed: 3, moved: 1, refused: { "no-kit-prop": 1 } });
    // No fixed-rule bench within 30 m of the mapped bench, or bike rack within 90 m of the mapped rack.
    for (const p of ps.filter((q) => !q.osm)) {
      if (p.kind.startsWith("bench")) expect(Math.hypot(p.x - 4, p.z)).toBeGreaterThanOrEqual(30);
      if (p.kind === "bike_rack") expect(Math.hypot(p.x - rack.x, p.z - rack.z)).toBeGreaterThanOrEqual(90);
    }
    // Without the OSM points, the fixed rule puts a bench near z = 0.
    const plain = streetProps(base, s);
    expect(plain.some((p) => p.kind.startsWith("bench") && Math.hypot(p.x, p.z) < 30)).toBe(true);
    expect(plain.some((p) => p.osm)).toBe(false);
  });

  it("moves a mapped point off a street to the near street edge, not toward the far path", () => {
    // A street at x = 0 (6 m wide) and a path 20 m to the west. The rack is
    // on the street, 1 m from its west edge. It must move west, off the
    // street, and not east across the street (away from the path).
    const street = { id: "s", kind: "street", width: 6, points: [[0, -100], [0, 100]] };
    const path = { id: "p", kind: "path", width: 2, points: [[-20, -100], [-20, 100]] };
    const base = { surfaces: LEVEL.surfaces, bounds: { minX: -200, maxX: 200, minZ: -200, maxZ: 200 }, strips: [street, path], areas: [], buildings: [] };
    const s = createGeoGroundSampler(base);
    const report = {};
    const ps = streetProps({ ...base, furniture: [{ id: "n9", kind: "bicycle_parking", x: -2, z: 0 }] }, s, report);
    const rack = ps.find((p) => p.osm === "n9");
    expect(rack, JSON.stringify(report.refusedPoints)).toBeTruthy();
    expect(rack.x).toBeLessThan(-3);
  });

  it("turns templates the same way as the skater yaw", () => {
    // forward(yaw) = (cos yaw, -sin yaw).
    const y = yawToward(0, -1);
    expect(Math.cos(y)).toBeCloseTo(0, 9);
    expect(-Math.sin(y)).toBeCloseTo(-1, 9);
    // A template +z front turned by yawFrontToward(vx, vz) points at (vx, vz).
    const f = yawFrontToward(1, 0);
    expect(Math.sin(f)).toBeCloseTo(1, 9);
    expect(Math.cos(f)).toBeCloseTo(0, 9);
  });
});

it("only the brick styles get the brick scan detail on the facades", () => {
  const brick = STYLES.filter((s) => s.brick).map((s) => s.id);
  expect(brick).toEqual(["brick-loft", "brick-warehouse", "brick-market-hall"]);
});
