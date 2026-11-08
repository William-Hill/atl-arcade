import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EDGE_FENCE, EDGE_FENCE_ID, clipGrindables, edgeFence, fenceDistance, fencePosts, fenceRayDistance, inFence, nearEdge, withEdgeFence } from "./edge-fence.js";
import { createLevelEnv } from "./ground.js";
import { withCanopy } from "./levels.js";
import { createGeoGroundSampler, GEO_CELL } from "./geo/geo-ground.js";
import { propObstacles } from "./geo/props.js";
import { createSkateState, stepSkate } from "../sim/skate/controller.js";
import { SKATE } from "../sim/skate/constants.js";
import { createSkater, stepSkater } from "../sim/skate/skater.js";

const BOUNDS = { minX: -50, maxX: 50, minZ: -40, maxZ: 40 };
const DT = 1 / 60;

// Flat ground that stops at the bounds, as a geodata level does.
function boundedFlat(b) {
  return (x, z) => (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ ? null : { height: 0, normal: [0, 1, 0], id: "ground" });
}

function flatEnv({ fence = true } = {}) {
  const f = fence ? edgeFence(BOUNDS) : null;
  return { sampleGround: withEdgeFence(boundedFlat(BOUNDS), f), bounds: BOUNDS, spawn: { position: [0, 0, 0], yaw: 0 }, fence: f };
}

// Ride with the push held for `seconds`. Returns the last state and the
// number of respawns.
function ride(env, start, { seconds = 10, jumpEvery = 0 } = {}) {
  let s = start;
  let respawns = 0;
  const ticks = Math.round(seconds / DT);
  for (let i = 0; i < ticks; i += 1) {
    s = stepSkate(s, { push: true, jump: jumpEvery > 0 && i % jumpEvery === 0 }, DT, env);
    if (s.respawned) respawns += 1;
  }
  return { s, respawns };
}

function atTopSpeed(position, yaw) {
  return { ...createSkateState({ position, yaw }), speed: SKATE.maxSpeed };
}

describe("edgeFence", () => {
  it("puts the inner face `inset` m inside the bounds", () => {
    const f = edgeFence(BOUNDS);
    expect(f).toMatchObject({ minX: -47, maxX: 47, minZ: -37, maxZ: 37, thickness: EDGE_FENCE.thickness, height: EDGE_FENCE.height });
  });

  it("returns null for bounds too small for a fence", () => {
    expect(edgeFence({ minX: 0, maxX: 4, minZ: 0, maxZ: 100 })).toBeNull();
  });

  it("measures the distance to the inner face and finds the wall band", () => {
    const f = edgeFence(BOUNDS);
    expect(fenceDistance(f, 0, 0)).toBe(37);
    expect(fenceDistance(f, 45, 0)).toBe(2);
    expect(inFence(f, 46.9, 0)).toBe(false);
    expect(inFence(f, 47.1, 0)).toBe(true);
    expect(inFence(f, 0, -37.4)).toBe(true);
    expect(inFence(f, 48, 0)).toBe(false);
  });

  it("makes the band a wall above the ground and keeps the ground elsewhere", () => {
    const f = edgeFence(BOUNDS);
    const sample = withEdgeFence(() => ({ height: 1, normal: [0, 1, 0], id: "street" }), f);
    expect(sample(0, 0)).toMatchObject({ height: 1, id: "street" });
    expect(sample(47.2, 0)).toMatchObject({ height: 1 + EDGE_FENCE.height, id: EDGE_FENCE_ID });
    expect(sample(47.2, 0).height - 1).toBeGreaterThan(SKATE.maxStep);
    // With the skater height, the wall top is above the skater.
    expect(sample(47.2, 0, 20).height).toBe(20 + EDGE_FENCE.height);
    expect(sample(47.2, 0, 0).height).toBe(1 + EDGE_FENCE.height);
  });

  it("shows the hint only near the fence", () => {
    const f = edgeFence(BOUNDS);
    expect(nearEdge(f, 0, 0)).toBe(false);
    expect(nearEdge(f, 47 - EDGE_FENCE.hint + 0.5, 0)).toBe(true);
    expect(nearEdge(null, 47, 0)).toBe(false);
  });

  it("cuts the fence line into panels around the whole rectangle", () => {
    const f = edgeFence(BOUNDS);
    const posts = fencePosts(f);
    expect(posts[0]).toEqual(posts[posts.length - 1]);
    for (let i = 1; i < posts.length; i += 1) {
      const len = Math.hypot(posts[i][0] - posts[i - 1][0], posts[i][1] - posts[i - 1][1]);
      expect(len).toBeGreaterThan(EDGE_FENCE.panel * 0.75);
      expect(len).toBeLessThan(EDGE_FENCE.panel * 1.25);
    }
    // The posts are on the middle of the wall band.
    for (const [x, z] of posts) expect(inFence(f, x, z)).toBe(true);
  });
});

describe("the edge fence stops the skater (#229)", () => {
  it("without the fence, a skater at top speed rides off and the backstop respawns it", () => {
    const { respawns } = ride(flatEnv({ fence: false }), atTopSpeed([30, 0, 0], 0), { seconds: 4 });
    expect(respawns).toBe(1);
  });

  it("a skater that rides into the bound at top speed stops at the fence and does not respawn", () => {
    const env = flatEnv();
    const { s, respawns } = ride(env, atTopSpeed([30, 0, 0], 0), { seconds: 4 });
    expect(respawns).toBe(0);
    expect(s.speed).toBe(0);
    expect(s.position[0]).toBeLessThan(env.fence.maxX);
    expect(s.position[0]).toBeGreaterThan(env.fence.maxX - 2 * SKATE.bodyRadius);
  });

  it("stops the skater at each of the four edges", () => {
    const env = flatEnv();
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const { s, respawns } = ride(env, atTopSpeed([0, 0, 0], yaw), { seconds: 8 });
      expect(respawns).toBe(0);
      expect(fenceDistance(env.fence, s.position[0], s.position[2])).toBeGreaterThan(0);
    }
  });

  it("a skater that hits the fence at a shallow angle slides along it and stays in", () => {
    const env = flatEnv();
    const { s, respawns } = ride(env, atTopSpeed([30, 0, 0], 0.4), { seconds: 3 });
    expect(respawns).toBe(0);
    expect(fenceDistance(env.fence, s.position[0], s.position[2])).toBeGreaterThan(0);
  });

  it("a skater that falls from high above the ground does not fly over the fence", () => {
    const env = flatEnv();
    const start = { ...createSkateState({ position: [40, 20, 0], yaw: 0 }), state: "air", airFrom: "edge", velocity: [SKATE.maxSpeed, 0, 0] };
    const { s, respawns } = ride(env, start, { seconds: 4 });
    expect(respawns).toBe(0);
    expect(s.state).toBe("rolling");
    expect(fenceDistance(env.fence, s.position[0], s.position[2])).toBeGreaterThan(0);
  });

  it("a skater that jumps into the fence at top speed does not get over it", () => {
    const env = flatEnv();
    const { s, respawns } = ride(env, atTopSpeed([30, 0, 0], 0), { seconds: 4, jumpEvery: 20 });
    expect(respawns).toBe(0);
    expect(fenceDistance(env.fence, s.position[0], s.position[2])).toBeGreaterThan(0);
  });
});

// A ledge on flat ground, 0.4 m high, along +x from x0 to x1 at z = 0.
function ledge(x0, x1, id = "ledge:test") {
  const points = [];
  for (let x = x0; x <= x1; x += 2) points.push([x, 0.4, 0]);
  const total = (points.length - 1) * 2;
  return { id, kind: "ledge", points, total, box: { minX: x0, maxX: points.at(-1)[0], minZ: 0, maxZ: 0 } };
}

describe("clipGrindables", () => {
  const f = edgeFence(BOUNDS);

  it("keeps a grindable inside the fence as it is", () => {
    const g = ledge(0, 20);
    expect(clipGrindables([g], f)).toEqual([g]);
    expect(clipGrindables([g], null)).toEqual([g]);
  });

  it("cuts a grindable that crosses the fence line `margin` m inside the fence", () => {
    const [g] = clipGrindables([ledge(30, 60)], f, { margin: 1 });
    expect(g.id).toBe("ledge:test");
    expect(g.points[0]).toEqual([30, 0.4, 0]);
    expect(g.points.at(-1)[0]).toBeCloseTo(f.maxX - 1);
    expect(g.total).toBeCloseTo(f.maxX - 1 - 30);
    expect(g.box.maxX).toBeCloseTo(f.maxX - 1);
  });

  it("splits a grindable that leaves and comes back, and drops a part outside", () => {
    // Out past the east fence and back: a U along x, with the far end outside.
    const points = [[40, 0.4, 0], [55, 0.4, 0], [55, 0.4, 4], [40, 0.4, 4]];
    const parts = clipGrindables([{ id: "u", kind: "ledge", points, total: 34 }], f, { margin: 1 });
    expect(parts.map((p) => p.id)).toEqual(["u:a", "u:b"]);
    for (const p of parts) for (const [x] of p.points) expect(x).toBeLessThanOrEqual(f.maxX - 1 + 1e-9);
    expect(clipGrindables([ledge(52, 60)], f)).toEqual([]);
  });
});

describe("a grind does not go through the edge fence", () => {
  // Grind along a ledge that runs past the fence and the bounds.
  function grindRide(grindables) {
    const env = flatEnv();
    let s = createSkater(null, { position: [24, 0, 0.3], yaw: 0 });
    s.speed = SKATE.maxSpeed;
    let snaps = 0;
    let respawns = 0;
    for (let i = 0; i < Math.round(5 / DT); i += 1) {
      s = stepSkater(s, { push: true, grind: true }, DT, env, { grindables });
      if (s.justSnapped) snaps += 1;
      if (s.respawned) respawns += 1;
    }
    return { s, snaps, respawns, env };
  }

  it("without the cut, the grind carries the skater through the fence", () => {
    const { snaps, respawns } = grindRide([ledge(20, 70)]);
    expect(snaps).toBeGreaterThan(0);
    expect(respawns).toBe(1);
  });

  it("with the cut, the grind ends before the fence and the skater stays in", () => {
    const { s, snaps, respawns, env } = grindRide(clipGrindables([ledge(20, 70)], edgeFence(BOUNDS)));
    expect(snaps).toBeGreaterThan(0);
    expect(respawns).toBe(0);
    expect(fenceDistance(env.fence, s.position[0], s.position[2])).toBeGreaterThan(0);
  });
});

describe("the edge fence on the BeltLine Eastside level", () => {
  // The level with its canopy trees, as the game loads it (levels.js).
  const read = (name) => JSON.parse(readFileSync(new URL(`../../levels/beltline-eastside/${name}`, import.meta.url), "utf8"));
  const level = withCanopy(read("level.json"), read("canopy.json"));
  const env = createLevelEnv(level);
  // The level as it was before #229: the same sampler with no fence.
  const bare = { ...env, sampleGround: createGeoGroundSampler(level, GEO_CELL, { obstacles: propObstacles(env.props.filter((p) => !p.roof)) }) };
  const b = level.bounds;

  it("has a fence", () => {
    expect(env.fence).toMatchObject({ maxX: b.maxX - EDGE_FENCE.inset });
  });

  it("ends every grindable (benches, curbs) before the fence", () => {
    expect(env.grindables.length).toBeGreaterThan(100);
    for (const g of env.grindables) for (const [x, , z] of g.points) expect(fenceDistance(env.fence, x, z), g.id).toBeGreaterThan(0.99);
  });

  // For each edge: lanes 60 m from the edge, toward it. On a lane where the
  // skater rode off the level before the fence, it now stays in.
  const EDGES = [
    { name: "east", yaw: 0, start: (t) => [b.maxX - 60, t], lanes: [b.minZ + 100, b.maxZ - 100] },
    { name: "west", yaw: Math.PI, start: (t) => [b.minX + 60, t], lanes: [b.minZ + 100, b.maxZ - 100] },
    { name: "north", yaw: Math.PI / 2, start: (t) => [t, b.minZ + 60], lanes: [b.minX + 100, b.maxX - 100] },
    { name: "south", yaw: -Math.PI / 2, start: (t) => [t, b.maxZ - 60], lanes: [b.minX + 100, b.maxX - 100] },
  ];
  for (const edge of EDGES) {
    it(`stops a skater at full push at the ${edge.name} edge, where it rode off before`, () => {
      let tested = 0;
      for (let t = edge.lanes[0]; t <= edge.lanes[1] && tested < 3; t += 20) {
        const [x, z] = edge.start(t);
        const g = bare.sampleGround(x, z);
        if (!g) continue;
        const start = createSkateState({ position: [x, g.height, z], yaw: edge.yaw });
        if (ride(bare, start, { seconds: 12 }).respawns === 0) continue;
        tested += 1;
        const { s, respawns } = ride(env, start, { seconds: 12 });
        expect(respawns, `${edge.name} lane at ${t}`).toBe(0);
        expect(fenceDistance(env.fence, s.position[0], s.position[2])).toBeGreaterThan(0);
      }
      expect(tested).toBeGreaterThan(0);
    });
  }
});

// The follow camera ray against the fence (playtest 2026-11-08: the camera
// swung outside the fence and the banner hid the skater).
describe("fenceRayDistance", () => {
  const fence = edgeFence(BOUNDS); // inner face: x -47..47, z -37..37

  it("is Infinity when the camera stays inside the inner face", () => {
    expect(fenceRayDistance(fence, [0, 1.2, 0], [-4, 3, 2])).toBe(Infinity);
  });

  it("is the distance along the ray to the face the camera crosses", () => {
    // The skater faces west at x = 45; the camera trails east to x = 50.
    expect(fenceRayDistance(fence, [45, 1.2, 0], [50, 1.2, 0])).toBeCloseTo(2, 9);
    // The 3D length counts, not the ground length: rise 4 m over 3 m.
    expect(fenceRayDistance(fence, [44, 1, 0], [50, 9, 0])).toBeCloseTo(5, 9);
  });

  it("takes the first face on a ray through a corner", () => {
    // From (44, 0, 34) toward (50, 0, 40): x = 47 and z = 37 at the same point.
    expect(fenceRayDistance(fence, [44, 0, 34], [50, 0, 40])).toBeCloseTo(Math.hypot(3, 3), 9);
    // Toward (50, 0, 40): z = 37 at a quarter of the ray, x = 47 at half of it.
    expect(fenceRayDistance(fence, [44, 0, 36], [50, 0, 40])).toBeCloseTo(Math.hypot(1.5, 1), 9);
  });

  it("ignores a pivot that is already on or past the inner face", () => {
    expect(fenceRayDistance(fence, [47, 1.2, 0], [50, 1.2, 0])).toBe(Infinity);
    expect(fenceRayDistance(fence, [47.2, 1.2, 0], [45, 1.2, 0])).toBe(Infinity);
  });

  it("is Infinity with no fence or a zero-length ray", () => {
    expect(fenceRayDistance(null, [45, 1, 0], [50, 1, 0])).toBe(Infinity);
    expect(fenceRayDistance(fence, [45, 1, 0], [45, 1, 0])).toBe(Infinity);
  });

  it("keeps the camera inside the fence through resolveClip and placeCamera", async () => {
    const { resolveClip, placeCamera } = await import("../sim/camera.js");
    const pivot = [46.5, 1.2, 0];
    const cam = { position: [52, 3, 1] };
    const full = Math.hypot(5.5, 1.8, 1);
    const allowed = resolveClip(Infinity, full, fenceRayDistance(fence, pivot, cam.position), DT);
    const placed = placeCamera(cam, pivot, allowed);
    expect(fenceDistance(fence, placed.position[0], placed.position[2])).toBeGreaterThanOrEqual(0);
  });
});
