import { describe, expect, it } from "vitest";
import { CAMERA, SKATE } from "./skate/constants.js";
import { NO_LOOK, cameraGoal, createCameraState, createLook, mapLook, stepCamera, stepLook } from "./camera.js";
import { createSkateState } from "./skate/controller.js";

function skaterAt(position, yaw, speed) {
  const s = createSkateState({ position, yaw });
  s.speed = speed;
  // The controller always derives velocity from heading and speed on flat ground.
  s.velocity = [Math.cos(yaw) * speed, 0, -Math.sin(yaw) * speed];
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


// Quarter-pipe regressions. On the transition the ground normal tilts toward
// the street; past vertNormalY the camera holds its yaw so it stays on the
// street side, and the wall ray starts from a pivot off the surface.
import { cameraPivot, isVert, resolveClip, placeCamera } from "./camera.js";

function onWall(yaw, speed, normal = [-0.99, 0.12, 0], state = "rolling") {
  const s = skaterAt([28.9, 2.4, 0], yaw, speed);
  s.groundNormal = normal;
  s.state = state;
  // Climbing: the velocity is mostly vertical.
  s.velocity = yaw === 0 ? [0.12 * speed, 0.99 * speed, 0] : [-0.12 * speed, -0.99 * speed, 0];
  return s;
}

describe("vert hold", () => {
  it("flags a steep transition and the air above it, not flat ground", () => {
    expect(isVert(onWall(0, 6))).toBe(true);
    expect(isVert(onWall(0, 6, [-0.99, 0.12, 0], "air"))).toBe(true);
    expect(isVert(skaterAt([0, 0, 0], 0, 6))).toBe(false);
  });

  it("holds the camera yaw when the skater flips on the wall", () => {
    let cam = createCameraState(skaterAt([20, 0, 0], 0, 8));
    const flipped = onWall(Math.PI, 5);
    for (let i = 0; i < 60; i += 1) cam = stepCamera(cam, flipped, 1 / 60);
    expect(cam.yaw).toBeCloseTo(0, 6);
    // The camera stays on the street side, west of the skater.
    expect(cam.position[0]).toBeLessThan(flipped.position[0] - 4);
  });

  it("chases the skater yaw again on flat ground", () => {
    let cam = createCameraState(skaterAt([20, 0, 0], 0, 8));
    const flat = skaterAt([24, 0, 0], Math.PI, 8);
    for (let i = 0; i < 120; i += 1) cam = stepCamera(cam, flat, 1 / 60);
    expect(Math.abs(cam.yaw)).toBeGreaterThan(3);
  });
});

describe("look-ahead", () => {
  it("does not lead into the wall while the skater climbs it", () => {
    const g = cameraGoal(onWall(0, 10), 0);
    expect(g.lookAt[0] - 28.9).toBeLessThan(0.5);
  });

  it("does not lead backward when the skater moves toward the camera", () => {
    const s = skaterAt([10, 0, 0], Math.PI, 10);
    s.velocity = [-10, 0, 0];
    const g = cameraGoal(s, 0);
    expect(g.lookAt[0]).toBeCloseTo(10, 6);
  });

  it("still leads on flat ground at full speed", () => {
    const s = skaterAt([0, 0, 0], 0, SKATE.maxSpeed);
    s.velocity = [SKATE.maxSpeed, 0, 0];
    expect(cameraGoal(s, 0).lookAt[0]).toBeCloseTo(CAMERA.lookAhead);
  });
});

describe("clip pivot and release", () => {
  it("puts the pivot off the surface along the ground normal", () => {
    const p = cameraPivot(onWall(0, 6));
    expect(p[0]).toBeCloseTo(28.9 - 0.99 * CAMERA.lookHeight);
    expect(p[1]).toBeCloseTo(2.4 + 0.12 * CAMERA.lookHeight);
  });

  it("snaps in to a blocker at once", () => {
    expect(resolveClip(Infinity, 9, 3, 1 / 60)).toBeCloseTo(3 - CAMERA.clipMargin);
    expect(resolveClip(8, 9, 1.3, 1 / 60)).toBeCloseTo(CAMERA.minDistance);
  });

  it("never places the camera past a wall closer than minDistance", () => {
    // Skater against the north building, turned south: the wall is 0.31 m from the pivot.
    const allowed = resolveClip(Infinity, 9, 0.31, 1 / 60);
    expect(allowed).toBeLessThan(0.31);
    expect(allowed).toBeGreaterThanOrEqual(0);
    expect(resolveClip(5, 9, 0, 1 / 60)).toBe(0);
  });

  it("eases back out when the blocker clears instead of popping", () => {
    let allowed = 2;
    allowed = resolveClip(allowed, 9, Infinity, 1 / 60);
    expect(allowed).toBeGreaterThan(2);
    expect(allowed).toBeLessThan(2.5);
    for (let i = 0; i < 180; i += 1) allowed = resolveClip(allowed, 9, Infinity, 1 / 60);
    expect(allowed).toBeCloseTo(9, 1);
  });

  it("places the camera along the pivot ray, never past the smoothed length", () => {
    const cam = { yaw: 0, position: [-6, 3, 0], lookAt: [1, 1, 0] };
    const placed = placeCamera(cam, [0, 1, 0], 2);
    expect(Math.hypot(placed.position[0], placed.position[1] - 1, placed.position[2])).toBeCloseTo(2);
    expect(placed.lookAt).toEqual(cam.lookAt);
    expect(placeCamera(cam, [0, 1, 0], 100).position).toEqual(cam.position);
  });
});

describe("swing speed", () => {
  it("caps the yaw rate so a 180 degree turnaround does not whip", () => {
    let cam = createCameraState(skaterAt([20, 0, 0], 0, 8));
    const back = skaterAt([20, 0, 0], Math.PI - 0.01, 8);
    const next = stepCamera(cam, back, 1 / 60);
    expect(Math.abs(next.yaw - cam.yaw)).toBeLessThanOrEqual(CAMERA.maxYawRate / 60 + 1e-9);
    for (let i = 0; i < 120; i += 1) cam = stepCamera(cam, back, 1 / 60);
    expect(Math.abs(cam.yaw)).toBeGreaterThan(3); // still arrives within 2 s
  });
});

describe("player look", () => {
  const k = CAMERA;
  const near = (a, b, eps = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) < eps);

  it("gives the same goal with a zero look as with no look", () => {
    const s = skaterAt([3, 0, -2], 0.7, 5);
    expect(near(cameraGoal(s, 0.7, k, NO_LOOK).position, cameraGoal(s, 0.7).position)).toBe(true);
  });

  it("turns the camera about the skater at the same range", () => {
    const s = skaterAt([0, 0, 0], 0, 0);
    const rest = cameraGoal(s, 0).position;
    const side = cameraGoal(s, 0, k, { yaw: Math.PI / 2, pitch: 0 }).position;
    expect(Math.hypot(...side)).toBeCloseTo(Math.hypot(...rest), 9);
    expect(side[1]).toBeCloseTo(k.height, 9);
    // The skater faces +x. A quarter look to the left puts the camera on the +z side.
    expect(side[2]).toBeCloseTo(k.distance, 9);
    expect(side[0]).toBeCloseTo(0, 9);
  });

  it("leads the look-at point along the orbit heading when the player looks to the side", () => {
    const s = { ...skaterAt([0, 0, 0], 0, SKATE.maxSpeed), velocity: [SKATE.maxSpeed, 0, 0] };
    const side = cameraGoal(s, 0, k, { yaw: Math.PI / 2, pitch: 0 }).lookAt;
    // Yaw 0 faces +x; a quarter look to the left orbits to -z.
    expect(side[0]).toBeCloseTo(0, 6);
    expect(side[2]).toBeLessThan(0);
  });

  it("keeps the camera at or above the skater at the lowest pitch", () => {
    const s = skaterAt([0, 0, 0], 0, 0);
    const low = cameraGoal(s, 0, k, { yaw: 0, pitch: -Math.PI / 2 }).position;
    expect(low[1]).toBeGreaterThanOrEqual(0);
  });

  it("raises the camera with a positive pitch", () => {
    const s = skaterAt([0, 0, 0], 0, 0);
    const up = cameraGoal(s, 0, k, { yaw: 0, pitch: 0.4 }).position;
    expect(up[1]).toBeGreaterThan(k.height);
    expect(Math.hypot(...up)).toBeCloseTo(Math.hypot(k.distance, k.height), 9);
  });

  it("maps a drag right and a stick right to a look right (negative yaw)", () => {
    expect(mapLook({ dx: 100 }, 1 / 60).yaw).toBeCloseTo(-100 * k.mouseLookRate, 9);
    expect(mapLook({ stick: [1, 0] }, 0.5).yaw).toBeCloseTo(-k.stickLookRate * 0.5, 9);
    expect(mapLook({ dy: 50 }, 1 / 60).pitch).toBeCloseTo(50 * k.mouseLookRate, 9);
  });

  it("ignores the right stick inside the deadzone", () => {
    expect(mapLook({ stick: [0.1, -0.1] }, 1)).toEqual({ yaw: 0, pitch: 0 });
  });

  it("clamps the pitch", () => {
    let look = createLook();
    look = stepLook(look, { yaw: 0, pitch: 5 }, 1 / 60);
    expect(look.pitch).toBe(k.maxPitch);
    look = stepLook(look, { yaw: 0, pitch: -9 }, 1 / 60);
    expect(look.pitch).toBe(k.minPitch);
  });

  it("holds the look for lookHold, then goes back behind the skater", () => {
    let look = stepLook(createLook(), { yaw: 1.2, pitch: 0.3 }, 1 / 60);
    const dt = 1 / 60;
    for (let t = 0; t < k.lookHold - 0.05; t += dt) look = stepLook(look, NO_LOOK, dt);
    expect(look.yaw).toBe(1.2);
    for (let t = 0; t < 4; t += dt) look = stepLook(look, NO_LOOK, dt);
    expect(look.yaw).toBe(0);
    expect(look.pitch).toBe(0);
  });

  it("moves the smoothed camera to the look side", () => {
    const s = skaterAt([0, 0, 0], 0, 0);
    let cam = createCameraState(s);
    for (let i = 0; i < 120; i += 1) cam = stepCamera(cam, s, 1 / 60, k, { yaw: Math.PI / 2, pitch: 0 });
    expect(cam.position[2]).toBeCloseTo(k.distance, 2);
  });
});
