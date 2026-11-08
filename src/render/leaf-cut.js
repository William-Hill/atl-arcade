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
//   code -5: a crown core of a Blender tree (markCrownCores()), uv in meters.
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
// The leaf edge anti-aliasing (#202). lod: the leaf half width in pixels
// ([start, end] of 1 / that) where a card changes to one clump. clump: the
// clump radius in card uv. clumpTone: the clump shade (the mean leaf
// tone). cut: the coverage that draws without alpha to coverage (phone,
// low, the shadow and AO passes). minCoverage: the coverage under which a
// pixel is discarded with alpha to coverage (no MSAA sample under 1/8).
export const LEAF_AA = { lod: [0.45, 1.1], clump: 0.36, clumpTone: 0.96, cut: 0.5, minCoverage: 0.06 };
// The baked leaf cut (#191, phone and low tiers). The leaf field of each
// leaf shape is drawn once at load, for `variants` seeds per shape, into the
// layers of a texture array of `size` px (bakeLeafCut()). A card reads the
// layer of its shape and of the variant nearest to its seed, so a card pixel
// does one texture read and not the loop over its leaves. The red channel
// holds the field (`field`: the range that it keeps), the green channel the
// leaf tone (`tone`). The mip chain filters the field and the veins far away.
export const LEAF_BAKE = { size: 128, variants: 8, field: [-1, 1], tone: [0.7, 1.15] };
// The leaf code of a crown core (markCrownCores()).
export const CORE_CODE = -5;

// Pure: a Blender tree template with its crown cores marked (#202). A core
// (the low icospheres inside the crown, scripts/blender/pbr_trees.py) has
// leaf code 0 (under 0.025 after Draco) and a sway weight over 0; a kit prop has no sway. A core
// vertex gets CORE_CODE and a uv in meters from its position, so the shader
// can give the core a leafy, darker shade and not a flat polygon. Returns a
// new template; the input does not change.
export function markCrownCores(t) {
  if (!t.leaf || !t.sway) return t;
  const leaf = Float32Array.from(t.leaf);
  let marked = 0;
  for (let i = 0; i < leaf.length / 3; i += 1) {
    // Draco quantizes the code: 0 comes back near 0, as in the shader.
    if (Math.abs(leaf[i * 3 + 2]) >= 0.025 || !(t.sway[i] > 0)) continue;
    const x = t.positions[i * 3];
    const y = t.positions[i * 3 + 1];
    const z = t.positions[i * 3 + 2];
    // An oblique projection: no seam, and every face gets some of the noise.
    leaf[i * 3] = x * 0.8 + z * 0.6;
    leaf[i * 3 + 1] = y * 0.85 + (z * 0.8 - x * 0.6) * 0.5;
    leaf[i * 3 + 2] = CORE_CODE;
    marked += 1;
  }
  return marked ? { ...t, leaf } : t;
}

// Pure: the shade range of a crown core (the GLSL coreTone()).
export const CORE_SHADE = { min: 0.7, max: 1.0 };

// Pure (the GLSL above does the same): the clump blend, 0 (leaves) to 1
// (one clump per card), for `px` (the pixel size in card uv) and the leaf
// half width `halfWidth` in card uv.
export function leafClump(px, halfWidth, { lod } = LEAF_AA) {
  const t = Math.min(Math.max((px / halfWidth - lod[0]) / (lod[1] - lod[0]), 0), 1);
  return t * t * (3 - 2 * t);
}

// Pure: the coverage of a pixel for a leaf field value (> 0 in a leaf) and
// the field change over one pixel: a ramp one pixel wide, 0.5 at the edge.
export function leafCoverage(field, width) {
  return Math.min(Math.max(field / Math.max(width, 1e-4) + 0.5, 0), 1);
}

// Pure: the lowest leaf shade of the shader: the darkest leaf tone with a
// vein, or the clump shade at its rim.
export function leafShadeRange() {
  const near = 0.9 * 0.82 * 0.92;
  const clump = LEAF_AA.clumpTone * 0.92;
  return { min: Math.min(near, clump), max: Math.max(1.12, LEAF_AA.clumpTone) };
}

// Pure: the bake layer of a leaf code (the shape in the integer part, the
// seed in the rest), and the code that the bake draws for that layer (the
// seed at the center of the variant).
export function leafBakeLayer(code, { variants } = LEAF_BAKE) {
  const shape = Math.floor(code);
  const variant = Math.min(Math.floor((code - shape) * variants), variants - 1);
  return { layer: shape * variants + variant, code: shape + (variant + 0.5) / variants };
}

// Pure: the 8-bit texel [r, g] of a field value and a tone (the bake), and
// back (the shader).
export function encodeLeafTexel(field, tone, bake = LEAF_BAKE) {
  const unit = (v, [a, b]) => Math.round(Math.min(Math.max((v - a) / (b - a), 0), 1) * 255);
  return [unit(field, bake.field), unit(tone, bake.tone)];
}
export function decodeLeafTexel([r, g], bake = LEAF_BAKE) {
  const back = (v, [a, b]) => a + (b - a) * (v / 255);
  return { field: back(r, bake.field), tone: back(g, bake.tone) };
}

// Pure: the bake target grid (`columns` x `rows` tiles of `size` px) and the
// GPU bytes of the texture array with its mip chain (2 bytes a texel).
export function leafBakeLayout({ size, variants } = LEAF_BAKE, shapes = LEAF_SHAPES.length) {
  const layers = shapes * variants;
  const columns = Math.ceil(Math.sqrt(layers));
  return { layers, columns, rows: Math.ceil(layers / columns), bytes: Math.round(size * size * 2 * layers * (4 / 3)) };
}

// Pure: the leaf cut of a tier: "baked" or "procedural". `param` (the
// ?leafcut= URL value) wins when it is one of the two.
export const LEAF_CUT_OF = { low: "baked", phone: "baked", high: "procedural" };
export function leafCutFor(quality, param) {
  if (param === "baked" || param === "procedural") return param;
  return LEAF_CUT_OF[quality] ?? "procedural";
}

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
  // The baked leaf cut (bakeLeafCut()), with the LEAF_BAKED define only.
  uLeafBake: { value: emptyLeafBake() },
};

function emptyLeafBake() {
  const t = new THREE.DataArrayTexture(new Uint8Array([255, 255]), 1, 1, 1);
  t.format = THREE.RGFormat;
  t.needsUpdate = true;
  return t;
}

const shapeTable = LEAF_SHAPES.map(([n, w, l, o], i) => `${i ? "else " : ""}if (s == ${i}) { n = ${n}; size = vec2(${w.toFixed(3)}, ${l.toFixed(3)}); outline = ${o}; }`).join("\n  ");

// The leaf field, also for the bake (bakeLeafCut()).
const LEAF_FIELD_GLSL = /* glsl */ `
// The leaf shape of shape code s: the leaf count, the leaf size in card
// uv, and the outline.
void leafShape(int s, out int n, out vec2 size, out int outline) {
  n = ${LEAVES.count};
  size = vec2(${LEAVES.size[0].toFixed(3)}, ${LEAVES.size[1].toFixed(3)});
  outline = 0;
  ${shapeTable}
}
// The leaf field of a card pixel: x > 0 in a leaf (1 at a leaf center), y
// the leaf tone. veinOn fades the vein; a leaf farther than reach from the
// pixel is skipped (it cannot cover it). The leaf places and angles come
// from the code l.z.
vec2 leafField(vec3 l, int n, vec2 size, int outline, float veinOn, float reach) {
  float best = -1e3;
  float tone = 1.0;
  for (int i = 0; i < ${MAX_LEAVES}; i++) {
    if (i >= n) break;
    float fi = float(i);
    vec2 c = vec2(fract(sin((l.z * 91.7 + fi) * 12.9898) * 43758.55), fract(sin((l.z * 47.3 + fi) * 78.233) * 43758.55));
    c = ${LEAVES.margin.toFixed(2)} + ${(1 - 2 * LEAVES.margin).toFixed(2)} * c;
    vec2 d = l.xy - c;
    if (dot(d, d) > reach * reach) continue;
    float ang = fract(sin((l.z * 13.1 + fi) * 37.7) * 9631.3) * 6.2832;
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
    if (1.0 - e > best) {
      best = 1.0 - e;
      tone = (0.9 + 0.22 * fract(fi * 0.618 + l.z * 3.0)) * mix(1.0, vein, veinOn);
    }
  }
  return vec2(best, tone);
}
`;

const LEAF_GLSL = /* glsl */ `
varying vec3 vLeaf;
varying float vFade;
uniform sampler2D uTreeAtlas;
#ifdef LEAF_BAKED
uniform highp sampler2DArray uLeafBake;
#endif
${LEAF_FIELD_GLSL}
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
// rgb: the shade to multiply, a: the coverage of the pixel (0..1). Without
// alpha to coverage a pixel draws when a >= 0.5 (LEAF_AA.cut). The edge is
// anti-aliased over about one pixel (#202). When the leaves on a card get
// smaller than about LEAF_AA.lod pixels, the card changes to one soft clump
// of leaves, so the leaves do not alias into pixel noise far away.
vec4 treeTexel(vec3 l) {
  // The codes are whole numbers apart: compare with a margin, since an
  // interpolated constant is not exact.
  if (l.z < -9.5) {
    vec4 t = texture2D(uTreeAtlas, l.xy);
    float tw = clamp(fwidth(t.a), 1e-3, 0.5);
    return vec4(t.rgb, clamp((t.a - 0.45) / tw + 0.5, 0.0, 1.0));
  }
  if (l.z < -4.5) {
    // A crown core: leaf clumps in the dark inside of the crown. The fine
    // noise fades out where it gets near the pixel size.
    float fine = 1.0 - smoothstep(0.25, 0.5, max(fwidth(l.x), fwidth(l.y)) * 9.0);
    float m = treeNoise(l.xy * 3.4) * 0.55 + mix(0.5, treeNoise(l.xy * 9.0 + 3.1), fine) * 0.45;
    return vec4(vec3(mix(${CORE_SHADE.min.toFixed(2)}, ${CORE_SHADE.max.toFixed(2)}, smoothstep(0.32, 0.68, m))), 1.0);
  }
  if (l.z < -0.5) return vec4(vec3(barkTone(l.xy, int(floor(0.5 - l.z)) - 1)), 1.0);
  if (l.z < 0.025) return vec4(1.0);
  int s = int(floor(l.z));
  int n;
  vec2 size;
  int outline;
  leafShape(s, n, size, outline);
  // The pixel size in card uv, and the clump blend by the leaf width in pixels.
  vec2 uvDx = dFdx(l.xy);
  vec2 uvDy = dFdy(l.xy);
  float px = max(max(length(uvDx), length(uvDy)), 1e-5);
  float clump = smoothstep(${LEAF_AA.lod[0].toFixed(2)}, ${LEAF_AA.lod[1].toFixed(2)}, px / size.x);
  // The cost of a card pixel (#191): the field runs for every card layer of
  // a crown. A card that is one clump (clump 1) skips it: its leaf field
  // has no weight.
  vec2 field = vec2(-1e3, 1.0);
#ifdef LEAF_BAKED
  // Phone and low (#191): the field of the nearest bake variant
  // (bakeLeafCut()). The mip chain filters the veins, so veinOn is not
  // necessary. textureGrad: the read is in a branch, so it gets the
  // derivatives from outside it.
  if (clump < 0.999) {
    float variant = min(floor(fract(l.z) * ${LEAF_BAKE.variants.toFixed(1)}), ${(LEAF_BAKE.variants - 1).toFixed(1)});
    vec2 texel = textureGrad(uLeafBake, vec3(l.xy, float(s) * ${LEAF_BAKE.variants.toFixed(1)} + variant), uvDx, uvDy).rg;
    field = vec2(mix(${LEAF_BAKE.field[0].toFixed(2)}, ${LEAF_BAKE.field[1].toFixed(2)}, texel.r), mix(${LEAF_BAKE.tone[0].toFixed(2)}, ${LEAF_BAKE.tone[1].toFixed(2)}, texel.g));
  }
#else
  // A vein line under one pixel wide gives speckle: it fades out.
  float veinOn = 1.0 - smoothstep(0.5, 1.0, px / (0.16 * size.x));
  // A leaf too far from the pixel to cover it skips the turn and the shape.
  if (clump < 0.999) field = leafField(l, n, size, outline, veinOn, 1.5 * max(size.x, size.y));
#endif
  float best = field.x;
  float tone = field.y;
  // The edge width of the field: one pixel, and not more than the leaf
  // (the needle angle has a seam where fwidth jumps).
  float w = clamp(fwidth(best), 1e-4, 2.0 * px / size.x);
  // The clump: a lobed round shape, one per card, with the mean leaf tone.
#ifdef LEAF_BAKED
  // A card of full leaves (clump 0) skips the clump shape. The clump edge
  // width comes from the pixel size: fwidth() is not defined in a branch.
  float blob = 0.0;
  float bw = 1.0;
  if (clump > 0.001) {
    vec2 q = l.xy - 0.5;
    // atan(0, 0) is undefined in GLSL: a small x offset keeps the card center defined.
    float qa = atan(q.y, q.x + 1e-6);
    float seed = fract(l.z);
    float rim = ${LEAF_AA.clump.toFixed(2)} * (1.0 + 0.12 * sin(3.0 * qa + seed * 37.0) + 0.07 * sin(5.0 * qa + seed * 91.0));
    blob = 1.0 - length(q) / rim;
    bw = clamp(1.2 * px / rim, 1e-4, 0.5);
  }
#else
  vec2 q = l.xy - 0.5;
  // atan(0, 0) is undefined in GLSL: a small x offset keeps the card center defined.
  float qa = atan(q.y, q.x + 1e-6);
  float seed = fract(l.z);
  float rim = ${LEAF_AA.clump.toFixed(2)} * (1.0 + 0.12 * sin(3.0 * qa + seed * 37.0) + 0.07 * sin(5.0 * qa + seed * 91.0));
  float blob = 1.0 - length(q) / rim;
  float bw = clamp(fwidth(blob), 1e-4, 0.5);
#endif
  float leafCov = clamp(best / w + 0.5, 0.0, 1.0);
  float blobCov = clamp(blob / bw + 0.5, 0.0, 1.0);
  float cov = mix(leafCov, blobCov, clump);
  float shade = mix(tone * (0.92 + 0.08 * clamp(best, 0.0, 1.0)), ${LEAF_AA.clumpTone.toFixed(2)} * (0.92 + 0.08 * clamp(blob, 0.0, 1.0)), clump);
  return vec4(vec3(shade), cov);
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
  // The green-gold tint is for leaves: blossoms (red over green) glow in their own color.
  vec3 leafTint = diffuseColor.r > diffuseColor.g ? vec3(1.0) : vec3(${LEAF_BACKLIGHT.tint.map((v) => v.toFixed(2)).join(", ")});
  reflectedLight.indirectDiffuse += diffuseColor.rgb * leafTint * directionalLights[0].color * leafBack * ${LEAF_BACKLIGHT.strength.toFixed(2)};
}
#endif`;

// `cards: false` drops the leaf cards (code > 0) from the pass: the trunks,
// the crown cores and the impostors stay.
// The crown occlusion (pbr look, #202): the sky light on the leaf cards
// goes down to `min` where the crown normal points down, so a crown has a
// lit top and a darker inside. It is smooth over the crown; the screen AO
// (GTAO) does not see the cards. The crown cores do not get it: GTAO sees
// them. Only the indirect (sky) light changes, as an AO term: the albedo
// stays.
export const CROWN_AO = { min: 0.5, range: [-0.75, 0.55] };
const CROWN_AO_GLSL = /* glsl */ `
if (vLeaf.z > 0.025) {
  float crownUp = (vec4(normal, 0.0) * viewMatrix).y;
  float crownAo = mix(${CROWN_AO.min.toFixed(2)}, 1.0, smoothstep(${CROWN_AO.range[0].toFixed(2)}, ${CROWN_AO.range[1].toFixed(2)}, crownUp));
  reflectedLight.indirectDiffuse *= crownAo;
}`;

// Pure: the crown occlusion for the world up part of the crown normal.
export function crownOcclusion(up, { min, range } = CROWN_AO) {
  const t = Math.min(Math.max((up - range[0]) / (range[1] - range[0]), 0), 1);
  return min + (1 - min) * t * t * (3 - 2 * t);
}

// `baked` reads the leaf field from the baked texture array (bakeLeafCut(),
// the phone and low tiers) and not from the leaf loop.
export function patchLeafFragment(shader, { tone = true, backlight = false, cards = true, baked = false } = {}) {
  shader.fragmentShader = (baked ? "#define LEAF_BAKED\n" : "") + shader.fragmentShader
    // Before main(): MeshNormalMaterial has no <common> in its fragment.
    .replace("void main() {", `${LEAF_GLSL}\nvoid main() {`)
    .replace(
      "#include <clipping_planes_fragment>",
      `#include <clipping_planes_fragment>
float fadeDither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
if (vFade > 0.0 && fadeDither < vFade - 1.0) discard;
if (vFade < 0.0 && fadeDither >= -vFade - 1.0) discard;
vec4 leafHit = treeTexel(vLeaf);
#ifdef ALPHA_TO_COVERAGE
if (leafHit.a < ${LEAF_AA.minCoverage.toFixed(3)}) discard;
#else
if (leafHit.a < ${LEAF_AA.cut.toFixed(2)}) discard;
#endif${cards ? "" : "\nif (vLeaf.z > 0.025) discard;"}`,
    );
  // With alpha to coverage (high tier, MSAA) the coverage goes to the alpha:
  // the MSAA resolve then blends the leaf edge.
  if (tone) shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= leafHit.rgb;\n#ifdef ALPHA_TO_COVERAGE\ndiffuseColor.a = leafHit.a;\n#endif");
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
  // `backlight` is the pbr look: the sun through the leaves and the crown occlusion.
  if (backlight) shader.fragmentShader = shader.fragmentShader.replace("#include <lights_fragment_end>", `#include <lights_fragment_end>\n${BACKLIGHT_GLSL}\n${CROWN_AO_GLSL}`);
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

// The leaf cut on an override material (the GTAO normal pass, the toon ink).
// Both sides draw. The leaf cards do not draw (#202): a crown of cards gave
// the AO a depth that changes at each pixel, and the AO turned it into dark
// speckle and a near-black inside. Without the cards a leaf pixel gets the
// smooth AO of what is behind it, and the crown cores still give the crown
// a darker inside. Only the pbr look has leaf cards.
export function withLeafCut(material) {
  material.side = THREE.DoubleSide;
  material.onBeforeCompile = (shader) => {
    patchLeafVertex(shader);
    patchLeafFragment(shader, { tone: false, cards: false });
  };
  material.customProgramCacheKey = () => `leaf-cut-nocards-${material.type}`;
  material.needsUpdate = true;
  return material;
}

// Draws the leaf field of each shape and variant with `renderer` into a
// texture array with a mip chain (LEAF_BAKE), and makes it
// TREE_UNIFORMS.uLeafBake. The bake runs the same GLSL as the procedural
// cut, so a variant has the leaf places of the procedural card with the
// same seed on the same GPU. Returns { texture, layers, bytes }.
export function bakeLeafCut(renderer, bake = LEAF_BAKE) {
  const { size, variants } = bake;
  const { layers, columns, rows, bytes } = leafBakeLayout(bake);
  const target = new THREE.WebGLRenderTarget(columns * size, rows * size, { depthBuffer: false });
  const code = { value: 0 };
  const range = (r) => r.map((v) => v.toFixed(3)).join(", ");
  const material = new THREE.ShaderMaterial({
    uniforms: { uCode: code },
    vertexShader: "varying vec2 vUv;\nvoid main() {\n  vUv = uv;\n  gl_Position = vec4(position.xy, 0.0, 1.0);\n}",
    fragmentShader: `${LEAF_FIELD_GLSL}
uniform float uCode;
varying vec2 vUv;
void main() {
  int n;
  vec2 size;
  int outline;
  leafShape(int(floor(uCode)), n, size, outline);
  // The full vein, and every leaf (no reach): the tone is set out of the leaves too.
  vec2 f = leafField(vec3(vUv, uCode), n, size, outline, 1.0, 1e3);
  vec2 fr = vec2(${range(bake.field)});
  vec2 tr = vec2(${range(bake.tone)});
  gl_FragColor = vec4(clamp((f.x - fr.x) / (fr.y - fr.x), 0.0, 1.0), clamp((f.y - tr.x) / (tr.y - tr.x), 0.0, 1.0), 0.0, 1.0);
}`,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const camera = new THREE.OrthographicCamera();
  const saved = { target: renderer.getRenderTarget(), autoClear: renderer.autoClear };
  // Each tile covers its whole viewport: no clear (a clear takes the whole target).
  renderer.autoClear = false;
  for (let layer = 0; layer < layers; layer += 1) {
    const shape = Math.floor(layer / variants);
    code.value = leafBakeLayer(shape + ((layer % variants) + 0.5) / variants, bake).code;
    target.viewport.set((layer % columns) * size, Math.floor(layer / columns) * size, size, size);
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
  }
  // Read back once into a plain texture array with mips (as the impostor
  // atlas: sampling a render target gave black on SwiftShader).
  const pixels = new Uint8Array(columns * size * rows * size * 4);
  renderer.readRenderTargetPixels(target, 0, 0, columns * size, rows * size, pixels);
  renderer.setRenderTarget(saved.target);
  renderer.autoClear = saved.autoClear;
  target.dispose();
  quad.geometry.dispose();
  material.dispose();
  const data = new Uint8Array(size * size * 2 * layers);
  const stride = columns * size;
  for (let layer = 0; layer < layers; layer += 1) {
    const x0 = (layer % columns) * size;
    const y0 = Math.floor(layer / columns) * size;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const from = ((y0 + y) * stride + x0 + x) * 4;
        const to = ((layer * size + y) * size + x) * 2;
        data[to] = pixels[from];
        data[to + 1] = pixels[from + 1];
      }
    }
  }
  const texture = new THREE.DataArrayTexture(data, size, size, layers);
  texture.format = THREE.RGFormat;
  texture.unpackAlignment = 1;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  TREE_UNIFORMS.uLeafBake.value = texture;
  return { texture, layers, bytes };
}
