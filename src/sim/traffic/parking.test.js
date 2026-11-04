import { describe, expect, it } from "vitest";
import { PARKING, parkedCars } from "./parking.js";
import { CAR_SIZE, MAIN_STREETS, carBodyDistance } from "./traffic.js";
import { createGeoGroundSampler, distanceToSegment } from "../../level/geo/geo-ground.js";
import { createLevelEnv } from "../../level/ground.js";
import beltline from "../../../levels/beltline-eastside/level.json" with { type: "json" };

const TOWN = {
  bounds: { minX: -300, maxX: 300, minZ: -300, maxZ: 300 },
  spawn: { position: [250, 0, 250], yaw: 0 },
  surfaces: { ground: 0, park: 0.02, street: 0.03, path: 0.05, trail: 0.07, sidewalk: 0.15 },
  strips: [
    // A residential street with a cross street at x = 0.
    { id: "e1", kind: "street", name: "Elm Street", highway: "residential", width: 8, points: [[-200, 0], [0, 0]] },
    { id: "e2", kind: "street", name: "Elm Street", highway: "residential", width: 8, points: [[0, 0], [200, 0]] },
    { id: "o1", kind: "street", name: "Oak Street", highway: "residential", width: 8, points: [[0, -150], [0, 0]] },
    // The trail crosses Elm Street at x = 120.
    { id: "t1", kind: "trail", width: 4.3, points: [[120, -100], [120, 100]] },
    // A main street, a bridge, a narrow street, and a service road: no cars.
    { id: "m1", kind: "street", name: "Main Street", highway: "residential", width: 12, points: [[-200, 80], [200, 80]] },
    { id: "b1", kind: "street", name: "High Street", highway: "residential", width: 10, bridge: true, points: [[-200, -80], [-50, -80]] },
    { id: "n1", kind: "street", name: "Narrow Lane", highway: "residential", width: 6, points: [[-200, 150], [200, 150]] },
    { id: "s1", kind: "street", highway: "service", width: 8, points: [[-200, 200], [200, 200]] },
    // A wide street: both curbs.
    { id: "w1", kind: "street", name: "Wide Avenue", highway: "tertiary", width: 14, points: [[-200, -220], [200, -220]] },
  ],
};

describe("parked cars", () => {
  const sample = createGeoGroundSampler(TOWN);
  const cars = parkedCars(TOWN, sample, { mainStreets: [["Main Street"]] });
  const stripOf = (c) => sample(c.x, c.z).id;

  it("parks cars only on named neighborhood streets wide enough for them", () => {
    expect(cars.length).toBeGreaterThan(10);
    const ids = new Set(cars.map(stripOf));
    for (const id of ["m1", "b1", "n1", "s1"]) expect(ids.has(id)).toBe(false);
    expect(ids.has("e1") || ids.has("e2")).toBe(true);
  });

  it("puts each car body on the street, at the curb, along the street", () => {
    for (const c of cars) {
      const size = CAR_SIZE[c.kind];
      expect(size).toBeDefined();
      const fx = Math.cos(c.yaw);
      const fz = -Math.sin(c.yaw);
      for (const [u, v] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const x = c.x + (fx * u * size.length) / 2 - (fz * v * size.width) / 2;
        const z = c.z + (fz * u * size.length) / 2 + (fx * v * size.width) / 2;
        expect(sample(x, z).id).toMatch(/^(e1|e2|o1|w1)$/);
      }
    }
    // On an 8 m street the car side is 0.35 m from the curb.
    const elm = cars.filter((c) => ["e1", "e2"].includes(stripOf(c)));
    for (const c of elm) expect(Math.abs(c.z)).toBeCloseTo(4 - CAR_SIZE[c.kind].width / 2 - PARKING.curbGap, 1);
  });

  it("parks on one curb of a narrow street and both curbs of a wide one", () => {
    const elmSides = new Set(cars.filter((c) => ["e1", "e2"].includes(stripOf(c))).map((c) => Math.sign(c.z)));
    expect(elmSides.size).toBe(1);
    const wideSides = new Set(cars.filter((c) => stripOf(c) === "w1").map((c) => Math.sign(c.z + 220)));
    expect(wideSides.size).toBe(2);
  });

  it("keeps clear of intersections, the trail, and the spawn", () => {
    for (const c of cars) {
      expect(Math.hypot(c.x, c.z)).toBeGreaterThanOrEqual(PARKING.intersectionGap);
      expect(distanceToSegment(c.x, c.z, 120, -100, 120, 100)).toBeGreaterThanOrEqual(4.3 / 2 + PARKING.trailGap);
      expect(Math.hypot(c.x - 250, c.z - 250)).toBeGreaterThanOrEqual(PARKING.spawnGap);
    }
  });

  it("never puts two parked cars in each other", () => {
    for (const a of cars) {
      for (const b of cars) {
        if (a === b) continue;
        expect(Math.hypot(a.x - b.x, a.z - b.z) > 3 || carBodyDistance(a, b.x, b.z) > 0).toBe(true);
      }
    }
  });

  it("gives the same cars on every load", () => {
    expect(parkedCars(TOWN, sample, { mainStreets: [["Main Street"]] })).toEqual(cars);
  });
});

describe("parked cars on the BeltLine level", () => {
  const env = createLevelEnv(beltline);
  const cars = parkedCars(beltline, env.sampleGround);

  it("parks a few hundred cars, under the cap", () => {
    expect(cars.length).toBeGreaterThan(200);
    expect(cars.length).toBeLessThan(PARKING.max);
  });

  it("keeps every car off the BeltLine trail, the park paths, and the main streets", () => {
    const keep = beltline.strips.filter((s) => s.kind === "trail" || s.kind === "path");
    const main = new Set(MAIN_STREETS.flat());
    for (const c of cars) {
      const strip = beltline.strips.find((s) => s.id === env.sampleGround(c.x, c.z).id);
      expect(strip.kind).toBe("street");
      expect(main.has(strip.name)).toBe(false);
      for (const s of keep) {
        for (let i = 0; i < s.points.length - 1; i += 1) {
          const [a, b] = [s.points[i], s.points[i + 1]];
          expect(distanceToSegment(c.x, c.z, a[0], a[1], b[0], b[1])).toBeGreaterThanOrEqual(s.width / 2 + PARKING.trailGap - 1e-6);
        }
      }
    }
  });
});
