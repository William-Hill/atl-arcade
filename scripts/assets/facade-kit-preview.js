// Preview only (not game code): puts the facade kit on the buildings near the
// camera in the running game, through the debug handle window.__atl.scene.
// facade-kit-preview.mjs imports this into the page; nothing in src/ does.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import dracoWrapperUrl from "three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url";
import dracoWasmUrl from "three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url";
import { loadLevel } from "../../src/level/levels.js";
import { orientRing } from "../../src/level/geo/extrude.js";
import { frontEdges } from "../../src/level/geo/facade-kit.js";
import { AWNING_COLORS, muralWalls } from "../../src/level/geo/geo-mesh.js";
import { STYLES, STYLE_INDEX, chooseStyle, hash32 } from "../../src/level/geo/styles.js";
import { buildingSpan } from "../../src/level/geo/terrain.js";
import { LOD1, LOD1_DISTANCE, byModule, facadePlacements, instanceMatrix } from "./facade-kit-placement.js";

export async function previewKit({ scene, camera, levelName = "beltline-eastside", radius = 140, file = "/assets/facades/facade-kit.glb" }) {
  const t0 = performance.now();
  const level = await loadLevel(levelName);
  const draco = new DRACOLoader();
  draco.setDecoderPath({ js: dracoWrapperUrl, wasm: dracoWasmUrl });
  const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync(file);
  const nodes = new Map();
  gltf.scene.traverse((o) => o.isMesh && nodes.set(o.name, o));
  const fronts = frontEdges(level);
  const murals = new Map(muralWalls(level).map((mw) => [mw.id, mw]));
  const eye = camera.position;
  const all = [];
  let buildings = 0;
  for (const b of level.buildings ?? []) {
    if (!(b.outer?.length >= 3)) continue;
    const [x, z] = b.outer[0];
    if (Math.hypot(x - eye.x, z - eye.z) > radius) continue;
    const style = STYLES[STYLE_INDEX[chooseStyle(b, level)]];
    const span = buildingSpan(level, b);
    const seed = hash32(String(b.id));
    const list = facadePlacements({ ring: orientRing(b.outer, false), holes: b.holes ?? [], style, base: span.base, top: span.top, front: fronts.get(b.id) ?? null, mural: murals.get(b.id) ?? null, seed });
    const trim = new THREE.Color().setRGB(...style.trim, THREE.SRGBColorSpace);
    const awning = new THREE.Color().setRGB(...AWNING_COLORS[seed % AWNING_COLORS.length], THREE.SRGBColorSpace);
    for (const it of list) all.push({ ...it, color: it.tint === "trim" ? trim : it.tint === "awning" ? awning : null });
    if (list.length) buildings += 1;
  }
  const group = new THREE.Group();
  group.name = "facade-kit-preview";
  const m4 = new THREE.Matrix4();
  const white = new THREE.Color(1, 1, 1);
  let drawCalls = 0;
  let triangles = 0;
  for (const [module, list] of byModule(all)) {
    // LOD0 near the camera, LOD1 (when the module has one) past LOD1_DISTANCE.
    const near = list.filter((it) => !LOD1.has(module) || Math.hypot(it.position[0] - eye.x, it.position[2] - eye.z) < LOD1_DISTANCE);
    const far = list.filter((it) => !near.includes(it));
    for (const [name, part] of [[module, near], [`${module}_lod1`, far]]) {
      const node = nodes.get(name);
      if (!node || !part.length) continue;
      const mesh = new THREE.InstancedMesh(node.geometry, node.material, part.length);
      part.forEach((it, k) => {
        mesh.setMatrixAt(k, m4.fromArray(instanceMatrix(it)));
        mesh.setColorAt(k, it.color ?? white);
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
      drawCalls += 1;
      triangles += (node.geometry.index.count / 3) * part.length;
    }
  }
  scene.add(group);
  return { buildings, instances: all.length, modules: byModule(all).size, drawCalls, triangles, ms: Math.round(performance.now() - t0) };
}
