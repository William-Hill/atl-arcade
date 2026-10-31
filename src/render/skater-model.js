import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import dracoWrapperUrl from "three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url";
import dracoWasmUrl from "three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url";

// The shipped skater models. Vite bundles each GLB as an asset.
export const SKATER_MODELS = {
  nia: new URL("../../assets/skaters/nia/skater.glb", import.meta.url).href,
};

// The GLB faces +z (the glTF convention). The controller faces +x at yaw 0,
// so the wrapper turns the model by +90 degrees about y.
export const MODEL_YAW = Math.PI / 2;

let dracoLoader = null;

// Vite serves the Draco decoder from node_modules. No CDN.
function getDracoLoader() {
  if (!dracoLoader) {
    dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath({ js: dracoWrapperUrl, wasm: dracoWasmUrl });
  }
  return dracoLoader;
}

// Wraps a glTF scene so that it faces +x with the feet at the wrapper origin.
export function wrapModel(model) {
  const root = new THREE.Group();
  root.name = "skater-model";
  model.rotation.y = MODEL_YAW;
  root.add(model);
  return root;
}

// Loads a skater GLB. Returns the wrapper, the skinned mesh, and the clips.
export async function loadSkaterModel(name = "nia") {
  const url = SKATER_MODELS[name];
  if (!url) throw new Error(`Unknown skater model: ${name}`);
  const loader = new GLTFLoader();
  loader.setDRACOLoader(getDracoLoader());
  const gltf = await loader.loadAsync(url);
  let skinnedMesh = null;
  gltf.scene.traverse((o) => {
    if (o.isSkinnedMesh && !skinnedMesh) skinnedMesh = o;
    if (o.isMesh) o.castShadow = true;
  });
  if (!skinnedMesh) throw new Error(`Skater model ${name} has no skinned mesh`);
  return { root: wrapModel(gltf.scene), skinnedMesh, animations: gltf.animations };
}
