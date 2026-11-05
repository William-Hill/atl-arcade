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
// The LOD groups of a GLB scene: "<name>_lod<n>" nodes by <name> (a whole
// building, or one section of a large one), each sorted by level.
export function lodGroups(nodes) {
  const groups = new Map();
  for (const o of nodes) {
    const m = /^(.*)_lod(\d+)$/.exec(o.name);
    if (!m) continue;
    if (!groups.has(m[1])) groups.set(m[1], []);
    groups.get(m[1]).push({ level: Number(m[2]), node: o });
  }
  for (const g of groups.values()) g.sort((a, b) => a.level - b.level);
  return groups;
}

// One position-only geometry from meshes (with their matrices relative to
// `base`), for a shadow caster. Alpha-tested materials (fences) are left out.
export function mergedPositions(meshes) {
  let count = 0;
  let icount = 0;
  const parts = [];
  for (const { geometry, matrix } of meshes) {
    const pos = geometry.attributes.position;
    const idx = geometry.index;
    parts.push({ pos, idx, matrix, offset: count });
    count += pos.count;
    icount += idx ? idx.count : pos.count;
  }
  const out = new Float32Array(count * 3);
  const index = new Uint32Array(icount);
  const v = new THREE.Vector3();
  let k = 0;
  for (const { pos, idx, matrix, offset } of parts) {
    for (let i = 0; i < pos.count; i += 1) {
      v.fromBufferAttribute(pos, i);
      if (matrix) v.applyMatrix4(matrix);
      v.toArray(out, (offset + i) * 3);
    }
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i += 1) index[k++] = offset + (idx ? idx.getX(i) : i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(out, 3));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingSphere();
  return g;
}

// Window light at night, the facade rule of geo-view.js: the window's key
// (TEXCOORD_1 u, painted per window by landmarks.py) is lit when it is under
// windowLit * 0.6 (shops 0.95 are keyed lower), and the emissive map glows by
// windowLit. In the day windowLit is 0, so the windows do not glow.
export function windowLightPatch(material, lit) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uLit = lit;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\n#ifndef USE_UV1\nattribute vec2 uv1;\n#endif\nvarying float vLitKey;",
      )
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLitKey = uv1.x;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uLit;\nvarying float vLitKey;")
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= step(vLitKey, uLit * 0.6) * uLit * 1.1;",
      );
  };
  material.customProgramCacheKey = () => "landmark-window-light";
  material.needsUpdate = true;
}

// The game's window light: the uLit uniform of a facade material in the
// scene (weather-view.js sets it every frame), found once.
function facadeLit(scene) {
  let found = null;
  scene.traverse((o) => {
    if (found || !o.material) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    found = ms.find((m) => m.userData?.uLit)?.userData.uLit ?? null;
  });
  return found;
}

const SHADOW_MATERIAL = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });

export function createLandmarkModels(
  levelName,
  { keys = LANDMARK_MODEL_KEYS } = {},
) {
  const root = new THREE.Group();
  root.name = "landmark-models";
  const info = { models: 0, triangles: 0, textures: 0, sections: 0, shadowTriangles: 0 };
  const cache = new Map();
  const loader = new GLTFLoader();
  loader.setDRACOLoader(getDracoLoader());
  loader.register(sharedTextures(cache));
  const lit = { value: 0 };
  let manual = false;
  let source = null;
  let lastLook = -Infinity;
  const patched = new Set();
  const follow = (renderer, scene) => {
    if (manual) return;
    const now = performance.now();
    if (!source && now - lastLook > 2000) {
      lastLook = now;
      source = facadeLit(scene);
    }
    lit.value = source ? source.value : 0;
  };
  const ready = import("../../assets/landmarks/sites.json").then((mod) => {
    const sites = mod.default ?? mod;
    if (sites.level !== levelName) return;
    return Promise.all(
      keys.map(async (k) => {
        const site = sites.buildings[k] ?? sites.bridges[k];
        const gltf = await loader.loadAsync(URLS[k]);
        const shadowParts = [];
        for (const [name, levels] of lodGroups(gltf.scene.children)) {
          // Each group (a building, or a section of one) switches from its
          // own center: the node translation of its levels.
          const lod = new THREE.LOD();
          lod.name = `landmark-glb-${name}`;
          const at = levels[0].node.position.clone();
          for (const { node } of levels) {
            node.position.set(0, 0, 0);
            node.updateMatrix();
            // Only the shadow proxy casts: LOD0 in the shadow pass was ~28
            // calls and ~115k triangles at the PCM trail camera.
            node.traverse((m) => {
              if (!m.isMesh) return;
              m.castShadow = false;
              m.receiveShadow = true;
              const ms = Array.isArray(m.material) ? m.material : [m.material];
              for (const mat of ms)
                if (mat.emissiveMap && !patched.has(mat)) {
                  patched.add(mat);
                  windowLightPatch(mat, lit);
                  mat.onBeforeRender = follow;
                }
            });
            lod.addLevel(node, node.userData.lodDistance ?? 0);
          }
          levels[0].node.traverse((m) => {
            if (m.isMesh)
              info.triangles +=
                (m.geometry.index
                  ? m.geometry.index.count
                  : m.geometry.attributes.position.count) / 3;
          });
          // The coarsest level casts the shadow for the whole group.
          const last = levels[levels.length - 1].node;
          last.updateMatrixWorld(true);
          const shift = new THREE.Matrix4().makeTranslation(at.x, at.y, at.z);
          last.traverse((m) => {
            if (!m.isMesh) return;
            const ms = Array.isArray(m.material) ? m.material : [m.material];
            if (ms.some((x) => x.alphaTest > 0 || x.transparent)) return;
            shadowParts.push({ geometry: m.geometry, matrix: shift.clone().multiply(m.matrixWorld) });
          });
          lod.position.set(site.origin[0] + at.x, site.origin[1] + at.y, site.origin[2] + at.z);
          root.add(lod);
          info.sections += 1;
        }
        if (shadowParts.length) {
          const g = mergedPositions(shadowParts);
          const shadow = new THREE.Mesh(g, SHADOW_MATERIAL);
          shadow.name = `landmark-shadow-${k}`;
          shadow.castShadow = true;
          shadow.receiveShadow = false;
          shadow.position.set(...site.origin);
          root.add(shadow);
          info.shadowTriangles += g.index.count / 3;
        }
        info.models += 1;
      }),
    ).then(() => {
      info.textures = cache.size;
    });
  });
  // setWindowLit(v) takes over from the scene's facade value (for a caller
  // that has the weather state).
  const setWindowLit = (v) => {
    manual = true;
    lit.value = v;
  };
  return { root, info, ready, setWindowLit };
}
