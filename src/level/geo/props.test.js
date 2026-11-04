import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createGeoGroundSampler } from "./geo-ground.js";
import { createLevelEnv } from "../ground.js";
import { levelProps, PLANTER, PROP_SOLID, planterSpots, roofProps, streetProps, yawFrontToward, yawToward } from "./props.js";
import { doorBay, frontEdges } from "./facade-kit.js";
import { walkStrip } from "./aprons.js";
import { orientRing } from "./extrude.js";
import { roofPlan } from "./roof-plan.js";
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

describe("shop and roof props", () => {
  const fronts = frontEdges(LEVEL);
  const sample = createGeoGroundSampler(LEVEL);
  const props = streetProps(LEVEL, sample, fronts);
  const storefront = STYLES.find((s) => s.id === "storefront");

  it("puts a planter at every second inner pier, but not at the door bay", () => {
    // A 6-bay wall of 3.2 m along +x at z = 8; its outward normal is +z.
    const b = { id: "w-planters", outer: [[0, 0], [19.2, 0], [19.2, 8], [0, 8]] };
    const spots = planterSpots(b, storefront, { edge: 0, door: 1, wraps: [] });
    // Inner piers 2 and 4; pier 2 is a pier of door bay 1.
    expect(spots.length).toBe(1);
    expect(spots[0].x).toBeCloseTo(4 * 3.2, 6);
    expect(spots[0].z).toBeCloseTo(8 + PLANTER.out, 6);
    expect(spots[0].yaw).toBeCloseTo(yawToward(1, 0), 6);
    expect(planterSpots(b, storefront, null)).toEqual([]);
  });

  it("places planters on the shop aprons, as solid ledges", () => {
    const planters = props.filter((p) => p.kind === "planter");
    expect(planters.length).toBeGreaterThan(50);
    for (const p of planters) {
      expect(p.scale).toBe(PLANTER.scale);
      const g = sample(p.x, p.z);
      expect(g.id === "ground" || LEVEL.areas.some((a) => a.id === g.id)).toBe(true);
    }
    const env = createLevelEnv(LEVEL);
    const p = env.props.find((q) => q.kind === "planter");
    const ground = terrainOf(LEVEL).height(p.x, p.z);
    expect(env.sampleGround(p.x, p.z).height).toBeCloseTo(ground + PROP_SOLID.planter.h, 6);
  });

  it("keeps the street props off the walks from the shop doors", () => {
    const walks = [];
    for (const b of LEVEL.buildings) {
      const f = fronts.get(b.id);
      if (!f) continue;
      const w = walkStrip(orientRing(b.outer, false), f, STYLES.find((s) => s.id === chooseStyle(b)).bay);
      if (w) walks.push(w);
    }
    expect(walks.length).toBeGreaterThan(10);
    for (const p of props) {
      if (p.kind === "street_sign") continue;
      for (const w of walks) {
        const dx = p.x - w.o[0];
        const dz = p.z - w.o[1];
        const a = dx * w.t[0] + dz * w.t[1];
        const d = dx * w.n[0] + dz * w.n[1];
        expect(a > w.a0 && a < w.a1 && d > w.d0 && d < w.d1, `${p.kind} at ${p.x},${p.z}`).toBe(false);
      }
    }
  });

  it("takes the roof props from the roof plan, square to the walls", () => {
    const loft = LEVEL.buildings.find((b) => b.id === "w270469054");
    const style = STYLES.find((s) => s.id === chooseStyle(loft));
    const roof = roofProps(loft, style);
    const plan = roofPlan(loft, style).parts.filter((p) => p.kind !== "vent");
    expect(roof.map((p) => [p.kind, p.x, p.z, p.yaw])).toEqual(plan.map((p) => [p.kind, p.x, p.z, p.yaw]));
    expect(roof.some((p) => p.kind === "roof_unit")).toBe(true);
    expect(doorBay(fronts.get(loft.id), 8)).toBe(fronts.get(loft.id).door);
  });
});
