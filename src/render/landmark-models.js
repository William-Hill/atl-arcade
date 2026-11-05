import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { getDracoLoader } from "./skater-model.js";
import {
  LANDMARK_GLB_BRIDGES,
  LANDMARK_GLB_BUILDINGS,
} from "../level/geo/landmarks.js";

// The Blender landmark GLBs (assets/landmarks/<key>/<key>.glb, docs/landmarks.md)
// for the PBR look: one THREE.LOD per landmark, at its site origin, from the
// `<name>_lod<n>` children and their `lodDistance`. The files embed the same
// brick, concrete, and window textures; `sharedTextures` hands every file the
// first copy of an image, so each texture is uploaded to the GPU only once.
export const LANDMARK_MODEL_KEYS = [
  ...Object.keys(LANDMARK_GLB_BUILDINGS),
  ...LANDMARK_GLB_BRIDGES,
];

const URLS = Object.fromEntries(
  LANDMARK_MODEL_KEYS.map((k) => [
    k,
    new URL(`../../assets/landmarks/${k}/${k}.glb`, import.meta.url).href,
  ]),
);

// FNV-1a over the bytes, with the length: the key of an embedded image.
export function bytesKey(buffer) {
  const bytes = new Uint8Array(buffer);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1)
    h = Math.imul(h ^ bytes[i], 0x01000193);
  return `${bytes.length}:${(h >>> 0).toString(16)}`;
}

// A GLTFLoader plugin: textures whose embedded image bytes and sampler match
// one already loaded (in any file) reuse that texture.
export function sharedTextures(cache = new Map()) {
  return (parser) => ({
    name: "ATL_shared_textures",
    loadTexture(index) {
      const def = parser.json.textures[index];
      const image = parser.json.images?.[def.source];
      if (!image || image.bufferView === undefined || def.extensions)
        return null;
      return parser
        .getDependency("bufferView", image.bufferView)
        .then((buffer) => {
          const key = `${bytesKey(buffer)}|${JSON.stringify(parser.json.samplers?.[def.sampler] ?? {})}`;
          if (!cache.has(key))
            cache.set(
              key,
              parser.loadTextureImage(index, def.source, parser.textureLoader),
            );
          return cache.get(key);
        });
    },
  });
}

// Returns { root, info, ready }. `ready` resolves when every model is placed.
// The sites are of one level (sites.json `level`); on another level, nothing.
export function createLandmarkModels(
  levelName,
  { keys = LANDMARK_MODEL_KEYS } = {},
) {
  const root = new THREE.Group();
  root.name = "landmark-models";
  const info = { models: 0, triangles: 0, textures: 0 };
  const cache = new Map();
  const loader = new GLTFLoader();
  loader.setDRACOLoader(getDracoLoader());
  loader.register(sharedTextures(cache));
  const ready = import("../../assets/landmarks/sites.json").then((mod) => {
    const sites = mod.default ?? mod;
    if (sites.level !== levelName) return;
    return Promise.all(
      keys.map(async (k) => {
        const site = sites.buildings[k] ?? sites.bridges[k];
        const gltf = await loader.loadAsync(URLS[k]);
        const lod = new THREE.LOD();
        lod.name = `landmark-glb-${k}`;
        const levels = gltf.scene.children
          .filter((o) => /_lod\d$/.test(o.name))
          .sort((a, b) => a.name.localeCompare(b.name));
        for (const o of levels) {
          o.traverse((m) => {
            if (m.isMesh) m.castShadow = m.receiveShadow = true;
          });
          lod.addLevel(o, o.userData.lodDistance ?? 0);
        }
        levels[0]?.traverse((m) => {
          if (m.isMesh)
            info.triangles +=
              (m.geometry.index
                ? m.geometry.index.count
                : m.geometry.attributes.position.count) / 3;
        });
        lod.position.set(...site.origin);
        root.add(lod);
        info.models += 1;
      }),
    ).then(() => {
      info.textures = cache.size;
    });
  });
  return { root, info, ready };
}
