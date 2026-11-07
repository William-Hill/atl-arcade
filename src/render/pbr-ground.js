import * as THREE from "three";
import { SURFACE_COLORS } from "../level/geo/geo-mesh.js";
import { MATERIAL_CLASSES } from "./pbr-palette.js";
import { DETAIL_GLSL, DETAIL_NORMAL, ENV_LIGHT, GROUND_ALBEDO, ROUGHNESS, litMaterial } from "./look.js";
import groundSets from "../../assets/ground/pbr/sets.json";

// The ground of the pbr look (#158): five PBR sets (asphalt, concrete,
// trail, grass, brick), each an albedo, an OpenGL normal map, and a packed
// ORM map (R ambient occlusion, G roughness, B metalness), from CC0 scans
// (scripts/ground-textures-pbr.py, assets/ground/<set>/provenance.json).
//
// Each map is one WebGL2 texture array with a layer per set, from one WebP
// strip. So the ground is still one material and one draw call per tile, the
// shader needs 3 samplers (not 15), and it reads only the layer of its own
// surface kind.
//
// Tiers: "high" gets 1024 px albedo and normal layers and 512 px ORM;
// "small" (phone and low) gets 512 px albedo and ORM and no normal map.

const URLS = {
  "albedo-1024.webp": new URL("../../assets/ground/pbr/albedo-1024.webp", import.meta.url).href,
  "albedo-512.webp": new URL("../../assets/ground/pbr/albedo-512.webp", import.meta.url).href,
  "normal-1024.webp": new URL("../../assets/ground/pbr/normal-1024.webp", import.meta.url).href,
  "orm-512.webp": new URL("../../assets/ground/pbr/orm-512.webp", import.meta.url).href,
};

export const GROUND_LAYERS = groundSets.layers;
const layer = (id) => GROUND_LAYERS.indexOf(id);

// Surface kind -> [layer, detail strength]. The same strengths as the toon
// surface (geo-view.js GROUND_OF); a brick path gets the brick pavers.
export const PBR_GROUND_OF = {
  ground: [layer("grass"), 0.6],
  park: [layer("grass"), 0.65],
  street: [layer("asphalt"), 0.8],
  path: [layer("concrete"), 0.8],
  sidewalk: [layer("concrete"), 0.8],
  trail: [layer("trail"), 0.7],
  patchDark: [layer("asphalt"), 0.8],
  patchLight: [layer("asphalt"), 0.8],
  iron: [layer("asphalt"), 0.4],
  bike: [layer("asphalt"), 0.5],
  brick: [layer("brick"), 0.8],
};

// The lowest roughness of each layer: the low end of its material class
// (pbr-palette.js). A smoother ground reflects the bright sky at a low angle
// and gives a white haze.
const CLASS_OF = { asphalt: "asphalt", concrete: "concrete", trail: "concrete", grass: "grass", brick: "brick" };
export const GROUND_ROUGHNESS_FLOOR = GROUND_LAYERS.map((id) => MATERIAL_CLASSES[CLASS_OF[id]].roughness[0]);

// The albedo factor of the surface material (a darker ground, toward real
// asphalt and soil; see createSurfaceMaterial in geo-view.js).
export const GROUND_COLOR_SCALE = 0.72;

// Pure: the tier of the pbr ground: "high", "small", or null (no maps).
export function pbrGroundTier(quality, enabled = true) {
  if (!enabled) return null;
  return quality === "high" ? "high" : "small";
}

// Pure: the files of a tier, from sets.json.
export function groundFiles(tier) {
  return groundSets.tiers[tier].files;
}

// Pure: the download (bytes) and GPU memory (RGBA8 with mips) of a tier.
export function groundBudget(tier) {
  const t = groundSets.tiers[tier];
  return { bytes: t.totalBytes, gpuBytes: t.totalGpuBytes, files: { ...t.files } };
}

// Pure: the mean linear albedo of a surface kind in the pbr look (art color
// x 0.72 x GROUND_ALBEDO of its layer). The scan detail is divided by its
// own mean, so this is the mean of the pixels too.
export function groundAlbedo(kind) {
  const [l] = PBR_GROUND_OF[kind];
  return SURFACE_COLORS[kind].map((c, i) => c * GROUND_COLOR_SCALE * GROUND_ALBEDO[l][i]);
}

// A texture array that starts as 1x1 layers of `fill` (RGBA 0..255 per
// layer), so the shader compiles and draws at once, and swaps in the strip
// when it has loaded. Each layer is stored upside down in the strip, so
// with flipY off it reads as a 2D map with flipY on.
function loadArray(url, fill, { srgb = false, onLoad } = {}) {
  const n = GROUND_LAYERS.length;
  const data = new Uint8Array(n * 4);
  fill.forEach((rgba, i) => data.set(rgba, i * 4));
  const holder = { value: arrayTexture({ data, width: 1, height: 1, depth: n }, srgb, false) };
  const done = (image) => {
    const t = arrayTexture({ data: image, width: image.width, height: image.height / n, depth: n }, srgb, true);
    holder.value.dispose();
    holder.value = t;
    onLoad?.(t);
  };
  fetch(url)
    .then((r) => r.blob())
    .then((blob) => createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" }))
    .then(done)
    .catch((err) => console.warn(`pbr ground: ${url}: ${err}`));
  return holder;
}

function arrayTexture(image, srgb, mips) {
  const t = new THREE.DataArrayTexture(image.data, image.width, image.height, image.depth);
  t.image = image;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.generateMipmaps = mips;
  t.anisotropy = 8;
  t.flipY = false;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

const srgb8 = (v) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));

// The pbr surface material. One material for every ground tile, as the toon
// surface. `tier` is "high" or "small".
export function createPbrSurfaceMaterial({ tier = "high" } = {}) {
  const mat = litMaterial("pbr", { vertexColors: true }, { roughness: ROUGHNESS.ground, envLight: ENV_LIGHT.ground });
  mat.color.setScalar(GROUND_COLOR_SCALE);
  const files = groundFiles(tier);
  const sets = groundSets.sets;
  const normal = Boolean(files.normal);
  mat.defines = normal ? { GROUND_NORMAL: 1 } : {};
  const kinds = Object.keys(PBR_GROUND_OF);
  const uniforms = {
    uGroundAlbedo: loadArray(URLS[files.albedo], sets.map((s) => [...s.meanLinear.map(srgb8), 255]), { srgb: true }),
    uGroundOrm: loadArray(URLS[files.orm], sets.map((s) => [Math.round(s.aoMean * 255), Math.round(s.roughMean * 255), 0, 255])),
    uGroundMean: { value: sets.map((s) => new THREE.Vector3(...s.meanLinear)) },
    uGroundAoMean: { value: sets.map((s) => s.aoMean) },
    uGroundTile: { value: sets.map((s) => s.tileMeters) },
    uGroundTint: { value: GROUND_ALBEDO.map((c) => new THREE.Vector3(...c)) },
    uGroundRoughFloor: { value: GROUND_ROUGHNESS_FLOOR },
    uGroundNormalK: { value: DETAIL_NORMAL.ground },
    uKindColor: { value: kinds.map((k) => new THREE.Vector3(...SURFACE_COLORS[k])) },
    uKindSet: { value: kinds.map((k) => PBR_GROUND_OF[k][0]) },
    uKindStrength: { value: kinds.map((k) => PBR_GROUND_OF[k][1]) },
    // The ground wetness (src/render/weather-view.js): 0 dry, 1 soaked.
    uWet: { value: 0 },
  };
  if (normal) uniforms.uGroundNormal = loadArray(URLS[files.normal], sets.map(() => [128, 128, 255, 255]));
  mat.userData.uWet = uniforms.uWet;
  mat.userData.groundTier = tier;
  mat.userData.groundTextures = () => [uniforms.uGroundAlbedo.value, uniforms.uGroundOrm.value, ...(normal ? [uniforms.uGroundNormal.value] : [])];
  const n = GROUND_LAYERS.length;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vGroundXZ;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGroundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec2 vGroundXZ;
uniform highp sampler2DArray uGroundAlbedo;
uniform highp sampler2DArray uGroundOrm;
#ifdef GROUND_NORMAL
uniform highp sampler2DArray uGroundNormal;
uniform float uGroundNormalK[${n}];
#endif
uniform vec3 uGroundMean[${n}];
uniform float uGroundAoMean[${n}];
uniform float uGroundTile[${n}];
uniform vec3 uGroundTint[${n}];
uniform float uGroundRoughFloor[${n}];
uniform vec3 uKindColor[${kinds.length}];
uniform float uKindSet[${kinds.length}];
uniform float uKindStrength[${kinds.length}];
uniform float uWet;
// The ground layer of this pixel, the weight of its detail, its UV and
// UV gradients, and its ORM sample.
int groundSet = -1;
float groundK = 0.0;
vec2 groundUv;
vec2 groundDx;
vec2 groundDy;
vec3 groundOrm = vec3(1.0, 1.0, 0.0);
${DETAIL_GLSL}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  // The gradients first, in uniform control flow: the layers have their
  // own tile sizes, so the mip level comes from the world position.
  vec2 dx = dFdx(vGroundXZ);
  vec2 dy = dFdy(vGroundXZ);
  // The surface kind from its art color (each kind has its own color).
  float strength = 0.0;
  for (int i = 0; i < ${kinds.length}; i++) {
    if (distance(vColor.rgb, uKindColor[i]) < 0.01) { groundSet = int(uKindSet[i] + 0.5); strength = uKindStrength[i]; }
  }
  if (groundSet >= 0) {
    float tile = uGroundTile[groundSet];
    float L = float(groundSet);
    groundUv = vGroundXZ / tile;
    groundDx = dx / tile;
    groundDy = dy / tile;
    vec3 mean = uGroundMean[groundSet];
    vec3 a = textureGrad(uGroundAlbedo, vec3(groundUv, L), groundDx, groundDy).rgb / mean;
    // A second, rotated, larger sample breaks the tile repeat.
    mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
    float big = 1.0 / 4.7;
    vec3 b = textureGrad(uGroundAlbedo, vec3(rot * groundUv * big, L), rot * groundDx * big, rot * groundDy * big).rgb / mean;
    vec3 det = clamp(a * mix(vec3(1.0), b, 0.45), 0.3, 2.5);
    float fade = 1.0 - smoothstep(90.0, 280.0, length(vViewPosition));
    // The scans are sampled in world x and z, so a vertical face (a curb
    // side) gets streaks. Only a face that points up gets the detail.
    fade *= smoothstep(0.5, 0.85, dot(normalize(vNormal), normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz)));
    groundK = strength * fade;
    diffuseColor.rgb *= mix(vec3(1.0), det, groundK) * uGroundTint[groundSet];
    groundOrm = textureGrad(uGroundOrm, vec3(groundUv, L), groundDx, groundDy).rgb;
  }
  // A soaked street is darker.
  diffuseColor.rgb *= mix(1.0, 0.72, uWet);
}`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
if (groundSet >= 0) roughnessFactor = mix(roughnessFactor, max(groundOrm.g, uGroundRoughFloor[groundSet]), groundK);
roughnessFactor *= mix(1.0, 0.3, uWet);`,
      )
      .replace(
        "#include <metalnessmap_fragment>",
        `#include <metalnessmap_fragment>
if (groundSet >= 0) metalnessFactor = mix(metalnessFactor, groundOrm.b, groundK);`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
#ifdef GROUND_NORMAL
if (groundSet >= 0 && groundK > 0.0) {
  vec3 sn = textureGrad(uGroundNormal, vec3(groundUv, float(groundSet)), groundDx, groundDy).rgb;
  vec3 d = (sn - vec3(0.5, 0.5, 1.0)) * groundK;
  d.xy *= uGroundNormalK[groundSet];
  // The map u grows along world x and v along world z (vGroundXZ).
  vec3 tu = (viewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz;
  vec3 tv = (viewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz;
  normal = detailNormal(normal, tu, tv, vec3(0.5, 0.5, 1.0) + d, 1.0);
}
#endif`,
      )
      .replace(
        "#include <aomap_fragment>",
        `#include <aomap_fragment>
// The scan AO on the sky light only (the sun is direct light), over its
// mean, so the mean shade of the ground stays where the palette put it.
if (groundSet >= 0) {
  float ao = mix(1.0, clamp(groundOrm.r / uGroundAoMean[groundSet], 0.0, 1.4), groundK);
  reflectedLight.indirectDiffuse *= ao;
  reflectedLight.indirectSpecular *= ao;
}`,
      );
  };
  mat.customProgramCacheKey = () => `surface-pbr-ground-v1-${tier}`;
  return mat;
}
