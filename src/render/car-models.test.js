import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  CAR_LOD_DISTANCES,
  MAX_STEER,
  carLodFor,
  createCarModelView,
  nearestLevel,
  fitScale,
  rolled,
  steerAngle,
  vehicleLod2,
  vehicleModel,
  yawDelta,
} from "./car-models.js";
import { CAR_SIZE } from "../sim/traffic/traffic.js";

// A stand-in vehicle GLB scene: a 4 m body along z and four 0.3 m wheels.
function fakeScene(prefix = "", mat = new THREE.MeshStandardMaterial()) {
  const scene = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 1.2, 4).translate(0, 0.9, 0),
    mat,
  );
  body.name = `${prefix}body`;
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
    w.name = `${prefix}${name}`;
    const front = name.includes("F");
    const parent = front ? new THREE.Group() : body;
    if (front) {
      parent.name = prefix + name.replace("wheel", "steer");
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
    expect(view.drawCalls).toBe(0);
    expect(view.has(0)).toBe(true);
    expect(view.has(1)).toBe(false);
    view.beginFrame();
    expect(view.set(0, cars[0])).toBe(true);
    expect(view.drawCalls).toBe(1);
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

  it("picks LOD0 near, LOD1 to 70 m, LOD2 farther, and none past the band", () => {
    const { lod0, lod1, lod2 } = CAR_LOD_DISTANCES;
    expect(carLodFor(0)).toBe(0);
    expect(carLodFor(lod0 - 0.01)).toBe(0);
    expect(carLodFor(lod0)).toBe(1);
    expect(carLodFor(lod1 - 0.01)).toBe(1);
    expect(carLodFor(lod1)).toBe(2);
    expect(carLodFor(lod2 - 0.01)).toBe(2);
    expect(carLodFor(lod2)).toBe(-1);
    expect(carLodFor(NaN)).toBe(-1);
    // The low tiers load no LOD0: LOD1 draws the near cars.
    expect(carLodFor(5, { lod0: false })).toBe(1);
    expect(carLodFor(80, { lod0: false })).toBe(2);
    const distances = { lod0: 10, lod1: 20, lod2: 30 };
    expect(carLodFor(15, { distances })).toBe(1);
    expect(carLodFor(25, { distances })).toBe(2);
  });

  it("falls back to the nearest loaded level, the more detailed first", () => {
    expect(nearestLevel(["a", "b", "c"], 1)).toBe(1);
    expect(nearestLevel([null, "b", "c"], 0)).toBe(1);
    expect(nearestLevel(["a", null, "c"], 1)).toBe(0);
    expect(nearestLevel(["a", null, null], 2)).toBe(0);
    expect(nearestLevel([null, null, null], 1)).toBe(-1);
  });

  it("switches a car between LOD0, LOD1 and LOD2 by distance", () => {
    const atlas = new THREE.MeshStandardMaterial();
    const lodScene = fakeScene("sedan_lod1_", atlas);
    const lod2 = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.2, 4), atlas);
    lod2.name = "sedan_lod2";
    lodScene.add(lod2);
    const models = {
      sedan: {
        lod0: vehicleModel("sedan", fakeScene()),
        lod1: vehicleModel("sedan", lodScene, "sedan_lod1_"),
        lod2: vehicleLod2("sedan", lodScene),
      },
    };
    expect(models.sedan.lod2.wheels).toHaveLength(0);
    expect(models.sedan.lod2.scale).toBeCloseTo(models.sedan.lod0.scale, 5);
    const car = { kind: "sedan", x: 0, y: 0, z: 0, yaw: 0 };
    const view = createCarModelView(models, [car, { ...car, x: 4 }]);
    // One batch for LOD0 of the kind, one for the shared LOD1/LOD2 atlas.
    expect(view.group.children.map((m) => m.name)).toEqual([
      "car-sedan",
      "car-lods",
    ]);
    expect(view.range).toBe(CAR_LOD_DISTANCES.lod2);
    const [near, far] = view.group.children;
    const tris = (lod) => {
      view.beginFrame();
      view.set(0, car, 0, lod);
      return view.info;
    };
    expect(tris(10).lods).toEqual([1, 0, 0]);
    expect(near.visible && !far.visible).toBe(true);
    expect(view.drawCalls).toBe(1);
    const t0 = view.info.triangles;
    expect(tris(40).lods).toEqual([0, 1, 0]);
    expect(!near.visible && far.visible).toBe(true);
    expect(tris(100).lods).toEqual([0, 0, 1]);
    expect(view.info.triangles).toBeLessThan(t0);
    // The second car keeps LOD0 drawn while the first is far.
    view.set(1, car, 0, 5);
    expect(near.visible && far.visible).toBe(true);
    expect(view.drawCalls).toBe(2);
    expect(view.set(0, car, 0, 500)).toBe(false);
    view.hide(1);
    expect(near.visible || far.visible).toBe(false);
    expect(view.drawCalls).toBe(0);
  });

  it("draws LOD1 near when no LOD0 is loaded", () => {
    const lodScene = fakeScene("taxi_lod1_");
    const lod2 = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.2, 4));
    lod2.name = "taxi_lod2";
    lodScene.add(lod2);
    const car = { kind: "taxi", x: 0, y: 0, z: 0, yaw: 0 };
    const view = createCarModelView(
      {
        taxi: {
          lod0: null,
          lod1: vehicleModel("taxi", lodScene, "taxi_lod1_"),
          lod2: vehicleLod2("taxi", lodScene),
        },
      },
      [car],
    );
    view.beginFrame();
    expect(view.set(0, car, 0, 2)).toBe(true);
    expect(view.info.lods).toEqual([0, 1, 0]);
  });
});
