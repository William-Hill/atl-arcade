import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  MAX_STEER,
  createCarModelView,
  fitScale,
  rolled,
  steerAngle,
  vehicleModel,
  yawDelta,
} from "./car-models.js";
import { CAR_SIZE } from "../sim/traffic/traffic.js";

// A stand-in vehicle GLB scene: a 4 m body along z and four 0.3 m wheels.
function fakeScene() {
  const scene = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 1.2, 4).translate(0, 0.9, 0),
    mat,
  );
  body.name = "body";
  scene.add(body);
  for (const [name, x, z] of [
    ["wheel_FL", -0.8, 1.4],
    ["wheel_FR", 0.8, 1.4],
    ["wheel_RL", -0.8, -1.2],
    ["wheel_RR", 0.8, -1.2],
  ]) {
    const w = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.3, 0.2).rotateZ(Math.PI / 2),
      mat,
    );
    w.name = name;
    const front = name.includes("F");
    const parent = front ? new THREE.Group() : body;
    if (front) {
      parent.name = name.replace("wheel", "steer");
      parent.position.set(x, 0.3, z);
      body.add(parent);
    } else w.position.set(x, 0.3, z);
    parent.add(w);
  }
  return scene;
}

describe("car models", () => {
  it("steers by the bicycle model and clamps the angle", () => {
    expect(steerAngle(0, 1, 2.7)).toBe(0);
    expect(steerAngle(0.1, 1, 2.7)).toBeCloseTo(Math.atan(0.27), 6);
    expect(steerAngle(-0.1, 1, 2.7)).toBeCloseTo(-Math.atan(0.27), 6);
    expect(steerAngle(5, 1, 2.7)).toBe(MAX_STEER);
    expect(steerAngle(1, 0, 2.7)).toBe(0);
  });

  it("wraps the yaw change across +-PI", () => {
    expect(yawDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2, 6);
    expect(yawDelta(0.2, 0.1)).toBeCloseTo(-0.1, 6);
  });

  it("rolls the distance moved, and nothing on a teleport", () => {
    expect(rolled(null, { x: 1, z: 0 })).toBe(0);
    expect(rolled({ x: 0, z: 0 }, { x: 3, z: 4 })).toBeCloseTo(5, 6);
    expect(rolled({ x: 0, z: 0 }, { x: 30, z: 0 })).toBe(0);
  });

  it("fits a model to the collision length of its kind", () => {
    expect(fitScale("sedan", CAR_SIZE.sedan.length)).toBe(1);
    expect(fitScale("bus", 6)).toBeCloseTo(2, 6);
  });

  it("reads the hubs, the wheelbase, and the wheel radius from the rig", () => {
    const m = vehicleModel("sedan", fakeScene());
    const s = CAR_SIZE.sedan.length / 4;
    expect(m.scale).toBeCloseTo(s, 6);
    expect(m.wheelbase).toBeCloseTo(2.6 * s, 6);
    expect(m.wheels.map((w) => w.front)).toEqual([true, true, false, false]);
    expect(m.wheels[0].hub.toArray()).toEqual([-0.8, 0.3, 1.4]);
    expect(m.wheels[2].radius).toBeCloseTo(0.3, 6);
  });

  it("draws one batch per kind and places the wheels at the hubs", () => {
    const model = vehicleModel("sedan", fakeScene());
    const cars = [
      { kind: "sedan", x: 10, y: 0, z: 5, yaw: 0 },
      { kind: "hatchback", x: 0, y: 0, z: 0, yaw: 0 },
    ];
    const view = createCarModelView({ sedan: model }, cars);
    expect(view.drawCalls).toBe(1);
    expect(view.has(0)).toBe(true);
    expect(view.has(1)).toBe(false);
    view.beginFrame();
    expect(view.set(0, cars[0])).toBe(true);
    expect(view.info.drawn).toBe(1);
    const mesh = view.group.children[0];
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(1, m);
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    // yaw 0 faces +x: the model's +z (front) turns to +x, its -x (left) to +z... scaled.
    const s = model.scale;
    expect(p.x).toBeCloseTo(10 + 1.4 * s, 5);
    expect(p.y).toBeCloseTo(0.3 * s, 5);
    expect(p.z).toBeCloseTo(5 + 0.8 * s, 5);
  });

  it("spins the wheels with the distance and steers into a turn", () => {
    const model = vehicleModel("sedan", fakeScene());
    const car = { kind: "sedan", x: 0, y: 0, z: 0, yaw: 0 };
    const view = createCarModelView({ sedan: model }, [car]);
    view.set(0, car);
    for (let i = 1; i <= 20; i += 1)
      view.set(0, { ...car, x: i * 0.5, yaw: i * 0.02 });
    const mesh = view.group.children[0];
    const m = new THREE.Matrix4();
    const qf = new THREE.Quaternion();
    const qr = new THREE.Quaternion();
    mesh.getMatrixAt(1, m);
    m.decompose(new THREE.Vector3(), qf, new THREE.Vector3());
    mesh.getMatrixAt(3, m);
    m.decompose(new THREE.Vector3(), qr, new THREE.Vector3());
    // The front wheel turns relative to the rear one (same spin).
    expect(qf.angleTo(qr)).toBeGreaterThan(0.01);
  });
});
