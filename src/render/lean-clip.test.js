import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { leanClip, poseClip } from "./lean-clip.js";

const q = (axis, deg) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis), THREE.MathUtils.degToRad(deg)).toArray();
const track = (name, values) => new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, [0, 1, 2], [...values, ...values, ...values]);
const UP = [0, 1, 0];
// The Mixamo hips rest: a -90 degree yaw.
const HIPS_REST = q(UP, -90);

// The angle (degrees) of the one-key additive value of a track.
function deltaDeg(clip, name) {
  const t = clip.tracks.find((k) => k.name === `${name}.quaternion`);
  return THREE.MathUtils.radToDeg(new THREE.Quaternion().fromArray(t.values).angleTo(new THREE.Quaternion()));
}

describe("leanClip", () => {
  it("uses the bone rest pose for a carve track that the coast does not have", () => {
    // The coast has no hips track: the export pruned it (the hips stay at rest).
    const coast = new THREE.AnimationClip("coast", 2, [track("spine", q(UP, 0))]);
    const carve = new THREE.AnimationClip("carve_left", 2, [track("hips", new THREE.Quaternion().fromArray(HIPS_REST).multiply(new THREE.Quaternion().fromArray(q(UP, 12))).toArray()), track("spine", q(UP, 14))]);
    const rest = (name) => (name.startsWith("hips") ? HIPS_REST : null);
    const lean = leanClip(carve, coast, rest);
    expect(lean.blendMode).toBe(THREE.AdditiveAnimationBlendMode);
    // The hips delta is the 12 degree carve turn, not the 78 degree absolute value.
    expect(deltaDeg(lean, "hips")).toBeCloseTo(12, 3);
    expect(deltaDeg(lean, "spine")).toBeCloseTo(14, 3);
  });

  it("keeps the legs out of the layer: the base clip holds the skates on the ground", () => {
    const coast = new THREE.AnimationClip("coast", 2, [track("mixamorigSpine", q(UP, 0)), track("mixamorigLeftUpLeg", q(UP, 0))]);
    const carve = new THREE.AnimationClip("carve_left", 2, [track("mixamorigSpine", q(UP, 10)), track("mixamorigLeftUpLeg", q(UP, 30)), track("mixamorigRightLeg", q(UP, 30)), track("mixamorigLeftFoot", q(UP, 30))]);
    const lean = leanClip(carve, coast, () => [0, 0, 0, 1]);
    expect(lean.tracks.map((t) => t.name)).toEqual(["mixamorigSpine.quaternion"]);
  });

  it("drops a track with no reference and no rest value", () => {
    const coast = new THREE.AnimationClip("coast", 2, [track("spine", q(UP, 0))]);
    const carve = new THREE.AnimationClip("carve_left", 2, [track("hips", q(UP, 40)), track("spine", q(UP, 10))]);
    const lean = leanClip(carve, coast, () => null);
    expect(lean.tracks.map((t) => t.name)).toEqual(["spine.quaternion"]);
  });

  it("the old reference (the coast pose alone) adds the absolute hips rotation", () => {
    // The control: this is the bug that leanClip() fixes.
    const coast = new THREE.AnimationClip("coast", 2, [track("spine", q(UP, 0))]);
    const carve = new THREE.AnimationClip("carve_left", 2, [track("hips", HIPS_REST)]);
    const old = THREE.AnimationUtils.makeClipAdditive(poseClip(carve, "x"), 0, poseClip(coast, "ref"));
    expect(deltaDeg(old, "hips")).toBeCloseTo(90, 3);
  });
});
