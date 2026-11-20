import * as THREE from "three";
import { EYES, MOUTHS } from "./face-anim.js";

// Face decals for a skater model. The face is painted on the base-color
// texture, and the mesh has no eyelids or lips to move. A decal projects
// eye and mouth states onto the front of the head in bind-pose space, so it
// follows the skin. scripts/art/nia_face_decals.py paints the atlases.
//
// rect: [x0, x1, y0, y1] in meters, glTF bind-pose space (+y up, the face
// looks to +z). Each atlas is one row of cells in the order of `states`.
export const FACE_DECALS = {
  nia: {
    eyes: { url: new URL("../../assets/skaters/nia/face/eyes.png", import.meta.url).href, rect: [-0.075, 0.075, 1.432, 1.486], states: EYES },
    mouth: { url: new URL("../../assets/skaters/nia/face/mouth.png", import.meta.url).href, rect: [-0.05, 0.046, 1.362, 1.405], states: MOUTHS },
  },
};

// Only surfaces that face the front get the decal: not the ears, not the
// back of the head.
const MIN_NORMAL_Z = 0.35;

const DECL_VERTEX = /* glsl */ `
varying vec3 vFacePos;
varying float vFaceNz;
`;
const DECL_FRAGMENT = /* glsl */ `
varying vec3 vFacePos;
varying float vFaceNz;
uniform sampler2D uFaceEyes;
uniform sampler2D uFaceMouth;
uniform vec4 uFaceEyeRect;   // x0, y0, width, height
uniform vec4 uFaceMouthRect;
uniform vec2 uFaceCells;     // eye cell count, mouth cell count
uniform vec2 uFaceState;     // eye cell, mouth cell
vec4 faceDecal(sampler2D map, vec4 rect, float cells, float cell) {
  vec2 e = (vFacePos.xy - rect.xy) / rect.zw;
  if (e.x < 0.0 || e.x > 1.0 || e.y < 0.0 || e.y > 1.0) return vec4(0.0);
  return texture2D(map, vec2((cell + clamp(e.x, 0.002, 0.998)) / cells, e.y));
}
`;
const APPLY_FRAGMENT = /* glsl */ `
float faceA = 0.0;
if (vFaceNz > ${MIN_NORMAL_Z.toFixed(2)} && vFacePos.z > 0.0) {
  vec4 fe = faceDecal(uFaceEyes, uFaceEyeRect, uFaceCells.x, uFaceState.x);
  diffuseColor.rgb = mix(diffuseColor.rgb, fe.rgb * diffuse, fe.a);
  vec4 fm = faceDecal(uFaceMouth, uFaceMouthRect, uFaceCells.y, uFaceState.y);
  diffuseColor.rgb = mix(diffuseColor.rgb, fm.rgb * diffuse, fm.a);
  faceA = fe.a;
}
`;
// The normal map and the roughness map carry the painted eyes too (shine on
// the eyes, edges on the lids). Under the eye decal they become flat skin.
const SKIN_ROUGHNESS = 0.75;
const APPLY_ROUGHNESS = /* glsl */ `
roughnessFactor = mix(roughnessFactor, ${SKIN_ROUGHNESS.toFixed(2)}, faceA);
`;
const APPLY_METALNESS = /* glsl */ `
metalnessFactor = mix(metalnessFactor, 0.0, faceA);
`;
const APPLY_NORMAL = /* glsl */ `
normal = normalize(mix(normal, nonPerturbedNormal, faceA));
`;

const rectVec = ([x0, x1, y0, y1]) => new THREE.Vector4(x0, y0, x1 - x0, y1 - y0);

async function loadDecal(url) {
  const tex = await new THREE.TextureLoader().loadAsync(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// Pure: true when the geometry has a front vertex (z > 0) inside one of the
// rects [x0, x1, y0, y1] (bind-pose meters).
export function coversRect(position, rects) {
  for (let i = 0; i < position.count; i += 1) {
    const z = position.getZ(i);
    if (z <= 0) continue;
    const x = position.getX(i);
    const y = position.getY(i);
    for (const [x0, x1, y0, y1] of rects) if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return true;
  }
  return false;
}

// Adds the face decal to the materials of the meshes. A glTF mesh with many
// primitives loads as many meshes (one per material, #167), so the decal
// goes to each mesh that has front vertices under the eye or mouth rect: the
// head, and the skin under the mouth. Accepts one mesh or an array.
// Returns { set(eyes, mouth), eyes, mouth, meshes }, or null when the skater
// has no face decals.
export async function attachFace(meshes, name = "nia") {
  const spec = FACE_DECALS[name];
  if (!spec) return null;
  const list = Array.isArray(meshes) ? meshes : [meshes];
  const under = list.filter((m) => coversRect(m.geometry.attributes.position, [spec.eyes.rect, spec.mouth.rect]));
  // With no mesh under the rects, the first mesh gets the decal (as before #167).
  const targets = under.length > 0 ? under : list.slice(0, 1);
  const [eyesTex, mouthTex] = await Promise.all([loadDecal(spec.eyes.url), loadDecal(spec.mouth.url)]);
  const uniforms = {
    uFaceEyes: { value: eyesTex },
    uFaceMouth: { value: mouthTex },
    uFaceEyeRect: { value: rectVec(spec.eyes.rect) },
    uFaceMouthRect: { value: rectVec(spec.mouth.rect) },
    uFaceCells: { value: new THREE.Vector2(spec.eyes.states.length, spec.mouth.states.length) },
    uFaceState: { value: new THREE.Vector2(0, 0) },
  };
  for (const mesh of targets) {
    const material = mesh.material.clone();
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = DECL_VERTEX + shader.vertexShader
        .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\nvFaceNz = objectNormal.z;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFacePos = position;");
      shader.fragmentShader = DECL_FRAGMENT + shader.fragmentShader
        .replace("#include <map_fragment>", `#include <map_fragment>\n${APPLY_FRAGMENT}`)
        .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\n${APPLY_ROUGHNESS}`)
        .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>\n${APPLY_METALNESS}`)
        .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>\n${APPLY_NORMAL}`);
    };
    material.customProgramCacheKey = () => "skater-face";
    mesh.material = material;
  }

  const face = { eyes: spec.eyes.states[0], mouth: spec.mouth.states[0], meshes: targets };
  face.set = (eyes, mouth) => {
    const e = spec.eyes.states.indexOf(eyes);
    const m = spec.mouth.states.indexOf(mouth);
    if (e < 0) throw new Error(`Unknown eye state: ${eyes}`);
    if (m < 0) throw new Error(`Unknown mouth state: ${mouth}`);
    uniforms.uFaceState.value.set(e, m);
    face.eyes = eyes;
    face.mouth = mouth;
  };
  return face;
}
