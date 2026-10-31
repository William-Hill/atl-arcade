import { describe, expect, it } from "vitest";
import { CAMERA, SKATE } from "./skate/constants.js";
import { cameraGoal, clipCamera, createCameraState, stepCamera } from "./camera.js";
import { createSkateState } from "./skate/controller.js";

function skaterAt(position, yaw, speed) {
  const s = createSkateState({ position, yaw });
  s.speed = speed;
  return s;
}

describe("cameraGoal", () => {
  it("sits behind and above a skater facing +x and looks ahead of it", () => {
    const s = skaterAt([10, 0, 5], 0, SKATE.maxSpeed);
    const g = cameraGoal(s, s.yaw);
    expect(g.position[0]).toBeLessThan(10 - CAMERA.distance + 1e-9);
    expect(g.position[1]).toBeCloseTo(CAMERA.height);
    expect(g.position[2]).toBeCloseTo(5);
    expect(g.lookAt[0]).toBeCloseTo(10 + CAMERA.lookAhead);
    expect(g.lookAt[1]).toBeCloseTo(CAMERA.lookHeight);
  });

  it("follows the heading for a skater facing -z (left turn of 90 degrees)", () => {
    const s = skaterAt([0, 0, 0], Math.PI / 2, 0);
    const g = cameraGoal(s, s.yaw);
    expect(g.position[2]).toBeCloseTo(CAMERA.distance);
    expect(Math.abs(g.position[0])).toBeLessThan(1e-9);
  });

  it("pulls back with speed up to the cap and does not look ahead at rest", () => {
    const rest = cameraGoal(skaterAt([0, 0, 0], 0, 0), 0);
    const fast = cameraGoal(skaterAt([0, 0, 0], 0, 8), 0);
    const faster = cameraGoal(skaterAt([0, 0, 0], 0, 100), 0);
    expect(rest.distance).toBeCloseTo(CAMERA.distance);
    expect(rest.lookAt[0]).toBeCloseTo(0);
    expect(fast.distance).toBeCloseTo(CAMERA.distance + Math.min(8 * CAMERA.speedPullback, CAMERA.maxPullback));
    expect(faster.distance).toBeCloseTo(CAMERA.distance + CAMERA.maxPullback);
  });
});

describe("stepCamera", () => {
  it("starts on the goal and stays there for a steady skater", () => {
    const s = skaterAt([3, 0, -2], 0.4, 5);
    const cam = createCameraState(s);
    const next = stepCamera(cam, s, 1 / 60);
    const goal = cameraGoal(s, s.yaw);
    for (let i = 0; i < 3; i += 1) {
      expect(next.position[i]).toBeCloseTo(goal.position[i], 6);
      expect(next.lookAt[i]).toBeCloseTo(goal.lookAt[i], 6);
    }
  });

  it("smooths a sudden 90 degree turn and converges within 2 seconds", () => {
    let s = skaterAt([0, 0, 0], 0, 6);
    let cam = createCameraState(s);
    s = skaterAt([0, 0, 0], Math.PI / 2, 6);
    cam = stepCamera(cam, s, 1 / 60);
    expect(cam.yaw).toBeGreaterThan(0);
    expect(cam.yaw).toBeLessThan(Math.PI / 2);
    for (let i = 0; i < 120; i += 1) cam = stepCamera(cam, s, 1 / 60);
    expect(cam.yaw).toBeCloseTo(Math.PI / 2, 2);
    const goal = cameraGoal(s, s.yaw);
    expect(cam.position[2]).toBeCloseTo(goal.position[2], 1);
  });

  it("turns the short way across the yaw wrap", () => {
    let s = skaterAt([0, 0, 0], Math.PI - 0.1, 6);
    let cam = createCameraState(s);
    s = skaterAt([0, 0, 0], -Math.PI + 0.1, 6);
    cam = stepCamera(cam, s, 1 / 60);
    // The shortest path crosses pi, so the yaw grows past pi - 0.1 or wraps negative.
    expect(cam.yaw > Math.PI - 0.1 || cam.yaw < -Math.PI + 0.1).toBe(true);
  });
});

describe("clipCamera", () => {
  const cam = { yaw: 0, position: [-6, 3, 0], lookAt: [0, 1, 0] };

  it("leaves the camera alone when the blocker is behind it", () => {
    expect(clipCamera(cam, 100)).toBe(cam);
    expect(clipCamera(cam, Infinity)).toBe(cam);
  });

  it("pulls the camera in front of a blocker with a margin", () => {
    const c = clipCamera(cam, 3);
    const d = Math.hypot(c.position[0] - cam.lookAt[0], c.position[1] - cam.lookAt[1], c.position[2] - cam.lookAt[2]);
    expect(d).toBeCloseTo(3 - CAMERA.clipMargin);
    expect(c.position[1]).toBeGreaterThan(1);
  });

  it("never comes closer than minDistance", () => {
    const c = clipCamera(cam, 0.2);
    const d = Math.hypot(c.position[0] - cam.lookAt[0], c.position[1] - cam.lookAt[1], c.position[2] - cam.lookAt[2]);
    expect(d).toBeCloseTo(CAMERA.minDistance);
  });
});
