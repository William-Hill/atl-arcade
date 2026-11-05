import { describe, expect, it } from "vitest";
import manifest from "../../assets/skate-features/features.json";
import { createPhysicsWorld, initPhysics } from "../physics/world.js";
import { prepareGrindables } from "../sim/skate/grind.js";
import {
  featureFootprint,
  featureGround,
  featureLevelObjects,
  featureSurfaceAt,
  rotateYaw,
  toWorld,
} from "./skate-features.js";

const F = manifest.features;
const close = (a, b, digits = 3) =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

describe("skate features manifest", () => {
  it("has every feature with a file, LOD0, bounds, and grind edges inside the bounds", () => {
    expect(Object.keys(F).length).toBe(18);
    for (const [id, f] of Object.entries(F)) {
      expect(f.file).toBe(`${id}.glb`);
      expect(f.lods.lod0.node).toBe(`${id}_lod0`);
      if (f.lods.lod0.triangles > manifest.lod1_min_triangles)
        expect(f.lods.lod1).toBeTruthy();
      for (const e of f.grind) {
        expect(e.points.length).toBeGreaterThanOrEqual(2);
        for (const p of e.points) {
          for (const k of [0, 1, 2]) {
            expect(p[k]).toBeGreaterThanOrEqual(f.bounds.min[k] - 0.05);
            expect(p[k]).toBeLessThanOrEqual(f.bounds.max[k] + 0.05);
          }
        }
      }
    }
  });

  it("puts the origin at the ground center of each footprint", () => {
    for (const f of Object.values(F)) {
      expect(Math.abs(f.bounds.min[1])).toBeLessThan(0.01);
      expect(Math.abs(f.bounds.min[0] + f.bounds.max[0])).toBeLessThan(0.1);
      expect(Math.abs(f.bounds.min[2] + f.bounds.max[2])).toBeLessThan(0.1);
    }
  });
});

describe("placing a feature", () => {
  it("rotates like Three.js rotation.y (front +z turns toward +x at yaw pi/2)", () => {
    close(rotateYaw([0, 0, 1], Math.PI / 2), [1, 0, 0]);
    close(
      toWorld([1, 2, 0], { position: [10, 1, 5], yaw: Math.PI }),
      [9, 3, 5],
    );
  });

  it("gives grind objects that prepareGrindables accepts", () => {
    const placement = { id: "fb", position: [100, 2, -50], yaw: Math.PI / 2 };
    const objects = featureLevelObjects(F.rail_flatbar_6m, placement);
    const g = prepareGrindables({ objects });
    expect(g).toHaveLength(1);
    expect(g[0].id).toBe("fb:top");
    expect(g[0].kind).toBe("rail");
    expect(g[0].total).toBeCloseTo(6, 5);
    // Along x in the model, so along -z in the world at yaw pi/2, 0.33 m over the base.
    close(g[0].points[0], [100, 2.33, -47]);
    close(g[0].points[1], [100, 2.33, -53]);
  });

  it("keeps the kink of the kinked rail and follows the stairs down", () => {
    const [rail] = prepareGrindables({
      objects: featureLevelObjects(F.rail_kinked, {
        id: "k",
        position: [0, 0, 0],
        yaw: 0,
      }),
    });
    expect(rail.points).toHaveLength(4);
    const ys = rail.points.map((p) => p[1]);
    expect(ys[0]).toBeCloseTo(ys[1], 6);
    expect(ys[2]).toBeCloseTo(ys[3], 6);
    expect(ys[0] - ys[3]).toBeCloseTo(F.rail_kinked.stairs.landing_height, 4);
    // The skater rides it toward +z (downhill).
    expect(rail.points[3][2]).toBeGreaterThan(rail.points[0][2]);
  });

  it("samples the quarter pipe profile: toe at the ground, lip at its height, nothing behind", () => {
    const f = F.ramp_quarter;
    const placement = { id: "qp", position: [0, 5, 0], yaw: 0 };
    const pts = f.surfaces[0].points;
    const toe = featureSurfaceAt(f, placement, 0, pts[0][0] - 1e-4);
    expect(toe.height).toBeCloseTo(5, 3);
    expect(toe.normal[1]).toBeGreaterThan(0.99);
    const deck = featureSurfaceAt(
      f,
      placement,
      0,
      pts[pts.length - 1][0] + 0.1,
    );
    expect(deck.height).toBeCloseTo(5 + f.ramp.height, 4);
    // Mid face: the normal leans toward +z (the riding face faces forward).
    const mid = featureSurfaceAt(f, placement, 0.5, 0);
    expect(mid.normal[2]).toBeGreaterThan(0.2);
    expect(
      featureSurfaceAt(f, placement, 0, pts[pts.length - 1][0] - 0.1),
    ).toBeNull();
    expect(featureSurfaceAt(f, placement, 2, 0)).toBeNull();
  });

  it("samples the pyramid banks as planes and the top as flat", () => {
    const f = F.ramp_pyramid;
    const placement = { id: "py", position: [0, 0, 0], yaw: 0.3 };
    expect(featureSurfaceAt(f, placement, 0, 0).height).toBeCloseTo(0.6, 6);
    // Halfway down a bank, turned with the yaw.
    const [x, , z] = rotateYaw([0, 0, 1.6], 0.3);
    const s = featureSurfaceAt(f, placement, x, z);
    expect(s.height).toBeCloseTo(0.3, 4);
    close(
      s.normal,
      rotateYaw(
        [0, 1.2 / Math.hypot(1.2, 0.6), 0.6 / Math.hypot(1.2, 0.6)],
        0.3,
      ),
    );
  });

  it("samples the ledge and bench solids and finds the highest feature", () => {
    const sample = featureGround([
      {
        feature: F.ledge_concrete_3m,
        placement: { id: "a", position: [0, 0, 0], yaw: 0 },
      },
      {
        feature: F.bench_block,
        placement: { id: "b", position: [10, 1, 0], yaw: Math.PI / 2 },
      },
    ]);
    expect(sample(0, 0).height).toBeCloseTo(0.4, 4);
    expect(sample(0, 0).id).toBe("a:body");
    // The block bench turned 90 degrees: 2.4 m along z now.
    expect(sample(10, 1.1).height).toBeCloseTo(1.445, 4);
    expect(sample(11, 0)).toBeNull();
    expect(sample(5, 5)).toBeNull();
  });

  it("turns the footprint with the yaw", () => {
    const fp = featureFootprint(F.ledge_concrete_6m, {
      id: "l",
      position: [0, 0, 0],
      yaw: Math.PI / 2,
    });
    const zs = fp.map((p) => p[1]);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(6, 2);
  });

  it("rides the planter soil inside the granite cap", () => {
    const placement = { id: "p", position: [0, 0, 0], yaw: 0 };
    const f = F.ledge_planter;
    expect(featureSurfaceAt(f, placement, 0, 0).height).toBeCloseTo(0.4, 5);
    expect(
      featureSurfaceAt(f, placement, 0, f.bounds.max[2] - 0.05).height,
    ).toBeCloseTo(0.5, 5);
    expect(
      featureSurfaceAt(f, placement, f.bounds.min[0] + 0.05, 0).height,
    ).toBeCloseTo(0.5, 5);
  });

  it("builds a physics world from every feature's grind objects", async () => {
    const R = await initPhysics();
    const objects = Object.keys(F).flatMap((id, i) =>
      featureLevelObjects(F[id], {
        id,
        position: [i * 10, 0, 0],
        yaw: i * 0.3,
      }),
    );
    expect(new Set(objects.map((o) => o.edge))).toEqual(
      new Set(["rail", "ledge", "bench", "coping"]),
    );
    const { world } = createPhysicsWorld(R, { objects });
    expect(world).toBeTruthy();
    expect(prepareGrindables({ objects })).toHaveLength(objects.length);
  });
});
