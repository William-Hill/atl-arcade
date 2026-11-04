import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import dracoWrapperUrl from "three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url";
import dracoWasmUrl from "three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url";
import { attachFace } from "./skater-face.js";

// The shipped skater models. Vite bundles each GLB as an asset.
export const SKATER_MODELS = {
  nia: new URL("../../assets/skaters/nia/skater.glb", import.meta.url).href,
  marcus: new URL("../../assets/skaters/marcus/skater.glb", import.meta.url).href,
};

// The same models with a 1024 px base color in place of 2048 px, for a phone
// (#74). The mesh, the rig, and the clips are the same.
export const SKATER_MODELS_SMALL = {
  nia: new URL("../../assets/skaters/nia/skater-1024.glb", import.meta.url).href,
  marcus: new URL("../../assets/skaters/marcus/skater-1024.glb", import.meta.url).href,
};

// Pure: the model URL for a skater. `small` picks the 1024 px variant.
export function skaterModelUrl(name, { small = false } = {}) {
  return (small ? SKATER_MODELS_SMALL[name] : null) ?? SKATER_MODELS[name] ?? null;
}

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

// Starts the download of a skater GLB at once (#74), so that it runs in
// parallel with the level load. loadSkaterModel() takes the promise.
// `onProgress(loaded, total)` reports the bytes.
export function fetchSkaterModel(name = "nia", onProgress = null, { small = false } = {}) {
  const url = skaterModelUrl(name, { small });
  if (!url) return Promise.reject(new Error(`Unknown skater model: ${name}`));
  return fetch(url).then(async (res) => {
    if (!res.ok) throw new Error(`Skater model ${name}: HTTP ${res.status}`);
    const total = Number(res.headers.get("content-length")) || 0;
    if (!onProgress || !res.body) return res.arrayBuffer();
    const reader = res.body.getReader();
    const parts = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      loaded += value.length;
      onProgress(loaded, total);
    }
    const out = new Uint8Array(loaded);
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out.buffer;
  });
}

// One parse for each skater GLB (#134). The player and the NPC skaters
// share it. `pristine` is a clone of the scene, made before the player
// model changes its materials, so an NPC clone starts from the GLB as it
// is. The clones share the geometry, the textures, and the clips.
const parsed = new Map();

// Parses a skater GLB once. Returns a promise of { gltf, pristine }.
// `bytes` is an optional promise from fetchSkaterModel().
export function parseSkaterGltf(name = "nia", bytes = null) {
  if (parsed.has(name)) return parsed.get(name);
  const url = SKATER_MODELS[name];
  if (!url) return Promise.reject(new Error(`Unknown skater model: ${name}`));
  const loader = new GLTFLoader();
  loader.setDRACOLoader(getDracoLoader());
  const promise = (async () => {
    const gltf = bytes ? await loader.parseAsync(await bytes, url.slice(0, url.lastIndexOf("/") + 1)) : await loader.loadAsync(url);
    return { gltf, pristine: cloneSkinned(gltf.scene) };
  })();
  parsed.set(name, promise);
  // A failed parse may try again later.
  promise.catch(() => parsed.delete(name));
  return promise;
}

// A new copy of a skater for an NPC: its own skeleton, and the shared
// geometry, materials, and clips. Returns the same shape as
// loadSkaterModel(), with no face decals.
export async function cloneSkaterModel(name = "nia", bytes = null) {
  const { gltf, pristine } = await parseSkaterGltf(name, bytes);
  const scene = cloneSkinned(pristine);
  let skinnedMesh = null;
  scene.traverse((o) => {
    if (o.isSkinnedMesh && !skinnedMesh) skinnedMesh = o;
    if (o.isMesh) o.castShadow = true;
  });
  if (!skinnedMesh) throw new Error(`Skater model ${name} has no skinned mesh`);
  return { root: wrapModel(scene), skinnedMesh, animations: gltf.animations, face: null };
}

// Loads a skater GLB. Returns the wrapper, the skinned mesh, the clips, and
// the face (null when the skater has no face decals). `bytes` is an optional
// promise from fetchSkaterModel().
export async function loadSkaterModel(name = "nia", bytes = null) {
  const { gltf, pristine } = await parseSkaterGltf(name, bytes);
  // A second load of the same skater takes a fresh clone, because the
  // first load changed the scene.
  const scene = gltf.userData.taken ? cloneSkinned(pristine) : gltf.scene;
  gltf.userData.taken = true;
  let skinnedMesh = null;
  scene.traverse((o) => {
    if (o.isSkinnedMesh && !skinnedMesh) skinnedMesh = o;
    if (o.isMesh) o.castShadow = true;
  });
  if (!skinnedMesh) throw new Error(`Skater model ${name} has no skinned mesh`);
  // The face decals are a bonus: if one fails to load, keep the model with
  // its painted face rather than drop to the capsule.
  let face = null;
  try {
    face = await attachFace(skinnedMesh, name);
  } catch (err) {
    console.warn(`Skater ${name}: no face decals (${err?.message ?? err})`);
  }
  return { root: wrapModel(scene), skinnedMesh, animations: gltf.animations, face };
}
