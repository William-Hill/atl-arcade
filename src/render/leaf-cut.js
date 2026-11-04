import * as THREE from "three";

// The leaf cut-out of a tree card (src/level/geo/trees.js LEAF_CARDS): up to
// LEAVES.count leaf ellipses at places from the card seed. A pixel outside
// every leaf is discarded. The shadow pass uses the same cut, so a card
// does not cast a square shadow.
export const LEAVES = { count: 7, size: [0.11, 0.19], margin: 0.2 };
const LEAF_GLSL = /* glsl */ `
varying vec3 vLeaf;
// x: 1 inside a leaf (0 outside), y: the leaf shade.
vec2 leafCut(vec3 l) {
  float best = 0.0;
  float tone = 1.0;
  for (int i = 0; i < ${LEAVES.count}; i++) {
    float fi = float(i);
    vec2 c = vec2(fract(sin((l.z * 91.7 + fi) * 12.9898) * 43758.55), fract(sin((l.z * 47.3 + fi) * 78.233) * 43758.55));
    c = ${LEAVES.margin.toFixed(2)} + ${(1 - 2 * LEAVES.margin).toFixed(2)} * c;
    float ang = fract(sin((l.z * 13.1 + fi) * 37.7) * 9631.3) * 6.2832;
    vec2 d = l.xy - c;
    d = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * d;
    float e = length(d / vec2(${LEAVES.size[0].toFixed(3)}, ${LEAVES.size[1].toFixed(3)}));
    if (e < 1.0 && 1.0 - e > best) {
      best = 1.0 - e;
      tone = 0.8 + 0.34 * fract(fi * 0.618 + l.z * 3.0);
    }
  }
  return vec2(best > 0.0 ? 1.0 : 0.0, tone * (0.86 + 0.14 * best));
}`;

export function patchLeafVertex(shader) {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nattribute vec3 leaf;\nvarying vec3 vLeaf;")
    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLeaf = leaf;");
}

export function patchLeafFragment(shader, { tone = true } = {}) {
  shader.fragmentShader = shader.fragmentShader
    // Before main(): MeshNormalMaterial has no <common> in its fragment.
    .replace("void main() {", `${LEAF_GLSL}\nvoid main() {`)
    .replace(
      "#include <clipping_planes_fragment>",
      `#include <clipping_planes_fragment>
vec2 leafHit = vLeaf.z > 0.0 ? leafCut(vLeaf) : vec2(1.0);
if (leafHit.x < 0.5) discard;`,
    );
  if (tone) shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= leafHit.y;");
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
