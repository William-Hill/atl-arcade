import { beforeEach, expect, test, vi } from "vitest";
import * as THREE from "three";
import { createFollowCamera } from "./follow-camera.js";
import { cameraPivot, createCameraState } from "../sim/camera.js";

const offsets = vi.hoisted(() => ({ right: 0, up: 0, roll: 0, fov: 0, flash: 0 }));
vi.mock("../sim/camera-fx.js", () => ({
  CAMERA_FX: {},
  createCameraFx: () => ({}),
  stepCameraFx: (fx) => fx,
  cameraFxOffsets: () => offsets,
}));

beforeEach(() => Object.assign(offsets, { right: 0, up: 0, roll: 0, fov: 0 }));

function setup(hits = []) {
  const skater = { position: [0, 0, 0], yaw: 0, speed: 0 };
  const camera = new THREE.PerspectiveCamera(60);
  const castRay = vi.fn(() => hits.shift() ?? null);
  const RAPIER = { Ray: class { constructor(origin, dir) { Object.assign(this, { origin, dir }); } } };
  const follow = createFollowCamera(camera, { RAPIER, world: { castRay }, skater });
  const base = new THREE.Vector3(...createCameraState(skater).position);
  return { camera, castRay, base, update: () => follow.update(skater, 1 / 60) };
}

test.each([1, -1])("limits signed local offsets and starts the up query after the right movement (%s)", (sign) => {
  offsets.right = sign * 0.2;
  offsets.up = sign * 0.3;
  const { camera, castRay, base, update } = setup([null, { timeOfImpact: 0.1 }, { toi: 0.15 }]);
  update();
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const afterRight = base.clone().addScaledVector(right, sign * 0.05);
  expect(new THREE.Vector3(...Object.values(castRay.mock.calls[1][0].origin)).distanceTo(base)).toBeLessThan(1e-10);
  expect(new THREE.Vector3(...Object.values(castRay.mock.calls[2][0].origin)).distanceTo(afterRight)).toBeLessThan(1e-10);
  expect(camera.position.distanceTo(afterRight.addScaledVector(up, sign * 0.1))).toBeLessThan(1e-10);
});

test("unobstructed offsets retain their full local movement", () => {
  offsets.right = -0.2;
  offsets.up = 0.3;
  const { camera, base, update } = setup();
  update();
  const expected = base.add(new THREE.Vector3(-0.2, 0.3, 0).applyQuaternion(camera.quaternion));
  expect(camera.position.distanceTo(expected)).toBeLessThan(1e-10);
});

test("zero offsets make no additional queries", () => {
  const { camera, castRay, base, update } = setup();
  update();
  expect(castRay).toHaveBeenCalledTimes(1);
  expect(camera.position.distanceTo(base)).toBeLessThan(1e-10);
});

test("clipped cameras suppress movement offsets", () => {
  offsets.right = 0.2;
  offsets.up = -0.3;
  const { camera, castRay, base, update } = setup([{ timeOfImpact: 1 }]);
  update();
  // The close wall also makes the swing probes (#257 merge: the epic swing
  // around a close blocker), but each ray starts at the skater pivot: no
  // ray starts at the camera for an offset movement.
  const pivot = new THREE.Vector3(...cameraPivot({ position: [0, 0, 0], yaw: 0, speed: 0 }));
  for (const [ray] of castRay.mock.calls) expect(new THREE.Vector3(...Object.values(ray.origin)).distanceTo(pivot)).toBeLessThan(1e-10);
  expect(camera.position.distanceTo(base)).toBeGreaterThan(1);
});

test("a blocker at the movement origin prevents movement", () => {
  offsets.right = 0.2;
  const { camera, base, update } = setup([null, { timeOfImpact: 0 }]);
  update();
  expect(camera.position.distanceTo(base)).toBeLessThan(1e-10);
});
