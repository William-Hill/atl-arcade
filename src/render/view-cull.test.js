import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createViewCull } from "./view-cull.js";

function camera() {
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
  cam.position.set(0, 2, 0);
  cam.lookAt(0, 2, -10); // looks to -z
  return cam;
}

describe("view cull", () => {
  it("sees everything before the first update", () => {
    expect(createViewCull().sees(0, 0, 100, 1)).toBe(true);
  });

  it("sees a point in front and not one behind or far to the side", () => {
    const cull = createViewCull({ margin: 0 });
    cull.update(camera());
    expect(cull.sees(0, 1, -20, 1)).toBe(true);
    expect(cull.sees(0, 1, 20, 1)).toBe(false);
    expect(cull.sees(80, 1, -10, 1)).toBe(false);
    expect(cull.sees(0, 1, -600, 1)).toBe(false);
  });

  it("keeps the margin past the screen edge", () => {
    const cam = camera();
    // Just behind the near plane: out of view with no margin.
    const tight = createViewCull({ margin: 0 });
    const loose = createViewCull({ margin: 2.5 });
    tight.update(cam);
    loose.update(cam);
    expect(tight.sees(0, 2, 1.5, 0.5)).toBe(false);
    expect(loose.sees(0, 2, 1.5, 0.5)).toBe(true);
  });

  it("follows the camera when it turns", () => {
    const cam = camera();
    const cull = createViewCull({ margin: 0 });
    cull.update(cam);
    expect(cull.sees(0, 1, 20, 1)).toBe(false);
    cam.lookAt(0, 2, 10);
    cull.update(cam);
    expect(cull.sees(0, 1, 20, 1)).toBe(true);
  });
});
