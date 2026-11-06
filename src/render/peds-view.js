import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { litMaterial } from "./look.js";

// Three.js view of the walkers from src/sim/peds.js, the gen-city way: a
// few part-packed figures, each one instanced mesh (one draw call), and the
// walk cycle in the vertex shader. Each vertex knows its part (a leg, an
// arm, or the body) and the joint it turns on, and each instance gets its
// walk phase and stride; the shader swings the legs and the arms and bobs
// the body. No skeleton and no per-instance animation on the CPU: the CPU
// writes one matrix, three colors and two numbers per walker.
//
// The figures face +x, like the skater and the crowd, and stand on y = 0.

const SHIRTS = [0xe03a3e, 0xffd23f, 0x2ec4b6, 0xff8c42, 0x9b5de5, 0x8ac926, 0x3a86ff, 0xf15bb5, 0x00bbf9, 0xffffff, 0xc8102e, 0x1d428a];
const PANTS = [0x2b2d42, 0x3d405b, 0x4a6fa5, 0x6b705c, 0xe9d8a6, 0x22223b, 0x8d6346];
const SKINS = [0x4a2c1d, 0x5a3825, 0x7a4b2a, 0x9c6b43, 0xc68e5e, 0xe0b48a, 0xf1cfa8];
const HAIR = [0x1b1b1b, 0x2e1f14, 0x4b3621, 0x111111, 0x6d4c33];

// The tint channels: the part takes the instance shirt, skin, or pants
// color, or keeps its own (FIXED).
const FIXED = [0, 0, 0];
const SHIRT = [1, 0, 0];
const SKIN = [0, 1, 0];
const PANT = [0, 0, 1];

// The joints (m above the ground) and the swing of a walk cycle (rad).
export const WALK = { hip: 0.86, shoulder: 1.42, leg: 0.45, arm: 0.4, bob: 0.035 };

// The swing channels: [leg side, arm side, joint height]. A leg swings with
// its side, an arm against the leg on its side.
const BODY = [0, 0, 0];
const leg = (side) => [side, 0, WALK.hip];
const arm = (side) => [0, side, WALK.shoulder];

function part(geometry, color, tint, swing, [x, y, z]) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (g !== geometry) geometry.dispose();
  g.translate(x, y, z);
  for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal") g.deleteAttribute(name);
  const n = g.attributes.position.count;
  const c = new THREE.Color(color);
  const colors = new Float32Array(n * 3);
  const tints = new Float32Array(n * 3);
  const parts = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    colors.set([c.r, c.g, c.b], i * 3);
    tints.set(tint, i * 3);
    parts.set(swing, i * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  g.setAttribute("pedTint", new THREE.BufferAttribute(tints, 3));
  g.setAttribute("pedPart", new THREE.BufferAttribute(parts, 3));
  return g;
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const head = (r) => new THREE.IcosahedronGeometry(r, 0);

// The figure variants: a walker, a walker in a dress with a tote bag, and
// a walker with a backpack and a cap. About 1.75 m tall at scale 1.
export const VARIANTS = ["walker", "tote", "backpack"];

export function pedGeometry(variant, hair = HAIR[0]) {
  const { hip, shoulder } = WALK;
  const legLen = hip - 0.02;
  const p = [];
  // The legs hang from the hip joint; the shoes are part of the leg.
  for (const side of [-1, 1]) {
    p.push(part(box(0.14, legLen, 0.15), 0xffffff, variant === "tote" ? SKIN : PANT, leg(side), [0, hip - legLen / 2, side * 0.1]));
    p.push(part(box(0.22, 0.07, 0.13), 0x2b2b2b, FIXED, leg(side), [0.04, 0.035, side * 0.1]));
  }
  if (variant === "tote") p.push(part(box(0.3, 0.42, 0.42), 0xffffff, SHIRT, BODY, [0, hip - 0.12, 0]));
  p.push(part(box(0.24, shoulder - hip + 0.08, 0.4), 0xffffff, SHIRT, BODY, [0, (hip + shoulder) / 2, 0]));
  // The arms hang from the shoulder joint, sleeve and hand.
  for (const side of [-1, 1]) {
    p.push(part(box(0.11, 0.3, 0.11), 0xffffff, SHIRT, arm(side), [0, shoulder - 0.15, side * 0.26]));
    p.push(part(box(0.09, 0.32, 0.09), 0xffffff, SKIN, arm(side), [0, shoulder - 0.44, side * 0.26]));
  }
  p.push(part(box(0.1, 0.08, 0.1), 0xffffff, SKIN, BODY, [0, shoulder + 0.06, 0]));
  p.push(part(head(0.13), 0xffffff, SKIN, BODY, [0, shoulder + 0.22, 0]));
  p.push(part(box(0.24, 0.09, 0.25), hair, FIXED, BODY, [-0.02, shoulder + 0.32, 0]));
  if (variant === "tote") {
    p.push(part(box(0.08, 0.1, 0.08), hair, FIXED, BODY, [-0.14, shoulder + 0.27, 0]));
    p.push(part(box(0.26, 0.3, 0.06), 0xe9d8a6, FIXED, BODY, [0, hip + 0.05, 0.31]));
  }
  if (variant === "backpack") {
    p.push(part(box(0.16, 0.4, 0.32), 0x2ec4b6, FIXED, BODY, [-0.2, shoulder - 0.25, 0]));
    p.push(part(box(0.3, 0.05, 0.27), 0xe03a3e, FIXED, BODY, [0.04, shoulder + 0.36, 0]));
  }
  const g = mergeGeometries(p);
  for (const q of p) q.dispose();
  return g;
}

// The walk in the vertex shader. pedAnim = (phase, stride): the phase
// advances with the distance walked (src/sim/peds.js), and the stride
// (0..1) is how far the limbs swing (0 standing). A part turns about its
// joint on the z axis (the figure faces +x), so the normal turns too.
const WALK_GLSL = /* glsl */ `
attribute vec3 pedTint;
attribute vec3 pedPart;
attribute vec3 pedSkin;
attribute vec3 pedPants;
attribute vec2 pedAnim;
vec3 pedTurn(vec3 v, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(v.x * c - v.y * s, v.x * s + v.y * c, v.z);
}`;

function pedMaterial(look, gradientMap) {
  const mat = litMaterial(look, { vertexColors: true }, { gradientMap });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${WALK_GLSL}`)
      .replace(
        "#include <beginnormal_vertex>",
        `float pedSwing = sin(pedAnim.x) * pedAnim.y;
float pedA = (pedPart.x * ${WALK.leg.toFixed(3)} - pedPart.y * ${WALK.arm.toFixed(3)}) * pedSwing;
vec3 objectNormal = pedTurn(vec3(normal), pedA);
#ifdef USE_TANGENT
vec3 objectTangent = vec3(tangent.xyz);
#endif`,
      )
      .replace(
        "#include <begin_vertex>",
        `vec3 transformed = vec3(position);
if (pedPart.z > 0.0) {
  transformed.y -= pedPart.z;
  transformed = pedTurn(transformed, pedA);
  transformed.y += pedPart.z;
}
// The body is highest when the legs pass each other.
transformed.y += ${WALK.bob.toFixed(3)} * pedAnim.y * (abs(cos(pedAnim.x)) - 0.5);`,
      )
      .replace(
        "#include <color_vertex>",
        `vColor = vec4(color, 1.0);
#ifdef USE_INSTANCING_COLOR
vColor.rgb = mix(vColor.rgb, instanceColor.rgb, pedTint.x);
#endif
vColor.rgb = mix(vColor.rgb, pedSkin, pedTint.y);
vColor.rgb = mix(vColor.rgb, pedPants, pedTint.z);`,
      );
  };
  mat.customProgramCacheKey = () => `peds-v1-${look}`;
  return mat;
}

function rampTexture() {
  const data = new Uint8Array([120, 120, 120, 255, 190, 190, 190, 255, 255, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// The look of a walker from its seeded `look` number: the variant, the
// colors, and the height.
export function pedLook(n) {
  const at = (bits, list) => list[(n >>> bits) % list.length];
  return {
    variant: n % VARIANTS.length,
    shirt: at(3, SHIRTS),
    pants: at(8, PANTS),
    skin: at(13, SKINS),
    scale: 0.92 + (((n >>> 18) % 16) / 15) * 0.16,
  };
}

// Builds the meshes for a pool of walkers. sync(state) packs the live
// walkers into the instances of their variant mesh. Call it once a frame.
export function createPedsView(state, { look = "toon" } = {}) {
  const group = new THREE.Group();
  group.name = "peds";
  const material = pedMaterial(look, look === "pbr" ? null : rampTexture());
  const size = state.peds.length;
  const meshes = VARIANTS.map((variant, i) => {
    const geometry = pedGeometry(variant, HAIR[i % HAIR.length]);
    const attr = (name, n) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(size * n), n);
      a.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(name, a);
      return a;
    };
    const mesh = new THREE.InstancedMesh(geometry, material, size);
    mesh.name = `peds-${variant}`;
    // The walkers spread around the camera; the template bounds would cull
    // them wrongly.
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, new THREE.Color());
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.userData.skin = attr("pedSkin", 3);
    mesh.userData.pants = attr("pedPants", 3);
    mesh.userData.anim = attr("pedAnim", 2);
    mesh.count = 0;
    group.add(mesh);
    return mesh;
  });

  // The colors are fixed per walker look; cache them.
  const looks = new Map();
  const lookOf = (n) => {
    if (!looks.has(n)) {
      // Clear a full cache before the new entry, so the entry stays.
      if (looks.size >= 4096) looks.clear();
      const l = pedLook(n);
      looks.set(n, { ...l, shirt: new THREE.Color(l.shirt), pants: new THREE.Color(l.pants), skin: new THREE.Color(l.skin) });
    }
    return looks.get(n);
  };

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  let drawn = 0;
  return {
    group,
    meshes,
    get drawCalls() {
      return meshes.length;
    },
    get drawn() {
      return drawn;
    },
    get triangles() {
      return meshes.reduce((sum, mesh) => sum + (mesh.geometry.attributes.position.count / 3) * mesh.count, 0);
    },
    sync(st) {
      // Walkers grow in over the outer 15% of the pool, so the ones that
      // come and go at its edge never pop on a clear horizon.
      const [fx, fz] = st.focus;
      const band = 0.15 * st.radius;
      for (const mesh of meshes) mesh.count = 0;
      drawn = 0;
      for (const w of st.peds) {
        if (!w.live) continue;
        const l = lookOf(w.look);
        const mesh = meshes[l.variant];
        q.setFromAxisAngle(up, Math.atan2(-w.fz, w.fx));
        p.set(w.x, w.y, w.z);
        const grow = Math.min(1, (st.radius - Math.hypot(w.x - fx, w.z - fz)) / band);
        if (grow <= 0) continue;
        s.setScalar(l.scale * grow);
        m.compose(p, q, s);
        const k = mesh.count;
        mesh.count += 1;
        drawn += 1;
        mesh.setMatrixAt(k, m);
        mesh.setColorAt(k, l.shirt);
        mesh.userData.skin.setXYZ(k, l.skin.r, l.skin.g, l.skin.b);
        mesh.userData.pants.setXYZ(k, l.pants.r, l.pants.g, l.pants.b);
        mesh.userData.anim.setXY(k, w.phase, Math.min(1, w.speed / 1.1));
      }
      for (const mesh of meshes) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;
        mesh.userData.skin.needsUpdate = true;
        mesh.userData.pants.needsUpdate = true;
        mesh.userData.anim.needsUpdate = true;
      }
    },
  };
}
