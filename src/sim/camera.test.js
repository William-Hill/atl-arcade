import { describe, expect, it } from "vitest";
import { CAMERA, SKATE } from "./skate/constants.js";
import { NO_LOOK, cameraGoal, cameraPivot, chooseSwing, createCameraState, createLook, mapLook, orbitAbout, stepCamera, stepLook, stepSwing } from "./camera.js";
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

// #230: the follow camera went inside a tree canopy and hid the skater.
import { canopyDistance, canopyVolumes, createCanopyIndex, fitCrown, insideVolume, treeVolume } from "./camera.js";
import { TREE_SPECIES, TREE_VARIANTS, treeKindFor, treeTemplate } from "../level/geo/trees.js";
import { CANOPY_FIT } from "./canopy-fit.js";

// A tree placement at x on the line z = 0 that gets `variant` of `species`.
function placementOf(species, variant, extra = {}) {
  for (let x = 0; x < 100; x += 0.7) {
    const p = { kind: "tree_round", species, x, y: 0, z: 0, yaw: 0, ...extra };
    if (treeKindFor(p) === `tree:${species}:${variant}`) return p;
  }
  throw new Error(`no placement for ${species}:${variant}`);
}

describe("tree canopy", () => {
  // The camera step of follow-camera.js, with the canopy as the only blocker.
  function settle(skater, volumes, frames = 90) {
    const index = createCanopyIndex(volumes);
    let cam = createCameraState(skater);
    let allowed = Infinity;
    let placed = cam;
    for (let i = 0; i < frames; i += 1) {
      cam = stepCamera(cam, skater, 1 / 60);
      const pivot = cameraPivot(skater);
      const full = Math.hypot(cam.position[0] - pivot[0], cam.position[1] - pivot[1], cam.position[2] - pivot[2]);
      allowed = resolveClip(allowed, full, index.distance(pivot, cam.position), 1 / 60);
      placed = placeCamera(cam, pivot, allowed);
    }
    return { cam, placed, pivot: cameraPivot(skater) };
  }

  it("builds a crown and a trunk volume for a tree prop, and none for a bench", () => {
    const p = { kind: "tree_round", species: "oak", x: 4, y: 1, z: -2, yaw: 0, scale: 1.2 };
    const v = treeVolume(p);
    const fit = CANOPY_FIT.oak[Number(treeKindFor(p).split(":")[2])];
    expect(v.crown.center[0]).toBe(4);
    expect(v.crown.center[1]).toBeCloseTo(1 + fit.y * 1.2, 9);
    expect(v.crown.radii).toEqual([fit.reach * 1.2, fit.h * 1.2, fit.reach * 1.2]);
    expect(v.trunk.y0).toBe(1);
    expect(treeVolume({ kind: "bench", x: 0, y: 0, z: 0 })).toBe(null);
    expect(canopyVolumes([{ kind: "bench", x: 0, y: 0, z: 0 }, { kind: "tree_tall", x: 1, y: 0, z: 1 }])).toHaveLength(1);
  });

  it("finds the near side of a crown on the segment, and nothing past the end", () => {
    const crown = { center: [-5, 3, 0], radii: [2, 1, 2] };
    const trunk = { x: -5, z: 0, r: 0.3, y0: 0, y1: 3 };
    const v = [{ crown, trunk }];
    expect(canopyDistance([0, 3, 0], [-10, 3, 0], v)).toBeCloseTo(3, 9);
    expect(canopyDistance([0, 3, 0], [-2, 3, 0], v)).toBe(Infinity);
    // Low ray: the trunk blocks it.
    expect(canopyDistance([0, 1, 0], [-10, 1, 0], v)).toBeCloseTo(4.7, 9);
    // A pivot inside the crown ignores it.
    expect(canopyDistance([-5, 3, 0], [-10, 3, 0], v)).toBe(Infinity);
  });

  it("moves the camera out of a canopy between the skater and the camera, with the skater in view", () => {
    // Skater at the origin facing +x: the camera goal is 6.5 m behind, 2.8 m up.
    const s = skaterAt([0, 0, 0], 0, 0);
    const goal = cameraGoal(s, 0).position;
    // A low crown (a magnolia) right around the camera goal.
    const tree = { kind: "tree_tall", species: "magnolia", x: goal[0] - 0.5, y: 0, z: 0, yaw: 0 };
    const volumes = canopyVolumes([tree]);
    expect(insideVolume(volumes[0], goal)).toBe(true); // the bug: the camera ends in the leaves

    const { placed, pivot } = settle(s, volumes);
    expect(insideVolume(volumes[0], placed.position)).toBe(false);
    // Pulled in toward the skater, still behind it.
    const d = Math.hypot(placed.position[0] - pivot[0], placed.position[1] - pivot[1], placed.position[2] - pivot[2]);
    expect(d).toBeLessThan(Math.hypot(goal[0] - pivot[0], goal[1] - pivot[1], goal[2] - pivot[2]));
    expect(placed.position[0]).toBeLessThan(0);
    // The skater is in view: nothing of the canopy on the line from the camera to the skater.
    expect(canopyDistance(placed.position, pivot, volumes)).toBe(Infinity);
    expect(canopyDistance(placed.position, [0, 0.2, 0], volumes)).toBe(Infinity);
  });

  it("leaves the camera alone when the canopy is off the line", () => {
    const s = skaterAt([0, 0, 0], 0, 0);
    const volumes = canopyVolumes([{ kind: "tree_round", species: "oak", x: -3, y: 0, z: 12, yaw: 0 }]);
    const { placed, cam } = settle(s, volumes);
    expect(placed.position).toEqual(cam.position);
  });

  it("eases back out after the tree, like after a wall", () => {
    const s = skaterAt([0, 0, 0], 0, 0);
    const goal = cameraGoal(s, 0).position;
    const index = createCanopyIndex(canopyVolumes([{ kind: "tree_tall", species: "magnolia", x: goal[0], y: 0, z: 0, yaw: 0 }]));
    const pivot = cameraPivot(s);
    const full = Math.hypot(goal[0] - pivot[0], goal[1] - pivot[1]);
    let allowed = resolveClip(Infinity, full, index.distance(pivot, goal), 1 / 60);
    expect(allowed).toBeLessThan(full);
    const empty = createCanopyIndex([]);
    for (let i = 0; i < 180; i += 1) allowed = resolveClip(allowed, full, empty.distance(pivot, goal), 1 / 60);
    expect(allowed).toBeCloseTo(full, 1);
  });

  it("indexes volumes by cell and answers inside() like the plain test", () => {
    const props = [];
    for (let i = 0; i < 50; i += 1) props.push({ kind: "tree_round", species: "oak", x: i * 9, y: 0, z: (i % 5) * 11, yaw: 0 });
    const volumes = canopyVolumes(props);
    const index = createCanopyIndex(volumes);
    for (const q of [[9, 7, 11], [4.5, 7, 5], [100, 2, 30], [270, 6, 0]]) {
      expect(index.inside(q)).toBe(volumes.some((v) => insideVolume(v, q)));
    }
    expect(index.distance([1, 1, 3], [60, 3, 3])).toBe(canopyDistance([1, 1, 3], [60, 3, 3], volumes));
  });

  // Review of #234: the volume ignored the variant `grow` scale and the
  // crown offset, so a large crown reached past it.
  it("holds every crown vertex of each procedural tree variant, at any scale and yaw", () => {
    for (const species of Object.keys(TREE_SPECIES)) {
      for (let variant = 0; variant < TREE_VARIANTS; variant += 1) {
        for (const scale of [1, 1.3]) {
          const p = placementOf(species, variant, { scale, y: 0.5 });
          const v = treeVolume(p);
          for (const cards of [false, true]) {
            const P = treeTemplate(species, variant, 0, "summer", { cards }).positions;
            const yaw = 1.1;
            for (let i = 0; i < P.length; i += 3) {
              if (P[i + 1] < TREE_SPECIES[species].clear) continue; // the trunk under the crown
              const x = P[i] * Math.cos(yaw) + P[i + 2] * Math.sin(yaw);
              const z = -P[i] * Math.sin(yaw) + P[i + 2] * Math.cos(yaw);
              const q = [p.x + x * scale, p.y + P[i + 1] * scale, p.z + z * scale];
              if (!insideVolume(v, q)) throw new Error(`${species}:${variant} ${cards ? "cards" : "puffs"} vertex ${i / 3} is outside the volume`);
            }
          }
        }
      }
    }
  });

  it("has a fit for each species and variant", () => {
    for (const species of Object.keys(TREE_SPECIES)) {
      expect(CANOPY_FIT[species]).toHaveLength(TREE_VARIANTS);
      for (const f of CANOPY_FIT[species]) expect(f.reach).toBeGreaterThan(0);
    }
  });

  it("fits the smallest round ellipsoid over the crown bottom", () => {
    // Points on a sphere of radius 2 at height 5, and a trunk under it.
    const pts = [];
    for (let i = 0; i < 400; i += 1) {
      const a = i * 2.39996;
      const y = 1 - (2 * (i + 0.5)) / 400;
      const r = Math.sqrt(1 - y * y);
      pts.push(Math.cos(a) * r * 2, 5 + y * 2, Math.sin(a) * r * 2);
    }
    const trunk = [0.3, 0, 0, 0.3, 2.9, 0];
    const f = fitCrown([pts, trunk], 3, { pad: 0 });
    expect(f.y).toBeCloseTo(5, 0);
    expect(f.h).toBeLessThan(2.6);
    expect(f.reach).toBeLessThan(2.6);
    for (let i = 0; i < pts.length; i += 3) {
      const t = (pts[i + 1] - f.y) / f.h;
      expect(Math.hypot(pts[i], pts[i + 2]) / f.reach).toBeLessThanOrEqual(Math.sqrt(1 - t * t) + 1e-9);
    }
    expect(fitCrown([trunk], 3)).toBe(null);
  });

  // Review of #234: distance() and near() made a Set, arrays and string
  // keys each frame.
  it("answers the same as the plain test with reused lists, across many queries", () => {
    const props = [];
    for (let i = 0; i < 80; i += 1) props.push({ kind: "tree_round", species: i % 2 ? "oak" : "magnolia", x: (i % 10) * 9 - 40, y: 0, z: Math.floor(i / 10) * 9 - 30, yaw: 0 });
    const volumes = canopyVolumes(props);
    const index = createCanopyIndex(volumes, 8);
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 100 - 50;
    for (let n = 0; n < 300; n += 1) {
      const a = [rand(), 3, rand()];
      const b = [rand(), 6, rand()];
      expect(index.distance(a, b)).toBe(canopyDistance(a, b, volumes));
      expect(index.inside(a)).toBe(volumes.some((v) => insideVolume(v, a)));
    }
    // near() lists each volume once, and its list is the caller's own.
    const box = index.near(-50, -50, 50, 50);
    expect(new Set(box).size).toBe(box.length);
    expect(box).toHaveLength(volumes.length);
    index.near(0, 0, 0, 0);
    expect(box).toHaveLength(volumes.length);
  });
});

// Playtest 2026-11-09: a wall or the edge fence close to the skater pulled the
// camera in to 0.77 m. The camera now swings around her to a clear side.
describe("swing around a close blocker", () => {
  // A wall along x = 0.4 m east of the skater (the edge fence), and a probe
  // that gives the distance from the pivot to the wall on the ray toward the
  // camera goal for an orbit offset.
  const skater = skaterAt([0, 0, 0], Math.PI / 2 + 0.6, 6); // north, away from the wall at 0.6 rad
  const pivot = cameraPivot(skater);
  const goalAt = (offset) => cameraGoal(skater, skater.yaw, CAMERA, { yaw: offset, pitch: 0 }).position;
  const wallX = 0.4;
  const hit = (offset) => {
    const g = goalAt(offset);
    const dx = g[0] - pivot[0];
    const len = Math.hypot(dx, g[1] - pivot[1], g[2] - pivot[2]);
    if (g[0] <= wallX) return Infinity;
    return (len * (wallX - pivot[0])) / dx;
  };
  const range = Math.hypot(...goalAt(0).map((v, i) => v - pivot[i]));

  it("keeps the camera behind the skater when nothing blocks it", () => {
    expect(chooseSwing(() => Infinity, range, 0)).toBe(0);
  });

  it("swings to the nearest clear side when a blocker is close", () => {
    expect(hit(0)).toBeLessThan(1.2);
    const target = chooseSwing(hit, range, 0);
    expect(target).not.toBe(0);
    expect(hit(target)).toBeGreaterThanOrEqual(CAMERA.swingBelow * range);
    // The smallest clear swing: one step less is still blocked.
    const back = target - Math.sign(target) * CAMERA.swingStep;
    if (Math.abs(back) > 1e-9) expect(hit(back)).toBeLessThan(CAMERA.swingBelow * range);
  });

  it("goes back behind the skater when the blocker clears", () => {
    expect(chooseSwing(() => Infinity, range, 0.9)).toBe(0);
  });

  it("keeps the side it already swung to", () => {
    const both = () => Infinity;
    const blocked0 = (o) => (Math.abs(o) < 1e-9 ? 0.5 : both(o));
    expect(chooseSwing(blocked0, range, -0.3)).toBeLessThan(0);
    expect(chooseSwing(blocked0, range, 0.3)).toBeGreaterThan(0);
  });

  it("goes to the clearest offset when no offset is clear, and holds when nothing is better", () => {
    const probe = (o) => 1 + Math.max(0, -o);
    expect(chooseSwing(probe, range, 0)).toBeCloseTo(-CAMERA.swingMax, 6);
    expect(chooseSwing(() => 1, range, 0.3)).toBe(0.3);
  });

  it("swings at most swingRate per second", () => {
    expect(stepSwing(0, 1, 0.1)).toBeCloseTo(CAMERA.swingRate * 0.1, 9);
    expect(stepSwing(0.95, 1, 0.1)).toBe(1);
    expect(stepSwing(0, -1, 0.1)).toBeCloseTo(-CAMERA.swingRate * 0.1, 9);
  });

  it("orbitAbout turns a camera point like the look offset does", () => {
    const a = goalAt(0);
    const b = orbitAbout(a, skater.position, 0.7);
    const want = goalAt(0.7);
    for (let i = 0; i < 3; i += 1) expect(b[i]).toBeCloseTo(want[i], 9);
  });

  it("a frame loop gets the camera clear of the wall within 0.3 s", () => {
    let offset = 0;
    const dt = 1 / 60;
    for (let i = 0; i < 18; i += 1) offset = stepSwing(offset, chooseSwing(hit, range, offset), dt);
    expect(hit(offset)).toBeGreaterThanOrEqual(CAMERA.swingBelow * range);
  });
});
