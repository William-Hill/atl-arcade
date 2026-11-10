import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { getDracoLoader } from "./skater-model.js";
import { ENV_LIGHT, litMaterial } from "./look.js";

// The models of a skatepark (#222): the skate features of
// assets/skate-features at the placements of `level.skatepark`
// (src/level/skatepark.js). The pad itself is a paved area of the level
// meshes; the ground and the grind edges are in the level env.
//
// Every feature shares one trim sheet, so the whole park is one merged
// geometry and one draw call: each feature's mesh goes into world space by
// its placement. The pbr look keeps the glTF material (color, normal and
// ORM maps). The toon look takes the color map on a toon material with the
// 3-step ramp, like the level props.

const GLBS = import.meta.glob("../../assets/skate-features/*.glb", { query: "?url", import: "default", eager: true });
// The trim sheet. Each GLB names its textures by a relative path
// ("textures/skate_trim_color.jpg"), which a build breaks: Vite gives the
// GLB a hashed name or inlines it. The loader gets the built URL of each
// texture by its file name.
const TEXTURES = import.meta.glob("../../assets/skate-features/textures/*.jpg", { query: "?url", import: "default", eager: true });
// A 1 x 1 PNG: a texture that the park does not read is this pixel, not a
// download (the toon look reads the color map only).
const BLANK = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

// Pure: the URL to load for a URL that a feature GLB asks for. A trim
// texture ("skate_trim_<kind>.jpg") goes to its built URL (`textures`: file
// name to URL) when its kind is in `keep`, and to the blank pixel when it
// is not. Every other URL stays.
export function trimTextureUrl(url, textures, keep = ["color", "normal", "orm"]) {
  const m = /(?:^|\/)(skate_trim_([a-z]+)\.jpg)(?:[?#].*)?$/.exec(url);
  if (!m) return url;
  if (!keep.includes(m[2])) return BLANK;
  return textures[m[1]] ?? url;
}

const TRIM = Object.fromEntries(Object.entries(TEXTURES).map(([path, url]) => [path.split("/").pop(), url]));

// The URL of a feature file ("ramp_quarter.glb"), or null.
export function skateFeatureUrl(file, urls = GLBS) {
  return urls[`../../assets/skate-features/${file}`] ?? null;
}

// Pure: the LOD node of a feature scene. `low` picks the coarsest
// (`<id>_lod1` when the file has one), else `<id>_lod0`.
export function featureLodNode(scene, low = false) {
  const nodes = scene.children.filter((o) => /_lod\d$/.test(o.name)).sort((a, b) => a.name.localeCompare(b.name));
  if (!nodes.length) return scene;
  return low ? nodes[nodes.length - 1] : nodes[0];
}

// The placement matrix ({ position: [x, y, z], yaw }).
export function placementMatrix(p, m = new THREE.Matrix4()) {
  return m.compose(new THREE.Vector3(...p.position), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw ?? 0), new THREE.Vector3(1, 1, 1));
}

// The geometries of one placed feature in world space, with only the
// attributes that every feature has (position, normal, uv).
export function placedGeometries(node, placement) {
  const out = [];
  const world = placementMatrix(placement);
  node.updateWorldMatrix(true, true);
  const m = new THREE.Matrix4();
  node.traverse((o) => {
    if (!o.isMesh) return;
    const g = new THREE.BufferGeometry();
    for (const name of ["position", "normal", "uv"]) if (o.geometry.attributes[name]) g.setAttribute(name, o.geometry.attributes[name].clone());
    if (o.geometry.index) g.setIndex(o.geometry.index.clone());
    g.applyMatrix4(m.multiplyMatrices(world, o.matrixWorld));
    out.push(g);
  });
  return out;
}

function toonRamp() {
  const tex = new THREE.DataTexture(new Uint8Array([110, 110, 110, 255, 180, 180, 180, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// `after` (a promise) holds the downloads back until the first frame (#190).
// `low` takes the coarse LOD of a feature that has one (the phone and low tiers).
export function createSkateparkView(skatepark, { look = "toon", after = null, low = false, shadows = true, urls = GLBS, textures = TRIM } = {}) {
  const group = new THREE.Group();
  group.name = `skatepark-${skatepark.id}`;
  const files = [...new Set(skatepark.placements.map((p) => p.file))];
  const stats = { id: skatepark.id, placed: skatepark.placements.length, files: files.length, loaded: false, drawCalls: 0, triangles: 0, error: null };
  // Every file has its own copy of the one material, and the park keeps the
  // material of its first file. So only the first file loads the trim
  // sheet (the color map alone in the toon look); the other files get the
  // blank pixel for each texture.
  const loaderFor = (keep) => {
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => trimTextureUrl(url, textures, keep));
    return new GLTFLoader(manager).setDRACOLoader(getDracoLoader());
  };
  const first = loaderFor(look === "pbr" ? ["color", "normal", "orm"] : ["color"]);
  const rest = loaderFor([]);
  const ready = (async () => {
    await after;
    const scenes = new Map(
      await Promise.all(
        files.map(async (file, i) => {
          const url = skateFeatureUrl(file, urls);
          if (!url) throw new Error(`skatepark: no file for ${file}`);
          return [file, (await (i === 0 ? first : rest).loadAsync(url)).scene];
        }),
      ),
    );
    const parts = [];
    let source = null;
    const spare = new Set();
    for (const p of skatepark.placements) {
      const node = featureLodNode(scenes.get(p.file), low);
      node.traverse((o) => {
        if (!o.isMesh) return;
        if (!source) source = o.material;
        else if (o.material !== source) spare.add(o.material);
      });
      parts.push(...placedGeometries(node, p));
    }
    const indexed = parts.every((g) => g.index);
    const geometry = mergeGeometries(indexed ? parts : parts.map((g) => (g.index ? g.toNonIndexed() : g)));
    for (const g of parts) g.dispose();
    // GLTFLoader makes a material and its textures for each file: one set stays.
    for (const mat of spare) {
      for (const k of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap"]) if (mat[k] && mat[k] !== source[k]) mat[k].dispose();
      mat.dispose();
    }
    let material = source;
    if (look === "pbr") {
      material.envMapIntensity = ENV_LIGHT.props;
    } else {
      material = litMaterial(look, { map: source.map }, { gradientMap: toonRamp() });
      for (const k of ["normalMap", "roughnessMap", "metalnessMap", "aoMap"]) source[k]?.dispose();
      source.dispose();
    }
    material.name = "skate_trim";
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "skatepark-features";
    mesh.castShadow = mesh.receiveShadow = shadows;
    group.add(mesh);
    stats.loaded = true;
    stats.drawCalls = 1;
    stats.triangles = (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
  })().catch((err) => {
    stats.error = String(err);
    throw err;
  });
  return { group, ready, stats };
}
