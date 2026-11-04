import * as THREE from "three";

// The tree shader parts. The `leaf` attribute [u, v, code] of a tree
// vertex says what it is:
//   code > 0: a leaf card (trees.js, scripts/blender/pbr_trees.py). The
//     integer part is the leaf shape (LEAF_SHAPES), the rest the seed. Up to
//     `count` leaves sit on the card at places from the seed. A pixel
//     outside every leaf is discarded. The shadow pass uses the same cut, so
//     a card does not cast a square shadow.
//   code 0: no texture (a crown core, a kit prop).
//   code -1, -2, -3: bark, uv = (around, along); -1 - code is the bark kind.
//   code -10, -11, ...: a far tree impostor (tree-impostors.js), uv in the atlas.
// The `fade` attribute (1: the near shape, 2: the far shape of a tree) makes
// the dithered cross fade between the two near the LOD distance.
export const LEAVES = { count: 7, size: [0.11, 0.19], margin: 0.2 };
// The leaf shape of each code: [count, width, length, outline]. Outline 0
// is an ellipse, 1 a pointed leaf with a midrib, 2 a needle fascicle, 3 a
// lobed (maple) leaf. Shape 0 is the procedural card of trees.js.
export const LEAF_SHAPES = [
  [LEAVES.count, ...LEAVES.size, 0], // 0: trees.js cards
  [16, 0.055, 0.2, 1], // 1: willow oak, narrow leaves
  [8, 0.016, 0.22, 2], // 2: loblolly pine, needle fascicles
  [5, 0.13, 0.27, 1], // 3: southern magnolia, big leaves
  [14, 0.07, 0.11, 0], // 4: crape myrtle, small round leaves
  [9, 0.105, 0.18, 1], // 5: flowering dogwood, oval leaves
  [7, 0.15, 0.15, 3], // 6: red maple, lobed leaves
];
const MAX_LEAVES = Math.max(...LEAF_SHAPES.map((s) => s[0]));
export const LEAF_SHAPE_OF = { oak: 1, pine: 2, magnolia: 3, myrtle: 4, dogwood: 5, street: 6 };
// The bark kind of each species: 0 furrowed, 1 plates, 2 smooth and mottled.
export const BARK_KIND_OF = { oak: 0, pine: 1, magnolia: 2, myrtle: 2, dogwood: 0, street: 0 };

// The shared tree uniforms: the impostor atlas, and the camera and the
// distances of the LOD cross fade (geo-view update() sets them).
const WHITE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
WHITE.needsUpdate = true;
export const TREE_UNIFORMS = {
  uTreeAtlas: { value: WHITE },
  uLodCamera: { value: new THREE.Vector3() },
  uLodFade: { value: new THREE.Vector2(1e6, 1e6 + 1) },
};

const shapeTable = LEAF_SHAPES.map(([n, w, l, o], i) => `${i ? "else " : ""}if (s == ${i}) { n = ${n}; size = vec2(${w.toFixed(3)}, ${l.toFixed(3)}); outline = ${o}; }`).join("\n  ");

const LEAF_GLSL = /* glsl */ `
varying vec3 vLeaf;
varying float vFade;
uniform sampler2D uTreeAtlas;
float treeHash(float n) { return fract(sin(n) * 43758.5453); }
float treeNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = treeHash(dot(i, vec2(127.1, 311.7)));
  float b = treeHash(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7)));
  float c = treeHash(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7)));
  float d = treeHash(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7)));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// The bark shade at (around, along).
float barkTone(vec2 uv, int kind) {
  if (kind == 1) {
    vec2 q = vec2(uv.x * 7.0, uv.y * 3.0 + floor(uv.x * 7.0) * 0.37);
    vec2 f = fract(q);
    float edge = min(min(f.x, 1.0 - f.x), 2.0 * min(f.y, 1.0 - f.y));
    return mix(0.5, 1.05, smoothstep(0.0, 0.14, edge)) * (0.85 + 0.3 * treeHash(dot(floor(q), vec2(7.1, 3.7))));
  }
  if (kind == 2) {
    float m = treeNoise(vec2(uv.x * 6.0, uv.y * 2.0)) * 0.67 + treeNoise(vec2(uv.x * 14.0, uv.y * 5.0)) * 0.33;
    return mix(0.8, 1.15, smoothstep(0.45, 0.7, m));
  }
  float r = abs(sin((uv.x * 9.0 + 0.7 * treeNoise(vec2(uv.x * 9.0, uv.y * 3.0))) * 3.14159));
  return mix(0.55, 1.08, sqrt(r)) * (0.88 + 0.24 * treeNoise(vec2(uv.x * 20.0, uv.y * 6.0)));
}
// rgb: the shade to multiply, a: 1 to draw the pixel, 0 to discard it.
vec4 treeTexel(vec3 l) {
  // The codes are whole numbers apart: compare with a margin, since an
  // interpolated constant is not exact.
  if (l.z < -9.5) {
    vec4 t = texture2D(uTreeAtlas, l.xy);
    return vec4(t.rgb, t.a > 0.45 ? 1.0 : 0.0);
  }
  if (l.z < -0.5) return vec4(vec3(barkTone(l.xy, int(floor(0.5 - l.z)) - 1)), 1.0);
  if (l.z < 0.025) return vec4(1.0);
  int s = int(floor(l.z));
  int n = ${LEAVES.count};
  vec2 size = vec2(${LEAVES.size[0].toFixed(3)}, ${LEAVES.size[1].toFixed(3)});
  int outline = 0;
  ${shapeTable}
  float best = 0.0;
  float tone = 1.0;
  for (int i = 0; i < ${MAX_LEAVES}; i++) {
    if (i >= n) break;
    float fi = float(i);
    vec2 c = vec2(fract(sin((l.z * 91.7 + fi) * 12.9898) * 43758.55), fract(sin((l.z * 47.3 + fi) * 78.233) * 43758.55));
    c = ${LEAVES.margin.toFixed(2)} + ${(1 - 2 * LEAVES.margin).toFixed(2)} * c;
    float ang = fract(sin((l.z * 13.1 + fi) * 37.7) * 9631.3) * 6.2832;
    vec2 d = l.xy - c;
    d = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * d;
    float e;
    float vein = 1.0;
    if (outline == 1) {
      float y = d.y / size.y;
      e = max(abs(y), abs(d.x) / max(size.x * (1.0 - y * y), 1e-4));
      vein = abs(d.x) < 0.08 * size.x ? 0.82 : 1.0;
    } else if (outline == 2) {
      float r = length(d);
      float a = fract(atan(d.y, d.x) * 1.9099 + fi * 0.37);
      e = max(r / size.y, abs(a - 0.5) * 3.2899 * r / size.x);
    } else if (outline == 3) {
      float r = length(d);
      float k = d.x / max(r, 1e-5);
      float lobe = 16.0 * k * k * k * k * k - 20.0 * k * k * k + 5.0 * k;
      e = r / (size.x * (0.72 + 0.28 * lobe));
      vein = abs(d.x) < 0.012 || abs(d.y) < 0.012 ? 0.85 : 1.0;
    } else {
      e = length(d / size);
    }
    if (e < 1.0 && 1.0 - e > best) {
      best = 1.0 - e;
      tone = (0.9 + 0.22 * fract(fi * 0.618 + l.z * 3.0)) * vein;
    }
  }
  return vec4(vec3(tone * (0.92 + 0.08 * best)), best > 0.0 ? 1.0 : 0.0);
}`;

export function patchLeafVertex(shader) {
  Object.assign(shader.uniforms, TREE_UNIFORMS);
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nattribute vec3 leaf;\nattribute float fade;\nvarying vec3 vLeaf;\nvarying float vFade;\nuniform vec3 uLodCamera;\nuniform vec2 uLodFade;")
    .replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
vLeaf = leaf;
vFade = 0.0;
if (fade > 0.0) {
#ifdef USE_BATCHING
  vec3 fadeOrigin = (modelMatrix * batchingMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#else
  vec3 fadeOrigin = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#endif
  float fadeT = clamp((distance(fadeOrigin.xz, uLodCamera.xz) - uLodFade.x) / max(uLodFade.y - uLodFade.x, 1e-3), 0.0, 1.0);
  vFade = fade < 1.5 ? 1.0 + fadeT : -1.0 - fadeT;
}`,
    );
}

// The sun light that comes through a leaf (pbr look): with the sun behind a
// leaf card, the card adds a part of the sun color, tinted yellow-green.
export const LEAF_BACKLIGHT = { strength: 0.35, power: 3, tint: [1.05, 1.15, 0.6] };
const BACKLIGHT_GLSL = /* glsl */ `
#if NUM_DIR_LIGHTS > 0
if (vLeaf.z > 0.025 || vLeaf.z < -9.5) {
  float leafBack = pow(saturate(dot(-normalize(vViewPosition), directionalLights[0].direction)), ${LEAF_BACKLIGHT.power.toFixed(1)});
  reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(${LEAF_BACKLIGHT.tint.map((v) => v.toFixed(2)).join(", ")}) * directionalLights[0].color * leafBack * ${LEAF_BACKLIGHT.strength.toFixed(2)};
}
#endif`;

export function patchLeafFragment(shader, { tone = true, backlight = false } = {}) {
  shader.fragmentShader = shader.fragmentShader
    // Before main(): MeshNormalMaterial has no <common> in its fragment.
    .replace("void main() {", `${LEAF_GLSL}\nvoid main() {`)
    .replace(
      "#include <clipping_planes_fragment>",
      `#include <clipping_planes_fragment>
float fadeDither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
if (vFade > 0.0 && fadeDither < vFade - 1.0) discard;
if (vFade < 0.0 && fadeDither >= -vFade - 1.0) discard;
vec4 leafHit = treeTexel(vLeaf);
if (leafHit.a < 0.5) discard;`,
    );
  if (tone) shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= leafHit.rgb;");
  // Leaf cards and impostors are two sided but shade as the crown volume:
  // keep the crown normal on the back face too (three flips it), or half the
  // cards of a crown, and of each impostor, go dark.
  if (tone)
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_begin>",
      `#include <normal_fragment_begin>
#if defined(DOUBLE_SIDED) && !defined(FLAT_SHADED)
if (vLeaf.z > 0.025 || vLeaf.z < -9.5) {
  normal = normalize(vNormal);
  nonPerturbedNormal = normal;
}
#endif`,
    );
  if (backlight) shader.fragmentShader = shader.fragmentShader.replace("#include <lights_fragment_end>", `#include <lights_fragment_end>\n${BACKLIGHT_GLSL}`);
}

// The depth material for the prop batch shadow: the leaf cut, no wind.
export function createLeafDepthMaterial() {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  mat.onBeforeCompile = (shader) => {
    patchLeafVertex(shader);
    patchLeafFragment(shader, { tone: false });
  };
  mat.customProgramCacheKey = () => "geo-props-leaf-depth";
  return mat;
}

// The leaf cut on an override material (the GTAO normal pass), so the AO
// and the ink outline see leaves and not square cards. Both sides draw.
export function withLeafCut(material) {
  material.side = THREE.DoubleSide;
  material.onBeforeCompile = (shader) => {
    patchLeafVertex(shader);
    patchLeafFragment(shader, { tone: false });
  };
  material.customProgramCacheKey = () => `leaf-cut-${material.type}`;
  material.needsUpdate = true;
  return material;
}
