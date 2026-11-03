import * as THREE from "three";
import brickInfo from "../../assets/landmarks/textures/brick/set.json";
import trimInfo from "../../assets/landmarks/textures/trim/set.json";
import metalInfo from "../../assets/landmarks/textures/metal/set.json";

// One static URL per file, so Vite bundles each map.
const SCANS = {
  brick: {
    info: brickInfo,
    color: new URL("../../assets/landmarks/textures/brick/color.jpg", import.meta.url).href,
    normal: new URL("../../assets/landmarks/textures/brick/normal.jpg", import.meta.url).href,
    rough: new URL("../../assets/landmarks/textures/brick/rough.jpg", import.meta.url).href,
  },
  trim: {
    info: trimInfo,
    color: new URL("../../assets/landmarks/textures/trim/color.jpg", import.meta.url).href,
    normal: new URL("../../assets/landmarks/textures/trim/normal.jpg", import.meta.url).href,
    rough: new URL("../../assets/landmarks/textures/trim/rough.jpg", import.meta.url).href,
  },
  metal: {
    info: metalInfo,
    color: new URL("../../assets/landmarks/textures/metal/color.jpg", import.meta.url).href,
    normal: new URL("../../assets/landmarks/textures/metal/normal.jpg", import.meta.url).href,
    rough: new URL("../../assets/landmarks/textures/metal/rough.jpg", import.meta.url).href,
  },
};

// Physical materials for the landmark models. Brick, stone trim, and the
// corrugated metal use CC0 scans from Poly Haven (assets/landmarks/textures/,
// built by scripts/landmark-textures.py): a color map, an OpenGL normal map,
// and a roughness map. The copper patina has no CC0 scan, so it keeps a
// procedural canvas texture. The landmark preview pages
// (landmarks/*/preview.ts) and the game use this one module, so the review
// judges the look that the game shows.
//
// Every texture tiles in world meters: applyBoxUVs() projects each vertex on
// the plane of its dominant normal axis, so one brick course or one copper
// seam has the same size on every part.

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(size) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  return c;
}

function texture(c, { color = false, repeatMeters = 1 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  // UVs are in meters, so the repeat is 1 / (meters per tile).
  t.repeat.set(1 / repeatMeters, 1 / repeatMeters);
  return t;
}

function hex(r, g, b) {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

const loader = new THREE.TextureLoader();
const pending = [];

function scanTexture(url, { color = false, repeatMeters = 1 } = {}) {
  let t;
  // A texture that fails to load stays blank; the material still draws.
  pending.push(new Promise((resolve) => {
    t = loader.load(url, () => resolve(), undefined, () => resolve());
  }));
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(1 / repeatMeters, 1 / repeatMeters);
  return t;
}

// One scan set: color (with the AO and the spec color tint baked in), normal,
// and roughness, tiled at the real size of the scan.
function scanSet(id) {
  const scan = SCANS[id];
  const repeatMeters = scan.info.tileMeters;
  return {
    map: scanTexture(scan.color, { color: true, repeatMeters }),
    normalMap: scanTexture(scan.normal, { repeatMeters }),
    roughnessMap: scanTexture(scan.rough, { repeatMeters }),
  };
}

// Resolves when the scan textures of the materials made so far have loaded.
export function landmarkTexturesReady() {
  return Promise.all(pending);
}

// Patinated copper: blue-green with darker vertical run-off streaks and
// standing seams every 45 cm.
function copperSet(base = [126, 158, 154]) {
  const size = 512;
  const col = canvas(size);
  const bump = canvas(size);
  const g = col.getContext("2d");
  const b = bump.getContext("2d");
  const rand = rng(1926);
  g.fillStyle = hex(...base);
  g.fillRect(0, 0, size, size);
  b.fillStyle = "rgb(110, 110, 110)";
  b.fillRect(0, 0, size, size);
  for (let i = 0; i < 160; i += 1) {
    const x = rand() * size;
    const w = 2 + rand() * 10;
    const d = (rand() - 0.5) * 40;
    const grad = g.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, hex(base[0] + d, base[1] + d * 0.6, base[2] + d * 0.6));
    grad.addColorStop(1, hex(base[0] + d * 0.3, base[1] + d * 0.2, base[2] + d * 0.2));
    g.globalAlpha = 0.35;
    g.fillStyle = grad;
    g.fillRect(x, 0, w, size);
  }
  g.globalAlpha = 1;
  const seam = size / (2 / 0.45);
  for (let x = 0; x < size; x += seam) {
    g.fillStyle = hex(base[0] - 25, base[1] - 25, base[2] - 22);
    g.fillRect(x, 0, 3, size);
    b.fillStyle = "rgb(255, 255, 255)";
    b.fillRect(x, 0, 4, size);
  }
  return { map: texture(col, { color: true, repeatMeters: 2 }), bumpMap: texture(bump, { repeatMeters: 2 }) };
}

// Ambient occlusion under overhangs: the surface darkens just below each
// height in `overhangs` (model meters above `baseY`, the world height of the
// model origin; for example a band or a cornice), fading out over about
// about 2.5 m (a 0.9 m falloff). A shader injection, so it costs no texture.
export function withOverhangOcclusion(material, overhangs, strength = 0.38, baseY = 0) {
  if (!overhangs || !overhangs.length) return material;
  const m = material.clone();
  const list = overhangs.slice(0, 8);
  while (list.length < 8) list.push(-1e4);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uOverhangs = { value: list };
    shader.uniforms.uOverhangStrength = { value: strength };
    shader.uniforms.uBaseY = { value: baseY };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vObjY;\nuniform float uBaseY;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvObjY = (modelMatrix * vec4(position, 1.0)).y - uBaseY;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vObjY;\nuniform float uOverhangs[8];\nuniform float uOverhangStrength;")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
{
  float ao = 1.0;
  for (int i = 0; i < 8; i++) {
    float d = uOverhangs[i] - vObjY;
    if (d > 0.0 && d < 3.0) ao = min(ao, 1.0 - uOverhangStrength * exp(-d / 0.9));
  }
  diffuseColor.rgb *= ao;
}`,
      );
  };
  m.customProgramCacheKey = () => `overhang-ao-${list.join(",")}-${baseY}`;
  return m;
}

const caches = new Map();

// Returns { [materialId]: THREE.Material } for the landmark material ids.
// `envMap` (optional) gives the metals and the glass their reflections.
// `overhangs` (optional, model meters) adds occlusion under overhangs to the
// brick and the stone.
export function landmarkMaterials({ envMap = null, overhangs = null, baseY = 0 } = {}) {
  const key = `${(overhangs ?? []).join(",")}@${baseY}`;
  if (caches.has(key)) return caches.get(key);
  let cache = null;
  const brick = scanSet("brick");
  const stone = scanSet("trim");
  const copper = copperSet();
  const metal = scanSet("metal");
  const std = (opts) => new THREE.MeshStandardMaterial({ envMap, envMapIntensity: 0.6, ...opts });
  cache = {
    // With a roughness map, `roughness` scales the map.
    brick: std({ ...brick, normalScale: new THREE.Vector2(1, 1), roughness: 1, metalness: 0 }),
    trim: std({ ...stone, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 1, metalness: 0 }),
    "copper-patina": std({ ...copper, bumpScale: 0.8, roughness: 0.55, metalness: 0.35 }),
    gold: std({ color: 0xd4a93a, roughness: 0.3, metalness: 1 }),
    "glass-dark": std({ color: 0x24303c, roughness: 0.12, metalness: 0.2, envMapIntensity: 1.0 }),
    // Painted steel: little metalness, so the bright room environment does
    // not turn the black paint grey.
    steel: std({ color: 0x1e2023, roughness: 0.55, metalness: 0.1, envMapIntensity: 0.25 }),
    // Corrugated metal: a soft normal, because the ribs alias at a
    // street-level distance with a strong one.
    metal: std({ ...metal, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.8, metalness: 0.3, envMapIntensity: 0.35 }),
    brass: std({ color: 0xd8a848, roughness: 0.25, metalness: 1, emissive: 0x3a2808, emissiveIntensity: 0.6 }),
    "letters-white": std({ color: 0xf4f4f2, roughness: 0.5, metalness: 0 }),
    bulb: new THREE.MeshStandardMaterial({ color: 0xfff1c8, emissive: 0xffd27a, emissiveIntensity: 1.4, roughness: 0.4 }),
  };
  if (overhangs && overhangs.length) {
    cache.brick = withOverhangOcclusion(cache.brick, overhangs, 0.5, baseY);
    cache.trim = withOverhangOcclusion(cache.trim, overhangs, 0.28, baseY);
    cache.metal = withOverhangOcclusion(cache.metal, overhangs, 0.3, baseY);
  }
  caches.set(key, cache);
  return cache;
}

// World-meter UVs by box projection on the dominant normal axis. `matrix` is
// the mesh's world matrix (the model frame, not the level).
export function applyBoxUVs(geometry, matrix = new THREE.Matrix4()) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const pos = g.attributes.position;
  g.computeVertexNormals();
  const nor = g.attributes.normal;
  const nm = new THREE.Matrix3().getNormalMatrix(matrix);
  const uv = new Float32Array(pos.count * 2);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    p.fromBufferAttribute(pos, i).applyMatrix4(matrix);
    n.fromBufferAttribute(nor, i).applyMatrix3(nm);
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    if (ay >= ax && ay >= az) {
      uv[i * 2] = p.x;
      uv[i * 2 + 1] = p.z;
    } else if (ax >= az) {
      uv[i * 2] = p.z;
      uv[i * 2 + 1] = p.y;
    } else {
      uv[i * 2] = p.x;
      uv[i * 2 + 1] = p.y;
    }
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return g;
}

let env = null;

// One small environment map for the landmark reflections (RoomEnvironment).
export async function landmarkEnvironment(renderer) {
  if (env) return env;
  const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
  const pmrem = new THREE.PMREMGenerator(renderer);
  env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return env;
}
