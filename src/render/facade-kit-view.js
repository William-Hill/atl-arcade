// The Blender facade kit (assets/facades/facade-kit.glb) in the pbr look: one
// BatchedMesh holds every module of the level (one draw call; all the nodes
// share the kit material), culled by building: a building shows its modules
// closer than DEPTH_DISTANCE (with the procedural depth tiles), the
// `<module>_lod1` nodes (or farGeometry()) past LOD1_DISTANCE, the small trim (TRIM) only
// closer than TRIM_DISTANCE. The glass panes of the windows and shop glass
// are cut out of the nodes, so the facade shader's rooms show through.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { getDracoLoader } from "./skater-model.js";
import { LOD1, LOD1_DISTANCE, instanceMatrix } from "../../scripts/assets/facade-kit-placement.js";

export const FACADE_KIT_URL = new URL("../../assets/facades/facade-kit.glb", import.meta.url).href;

// The small modules, drawn only near a building (m).
export const TRIM_DISTANCE = 35;
export const TRIM = new Set(["ac_unit_wall", "trim_downspout", "trim_downspout_head", "trim_downspout_shoe", "trim_gooseneck_lamp", "trim_pilaster_cap", "hvac_condenser", "roof_vent", "roof_exhaust", "fire_escape_ladder"]);
// The atlas strip of the glass (docs/facade-kit.md: rows 762-858 px, from the
// top), and the nodes whose glass is cut.
const GLASS_V = [762 / 1024, 858 / 1024];
const CUT_GLASS = /^(window_|storefront_glass_)/;

// The mesh nodes of the kit, by name.
export async function loadFacadeKit(url = FACADE_KIT_URL) {
  const loader = new GLTFLoader().setDRACOLoader(getDracoLoader());
  const gltf = await loader.loadAsync(url);
  const nodes = new Map();
  gltf.scene.traverse((o) => o.isMesh && nodes.set(o.name, o));
  return nodes;
}

function trianglesOf(geometry) {
  return (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
}

// The geometry with the triangles that `keep(a, b, c)` (vertex indices) accepts.
function filterTriangles(geometry, keep) {
  const g = geometry.index ? geometry : geometry.toNonIndexed();
  const src = g.index ? g.index.array : null;
  const n = g.index ? g.index.count : g.attributes.position.count;
  const kept = [];
  for (let t = 0; t < n; t += 3) {
    const tri = src ? [src[t], src[t + 1], src[t + 2]] : [t, t + 1, t + 2];
    if (keep(...tri)) kept.push(...tri);
  }
  const out = g.clone();
  out.setIndex(kept);
  return out;
}

// The geometry without the triangles in the glass strip of the atlas.
export function withoutGlass(geometry) {
  const uv = geometry.attributes.uv;
  const inGlass = (i) => {
    const v = 1 - uv.getY(i);
    return v >= GLASS_V[0] - 1e-4 && v <= GLASS_V[1] + 1e-4;
  };
  return filterTriangles(geometry, (a, b, c) => !(inGlass(a) && inGlass(b) && inGlass(c)));
}

// The far version of a module without a `_lod1` node: its faces toward the
// street (+z) and its large horizontal faces (sills, heads, slabs). The side
// faces of frames and mullions are a few pixels past LOD1_DISTANCE.
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
export function farGeometry(geometry) {
  const p = geometry.attributes.position;
  return filterTriangles(geometry, (a, b, c) => {
    _a.fromBufferAttribute(p, a);
    _b.fromBufferAttribute(p, b).sub(_a);
    _c.fromBufferAttribute(p, c).sub(_a);
    const n = _b.cross(_c);
    const area = n.length() / 2;
    if (area === 0) return false;
    n.divideScalar(area * 2);
    return n.z > 0.7 || (Math.abs(n.y) > 0.7 && area > 0.02);
  });
}

// `buildings`: facadeKitPlacements().buildings. `names`: shop names on the GLB
// sign boards, { mesh, ids: one instance id per board of each building, in
// order } (shop-names.js boardNamesBatch()). update(cameraPosition) shows and
// hides by building; `info` has the counts of the last update (triangles
// before the per-instance frustum culling).
export function createFacadeKitView(nodes, buildings, { depthDistance = 120, lod1Distance = LOD1_DISTANCE, trimDistance = TRIM_DISTANCE, names = null } = {}) {
  const geometries = new Map();
  const geometryOf = (name) => {
    if (!geometries.has(name)) {
      const node = nodes.get(name);
      geometries.set(name, node ? (CUT_GLASS.test(name) ? withoutGlass(node.geometry) : node.geometry) : null);
    }
    return geometries.get(name);
  };
  let count = 0;
  for (const b of buildings) for (const it of b.list) if (geometryOf(it.module)) count += 1;
  // The far geometry of a module: its `_lod1` node, or farGeometry() when that
  // saves a third of the triangles (none for TRIM, which is gone by then).
  const far = new Map();
  for (const [m, g] of [...geometries]) {
    if (!g || TRIM.has(m)) continue;
    if (LOD1.has(m)) {
      if (geometryOf(`${m}_lod1`)) far.set(m, `${m}_lod1`);
      continue;
    }
    const f = farGeometry(g);
    if (trianglesOf(f) <= trianglesOf(g) * 0.67) {
      geometries.set(`${m}_far`, f);
      far.set(m, `${m}_far`);
    }
  }
  const used = [...geometries].filter(([, g]) => g);
  const material = nodes.values().next().value?.material;
  const vertices = used.reduce((s, [, g]) => s + g.attributes.position.count, 0);
  const indices = used.reduce((s, [, g]) => s + g.index.count, 0);
  const batch = new THREE.BatchedMesh(Math.max(count, 1), Math.max(vertices, 1), Math.max(indices, 1), material);
  batch.name = "facade-kit-glb";
  batch.sortObjects = false;
  const ids = new Map(used.map(([name, g]) => [name, { id: batch.addGeometry(g), triangles: trianglesOf(g) }]));

  const root = new THREE.Group();
  root.name = "facade-kit-glb";
  root.add(batch);
  if (names) root.add(names.mesh);
  const m4 = new THREE.Matrix4();
  const color = new THREE.Color();
  const view = [];
  let boardIndex = 0;
  for (const b of buildings) {
    const items = [];
    for (const it of b.list) {
      const g0 = ids.get(it.module);
      if (!g0) continue;
      const g1 = far.has(it.module) ? ids.get(far.get(it.module)) : null;
      const id = batch.addInstance(g0.id);
      batch.setMatrixAt(id, m4.fromArray(instanceMatrix(it)));
      if (it.color) color.setRGB(it.color[0], it.color[1], it.color[2], THREE.SRGBColorSpace);
      else color.setRGB(1, 1, 1);
      batch.setColorAt(id, color);
      batch.setVisibleAt(id, false);
      items.push({ id, g0, g1, trim: TRIM.has(it.module) });
    }
    const boards = names ? names.ids.slice(boardIndex, boardIndex + b.boards.length) : [];
    boardIndex += b.boards.length;
    view.push({ center: b.center, radius: b.radius, items, boards, state: 0, triangles: 0, shown: 0 });
  }
  if (names) for (const id of names.ids) names.mesh.setVisibleAt(id, false);
  // State of a building: 0 hidden, 1 far (far geometry, no trim), 2 far with
  // trim, 3 near, 4 near without trim (when trimDistance < lod1Distance).
  const stateAt = (d) => (d >= depthDistance ? 0 : d >= Math.max(lod1Distance, trimDistance) ? 1 : d >= lod1Distance ? 2 : d >= trimDistance ? 4 : 3);
  const info = { buildings: view.length, instances: count, near: 0, lod1: 0, shown: 0, drawCalls: 0, triangles: 0 };
  let triangles = 0;
  let shown = 0;
  let boardsShown = 0;
  const apply = (t, state) => {
    const visible = state !== 0;
    const lod1 = state === 1 || state === 2;
    const trim = state === 2 || state === 3;
    let tris = 0;
    let n = 0;
    for (const it of t.items) {
      const on = visible && (!it.trim || trim);
      batch.setVisibleAt(it.id, on);
      const g = lod1 && it.g1 ? it.g1 : it.g0;
      if (it.g1) batch.setGeometryIdAt(it.id, g.id);
      if (on) { tris += g.triangles; n += 1; }
    }
    for (const id of t.boards) names.mesh.setVisibleAt(id, visible);
    boardsShown += (visible ? t.boards.length : 0) - (t.state !== 0 ? t.boards.length : 0);
    triangles += tris - t.triangles;
    shown += n - t.shown;
    Object.assign(t, { state, triangles: tris, shown: n });
  };
  return {
    root,
    info,
    update(cameraPosition) {
      let near = 0;
      let lod1 = 0;
      for (const t of view) {
        const d = Math.max(0, Math.hypot(t.center[0] - cameraPosition.x, t.center[1] - cameraPosition.z) - t.radius);
        const state = stateAt(d);
        if (state !== t.state) apply(t, state);
        if (state !== 0) near += 1;
        if (state === 1 || state === 2) lod1 += 1;
      }
      Object.assign(info, { near, lod1, shown, drawCalls: (shown > 0 ? 1 : 0) + (boardsShown > 0 ? 1 : 0), triangles: triangles + boardsShown * 2 });
    },
  };
}
