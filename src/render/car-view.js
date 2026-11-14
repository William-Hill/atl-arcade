import * as THREE from "three";
import { carTemplates } from "./car-kit.js";
import { propLodFor } from "./prop-batch.js";
import { createBatchFade, ditherBatch } from "./lod-dither.js";
import { fadeCopies, lodFadeOn } from "./lod-fade.js";
import { CAR_COLORS } from "../sim/traffic/traffic.js";

// Three.js view of the cars (issue #132): the parked cars and the traffic
// in one BatchedMesh, so all the cars cost one draw call (as the props in
// src/render/prop-batch.js, #89). Each car shows its detailed (LOD0) or its
// simple (LOD1) shape by its distance from the camera, and hides past the
// draw distance. The paint attribute picks the instance body color.
// A LOD switch, a hide, and a show fade with a short timed dither (#279,
// lod-fade.js), as the props do.

export const CAR_LOD0_DISTANCE = 70; // m
export const CAR_DRAW_DISTANCE = 240; // m

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

// parked: [{ kind, color, x, y, z, yaw, pitch? }]. moving: the traffic
// cars (src/sim/traffic/traffic.js). A new traffic state from the same seed
// has the same cars in the same order, so update() takes the cars now.
// `fade: false` makes each LOD switch hard (the default reads ?lodfade=0).
export function createCarView(parked, moving = [], { lod0Distance = CAR_LOD0_DISTANCE, drawDistance = CAR_DRAW_DISTANCE, pitchAt = null, fade = lodFadeOn(), clock } = {}) {
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
  const copies = fadeCopies(all.length, fade);
  const mesh = new THREE.BatchedMesh(Math.max(1, all.length + copies), Math.max(1, vertices), Math.max(1, indices), material);
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
  all.forEach((c, i) => {
    const id = mesh.addInstance(ids.get(c.kind)[1]);
    mesh.setColorAt(id, c.kind === "bus" ? white : palette[c.color % palette.length]);
    pose(id, c, c.pitch ?? 0);
    mesh.setVisibleAt(id, false);
  });
  // A traffic car keeps its kind, so the geometry ids come from the first
  // list of cars.
  const fader = createBatchFade(mesh, all.length, copies, { geometryOf: (i, lod) => ids.get(all[i]?.kind ?? kinds[0])[lod], enabled: fade, colors: true, clock });
  if (fade) ditherBatch(mesh, fader.uniform);
  mesh.userData.lodFade = fader.info;
  const info = { parked: parked.length, moving: moving.length, drawn: 0, lod0: 0, triangles: 0 };
  return {
    mesh,
    info,
    fade: fader.info,
    get drawCalls() {
      return 1;
    },
    // Sets the LOD, the visibility, and (for the traffic) the pose of each
    // car for a camera position. Call it once per frame. `time` (s) is for
    // the tests.
    update(cameraPosition, movingNow = moving, time) {
      let drawn = 0;
      let lod0 = 0;
      let tris = 0;
      const cx = cameraPosition.x;
      const cz = cameraPosition.z;
      const np = parked.length;
      fader.begin(cameraPosition, time);
      for (let i = 0; i < all.length; i += 1) {
        const c = i < np ? parked[i] : (movingNow[i - np] ?? all[i]);
        const lod = propLodFor(Math.hypot(c.x - cx, c.z - cz), lod0Distance, drawDistance);
        if (lod >= 0) {
          drawn += 1;
          tris += triangles.get(c.kind)[lod];
        }
        if (lod === 0) lod0 += 1;
        fader.set(i, lod);
        // A car that fades out still moves, and its fade copy moves with it.
        if (i >= np && (lod >= 0 || fader.fading(i))) {
          pose(i, c, pitchAt ? pitchAt(c) : 0);
          fader.follow(i);
        }
      }
      fader.end();
      info.drawn = drawn;
      info.lod0 = lod0;
      info.triangles = tris;
    },
  };
}
