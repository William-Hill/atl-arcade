import { describe, expect, it } from "vitest";
import { GREYBOX, grindables, objectsOfKind } from "./greybox.js";
import { createGroundSampler } from "./ground.js";
import { rampMesh, rampSurface } from "./ramp.js";

const ground = createGroundSampler(GREYBOX);

describe("greybox level data", () => {
  it("has every required object kind", () => {
    expect(objectsOfKind(GREYBOX, "rail")).toHaveLength(3);
    expect(objectsOfKind(GREYBOX, "ledge")).toHaveLength(2);
    expect(objectsOfKind(GREYBOX, "ramp")).toHaveLength(1);
    expect(objectsOfKind(GREYBOX, "ground").length).toBeGreaterThanOrEqual(8);
    expect(GREYBOX.objects.filter((o) => o.id.startsWith("stair-"))).toHaveLength(4);
  });

  it("gives every rail and ledge a grind spline", () => {
    const g = grindables(GREYBOX);
    expect(g.map((o) => o.id).sort()).toEqual(
      ["ledge-north", "ledge-south", "rail-curved", "rail-kinked", "rail-straight"],
    );
    for (const o of g) expect(o.spline.points || o.spline.start).toBeTruthy();
  });

  it("has unique ids", () => {
    const ids = GREYBOX.objects.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("ground sampler", () => {
  it("finds the street at y = 0", () => {
    expect(ground(0, 0)).toMatchObject({ height: 0, id: "street" });
  });

  it("steps up onto the sidewalk curb", () => {
    expect(ground(0, -8).height).toBeCloseTo(0.15);
    expect(ground(0, 8).height).toBeCloseTo(0.15);
  });

  it("puts the ledge top above the sidewalk", () => {
    expect(ground(-12, -7)).toMatchObject({ height: 0.55, id: "ledge-north" });
  });

  it("stacks the plaza and stairs down to the sidewalk", () => {
    expect(ground(-27, 10).height).toBeCloseTo(1.0);
    expect(ground(-21.8, 10).height).toBeCloseTo(0.83);
    expect(ground(-21.4, 10).height).toBeCloseTo(0.66);
    expect(ground(-21.0, 10).height).toBeCloseTo(0.49);
    expect(ground(-20.6, 10).height).toBeCloseTo(0.32);
    expect(ground(-20.2, 10).height).toBeCloseTo(0.15);
  });

  it("ignores rails", () => {
    expect(ground(-14, -2)).toMatchObject({ height: 0, id: "street" });
  });

  it("follows the quarter pipe from the lip to the wall", () => {
    expect(ground(26, 0)).toMatchObject({ height: 0, id: "quarter-pipe" });
    expect(ground(29, 0).height).toBeCloseTo(3);
    const mid = ground(27.5, 0);
    expect(mid.height).toBeCloseTo(3 - Math.sqrt(9 - 2.25));
    expect(mid.normal[0]).toBeLessThan(0);
    expect(mid.normal[1]).toBeGreaterThan(0);
    expect(ground(30.5, 0)).toMatchObject({ height: 3, id: "deck" });
  });

  it("returns null off the level", () => {
    expect(ground(100, 100)).toBeNull();
  });
});

describe("ramp mesh", () => {
  const ramp = objectsOfKind(GREYBOX, "ramp")[0];

  it("is off the ramp outside its width", () => {
    expect(rampSurface(ramp, 27, 7)).toBeNull();
  });

  it("builds a closed triangle list", () => {
    const m = rampMesh(ramp, 8);
    expect(m.positions.length % 3).toBe(0);
    expect(m.indices.length % 3).toBe(0);
    expect(m.indices.length / 3).toBe(8 * 2 + 8 * 2 + 2);
    for (const i of m.indices) expect(i).toBeLessThan(m.positions.length / 3);
  });
});

describe("level perimeter", () => {
  // The skater steps up at most 0.25 m, so every column in the outer 1 m band
  // must stand at least 0.4 m above the floor just inside it. Otherwise a
  // skater rolls off the block and falls forever.
  const STEP = 0.4;
  for (const [edge, x, inside] of [["west", -31.5, -30.5], ["east", 31.5, 30.5]]) {
    it(`closes the ${edge} edge from z -10 to 14`, () => {
      const gaps = [];
      for (let z = -9.9; z < 14; z += 0.2) {
        const wall = ground(x, z);
        const floor = ground(inside, z);
        if (!wall || !floor || wall.height < floor.height + STEP) gaps.push(Number(z.toFixed(1)));
      }
      expect(gaps).toEqual([]);
    });
  }

  it("closes the north and south edges with buildings", () => {
    for (let x = -31.9; x < 32; x += 0.5) {
      expect(ground(x, -10.5).height).toBeGreaterThan(5);
      expect(ground(x, 14.5).height).toBeGreaterThan(5);
    }
  });
});
