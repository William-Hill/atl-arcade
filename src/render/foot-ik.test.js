import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { FOOT_IK, distance, footTilt, ikWanted, legBoneNames, planFeet, solveTwoBone, stepIkWeight } from "./foot-ik.js";
import { createGroundSampler } from "../level/ground.js";
import { GREYBOX } from "../level/greybox.js";

// The joint names of a skater GLB.
function glbNodeNames(name) {
  const buf = readFileSync(new URL(`../../assets/skaters/${name}/skater.glb`, import.meta.url));
  const json = JSON.parse(buf.toString("utf8", 20, 20 + buf.readUInt32LE(12)));
  return json.nodes.map((n) => n.name);
}

// GLTFLoader takes the reserved characters out of the node names.
const sanitize = (n) => n.replace(/\s/g, "_").replace(/[[\].:/]/g, "");

describe("leg bones by name", () => {
  it("finds the hips and both leg chains of Nia and Marcus", () => {
    for (const skater of ["nia", "marcus"]) {
      for (const names of [glbNodeNames(skater), glbNodeNames(skater).map(sanitize)]) {
        const legs = legBoneNames(names);
        expect(legs, skater).not.toBeNull();
        expect(legs.hips).toMatch(/Hips$/);
        expect(legs.left.upLeg).toMatch(/LeftUpLeg$/);
        expect(legs.left.leg).toMatch(/LeftLeg$/);
        expect(legs.left.foot).toMatch(/LeftFoot$/);
        expect(legs.left.toe).toMatch(/LeftToeBase$/);
        expect(legs.right.upLeg).toMatch(/RightUpLeg$/);
        expect(legs.right.foot).toMatch(/RightFoot$/);
      }
    }
  });

  it("finds Blender names, and gives null for a rig with no legs", () => {
    const legs = legBoneNames(["pelvis", "thigh.L", "shin.L", "foot.L", "thigh.R", "shin.R", "foot.R"]);
    expect(legs).toEqual({
      hips: "pelvis",
      left: { upLeg: "thigh.L", leg: "shin.L", foot: "foot.L", toe: null },
      right: { upLeg: "thigh.R", leg: "shin.R", foot: "foot.R", toe: null },
    });
    expect(legBoneNames(["Hips", "Spine", "Head"])).toBeNull();
  });
});

describe("two-bone IK", () => {
  const hip = [0, 1, 0];
  const knee = [0, 0.55, 0.05];
  const ankle = [0, 0.1, 0];

  it("puts the ankle on a target in reach and keeps the bone lengths", () => {
    const target = [0.05, 0.3, 0.02];
    const r = solveTwoBone(hip, knee, ankle, target);
    expect(distance(r.ankle, target)).toBeLessThan(1e-9);
    expect(distance(hip, r.knee)).toBeCloseTo(distance(hip, knee), 9);
    expect(distance(r.knee, r.ankle)).toBeCloseTo(distance(knee, ankle), 9);
  });

  it("keeps the knee on the side of the pole", () => {
    const r = solveTwoBone(hip, knee, ankle, [0, 0.4, 0]);
    expect(r.knee[2]).toBeGreaterThan(0.1); // The knee bends forward (+z).
    const back = solveTwoBone(hip, knee, ankle, [0, 0.4, 0], [0, 0.55, -1]);
    expect(back.knee[2]).toBeLessThan(-0.1);
  });

  it("gives a straight leg toward a target out of reach", () => {
    const r = solveTwoBone(hip, knee, ankle, [0, -2, 0]);
    const reach = distance(hip, knee) + distance(knee, ankle);
    expect(distance(hip, r.ankle)).toBeCloseTo(reach, 3);
    expect(r.ankle[0]).toBeCloseTo(0, 6);
  });

  it("returns the clip pose for a target at the ankle", () => {
    const r = solveTwoBone(hip, knee, ankle, ankle);
    expect(distance(r.knee, knee)).toBeLessThan(1e-9);
    expect(distance(r.ankle, ankle)).toBeLessThan(1e-9);
  });
});

describe("the foot plan", () => {
  const sample = createGroundSampler(GREYBOX);
  const feet = (lx, rx, z, y) => ({ left: { ankle: [lx, y, z], toe: [lx, y - 0.07, z + 0.12] }, right: { ankle: [rx, y, z], toe: [rx, y - 0.07, z + 0.12] } });

  it("does nothing on flat ground", () => {
    const p = planFeet({ rootY: 0, feet: feet(-12.1, -11.9, 3, 0.2), sample });
    expect(p.pelvis).toBe(0);
    expect(p.left.target).toEqual([-12.1, 0.2, 3]);
    expect(p.right.target).toEqual([-11.9, 0.2, 3]);
  });

  it("drops the pelvis and the lower foot one step down on the greybox stairs", () => {
    // Step 1 is 0.83 m (x -22 to -21.6), step 2 is 0.66 m (x -21.6 to -21.2).
    const p = planFeet({ rootY: 0.83, feet: feet(-21.5, -21.76, 9, 1.02), sample });
    expect(p.left.offset).toBeCloseTo(-0.17, 6);
    expect(p.right.offset).toBe(0);
    expect(p.pelvis).toBeCloseTo(-0.17, 6);
    expect(p.left.target[1]).toBeCloseTo(0.85, 6);
    expect(p.right.target[1]).toBeCloseTo(1.02, 6);
  });

  it("puts a skate across a stair edge on the step nose (the higher sample)", () => {
    // The ankle is over step 2, the toe over step 1.
    const f = { left: { ankle: [-21.55, 1.02, 9], toe: [-21.65, 0.95, 9] }, right: { ankle: [-21.8, 1.02, 9], toe: [-21.8, 0.95, 9] } };
    expect(planFeet({ rootY: 0.83, feet: f, sample }).left.offset).toBe(0);
  });

  it("raises the uphill skate on the quarter pipe and tilts it to the slope", () => {
    // 1.2 m up a 3 m quarter pipe: about 24 degrees.
    const rootY = sample(27.2, 0).height;
    const p = planFeet({ rootY, feet: feet(27.33, 27.07, 0, rootY + 0.2), sample });
    expect(p.left.offset).toBeGreaterThan(0.04);
    expect(p.right.offset).toBeLessThan(-0.04);
    expect(p.pelvis).toBe(p.right.offset);
    expect(p.left.tilt.angle).toBeGreaterThan(0.35);
    // A tilted skate holds its ankle h / cos(t) over the ground.
    const g = sample(27.33, 0).height;
    expect(p.left.target[1] - g).toBeCloseTo(0.2 / Math.cos(p.left.tilt.angle), 2);
  });

  it("limits the drop and the rise, and scales by the weight", () => {
    const f = feet(-21.5, -21.76, 9, 1.02);
    expect(planFeet({ rootY: 2, feet: f, sample }).pelvis).toBe(-FOOT_IK.maxDrop);
    expect(planFeet({ rootY: -1, feet: f, sample }).left.offset).toBe(FOOT_IK.maxRise);
    expect(planFeet({ rootY: 0.83, feet: f, sample, weight: 0.5 }).pelvis).toBeCloseTo(-0.085, 6);
    expect(planFeet({ rootY: 0.83, feet: f, sample, weight: 0 }).pelvis).toBe(-0);
  });

  it("keeps the clip pose where there is no ground", () => {
    const p = planFeet({ rootY: 0, feet: feet(500, 501, 500, 0.2), sample });
    expect(p.pelvis).toBe(0);
    expect(p.left.offset).toBe(0);
    expect(p.left.normal).toEqual([0, 1, 0]);
  });
});

describe("foot tilt and the IK weight", () => {
  it("tilts toward the normal up to the limit", () => {
    expect(footTilt([0, 1, 0]).angle).toBe(0);
    const t = footTilt([-Math.sin(0.3), Math.cos(0.3), 0]);
    expect(t.angle).toBeCloseTo(0.3, 9);
    // The axis is up x n: a slope that rises to +x (normal to -x) turns about +z.
    expect(t.axis[2]).toBeCloseTo(1, 9);
    expect(footTilt([-1, 0.2, 0]).angle).toBe(FOOT_IK.maxTilt);
    expect(footTilt([-Math.sin(0.3), Math.cos(0.3), 0], 0.5).angle).toBeCloseTo(0.15, 9);
  });

  it("is on for the ground clips and off in the air, on a rail, and in a bail", () => {
    expect(ikWanted({ state: "rolling" }, "coast")).toBe(true);
    expect(ikWanted({ state: "rolling" }, "land")).toBe(true);
    expect(ikWanted({ state: "rolling" }, "bail")).toBe(false);
    expect(ikWanted({ state: "air" }, "air_mute")).toBe(false);
    expect(ikWanted({ state: "grind" }, "grind_soul")).toBe(false);
  });

  it("fades in slowly and out fast", () => {
    let w = 0;
    for (let i = 0; i < 6; i += 1) w = stepIkWeight(w, true, 1 / 60);
    expect(w).toBeCloseTo(6 / 60 / FOOT_IK.fadeIn, 9);
    for (let i = 0; i < 30; i += 1) w = stepIkWeight(w, true, 1 / 60);
    expect(w).toBe(1);
    for (let i = 0; i < 4; i += 1) w = stepIkWeight(w, false, 1 / 60);
    expect(w).toBe(0);
  });
});
