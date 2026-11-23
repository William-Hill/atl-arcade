import { describe, expect, it } from "vitest";
import { nearestWalkers, personFor, poseClip, PED_MODEL_KINDS, walkTimeScale } from "./ped-models.js";
import { readFileSync } from "node:fs";
import { POSE } from "../sim/ped-activity.js";
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

  it("plays the clip of each pose (#133), and every person GLB has it", () => {
    expect(poseClip(POSE.walk)).toBe(null);
    expect(poseClip(POSE.sit)).toEqual({ name: "sit", pace: false });
    expect(poseClip(POSE.cheer)).toEqual({ name: "cheer", pace: false });
    expect(poseClip(POSE.talk)).toEqual({ name: "idle", pace: false });
    expect(poseClip(POSE.jog)).toEqual({ name: "run", pace: true });
    const manifest = JSON.parse(readFileSync(new URL("../../assets/people/manifest.json", import.meta.url), "utf8"));
    for (const kind of PED_MODEL_KINDS) {
      for (const pose of [POSE.sit, POSE.cheer, POSE.talk, POSE.jog]) expect(Object.keys(manifest.assets[kind].clips), `${kind} ${pose}`).toContain(poseClip(pose).name);
    }
  });
});
