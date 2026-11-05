import * as THREE from "three";
import { carTemplates } from "./car-kit.js";
import { propLodFor } from "./prop-batch.js";
import { CAR_COLORS, CAR_SIZE } from "../sim/traffic/traffic.js";
import { LAMP, lampLayout, lampLevels } from "./car-models.js";

// Three.js view of the cars (issue #132): the parked cars and the traffic
// in one BatchedMesh, so all the cars cost one draw call (as the props in
// src/render/prop-batch.js, #89). Each car shows its detailed (LOD0) or its
// simple (LOD1) shape by its distance from the camera, and hides past the
// draw distance. The paint attribute picks the instance body color.

export const CAR_LOD0_DISTANCE = 70; // m
export const CAR_DRAW_DISTANCE = 240; // m
// The lamps draw to this distance (m), the headlight pools on the street to
// BEAM_DISTANCE.
export const LAMP_DISTANCE = 240;
export const BEAM_DISTANCE = 120;

function carGeometry(t) {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(t.positions), 3));
  geom.setAttribute("normal", new THREE.BufferAttribute(Float32Array.from(t.normals), 3));
  geom.setAttribute("color", new THREE.BufferAttribute(Float32Array.from(t.colors), 3));
  geom.setAttribute("paint", new THREE.BufferAttribute(Float32Array.from(t.paint), 1));
  geom.setIndex(new THREE.BufferAttribute(Uint32Array.from(t.indices), 1));
  return geom;
}

function rampTexture() {
  const data = new Uint8Array([120, 120, 120, 255, 190, 190, 190, 255, 255, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// A toon material where paint mixes the vertex color toward the instance
// color: paint 1 is the body, paint 0 keeps glass, tires, and lights.
function carMaterial() {
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: rampTexture() });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nattribute float paint;").replace(
      "#include <color_vertex>",
      `vColor = vec4(color, 1.0);
#ifdef USE_BATCHING_COLOR
vColor.rgb = mix(vColor.rgb, vColor.rgb * getBatchingColor(getIndirectIndex(gl_DrawID)).rgb, paint);
#endif`,
    );
  };
  mat.customProgramCacheKey = () => "cars-v1";
  return mat;
}

// A soft round-ended pool of light, bright at the car end: the headlight
// beams on the street at night (additive, no depth write).
function beamTexture(n = 64) {
  const data = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const u = i / (n - 1); // along the beam: 0 at the car
      const v = (j / (n - 1)) * 2 - 1; // across
      const spread = 0.35 + 0.65 * u;
      const a = Math.max(0, 1 - Math.abs(v) / spread) ** 1.5 * (1 - u) ** 1.2 * Math.min(1, u * 6);
      const k = (j * n + i) * 4;
      data[k] = data[k + 1] = data[k + 2] = Math.round(255 * a);
      data[k + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// The lamps of the moving cars (src/render/car-models.js lampLayout and
// lampLevels): one InstancedMesh of unlit quads for every lamp, one for
// the headlight pools. Two draw calls for all the cars.
function createLamps(moving) {
  const layouts = new Map();
  const per = lampLayout(CAR_SIZE.sedan).length;
  const quad = new THREE.PlaneGeometry(1, 1);
  const lampMat = new THREE.MeshBasicMaterial({ toneMapped: false, fog: true });
  const lamps = new THREE.InstancedMesh(quad, lampMat, Math.max(1, moving.length * per));
  lamps.name = "car-lamps";
  lamps.frustumCulled = false;
  lamps.count = 0;
  lamps.setColorAt(0, new THREE.Color());
  const beamGeom = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0);
  const beamMat = new THREE.MeshBasicMaterial({ map: beamTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const beams = new THREE.InstancedMesh(beamGeom, beamMat, Math.max(1, moving.length));
  beams.name = "car-beams";
  beams.frustumCulled = false;
  beams.count = 0;
  beams.setColorAt(0, new THREE.Color());
  const colors = { head: new THREE.Color(LAMP.head), tail: new THREE.Color(LAMP.tail), signal: new THREE.Color(LAMP.signal) };
  const col = new THREE.Color();
  const car = new THREE.Matrix4();
  const local = new THREE.Matrix4();
  const out = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, "YZX");
  const p = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const s3 = new THREE.Vector3();
  const faceFront = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  const faceBack = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
  const noTurn = new THREE.Quaternion();
  const info = { lamps: 0, beams: 0, lit: 0 };
  return {
    lamps,
    beams,
    info,
    get drawCalls() {
      return (lamps.count > 0 ? 1 : 0) + (beams.count > 0 ? 1 : 0);
    },
    // cars: [{ car, pitch, d }] in view this frame.
    update(cars, { lit = 0, time = 0 } = {}) {
      let n = 0;
      let nb = 0;
      for (const { car: c, pitch, d } of cars) {
        if (d > LAMP_DISTANCE) continue;
        let layout = layouts.get(c.kind);
        if (!layout) layouts.set(c.kind, (layout = lampLayout(CAR_SIZE[c.kind])));
        const lv = lampLevels({ lit, brake: c.brake ?? 0, signal: c.signal ?? 0, time, phase: (c.id * 0.37) % 1 });
        e.set(0, c.yaw, pitch);
        q.setFromEuler(e);
        car.compose(p.set(c.x, c.y, c.z), q, one);
        for (const L of layout) {
          const level = L.type === "head" ? lv.head : L.type === "tail" ? lv.tail : L.side > 0 ? lv.left : lv.right;
          if (level <= 0.01) continue;
          local.compose(p.set(L.x, L.y, L.z), L.face > 0 ? faceFront : faceBack, s3.set(L.w, L.h, 1));
          lamps.setMatrixAt(n, out.multiplyMatrices(car, local));
          lamps.setColorAt(n, col.copy(colors[L.type]).multiplyScalar(0.25 + 0.75 * level));
          n += 1;
        }
        if (lv.beam > 0.05 && d < BEAM_DISTANCE) {
          const size = CAR_SIZE[c.kind];
          local.compose(p.set(size.length / 2 + 0.3, 0.06, 0), noTurn, s3.set(9, 1, size.width * 1.6));
          beams.setMatrixAt(nb, out.multiplyMatrices(car, local));
          beams.setColorAt(nb, col.setRGB(1, 0.92, 0.75).multiplyScalar(0.55 * lv.beam));
          nb += 1;
        }
      }
      lamps.count = n;
      beams.count = nb;
      lamps.instanceMatrix.needsUpdate = true;
      if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
      beams.instanceMatrix.needsUpdate = true;
      if (beams.instanceColor) beams.instanceColor.needsUpdate = true;
      info.lamps = n;
      info.beams = nb;
      info.lit = lit;
    },
  };
}

// parked: [{ kind, color, x, y, z, yaw, pitch? }]. moving: the traffic
// cars (src/sim/traffic/traffic.js). A new traffic state from the same seed
// has the same cars in the same order, so update() takes the cars now.
export function createCarView(parked, moving = [], { lod0Distance = CAR_LOD0_DISTANCE, drawDistance = CAR_DRAW_DISTANCE, pitchAt = null } = {}) {
  const templates = carTemplates();
  const all = [...parked, ...moving];
  const kinds = [...new Set(all.map((c) => c.kind))].sort();
  const geoms = new Map(kinds.map((k) => [k, [carGeometry(templates[k]), carGeometry(templates[`${k}_lod1`])]]));
  let vertices = 0;
  let indices = 0;
  for (const pair of geoms.values()) {
    for (const g of pair) {
      vertices += g.attributes.position.count;
      indices += g.index.count;
    }
  }
  const material = carMaterial();
  const mesh = new THREE.BatchedMesh(Math.max(1, all.length), Math.max(1, vertices), Math.max(1, indices), material);
  mesh.name = "cars";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // The moving cars leave any fixed bounds: cull each instance, not the batch.
  mesh.frustumCulled = false;
  const ids = new Map();
  const triangles = new Map();
  for (const [kind, [g0, g1]] of geoms) {
    ids.set(kind, [mesh.addGeometry(g0), mesh.addGeometry(g1)]);
    triangles.set(kind, [g0.index.count / 3, g1.index.count / 3]);
    g0.dispose();
    g1.dispose();
  }
  const palette = CAR_COLORS.map((h) => new THREE.Color(h));
  const white = new THREE.Color(1, 1, 1);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, "YZX");
  const p = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  function pose(id, c, pitch = 0) {
    e.set(0, c.yaw, pitch);
    q.setFromEuler(e);
    p.set(c.x, c.y, c.z);
    m.compose(p, q, one);
    mesh.setMatrixAt(id, m);
  }
  const state = new Int8Array(all.length).fill(-2);
  all.forEach((c, i) => {
    const id = mesh.addInstance(ids.get(c.kind)[1]);
    mesh.setColorAt(id, c.kind === "bus" ? white : palette[c.color % palette.length]);
    pose(id, c, c.pitch ?? 0);
    mesh.setVisibleAt(id, false);
  });
  const info = { parked: parked.length, moving: moving.length, drawn: 0, lod0: 0, triangles: 0, models: 0 };
  // The lamps ride on the car mesh (an identity transform), so the scene
  // takes them with it.
  const lamps = moving.length ? createLamps(moving) : null;
  if (lamps) mesh.add(lamps.lamps, lamps.beams);
  const inView = [];
  // The GLB cars (src/render/car-models.js, LOD0 to LOD2) replace the kit
  // shapes of their kinds within models.range once they load.
  let models = null;
  return {
    mesh,
    info,
    get drawCalls() {
      return 1 + (models ? models.drawCalls : 0) + (lamps ? lamps.drawCalls : 0);
    },
    get models() {
      return models;
    },
    get lamps() {
      return lamps;
    },
    setModels(view) {
      models = view;
      state.fill(-2);
    },
    // Sets the LOD, the visibility, and (for the traffic) the pose of each
    // car for a camera position. Call it once per frame. lights: { lit,
    // time } with lit the weather window factor (0 day, 1 night) and time
    // in s for the turn signals.
    update(cameraPosition, movingNow = moving, lights = {}) {
      inView.length = 0;
      let drawn = 0;
      let lod0 = 0;
      let tris = 0;
      const cx = cameraPosition.x;
      const cz = cameraPosition.z;
      const np = parked.length;
      models?.beginFrame();
      for (let i = 0; i < all.length; i += 1) {
        const c = i < np ? parked[i] : (movingNow[i - np] ?? all[i]);
        const d = Math.hypot(c.x - cx, c.z - cz);
        const lod = propLodFor(d, lod0Distance, drawDistance);
        // The GLB cars (with their own LODs) cover models.range; kit cars beyond.
        const pitch = lod >= 0 ? (i < np ? (c.pitch ?? 0) : pitchAt ? pitchAt(c) : 0) : 0;
        const glb = lod >= 0 && models?.has(i) && d < (models.range ?? lod0Distance) && models.set(i, c, pitch, d);
        if (lod >= 0 && i >= np) inView.push({ car: c, pitch, d });
        if (!glb) models?.hide(i);
        if (lod >= 0) {
          drawn += 1;
          if (!glb) tris += triangles.get(c.kind)[lod];
          if (i >= parked.length && !glb) pose(i, c, pitch);
        }
        if (lod === 0) lod0 += 1;
        const want = glb ? -3 : lod;
        if (want === state[i]) continue;
        state[i] = want;
        if (lod < 0 || glb) mesh.setVisibleAt(i, false);
        else {
          mesh.setGeometryIdAt(i, ids.get(c.kind)[lod]);
          mesh.setVisibleAt(i, true);
        }
      }
      lamps?.update(inView, lights);
      info.drawn = drawn;
      info.lod0 = lod0;
      info.models = models ? models.info.drawn : 0;
      info.triangles = tris + (models ? models.info.triangles : 0);
    },
  };
}
