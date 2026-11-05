import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { getDracoLoader } from "./skater-model.js";
import { CAR_SIZE } from "../sim/traffic/traffic.js";

// The rigged PBR vehicle GLBs (assets/vehicles/, Meshy + Blender) for the
// near cars of the pbr look. Each GLB faces +z with a body mesh and four
// wheels under hub pivots (wheel_FL/FR/RL/RR, steer_FL/FR; see
// scripts/blender/vehicle_wheels.py). One BatchedMesh per kind draws the
// bodies and the wheels of all its cars in one call, so the wheels can spin
// and the front pair steer per car.

export const CAR_MODEL_URLS = {
  sedan: new URL("../../assets/vehicles/sedan.glb", import.meta.url).href,
  pickup: new URL("../../assets/vehicles/pickup.glb", import.meta.url).href,
  bus: new URL("../../assets/vehicles/bus.glb", import.meta.url).href,
  hatchback: new URL("../../assets/vehicles/hatchback.glb", import.meta.url)
    .href,
  van: new URL("../../assets/vehicles/van.glb", import.meta.url).href,
  taxi: new URL("../../assets/vehicles/taxi.glb", import.meta.url).href,
  box_truck: new URL("../../assets/vehicles/box_truck.glb", import.meta.url)
    .href,
};

const WHEELS = ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"];
export const MAX_STEER = 0.55; // rad

// Pure: the front-wheel angle (rad) for a turn of dyaw over ds meters, by
// the bicycle model. Positive turns toward +yaw.
export function steerAngle(dyaw, ds, wheelbase) {
  if (!(ds > 1e-4)) return 0;
  const a = Math.atan(wheelbase * (dyaw / ds));
  return Math.max(-MAX_STEER, Math.min(MAX_STEER, a));
}

// Pure: the yaw change from a to b in (-PI, PI].
export function yawDelta(a, b) {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

// Pure: the rolled distance (m) between two poses. Teleports (a lane reset
// or a new traffic state) roll nothing.
export function rolled(prev, now, maxStep = 5) {
  if (!prev) return 0;
  const d = Math.hypot(now.x - prev.x, now.z - prev.z);
  return d > maxStep ? 0 : d;
}

// Pure: the uniform scale that fits a model `modelLength` long (m) to the
// collision box of its kind.
export function fitScale(kind, modelLength) {
  return modelLength > 0 ? CAR_SIZE[kind].length / modelLength : 1;
}

function shareAttributes(geoms) {
  const names = Object.keys(geoms[0].attributes).filter((n) =>
    geoms.every((g) => g.attributes[n]),
  );
  for (const g of geoms)
    for (const n of Object.keys(g.attributes))
      if (!names.includes(n)) g.deleteAttribute(n);
  return geoms;
}

// Reads one vehicle GLB into { body, wheels: [{ geometry, hub, front, radius }], material, scale, wheelbase }.
export function vehicleModel(kind, scene) {
  scene.updateMatrixWorld(true);
  const body = scene.getObjectByName("body");
  if (!body?.isMesh) throw new Error(`${kind}: no body mesh`);
  const geoms = [body.geometry.clone().applyMatrix4(body.matrixWorld)];
  const wheels = [];
  for (const name of WHEELS) {
    const w = scene.getObjectByName(name);
    if (!w?.isMesh) throw new Error(`${kind}: no ${name}`);
    const g = w.geometry.clone();
    g.computeBoundingBox();
    const hub = new THREE.Vector3().setFromMatrixPosition(w.matrixWorld);
    wheels.push({
      name,
      geometry: g,
      hub,
      front: name.includes("F"),
      radius: (g.boundingBox.max.y - g.boundingBox.min.y) / 2,
    });
    geoms.push(g);
  }
  shareAttributes(geoms);
  const box = new THREE.Box3().setFromObject(scene);
  const scale = fitScale(kind, box.max.z - box.min.z);
  const zf = wheels.filter((w) => w.front).reduce((s, w) => s + w.hub.z, 0) / 2;
  const zr =
    wheels.filter((w) => !w.front).reduce((s, w) => s + w.hub.z, 0) / 2;
  return {
    kind,
    body: geoms[0],
    wheels,
    material: body.material,
    scale,
    wheelbase: (zf - zr) * scale,
  };
}

export async function loadCarModels(kinds = Object.keys(CAR_MODEL_URLS)) {
  const loader = new GLTFLoader().setDRACOLoader(getDracoLoader());
  const entries = await Promise.all(
    kinds
      .filter((k) => CAR_MODEL_URLS[k])
      .map(async (k) => [
        k,
        vehicleModel(k, (await loader.loadAsync(CAR_MODEL_URLS[k])).scene),
      ]),
  );
  return Object.fromEntries(entries);
}

// The near-car view: cars is the list of all cars (parked then moving) in
// the order of src/render/car-view.js. set(i, car, pitch) shows car i at its
// pose this frame; hide(i) hides it.
export function createCarModelView(models, cars) {
  const group = new THREE.Group();
  group.name = "car-models";
  const byKind = new Map();
  for (const [kind, model] of Object.entries(models)) {
    const count = cars.filter((c) => c.kind === kind).length;
    if (!count) continue;
    const geoms = [model.body, ...model.wheels.map((w) => w.geometry)];
    const verts = geoms.reduce((s, g) => s + g.attributes.position.count, 0);
    const idx = geoms.reduce(
      (s, g) => s + (g.index ? g.index.count : g.attributes.position.count),
      0,
    );
    const mesh = new THREE.BatchedMesh(count * 5, verts, idx, model.material);
    mesh.name = `car-${kind}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    const ids = geoms.map((g) => mesh.addGeometry(g));
    group.add(mesh);
    byKind.set(kind, {
      model,
      mesh,
      ids,
      triangles: geoms.map(
        (g) => (g.index ? g.index.count : g.attributes.position.count) / 3,
      ),
    });
  }
  const slots = cars.map((c) => {
    const k = byKind.get(c.kind);
    if (!k) return null;
    const inst = [
      k.mesh.addInstance(k.ids[0]),
      ...k.model.wheels.map((_, j) => k.mesh.addInstance(k.ids[j + 1])),
    ];
    for (const id of inst) k.mesh.setVisibleAt(id, false);
    return { k, inst, shown: false, prev: null, spin: 0, steer: 0 };
  });
  const carM = new THREE.Matrix4();
  const fit = new THREE.Matrix4();
  const wm = new THREE.Matrix4();
  const tmp = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, "YZX");
  const p = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const s3 = new THREE.Vector3();
  const yUp = new THREE.Vector3(0, 1, 0);
  const qFit = new THREE.Quaternion().setFromAxisAngle(yUp, Math.PI / 2);
  const info = { drawn: 0, triangles: 0 };
  function hide(i) {
    const s = slots[i];
    if (!s || !s.shown) return;
    for (const id of s.inst) s.k.mesh.setVisibleAt(id, false);
    s.shown = false;
    s.prev = null;
  }
  return {
    group,
    info,
    has: (i) => Boolean(slots[i]),
    get drawCalls() {
      return byKind.size;
    },
    beginFrame() {
      info.drawn = 0;
      info.triangles = 0;
    },
    hide,
    set(i, c, pitch = 0) {
      const s = slots[i];
      if (!s) return false;
      const { model, mesh, triangles } = s.k;
      const ds = rolled(s.prev, c);
      if (s.prev && ds > 0) {
        s.spin =
          (s.spin + ds / (model.wheels[2].radius * model.scale)) %
          (2 * Math.PI);
        const target = steerAngle(
          yawDelta(s.prev.yaw, c.yaw),
          ds,
          model.wheelbase,
        );
        s.steer += (target - s.steer) * Math.min(1, ds);
      }
      s.prev = { x: c.x, z: c.z, yaw: c.yaw };
      e.set(0, c.yaw, pitch);
      q.setFromEuler(e).multiply(qFit);
      p.set(c.x, c.y, c.z);
      carM.compose(p, q, s3.set(model.scale, model.scale, model.scale));
      mesh.setMatrixAt(s.inst[0], carM);
      model.wheels.forEach((w, j) => {
        fit.makeRotationY(w.front ? s.steer : 0);
        tmp.makeRotationX(s.spin);
        wm.makeTranslation(w.hub.x, w.hub.y, w.hub.z)
          .multiply(fit)
          .multiply(tmp);
        mesh.setMatrixAt(s.inst[j + 1], tmp.multiplyMatrices(carM, wm));
      });
      if (!s.shown) {
        for (const id of s.inst) mesh.setVisibleAt(id, true);
        s.shown = true;
      }
      info.drawn += 1;
      info.triangles += triangles.reduce((a, b) => a + b, 0);
      return true;
    },
  };
}
