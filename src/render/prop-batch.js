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

// A template ({ positions, indices, colors, normals?, sway? }) as a
// geometry with the attribute set that the batch needs: position, normal,
// color, sway, and an index.
export function templateGeometry(t) {
  const geom = new THREE.BufferGeometry();
  const count = t.positions.length / 3;
  geom.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(t.positions), 3));
  geom.setAttribute("color", new THREE.BufferAttribute(t.colors ? Float32Array.from(t.colors) : new Float32Array(count * 3).fill(1), 3));
  geom.setAttribute("sway", new THREE.BufferAttribute(t.sway ? Float32Array.from(t.sway) : new Float32Array(count), 1));
  geom.setIndex(new THREE.BufferAttribute(Uint32Array.from(t.indices), 1));
  if (t.normals) geom.setAttribute("normal", new THREE.BufferAttribute(Float32Array.from(t.normals), 3));
  else geom.computeVertexNormals();
  return geom;
}

// placements: [{ kind, x, y, z, yaw, scale }]. templates: { kind, `${kind}_lod1` }.
// A placement with no template is left out.
export function createPropBatch(placements, templates, material, { lod0Distance, drawDistance }) {
  const kinds = [...new Set(placements.map((p) => p.kind))].filter((k) => templates[k]).sort();
  const geoms = new Map();
  let vertices = 0;
  let indices = 0;
  for (const kind of kinds) {
    // A kind with no LOD1 template shows its one shape at both levels.
    const pair = [templates[kind], templates[`${kind}_lod1`]].filter(Boolean).map(templateGeometry);
    for (const g of pair) {
      vertices += g.attributes.position.count;
      indices += g.index.count;
    }
    geoms.set(kind, pair);
  }
  const used = placements.filter((p) => templates[p.kind]);
  const mesh = new THREE.BatchedMesh(used.length, vertices, indices, material);
  mesh.name = "props";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const ids = new Map();
  for (const [kind, pair] of geoms) {
    const [g0, g1 = g0] = pair.map((g) => mesh.addGeometry(g));
    ids.set(kind, [g0, g1]);
  }
  const lodIds = new Int32Array(used.length * 2);
  const xz = new Float32Array(used.length * 2);
  const state = new Int8Array(used.length).fill(-2);
  const m = new THREE.Matrix4();
  used.forEach((p, i) => {
    const [g0, g1] = ids.get(p.kind);
    lodIds[i * 2] = g0;
    lodIds[i * 2 + 1] = g1;
    xz[i * 2] = p.x;
    xz[i * 2 + 1] = p.z;
    const id = mesh.addInstance(g1);
    m.fromArray(placementMatrix(p));
    mesh.setMatrixAt(id, m);
    mesh.setVisibleAt(id, false);
  });
  // The bounds of the whole batch, for the culling of the batch itself.
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  for (const pair of geoms.values()) for (const g of pair) g.dispose();

  const info = { instances: used.length, kinds: kinds.length, drawn: 0, lod0: 0 };
  return {
    mesh,
    info,
    // Sets the LOD and the visibility of each prop for a camera position.
    // Only a changed instance is written.
    update(cameraPosition) {
      let drawn = 0;
      let lod0 = 0;
      const cx = cameraPosition.x;
      const cz = cameraPosition.z;
      for (let i = 0; i < used.length; i += 1) {
        const lod = propLodFor(Math.hypot(xz[i * 2] - cx, xz[i * 2 + 1] - cz), lod0Distance, drawDistance);
        if (lod >= 0) drawn += 1;
        if (lod === 0) lod0 += 1;
        if (lod === state[i]) continue;
        if (lod < 0) mesh.setVisibleAt(i, false);
        else {
          mesh.setGeometryIdAt(i, lodIds[i * 2 + lod]);
          mesh.setVisibleAt(i, true);
        }
        state[i] = lod;
      }
      info.drawn = drawn;
      info.lod0 = lod0;
    },
  };
}
