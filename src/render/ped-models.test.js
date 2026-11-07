import { describe, expect, it } from "vitest";
import { assignPeople, nearestWalkers, personFor, PED_MODEL_COUNT, PED_MODEL_KINDS, walkTimeScale } from "./ped-models.js";
import { meshyPropLod } from "./people-props-view.js";

describe("ped-models", () => {
  it("picks the nearest live walkers within the radius", () => {
    const peds = [
      { id: 0, live: true, x: 10, z: 0 },
      { id: 1, live: true, x: 2, z: 0 },
      { id: 2, live: false, x: 1, z: 0 },
      { id: 3, live: true, x: 0, z: 5 },
      { id: 4, live: true, x: 100, z: 0 },
    ];
    expect(nearestWalkers(peds, 0, 0, 2)).toEqual([1, 3]);
    expect(nearestWalkers(peds, 0, 0, 8)).toEqual([1, 3, 0]);
    expect(nearestWalkers(peds, 0, 0, 0)).toEqual([]);
  });
  it("gives each walker a fixed person, and uses every person", () => {
    expect(personFor(7)).toBe(personFor(7));
    const seen = new Set(Array.from({ length: 200 }, (_, i) => personFor(i)));
    expect([...seen].sort()).toEqual([...PED_MODEL_KINDS].sort());
  });
  it("never draws the same person twice at once", () => {
    for (const tier of Object.keys(PED_MODEL_COUNT)) expect(PED_MODEL_COUNT[tier]).toBeLessThanOrEqual(PED_MODEL_KINDS.length);
    const want = Array.from({ length: 12 }, (_, i) => i * 5);
    const people = assignPeople(want);
    expect(people.size).toBe(PED_MODEL_KINDS.length);
    expect(new Set(people.values()).size).toBe(people.size);
    // The nearest walkers get a person first.
    expect([...people.keys()]).toEqual(want.slice(0, PED_MODEL_KINDS.length));
  });
  it("keeps a walker's person while it stays near", () => {
    const first = assignPeople([1, 2, 3]);
    const next = assignPeople([9, 3, 1], first);
    expect(next.get(3)).toBe(first.get(3));
    expect(next.get(1)).toBe(first.get(1));
    expect(new Set(next.values()).size).toBe(3);
  });
  it("plays the walk at the walker's pace", () => {
    expect(walkTimeScale(1.45, 1, 1.45)).toBeCloseTo(1);
    expect(walkTimeScale(0, 1, 1.45)).toBe(0);
    expect(walkTimeScale(2.9, 1, 1.45)).toBeCloseTo(2);
  });
});

describe("people-props-view", () => {
  it("picks the LOD by distance", () => {
    expect(meshyPropLod(5, 20)).toBe(0);
    expect(meshyPropLod(25, 20)).toBe(1);
    expect(meshyPropLod(500, 20)).toBe(-1);
    expect(meshyPropLod(50, 60, 160)).toBe(0);
  });
});
