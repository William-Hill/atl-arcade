import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { grindLean } from "./skater-view.js";

// Axes: yaw 0 faces +x and positive yaw turns left (toward -z), so +z is the
// skater's right. A positive balance makes the skater fall off the right.
function upAfterLean(balance) {
  const g = new THREE.Object3D();
  g.rotation.set(grindLean({ state: "grind", grind: { balance } }), 0, 0, "YXZ");
  return new THREE.Vector3(0, 1, 0).applyEuler(g.rotation);
}

describe("grind lean", () => {
  it("tilts the capsule toward the side it will fall off", () => {
    expect(upAfterLean(0.5).z).toBeGreaterThan(0.1); // right
    expect(upAfterLean(-0.5).z).toBeLessThan(-0.1); // left
  });

  it("is zero off the rail", () => {
    expect(grindLean({ state: "rolling", grind: null })).toBe(0);
  });
});
