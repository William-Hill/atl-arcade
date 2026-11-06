import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createSkaterView, grindLean } from "./skater-view.js";

describe("place (#189)", () => {
  it("moves the group to the state position and heading, with no clip step", () => {
    const view = createSkaterView({ lean: false });
    view.place({ position: [3, 1.5, -7], yaw: 1.2 });
    expect(view.group.position.toArray()).toEqual([3, 1.5, -7]);
    expect(view.group.rotation.y).toBeCloseTo(1.2);
  });
});

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
