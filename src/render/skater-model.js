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

// The LOD1 models for far NPC skaters (#280): about 3,000 triangles in place
// of about 18,000, made by scripts/skater-lod.mjs. A LOD1 file holds only
// the simplified skinned mesh and the skin (the same 65 joints, in the same
// order) with vertex colors. It has no textures and no clips: the game binds
// the LOD1 mesh to the skeleton of the LOD0 clone, so the LOD0 clips move it.
export const SKATER_MODELS_LOD1 = {
  nia: new URL("../../assets/skaters/nia/skater-lod1.glb", import.meta.url).href,
  marcus: new URL("../../assets/skaters/marcus/skater-lod1.glb", import.meta.url).href,
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

// One parse for each LOD1 GLB. Returns a promise of { geometry, joints }:
// the LOD1 geometry and the joint names of its skin, in skin order.
const parsedLod1 = new Map();
export function parseSkaterLod1(name = "nia") {
  if (parsedLod1.has(name)) return parsedLod1.get(name);
  const url = SKATER_MODELS_LOD1[name];
  if (!url) return Promise.reject(new Error(`No LOD1 skater model: ${name}`));
  const loader = new GLTFLoader();
  loader.setDRACOLoader(getDracoLoader());
  const promise = loader.loadAsync(url).then((gltf) => {
    let mesh = null;
    gltf.scene.traverse((o) => {
      if (o.isSkinnedMesh && !mesh) mesh = o;
    });
    if (!mesh) throw new Error(`LOD1 skater model ${name} has no skinned mesh`);
    return { geometry: mesh.geometry, joints: mesh.skeleton.bones.map((b) => b.name) };
  });
  parsedLod1.set(name, promise);
  promise.catch(() => parsedLod1.delete(name));
  return promise;
}

// Pure: true when the LOD1 skin has the same joints, in the same order, as
// the LOD0 skin. Only then can the LOD1 mesh use the LOD0 skeleton.
export function sameJoints(a, b) {
  return a.length === b.length && a.every((name, i) => name === b[i]);
}

// The LOD1 material: the LOD0 material with the vertex colors of the LOD1
// mesh in place of the textures (scripts/skater-lod.mjs bakes the base
// color texture into the vertex colors). A LOD1 mesh with UVs keeps the
// LOD0 material.
export function lod1Material(source, geometry) {
  if (!geometry.attributes.color) return source;
  const mat = source.clone();
  mat.name = `${source.name || "skater"}-lod1`;
  for (const key of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap"]) if (key in mat) mat[key] = null;
  mat.vertexColors = true;
  return mat;
}

// Adds the LOD1 mesh to a cloned skater: a skinned mesh with the LOD1
// geometry, the LOD1 material, and the LOD0 skeleton. Thus the same mixer
// moves both meshes. The LOD1 mesh starts hidden. Returns the LOD1 mesh.
export function addLod1Mesh(skinnedMesh, lod1) {
  const joints = skinnedMesh.skeleton.bones.map((b) => b.name);
  if (!sameJoints(lod1.joints, joints)) throw new Error("The LOD1 skin has other joints than the LOD0 skin");
  const mesh = new THREE.SkinnedMesh(lod1.geometry, lod1Material(skinnedMesh.material, lod1.geometry));
  mesh.name = `${skinnedMesh.name || "skater"}-lod1`;
  mesh.position.copy(skinnedMesh.position);
  mesh.quaternion.copy(skinnedMesh.quaternion);
  mesh.scale.copy(skinnedMesh.scale);
  mesh.castShadow = skinnedMesh.castShadow;
  mesh.frustumCulled = skinnedMesh.frustumCulled;
  mesh.bind(skinnedMesh.skeleton, skinnedMesh.bindMatrix);
  mesh.visible = false;
  skinnedMesh.parent.add(mesh);
  return mesh;
}

// A new copy of a skater for an NPC: its own skeleton, and the shared
// geometry, materials, and clips. Returns the same shape as
// loadSkaterModel(), with no face decals. With `lod1: true`, `lod1Mesh` is
// the LOD1 mesh (addLod1Mesh()), or null when the LOD1 model fails to load:
// then the NPC uses the full model at all distances.
export async function cloneSkaterModel(name = "nia", bytes = null, { lod1 = false } = {}) {
  const lod1Promise = lod1 ? parseSkaterLod1(name).catch((err) => (console.warn(`Skater ${name}: no LOD1 (${err?.message ?? err})`), null)) : null;
  const { gltf, pristine } = await parseSkaterGltf(name, bytes);
  const scene = cloneSkinned(pristine);
  let skinnedMesh = null;
  scene.traverse((o) => {
    if (o.isSkinnedMesh && !skinnedMesh) skinnedMesh = o;
    if (o.isMesh) o.castShadow = true;
  });
  if (!skinnedMesh) throw new Error(`Skater model ${name} has no skinned mesh`);
  const lod1Data = lod1Promise ? await lod1Promise : null;
  let lod1Mesh = null;
  if (lod1Data) {
    try {
      lod1Mesh = addLod1Mesh(skinnedMesh, lod1Data);
    } catch (err) {
      console.warn(`Skater ${name}: no LOD1 (${err?.message ?? err})`);
    }
  }
  return { root: wrapModel(scene), skinnedMesh, lod1Mesh, animations: gltf.animations, face: null };
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
