import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { getDracoLoader } from "./skater-model.js";

// The Meshy street furniture and BeltLine props (assets/props/street/,
// assets/props/beltline/; docs/people-props.md) at the placements of
// src/level/geo/props.js (the drinking fountains and bollards of the OSM
// furniture, the BeltLine stops along the trail). They are textured PBR
// GLBs, not kit props, so the kit batch skips them and this view draws
// them: per kind one InstancedMesh per mesh of each LOD (<kind>_lod0 with
// its child parts, <kind>_lod1), refilled when the camera moves. The parked
// bikes and scooters stay still: their wheel nodes are drawn at rest.

export const MESHY_PROP_URLS = {
  drinking_fountain: new URL("../../assets/props/street/drinking_fountain.glb", import.meta.url).href,
  bollard: new URL("../../assets/props/street/bollard.glb", import.meta.url).href,
  picnic_table: new URL("../../assets/props/beltline/picnic_table.glb", import.meta.url).href,
  patio_umbrella: new URL("../../assets/props/beltline/patio_umbrella.glb", import.meta.url).href,
  food_cart: new URL("../../assets/props/beltline/food_cart.glb", import.meta.url).href,
  bike_dock: new URL("../../assets/props/beltline/bike_dock.glb", import.meta.url).href,
  city_bike: new URL("../../assets/props/beltline/city_bike.glb", import.meta.url).href,
  e_scooter: new URL("../../assets/props/beltline/e_scooter.glb", import.meta.url).href,
  sculpture_ribbon: new URL("../../assets/props/beltline/sculpture_ribbon.glb", import.meta.url).href,
};

// Past this distance (m) from the camera a prop is not drawn (the kit props'
// PROP_DRAW_DISTANCE is 200; these are small).
export const MESHY_PROP_DRAW = 160;
// The camera moves this far (m) before the instances are refilled.
const REFILL_STEP = 2;

// Pure: the LOD (0, 1) of a prop `d` m away whose lod1 starts at `lod1` m,
// or -1 past `draw`.
export function meshyPropLod(d, lod1, draw = MESHY_PROP_DRAW) {
  if (!(d < draw)) return -1;
  return d >= lod1 ? 1 : 0;
}

// The placement matrix of a prop ({ x, y, z, yaw, scale }).
function placement(p, m) {
  const s = p.scale ?? 1;
  return m.compose(new THREE.Vector3(p.x, p.y ?? 0, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw ?? 0), new THREE.Vector3(s, s, s));
}

export function createMeshyPropsView(props, { urls = MESHY_PROP_URLS } = {}) {
  const group = new THREE.Group();
  group.name = "meshy-props";
  const byKind = new Map();
  for (const p of props) if (urls[p.kind] && !p.roof) (byKind.get(p.kind) ?? byKind.set(p.kind, []).get(p.kind)).push(p);
  const kinds = [];
  const stats = { kinds: byKind.size, placed: [...byKind.values()].reduce((n, l) => n + l.length, 0), loaded: 0, drawn: 0, drawCalls: 0, triangles: 0, error: null };
  const loader = new GLTFLoader();
  loader.setDRACOLoader(getDracoLoader());
  const ready = Promise.all(
    [...byKind].map(async ([kind, list]) => {
      const gltf = await loader.loadAsync(urls[kind]);
      gltf.scene.updateMatrixWorld(true);
      const levels = [0, 1].map((lod) => {
        const node = gltf.scene.getObjectByName(`${kind}_lod${lod}`);
        if (!node) return null;
        const parts = [];
        node.traverse((o) => {
          if (!o.isMesh) return;
          const mesh = new THREE.InstancedMesh(o.geometry, o.material, list.length);
          mesh.name = `meshy-prop-${o.name}`;
          mesh.castShadow = mesh.receiveShadow = true;
          // The instances spread over the level; the template bounds would
          // cull them wrongly.
          mesh.frustumCulled = false;
          mesh.count = 0;
          mesh.visible = false;
          group.add(mesh);
          parts.push({ mesh, local: o.matrixWorld.clone() });
        });
        return { parts, distance: node.userData.lodDistance ?? (lod ? 20 : 0) };
      });
      kinds.push({ kind, list, levels, matrices: list.map((p) => placement(p, new THREE.Matrix4())) });
      stats.loaded += 1;
      last = null;
    }),
  ).catch((err) => {
    stats.error = String(err);
    throw err;
  });
  let last = null;
  const m = new THREE.Matrix4();
  return {
    group,
    ready,
    stats,
    update(camera) {
      if (last && last.distanceTo(camera) < REFILL_STEP) return;
      last = camera.clone();
      stats.drawn = stats.drawCalls = stats.triangles = 0;
      for (const { list, levels, matrices } of kinds) {
        for (const l of levels) if (l) for (const part of l.parts) part.mesh.count = 0;
        list.forEach((p, i) => {
          const d = Math.hypot(p.x - camera.x, (p.y ?? 0) - camera.y, p.z - camera.z);
          let lod = meshyPropLod(d, levels[1]?.distance ?? Infinity);
          if (lod === 1 && !levels[1]) lod = 0;
          if (lod < 0) return;
          stats.drawn += 1;
          for (const part of levels[lod].parts) {
            m.multiplyMatrices(matrices[i], part.local);
            part.mesh.setMatrixAt(part.mesh.count, m);
            part.mesh.count += 1;
          }
        });
        for (const l of levels) {
          if (!l) continue;
          for (const { mesh } of l.parts) {
            mesh.visible = mesh.count > 0;
            mesh.instanceMatrix.needsUpdate = true;
            if (!mesh.visible) continue;
            stats.drawCalls += 1;
            stats.triangles += ((mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3) * mesh.count;
          }
        }
      }
    },
  };
}
