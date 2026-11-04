import * as THREE from "three";

// All the props of a level in one BatchedMesh (#89): one draw call for every
// prop with WEBGL_multi_draw. Each prop is one instance. Each instance shows
// the detailed (LOD0) or the simple (LOD1) shape of its kind by its own
// distance from the camera, and hides past the draw distance. Three.js culls
// each instance against the view (and the shadow camera) before the draw.
//
// Before, each 50 m tile was one merged mesh per LOD, and the tile center
// picked the LOD for the whole tile. Thus a prop up to 35 m past the LOD
// distance showed its detailed shape.

// Pure: the LOD of a prop at `distance` (m) from the camera: 0, 1, or -1
// (hidden).
export function propLodFor(distance, lod0Distance, drawDistance) {
  if (!(distance < drawDistance)) return -1;
  return distance < lod0Distance ? 0 : 1;
}

// Pure: the 4x4 column-major matrix of a placement (the same transform as
// placeTemplate() in src/level/geo/extrude.js): scale, then a yaw about +y
// (a positive yaw turns +x toward -z), then the move to (x, y, z).
export function placementMatrix({ x = 0, y = 0, z = 0, yaw = 0, scale = 1 }) {
  const c = Math.cos(yaw) * scale;
  const s = Math.sin(yaw) * scale;
  return [c, 0, -s, 0, 0, scale, 0, 0, s, 0, c, 0, x, y, z, 1];
}

// A template ({ positions, indices, colors, normals?, sway?, leaf? }) as a
// geometry with the attribute set that the batch needs: position, normal,
// color, sway, leaf, fade, and an index. `fade` is 1 on the near shape and 2
// on the far shape of a kind that cross fades (leaf-cut.js), else 0.
export function templateGeometry(t, fade = 0) {
  const geom = new THREE.BufferGeometry();
  const count = t.positions.length / 3;
  geom.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(t.positions), 3));
  geom.setAttribute("color", new THREE.BufferAttribute(t.colors ? Float32Array.from(t.colors) : new Float32Array(count * 3).fill(1), 3));
  geom.setAttribute("sway", new THREE.BufferAttribute(t.sway ? Float32Array.from(t.sway) : new Float32Array(count), 1));
  // The leaf cards of a tree (trees.js): [u, v, seed]. Seed 0 is "not a card".
  geom.setAttribute("leaf", new THREE.BufferAttribute(t.leaf ? Float32Array.from(t.leaf) : new Float32Array(count * 3), 3));
  geom.setAttribute("fade", new THREE.BufferAttribute(new Float32Array(count).fill(fade), 1));
  geom.setIndex(new THREE.BufferAttribute(Uint32Array.from(t.indices), 1));
  if (t.normals) geom.setAttribute("normal", new THREE.BufferAttribute(Float32Array.from(t.normals), 3));
  else geom.computeVertexNormals();
  return geom;
}

// Pure: the shapes of a cross-fading prop at `distance` (m): [near, far]
// visible. Both show over the fade band [lod0Distance - band, lod0Distance).
export function fadeLodsFor(distance, lod0Distance, drawDistance, band) {
  if (!(distance < drawDistance)) return [false, false];
  return [distance < lod0Distance, distance >= lod0Distance - band];
}

// placements: [{ kind, x, y, z, yaw, scale }]. templates: { kind, `${kind}_lod1` }.
// A placement with no template is left out. `fade` ({ band, kinds }) gives
// each placement of those kinds (with a LOD1) two instances, near and far,
// shown together over the band, where the shader dithers one into the other.
// `tint(p)` gives a placement its own color ([r, g, b] times the template
// colors), or null.
export function createPropBatch(placements, templates, material, { lod0Distance, drawDistance, fade = null, tint = null }) {
  const fading = new Set(fade ? fade.kinds.filter((k) => templates[k] && templates[`${k}_lod1`]) : []);
  const kinds = [...new Set(placements.map((p) => p.kind))].filter((k) => templates[k]).sort();
  const geoms = new Map();
  let vertices = 0;
  let indices = 0;
  for (const kind of kinds) {
    // A kind with no LOD1 template shows its one shape at both levels.
    const f = fading.has(kind);
    const pair = [templates[kind], templates[`${kind}_lod1`]].filter(Boolean).map((t, i) => templateGeometry(t, f ? i + 1 : 0));
    for (const g of pair) {
      vertices += g.attributes.position.count;
      indices += g.index.count;
    }
    geoms.set(kind, pair);
  }
  const used = placements.filter((p) => templates[p.kind]);
  const instanceCount = used.reduce((n, p) => n + (fading.has(p.kind) ? 2 : 1), 0);
  const mesh = new THREE.BatchedMesh(instanceCount, vertices, indices, material);
  mesh.name = "props";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const ids = new Map();
  for (const [kind, pair] of geoms) {
    const [g0, g1 = g0] = pair.map((g) => mesh.addGeometry(g));
    ids.set(kind, [g0, g1]);
  }
  const lodIds = new Int32Array(used.length * 2);
  // The instance of each placement, and its far instance (-1 for none).
  const inst = new Int32Array(used.length * 2).fill(-1);
  const xz = new Float32Array(used.length * 2);
  const state = new Int8Array(used.length).fill(-2);
  const m = new THREE.Matrix4();
  const color = new THREE.Color();
  used.forEach((p, i) => {
    const [g0, g1] = ids.get(p.kind);
    lodIds[i * 2] = g0;
    lodIds[i * 2 + 1] = g1;
    xz[i * 2] = p.x;
    xz[i * 2 + 1] = p.z;
    m.fromArray(placementMatrix(p));
    const c = tint ? tint(p) : null;
    const pairIds = fading.has(p.kind) ? [g0, g1] : [g1];
    pairIds.forEach((g, k) => {
      const id = mesh.addInstance(g);
      inst[i * 2 + k] = id;
      mesh.setMatrixAt(id, m);
      mesh.setVisibleAt(id, false);
      if (c) mesh.setColorAt(id, color.setRGB(c[0], c[1], c[2]));
    });
  });
  // The bounds of the whole batch, for the culling of the batch itself.
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  for (const pair of geoms.values()) for (const g of pair) g.dispose();

  const band = fade?.band ?? 0;
  const info = { instances: used.length, kinds: kinds.length, drawn: 0, lod0: 0, fading: 0 };
  return {
    mesh,
    info,
    // Sets the LOD and the visibility of each prop for a camera position.
    // Only a changed instance is written.
    update(cameraPosition) {
      let drawn = 0;
      let lod0 = 0;
      let both = 0;
      const cx = cameraPosition.x;
      const cz = cameraPosition.z;
      for (let i = 0; i < used.length; i += 1) {
        const d = Math.hypot(xz[i * 2] - cx, xz[i * 2 + 1] - cz);
        const far = inst[i * 2 + 1];
        if (far >= 0) {
          const [a, b] = fadeLodsFor(d, lod0Distance, drawDistance, band);
          if (a || b) drawn += 1;
          if (a) lod0 += 1;
          if (a && b) both += 1;
          const s = (a ? 1 : 0) | (b ? 2 : 0);
          if (s === state[i]) continue;
          mesh.setVisibleAt(inst[i * 2], a);
          mesh.setVisibleAt(far, b);
          state[i] = s;
          continue;
        }
        const lod = propLodFor(d, lod0Distance, drawDistance);
        if (lod >= 0) drawn += 1;
        if (lod === 0) lod0 += 1;
        if (lod === state[i]) continue;
        const id = inst[i * 2];
        if (lod < 0) mesh.setVisibleAt(id, false);
        else {
          mesh.setGeometryIdAt(id, lodIds[i * 2 + lod]);
          mesh.setVisibleAt(id, true);
        }
        state[i] = lod;
      }
      info.drawn = drawn;
      info.lod0 = lod0;
      info.fading = both;
    },
  };
}
