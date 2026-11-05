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
//
// Farther cars use assets/vehicles/vehicles_lod.glb (scripts/blender/
// vehicle_lods.py): per kind a LOD1 with the same rig (<kind>_lod1_body,
// _steer_FL/FR, _wheel_FL/FR/RL/RR) and a LOD2 with the wheels merged into
// one mesh (<kind>_lod2), all on one shared 2048x1024 atlas, so every far
// car of every kind draws in one more call.

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

export const CAR_LOD_URL = new URL(
  "../../assets/vehicles/vehicles_lod.glb",
  import.meta.url,
).href;

// The GLB LOD bands (m from the camera): LOD0 to lod0, LOD1 to lod1, LOD2 to
// lod2, the kit cars of src/render/car-view.js beyond.
export const CAR_LOD_DISTANCES = { lod0: 25, lod1: 70, lod2: 140 };

// Pure: the GLB LOD (0, 1, 2) for a car `distance` m away, or -1 past the
// LOD2 band. Without LOD0 (the low tiers) LOD1 draws the near cars too.
export function carLodFor(
  distance,
  { lod0 = true, distances = CAR_LOD_DISTANCES } = {},
) {
  if (!(distance < distances.lod2)) return -1;
  if (distance >= distances.lod1) return 2;
  return lod0 && distance < distances.lod0 ? 0 : 1;
}

// Pure: the nearest loaded level to `lod` in levels ([lod0, lod1, lod2],
// null where missing), preferring the more detailed one; -1 if none.
export function nearestLevel(levels, lod) {
  for (let d = 0; d < levels.length; d += 1) {
    if (levels[lod - d]) return lod - d;
    if (levels[lod + d]) return lod + d;
  }
  return -1;
}

// Whether the page asked for a low tier (?quality=low|phone): those skip the
// 1024 px LOD0 GLBs and draw LOD1 near.
function lowTierParam() {
  const q = new URLSearchParams(globalThis.location?.search ?? "").get(
    "quality",
  );
  return q === "low" || q === "phone";
}

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

// Reads one rigged vehicle into { body, wheels: [{ geometry, hub, front, radius }], material, scale, wheelbase }.
// prefix selects a LOD in a shared file ("taxi_lod1_" reads taxi_lod1_body...).
export function vehicleModel(kind, scene, prefix = "") {
  scene.updateMatrixWorld(true);
  const body = scene.getObjectByName(`${prefix}body`);
  if (!body?.isMesh) throw new Error(`${kind}: no ${prefix}body mesh`);
  const geoms = [body.geometry.clone().applyMatrix4(body.matrixWorld)];
  const wheels = [];
  for (const name of WHEELS) {
    const w = scene.getObjectByName(`${prefix}${name}`);
    if (!w?.isMesh) throw new Error(`${kind}: no ${prefix}${name}`);
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
  const box = new THREE.Box3().setFromObject(body);
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

// Reads the one-mesh LOD2 of a kind (<kind>_lod2): no wheels to turn.
export function vehicleLod2(kind, scene) {
  scene.updateMatrixWorld(true);
  const mesh = scene.getObjectByName(`${kind}_lod2`);
  if (!mesh?.isMesh) throw new Error(`${kind}: no ${kind}_lod2 mesh`);
  const body = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  body.computeBoundingBox();
  const len = body.boundingBox.max.z - body.boundingBox.min.z;
  return {
    kind,
    body,
    wheels: [],
    material: mesh.material,
    scale: fitScale(kind, len),
    wheelbase: 0,
  };
}

// Loads { kind: { lod0, lod1, lod2 } }. lod0: false (the default on
// ?quality=low|phone) skips the 1024 px rigged GLBs.
export async function loadCarModels(
  kinds = Object.keys(CAR_MODEL_URLS),
  { lod0 = !lowTierParam() } = {},
) {
  const loader = new GLTFLoader().setDRACOLoader(getDracoLoader());
  const want = kinds.filter((k) => CAR_MODEL_URLS[k]);
  const [lods, ...near] = await Promise.all([
    loader.loadAsync(CAR_LOD_URL),
    ...(lod0 ? want.map((k) => loader.loadAsync(CAR_MODEL_URLS[k])) : []),
  ]);
  return Object.fromEntries(
    want.map((k, j) => [
      k,
      {
        lod0: lod0 ? vehicleModel(k, near[j].scene) : null,
        lod1: vehicleModel(k, lods.scene, `${k}_lod1_`),
        lod2: vehicleLod2(k, lods.scene),
      },
    ]),
  );
}

const indexCount = (g) =>
  g.index ? g.index.count : g.attributes.position.count;

// The GLB car view: cars is the list of all cars (parked then moving) in the
// order of src/render/car-view.js. models maps a kind to { lod0, lod1, lod2 }
// (or to one model, drawn as LOD0). set(i, car, pitch, distance) shows car i
// at its pose this frame at the LOD for its distance; hide(i) hides it. One
// BatchedMesh per material: one per kind for LOD0, one shared by every
// LOD1/LOD2 on the atlas.
export function createCarModelView(
  models,
  cars,
  { distances = CAR_LOD_DISTANCES } = {},
) {
  const group = new THREE.Group();
  group.name = "car-models";
  const kinds = new Map();
  const batches = new Map();
  for (const [kind, entry] of Object.entries(models)) {
    const count = cars.filter((c) => c.kind === kind).length;
    if (!count || !entry) continue;
    const levels = entry.body
      ? [entry, null, null]
      : [entry.lod0 ?? null, entry.lod1 ?? null, entry.lod2 ?? null];
    const parts = levels.map((m) =>
      m ? [m.body, ...m.wheels.map((w) => w.geometry)] : null,
    );
    levels.forEach((m, l) => {
      if (!m) return;
      let b = batches.get(m.material);
      if (!b) {
        b = { material: m.material, geoms: [], instances: 0, shown: 0 };
        batches.set(m.material, b);
      }
      b.geoms.push(...parts[l]);
      b.instances += count * parts[l].length;
      b.name = b.name ? "car-lods" : l === 0 ? `car-${kind}` : "car-lods";
    });
    kinds.set(kind, { levels, parts });
  }
  for (const b of batches.values()) {
    shareAttributes(b.geoms);
    const verts = b.geoms.reduce((s, g) => s + g.attributes.position.count, 0);
    const idx = b.geoms.reduce((s, g) => s + indexCount(g), 0);
    b.mesh = new THREE.BatchedMesh(b.instances, verts, idx, b.material);
    b.mesh.name = b.name;
    b.mesh.castShadow = true;
    b.mesh.receiveShadow = true;
    b.mesh.frustumCulled = false;
    b.mesh.visible = false;
    group.add(b.mesh);
  }
  for (const k of kinds.values()) {
    k.lods = k.levels.map((m, l) => {
      if (!m) return null;
      const b = batches.get(m.material);
      return {
        model: m,
        batch: b,
        ids: k.parts[l].map((g) => b.mesh.addGeometry(g)),
        triangles: k.parts[l].reduce((s, g) => s + indexCount(g) / 3, 0),
      };
    });
    k.rig = k.levels.find((m) => m?.wheels.length) ?? null;
  }
  const slots = cars.map((c) => {
    const k = kinds.get(c.kind);
    if (!k) return null;
    const inst = k.lods.map((L) => {
      if (!L) return null;
      const ids = L.ids.map((g) => L.batch.mesh.addInstance(g));
      for (const id of ids) L.batch.mesh.setVisibleAt(id, false);
      return ids;
    });
    return { k, inst, level: -1, prev: null, spin: 0, steer: 0 };
  });
  const carM = new THREE.Matrix4();
  const fit = new THREE.Matrix4();
  const wm = new THREE.Matrix4();
  const tmp = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, "YZX");
  const p = new THREE.Vector3();
  const s3 = new THREE.Vector3();
  const yUp = new THREE.Vector3(0, 1, 0);
  const qFit = new THREE.Quaternion().setFromAxisAngle(yUp, Math.PI / 2);
  const info = { drawn: 0, triangles: 0, lods: [0, 0, 0] };
  const hasLod0 = [...kinds.values()].some((k) => k.levels[0]);
  function showLevel(s, level) {
    if (s.level === level) return;
    if (s.level >= 0) {
      const L = s.k.lods[s.level];
      for (const id of s.inst[s.level]) L.batch.mesh.setVisibleAt(id, false);
      L.batch.shown -= 1;
      L.batch.mesh.visible = L.batch.shown > 0;
    }
    if (level >= 0) {
      const L = s.k.lods[level];
      for (const id of s.inst[level]) L.batch.mesh.setVisibleAt(id, true);
      L.batch.shown += 1;
      L.batch.mesh.visible = true;
    }
    s.level = level;
  }
  function hide(i) {
    const s = slots[i];
    if (!s || s.level < 0) return;
    showLevel(s, -1);
    s.prev = null;
  }
  return {
    group,
    info,
    // The far edge of the GLB cars: car-view draws kit cars beyond it.
    range: distances.lod2,
    has: (i) => Boolean(slots[i]),
    // The batches with a car in them this frame.
    get drawCalls() {
      let n = 0;
      for (const b of batches.values()) if (b.mesh.visible) n += 1;
      return n;
    },
    beginFrame() {
      info.drawn = 0;
      info.triangles = 0;
      info.lods = [0, 0, 0];
    },
    hide,
    set(i, c, pitch = 0, distance = 0) {
      const s = slots[i];
      if (!s) return false;
      const want = carLodFor(distance, { lod0: hasLod0, distances });
      const level = want < 0 ? -1 : nearestLevel(s.k.levels, want);
      if (level < 0) {
        hide(i);
        return false;
      }
      const { model, batch, triangles } = s.k.lods[level];
      const rig = s.k.rig;
      const ds = rolled(s.prev, c);
      if (rig && s.prev && ds > 0) {
        s.spin =
          (s.spin + ds / (rig.wheels[2].radius * rig.scale)) % (2 * Math.PI);
        const target = steerAngle(
          yawDelta(s.prev.yaw, c.yaw),
          ds,
          rig.wheelbase,
        );
        s.steer += (target - s.steer) * Math.min(1, ds);
      }
      s.prev = { x: c.x, z: c.z, yaw: c.yaw };
      e.set(0, c.yaw, pitch);
      q.setFromEuler(e).multiply(qFit);
      p.set(c.x, c.y, c.z);
      carM.compose(p, q, s3.set(model.scale, model.scale, model.scale));
      const ids = s.inst[level];
      batch.mesh.setMatrixAt(ids[0], carM);
      model.wheels.forEach((w, j) => {
        fit.makeRotationY(w.front ? s.steer : 0);
        tmp.makeRotationX(s.spin);
        wm.makeTranslation(w.hub.x, w.hub.y, w.hub.z)
          .multiply(fit)
          .multiply(tmp);
        batch.mesh.setMatrixAt(ids[j + 1], tmp.multiplyMatrices(carM, wm));
      });
      showLevel(s, level);
      info.drawn += 1;
      info.lods[level] += 1;
      info.triangles += triangles;
      return true;
    },
  };
}
