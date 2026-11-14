import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createCarView } from "./car-view.js";

// The timed LOD fade of the cars (#279).
describe("createCarView fade", () => {
  const parked = [{ kind: "sedan", color: 0, x: 71, y: 0, z: 0, yaw: 0 }];

  it("keeps one spare instance per car for the fade copies", () => {
    expect(createCarView(parked, [], { fade: true }).mesh.instanceCount).toBe(2);
    expect(createCarView(parked, [], { fade: false }).mesh.instanceCount).toBe(1);
  });

  it("fades at the LOD switch, with the car color on the copy, and ends the fade", () => {
    const view = createCarView(parked, [], { fade: true });
    view.update({ x: 0, z: 0 }, [], 1);
    expect(view.fade.fading).toBe(0);
    view.update({ x: 2, z: 0 }, [], 1.05);
    expect(view.fade.fading).toBe(1);
    expect(view.mesh.getVisibleAt(1)).toBe(true);
    const a = view.mesh.getColorAt(0, new THREE.Color());
    const b = view.mesh.getColorAt(1, new THREE.Color());
    expect(b.equals(a)).toBe(true);
    expect(a.equals(new THREE.Color(1, 1, 1))).toBe(false);
    view.update({ x: 2, z: 0 }, [], 1.4);
    expect(view.fade.fading).toBe(0);
    expect(view.mesh.getVisibleAt(1)).toBe(false);
    expect(view.drawCalls).toBe(1);
  });
});

