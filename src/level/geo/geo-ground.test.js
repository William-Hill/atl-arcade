import { describe, expect, it } from "vitest";
import { createGeoGroundSampler, distanceToSegment, pointInRings } from "./geo-ground.js";
import { createLevelEnv } from "../ground.js";
import { createSkateState, runScript } from "../../sim/skate/controller.js";

const SURFACES = { ground: 0, park: 0.02, street: 0.03, path: 0.05, trail: 0.07, sidewalk: 0.15 };

// A small level: a street along x, a sidewalk next to it, a trail that
// crosses the street, a park, and one building north of the sidewalk.
const LEVEL = {
  name: "tiny",
  format: "geo-level/1",
  bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 },
  spawn: { position: [-60, 0.03, 0], yaw: 0 },
  surfaces: SURFACES,
  buildings: [
    {
      id: "b1",
      height: 9,
      outer: [
        [-10, -30],
        [10, -30],
        [10, -15],
        [-10, -15],
      ],
    },
  ],
  strips: [
    { id: "street", kind: "street", width: 8, points: [[-90, 0], [90, 0]] },
    { id: "walk", kind: "sidewalk", width: 2, points: [[-90, -6], [90, -6]] },
    { id: "trail", kind: "trail", width: 4.3, points: [[30, 60], [30, -60]] },
  ],
  areas: [{ id: "park", kind: "park", outer: [[40, 20], [80, 20], [80, 60], [40, 60]] }],
  objects: [],
};

describe("geo ground sampler", () => {
  const sample = createGeoGroundSampler(LEVEL);

  it("returns the highest surface under a point", () => {
    expect(sample(0, 0)).toMatchObject({ height: 0.03, id: "street" });
    expect(sample(0, -6)).toMatchObject({ height: 0.15, id: "walk" });
    expect(sample(30, 0)).toMatchObject({ height: 0.07, id: "trail" }); // The trail is above the street.
    expect(sample(60, 40)).toMatchObject({ height: 0.02, id: "park" });
    expect(sample(0, -20)).toMatchObject({ height: 9, id: "b1" });
    expect(sample(0, 50)).toMatchObject({ height: 0, id: "ground" });
    expect(sample(0, 50).normal).toEqual([0, 1, 0]);
  });

  it("uses the strip half width as the edge", () => {
    expect(sample(0, 3.99).id).toBe("street");
    expect(sample(0, 4.01).id).toBe("ground");
  });

  it("returns null outside the bounds, so the controller respawns the skater", () => {
    expect(sample(101, 0)).toBeNull();
  });

  it("agrees with a brute-force test over a grid of points", () => {
    for (let x = -95; x <= 95; x += 3.7) {
      for (let z = -95; z <= 95; z += 3.7) {
        let best = { height: 0, id: "ground" };
        for (const b of LEVEL.buildings) if (pointInRings(x, z, [b.outer]) && b.height > best.height) best = { height: b.height, id: b.id };
        for (const a of LEVEL.areas) if (pointInRings(x, z, [a.outer]) && SURFACES[a.kind] > best.height) best = { height: SURFACES[a.kind], id: a.id };
        for (const s of LEVEL.strips) {
          const [p, q] = s.points;
          if (distanceToSegment(x, z, p[0], p[1], q[0], q[1]) <= s.width / 2 && SURFACES[s.kind] > best.height) best = { height: SURFACES[s.kind], id: s.id };
        }
        expect(sample(x, z)).toMatchObject(best);
      }
    }
  });

  it("is the sampler that createLevelEnv picks for a geo level", () => {
    const env = createLevelEnv(LEVEL);
    expect(env.sampleGround(0, -20).id).toBe("b1");
    expect(env.bounds).toBe(LEVEL.bounds);
  });

  it("lets the skater roll up the curb and stops her at the building wall", () => {
    const env = createLevelEnv(LEVEL);
    // North (-z) from the street: over the 0.12 m curb, then into the wall.
    const start = createSkateState({ position: [0, 0.03, 0], yaw: Math.PI / 2 });
    const { state, states } = runScript(start, [{ frames: 240, input: { push: true } }], { env, trace: true });
    expect(states.some((s) => s.position[1] === 0.15)).toBe(true);
    expect(state.position[2]).toBeGreaterThan(-15);
    expect(state.position[1]).toBeLessThan(1);
  });
});
