import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createLevelEnv } from "./ground.js";
import { loadLevel } from "./levels.js";
import { distanceToSegment, pointInRings } from "./geo/geo-ground.js";
import { createProjection } from "./geo/projection.js";
import { decodeHeights, encodeHeights, terrainOf } from "./geo/terrain.js";
import { SKATEPARK, distanceToRing, gradeTerrain, offPad, padOutline, padPoint, padYaw, skateparkGrindables, withSkatepark, withSkateparkGround } from "./skatepark.js";
import { findSnap } from "../sim/skate/grind.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const RAW = read("../../levels/beltline-eastside/level.json");
const PARK = read("../../levels/beltline-eastside/skatepark.json");
const MANIFEST = read("../../assets/skate-features/features.json");

describe("the pad frame", () => {
  const park = { center: [10, 20], axis: [0, -1], size: [8, 4] };

  it("puts +u along the axis and +v a quarter turn clockwise from above", () => {
    expect(padYaw(park)).toBeCloseTo(Math.PI / 2, 9);
    const [ux, uz] = padPoint(park, 1, 0);
    expect([ux, uz].map((v) => +v.toFixed(6))).toEqual([10, 19]);
    const [vx, vz] = padPoint(park, 0, 1);
    expect([vx, vz].map((v) => +v.toFixed(6))).toEqual([11, 20]);
  });

  it("gives the 4 corners of the pad", () => {
    const ring = padOutline(park).map((p) => p.map((v) => +v.toFixed(6)));
    expect(ring).toEqual([
      [8, 24],
      [8, 16],
      [12, 16],
      [12, 24],
    ]);
    expect(distanceToRing(10, 20, ring)).toBe(0);
    expect(distanceToRing(15, 20, ring)).toBeCloseTo(3, 9);
  });
});

describe("gradeTerrain", () => {
  // A 9 x 9 grid of 8 m cells on a 10% slope along x.
  const cols = 9;
  const rows = 9;
  const heights = Array.from({ length: cols * rows }, (_, k) => (k % cols) * 0.8);
  const terrain = { cell: 8, x0: 0, z0: 0, cols, rows, data: encodeHeights(heights) };
  const ring = [
    [28, 28],
    [36, 28],
    [36, 36],
    [28, 36],
  ];

  it("levels the nodes near the ring and leaves the far nodes", () => {
    const { terrain: out, height } = gradeTerrain(terrain, ring, { full: 12, blend: 28 });
    const h = decodeHeights(out.data, cols * rows);
    expect(height).toBeCloseTo(3.2, 2);
    // The 4 nodes around the pad are at the pad height.
    for (const [i, j] of [[3, 3], [4, 3], [3, 4], [4, 4], [5, 4]]) expect(h[j * cols + i]).toBeCloseTo(height, 2);
    // A node past the blend distance keeps its height.
    expect(h[0]).toBeCloseTo(0, 2);
    expect(h[4 * cols + 8]).toBeCloseTo(heights[4 * cols + 8], 2);
    // A node between the two is between its own height and the pad height.
    const mid = h[4 * cols + 7];
    expect(mid).toBeGreaterThan(height);
    expect(mid).toBeLessThan(heights[4 * cols + 7]);
    expect(terrain.data).toBe(encodeHeights(heights));
  });

  it("returns the terrain as it is when no node is near the ring", () => {
    const far = [[1000, 1000], [1001, 1000], [1001, 1001]];
    expect(gradeTerrain(terrain, far).terrain).toBe(terrain);
  });
});

describe("the BeltLine skatepark (#222)", () => {
  const level = withSkatepark(RAW, PARK, MANIFEST);
  const env = createLevelEnv(level, { props: false });
  const sp = level.skatepark;

  it("stands on the OpenStreetMap center of the real skatepark", () => {
    const [x, z] = createProjection(RAW.origin).toLocal(PARK.placement.osm.lat, PARK.placement.osm.lon);
    expect(Math.hypot(PARK.center[0] - x, PARK.center[1] - z)).toBeLessThan(0.5);
    expect(PARK.placement.approximate).toBe(true);
    expect(Math.hypot(...PARK.axis)).toBeCloseTo(1, 3);
  });

  it("does not change the level file object, and adds the pad as a paved area", () => {
    expect(RAW.skatepark).toBeUndefined();
    expect(RAW.areas.some((a) => a.id === sp.area)).toBe(false);
    const area = level.areas.find((a) => a.id === sp.area);
    expect(area.kind).toBe(SKATEPARK.surface);
    expect(area.outer.length).toBe(4);
    expect(withSkatepark(RAW, null, MANIFEST)).toBe(RAW);
  });

  it("keeps clear of the trail, the paths and the streets around it", () => {
    for (const s of RAW.strips) {
      for (let i = 0; i < s.points.length - 1; i += 1) {
        const [a, b] = [s.points[i], s.points[i + 1]];
        if (Math.hypot(a[0] - PARK.center[0], a[1] - PARK.center[1]) > 200) continue;
        for (const c of sp.outer) expect(distanceToSegment(c[0], c[1], a[0], a[1], b[0], b[1]), `${s.id} at a pad corner`).toBeGreaterThan(s.width / 2 + 1);
        for (let k = 0; k <= 20; k += 1) expect(pointInRings(a[0] + ((b[0] - a[0]) * k) / 20, a[1] + ((b[1] - a[1]) * k) / 20, [sp.outer]), `${s.id} crosses the pad`).toBe(false);
      }
    }
  });

  it("is level: the pad is one height, and the ground around it has no step", () => {
    const [l, w] = PARK.size;
    for (let u = -l / 2 + 0.2; u < l / 2; u += 1.3) {
      for (let v = -w / 2 + 0.2; v < w / 2; v += 1.3) {
        const [x, z] = padPoint(PARK, u, v);
        expect(terrainOf(level).height(x, z) + level.surfaces.sidewalk).toBeCloseTo(sp.top, 2);
      }
    }
    // Along the pad outline, 0.5 m out: the grass is one curb height under the pad.
    for (let u = -l / 2; u <= l / 2; u += 2) {
      for (const v of [-w / 2 - 0.5, w / 2 + 0.5]) {
        const [x, z] = padPoint(PARK, u, v);
        expect(sp.top - env.sampleGround(x, z).height).toBeCloseTo(level.surfaces.sidewalk, 1);
      }
    }
    // Where the grading changed the ground, the grade stays under 35%, or
    // within 5% of the grade before (the foot of the Freedom Parkway embankment,
    // 10 m south of the pad, goes from 21% to 31%).
    const t0 = terrainOf(RAW);
    const t1 = terrainOf(level);
    const grade = (t, x, z) => Math.max(Math.abs(t.height(x + 2, z) - t.height(x, z)), Math.abs(t.height(x, z + 2) - t.height(x, z))) / 2;
    let changed = 0;
    for (let x = PARK.center[0] - 60; x <= PARK.center[0] + 60; x += 2) {
      for (let z = PARK.center[1] - 60; z <= PARK.center[1] + 60; z += 2) {
        if (Math.abs(t1.height(x, z) - t0.height(x, z)) < 0.01) continue;
        changed += 1;
        expect(grade(t1, x, z), `grade at ${x}, ${z}`).toBeLessThan(Math.max(0.35, grade(t0, x, z) + 0.05));
      }
    }
    expect(changed).toBeGreaterThan(100);
    expect(t1.height(335.8, 10.8)).toBe(t0.height(335.8, 10.8));
    expect(t1.height(RAW.spawn.position[0], RAW.spawn.position[2])).toBe(t0.height(RAW.spawn.position[0], RAW.spawn.position[2]));
  });

  it("places every feature on the pad, with no feature on another", () => {
    expect(sp.placements.length).toBe(PARK.features.length);
    const boxes = sp.placements.map((p) => {
      const { min, max } = p.feature.footprint;
      const corners = [[min[0], min[1]], [max[0], min[1]], [max[0], max[1]], [min[0], max[1]]].map(([mx, mz]) => {
        const c = Math.cos(p.yaw);
        const s = Math.sin(p.yaw);
        return [p.position[0] + mx * c + mz * s, p.position[2] - mx * s + mz * c];
      });
      for (const [x, z] of corners) expect(pointInRings(x, z, [sp.outer]), `${p.id} leaves the pad`).toBe(true);
      expect(p.position[1]).toBeCloseTo(sp.top, 6);
      return { id: p.id, corners };
    });
    for (const a of boxes) for (const b of boxes) if (a !== b) for (const [x, z] of a.corners) expect(pointInRings(x, z, [b.corners]), `${a.id} is on ${b.id}`).toBe(false);
  });

  it("has the ramps and the ledge tops in the ground", () => {
    const at = (id, mx, mz) => {
      const p = sp.placements.find((q) => q.id === `h4w-skatepark:${id}`);
      const c = Math.cos(p.yaw);
      const s = Math.sin(p.yaw);
      return env.sampleGround(p.position[0] + mx * c + mz * s, p.position[2] - mx * s + mz * c);
    };
    expect(at("pyramid", 0, 0).height - sp.top).toBeCloseTo(0.6, 3);
    expect(at("pyramid", 0, 0).id).toBe("skatepark:h4w-skatepark:pyramid:top");
    expect(at("pyramid", 0, 1.6).height - sp.top).toBeCloseTo(0.3, 3);
    expect(at("pyramid", 0, 1.6).normal[1]).toBeLessThan(0.95);
    expect(at("line-ledge", 0, 0).height - sp.top).toBeCloseTo(0.4, 3);
    expect(at("quarter", 0, -0.9).height - sp.top).toBeCloseTo(1.2, 2);
    expect(at("bank", 0, -1).height - sp.top).toBeCloseTo(0.9, 3);
    expect(at("manual-pad", 0, 0).height - sp.top).toBeCloseTo(0.2, 3);
    // A rail has no ground of its own.
    expect(at("long-rail", 0, 0).id).toBe(sp.area);
    // Off the features the sampler is the level ground.
    const base = createLevelEnv(RAW, { props: false }).sampleGround(RAW.spawn.position[0], RAW.spawn.position[2]);
    expect(env.sampleGround(RAW.spawn.position[0], RAW.spawn.position[2])).toEqual(base);
    const plain = () => ({ height: 1, normal: [0, 1, 0], id: "g" });
    expect(withSkateparkGround(plain, null)).toBe(plain);
  });

  it("has the rails, the ledges and the copings in the grindables", () => {
    const mine = env.grindables.filter((g) => g.id.includes(":skatepark:"));
    expect(mine).toEqual(skateparkGrindables(sp));
    expect(mine.filter((g) => g.kind === "rail").map((g) => g.id)).toEqual(["rail:skatepark:h4w-skatepark:long-rail:top", "rail:skatepark:h4w-skatepark:end-rail:top", "rail:skatepark:h4w-skatepark:quarter:coping"]);
    const rail = mine.find((g) => g.id === "rail:skatepark:h4w-skatepark:long-rail:top");
    expect(rail.total).toBeCloseTo(9, 6);
    expect(rail.points[0][1] - sp.top).toBeCloseTo(0.33, 6);
    for (const g of mine) for (const [x, , z] of g.points) expect(pointInRings(x, z, [sp.outer])).toBe(true);
    // A skater who rolls beside the rail, along it, can snap to it.
    const [x, z] = padPoint(PARK, -8, -3.1);
    const snap = findSnap(env.grindables, { position: [x, sp.top, z], yaw: sp.yaw });
    expect(snap.grindable.id).toBe(rail.id);
    expect(skateparkGrindables(null)).toEqual([]);
  });

  it("keeps the props and the trees off the pad", () => {
    const [x, z] = padPoint(PARK, 2, 1);
    const [ox, oz] = padPoint(PARK, 0, PARK.size[1] / 2 + 5);
    const props = [{ kind: "tree", x, z }, { kind: "tree", x: ox, z: oz }];
    expect(offPad(props, sp)).toEqual([props[1]]);
    expect(offPad(props, null)).toBe(props);
  });

  it("loads with the BeltLine level", async () => {
    const loaded = await loadLevel("beltline-eastside");
    expect(loaded.skatepark.id).toBe("h4w-skatepark");
    expect(loaded.skatepark.name).toBe("Thomas Taylor Memorial Skatepark");
    expect(loaded.skatepark.top).toBeCloseTo(sp.top, 6);
    expect(createLevelEnv(loaded).props.every((p) => distanceToRing(p.x, p.z, loaded.skatepark.outer) > SKATEPARK.propMargin)).toBe(true);
  });
});
