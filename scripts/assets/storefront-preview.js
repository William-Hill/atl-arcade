// Preview hook: places storefront GLBs into the running game scene
// (window.__atl.scene) without touching the game code. Loaded on demand by
// scripts/assets/storefront-context.mjs with a dynamic import, so it runs
// only in that harness, never in the game build. One DRACO/GLTF loader and
// one shared atlas texture for every file, as the game should load them.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import dracoWrapperUrl from "three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url";
import dracoWasmUrl from "three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url";

// plan: { dir, items: [{ name, file, x, y, z, ry, sx? , rz? }] }
export async function place(plan) {
  const scene = window.__atl.scene;
  const draco = new DRACOLoader();
  draco.setDecoderPath({ js: dracoWrapperUrl, wasm: dracoWasmUrl });
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  const files = [...new Set(plan.items.map((i) => i.file))];
  const pieces = {};
  let atlas = null;
  for (const f of files) {
    const g = await loader.loadAsync(`${plan.dir}/${f}.glb`);
    g.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = true;
      for (const k of ["map", "emissiveMap"]) {
        if (!o.material[k]) continue;
        atlas ??= o.material[k];
        o.material[k] = atlas;
      }
    });
    for (const c of g.scene.children) pieces[c.name] = c;
  }
  const group = new THREE.Group();
  group.name = "storefront-preview";
  let triangles = 0;
  for (const it of plan.items) {
    const src = pieces[it.name];
    if (!src) throw new Error(`no piece ${it.name}`);
    const o = src.clone();
    o.position.set(it.x, it.y, it.z);
    o.rotation.set(0, it.ry ?? 0, 0, "YXZ");
    if (it.tilt) o.rotateZ(it.tilt);
    if (it.sx) o.scale.x = it.sx;
    o.traverse((m) => m.isMesh && (triangles += m.geometry.index.count / 3));
    group.add(o);
  }
  scene.add(group);
  return { placed: plan.items.length, triangles, textures: atlas ? 1 : 0 };
}
