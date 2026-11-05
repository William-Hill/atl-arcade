// The Blender facade kit (assets/facades/facade-kit.glb) in the pbr look: one
// InstancedMesh per module per depth tile (src/level/geo/facade-kit-glb.js),
// shown with the procedural depth tiles (closer than DEPTH_DISTANCE), and the
// `<module>_lod1` node of a tile past LOD1_DISTANCE.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { getDracoLoader } from "./skater-model.js";
import { LOD1, LOD1_DISTANCE, byModule, instanceMatrix } from "../../scripts/assets/facade-kit-placement.js";

export const FACADE_KIT_URL = new URL("../../assets/facades/facade-kit.glb", import.meta.url).href;

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

// `tiles`: facadeKitPlacements().tiles. update() returns nothing; `info` has
// the tile, instance, draw call, and triangle counts of the last update.
export function createFacadeKitView(nodes, tiles, { depthDistance = 120, lod1Distance = LOD1_DISTANCE } = {}) {
  const root = new THREE.Group();
  root.name = "facade-kit-glb";
  const m4 = new THREE.Matrix4();
  const color = new THREE.Color();
  const view = [];
  let instances = 0;
  const make = (node, list, name) => {
    const mesh = new THREE.InstancedMesh(node.geometry, node.material, list.length);
    mesh.name = name;
    list.forEach((it, k) => {
      mesh.setMatrixAt(k, m4.fromArray(instanceMatrix(it)));
      if (it.color) color.setRGB(it.color[0], it.color[1], it.color[2], THREE.SRGBColorSpace);
      else color.setRGB(1, 1, 1);
      mesh.setColorAt(k, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.userData.triangles = trianglesOf(node.geometry) * list.length;
    return mesh;
  };
  for (const [key, tile] of tiles) {
    const group = new THREE.Group();
    group.name = `facade-kit-${key}`;
    group.visible = false;
    const near = [];
    const far = [];
    for (const [module, list] of byModule(tile.list)) {
      const node = nodes.get(module);
      if (!node) continue;
      const lod0 = make(node, list, module);
      group.add(lod0);
      near.push(lod0);
      const lod1Node = LOD1.has(module) ? nodes.get(`${module}_lod1`) : null;
      if (lod1Node) {
        const lod1 = make(lod1Node, list, `${module}_lod1`);
        lod1.visible = false;
        group.add(lod1);
        far.push([lod0, lod1]);
      }
      instances += list.length;
    }
    root.add(group);
    view.push({ group, center: tile.center, near, far, lod1: false });
  }
  const info = { tiles: view.length, instances, near: 0, lod1: 0, drawCalls: 0, triangles: 0 };
  return {
    root,
    info,
    update(cameraPosition) {
      let near = 0;
      let lod1 = 0;
      let drawCalls = 0;
      let triangles = 0;
      for (const t of view) {
        const d = Math.hypot(t.center[0] - cameraPosition.x, t.center[1] - cameraPosition.z);
        t.group.visible = d < depthDistance;
        if (!t.group.visible) continue;
        near += 1;
        const useLod1 = d >= lod1Distance;
        if (useLod1) lod1 += 1;
        for (const [a, b] of t.far) {
          a.visible = !useLod1;
          b.visible = useLod1;
        }
        for (const mesh of t.group.children) {
          if (!mesh.visible) continue;
          drawCalls += 1;
          triangles += mesh.userData.triangles;
        }
      }
      Object.assign(info, { near, lod1, drawCalls, triangles });
    },
  };
}
