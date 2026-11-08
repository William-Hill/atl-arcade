import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { litMaterial } from "./look.js";
import { F, pedLook, lookKey } from "./ped-look.js";

// Three.js view of the walkers from src/sim/peds.js, the gen-city way: one
// part-packed figure in one instanced mesh (one draw call), and the walk
// cycle in the vertex shader. Each vertex knows its part (a leg, an arm, or
// the body), the joint it turns on, its color channel, and its feature bit.
// Each instance gets its walk phase and stride, its colors, and its feature
// bits (ped-look.js): the shader swings the legs and the arms, bobs the
// body, and hides the parts whose bit is off (a hair style, a sleeve, a
// skirt, a bag). The instance matrix sets the height and the build. No
// skeleton and no per-instance animation on the CPU.
//
// The figure faces +x, like the skater and the crowd, and stands on y = 0.

// The joints (m above the ground) and the swing of a walk cycle (rad).
export const WALK = { hip: 0.86, shoulder: 1.42, leg: 0.45, arm: 0.4, bob: 0.035 };
// The top of the head of the figure at scale 1 (m). The instance scale is
// the walker height over this.
export const HEAD_TOP = WALK.shoulder + 0.22 + 0.13;

// The color channels: the part keeps its own color (FIXED) or takes the
// instance shirt, pants, skin, hair, accent, shoe or sleeve color.
const CH = { fixed: 0, shirt: 1, pants: 2, skin: 3, hair: 4, accent: 5, shoe: 6, sleeve: 7 };

// The swing channels: [leg side, arm side, joint height]. A leg swings with
// its side, an arm against the leg on its side.
const BODY = [0, 0, 0];
const leg = (side) => [side, 0, WALK.hip];
const arm = (side) => [0, side, WALK.shoulder];

// pedInfo.x is PED_MARK + the channel: a mesh without the ped attributes
// reads 0 or 1 there (the generic attribute value), so the shader patch
// leaves it as it is.
const PED_MARK = 16;

// One part: `ch` the color channel, `bit` the feature bit (-1: always on).
function part(geometry, { color = 0xffffff, ch = CH.fixed, bit = -1, swing = BODY, at: [x, y, z], scale = null, rotX = 0 }) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (g !== geometry) geometry.dispose();
  if (scale) g.scale(scale[0], scale[1], scale[2]);
  if (rotX) g.rotateX(rotX);
  g.translate(x, y, z);
  for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal") g.deleteAttribute(name);
  const n = g.attributes.position.count;
  const c = new THREE.Color(color);
  const colors = new Float32Array(n * 3);
  const parts = new Float32Array(n * 3);
  const info = new Float32Array(n * 2);
  for (let i = 0; i < n; i += 1) {
    colors.set([c.r, c.g, c.b], i * 3);
    parts.set(swing, i * 3);
    info.set([PED_MARK + ch, bit + 1], i * 2);
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  g.setAttribute("pedPart", new THREE.BufferAttribute(parts, 3));
  g.setAttribute("pedInfo", new THREE.BufferAttribute(info, 2));
  return g;
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const ball = (r, detail = 1) => new THREE.IcosahedronGeometry(r, detail);
// The top half of a sphere, for a hair cap or a hat crown.
const dome = (r) => new THREE.SphereGeometry(r, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2);

// The figure with every optional part, about 1.77 m to the top of the head.
export function pedGeometry() {
  const { hip, shoulder } = WALK;
  const head = shoulder + 0.22;
  const p = [];
  for (const side of [-1, 1]) {
    const sw = leg(side);
    const z = side * 0.1;
    // The thigh, the shin (skin under shorts and skirts), the long pants
    // over the shin, and the shoe.
    p.push(part(box(0.15, 0.42, 0.16), { ch: CH.pants, swing: sw, at: [0, hip - 0.21, z] }));
    p.push(part(box(0.11, 0.4, 0.12), { ch: CH.skin, swing: sw, at: [0, 0.27, z] }));
    p.push(part(box(0.14, 0.41, 0.15), { ch: CH.pants, bit: F.longPants, swing: sw, at: [0, 0.275, z] }));
    p.push(part(box(0.23, 0.08, 0.13), { color: 0x2b2b2b, ch: CH.shoe, swing: sw, at: [0.04, 0.04, z] }));
  }
  // The skirt (or the skirt of a dress), from the waist to the knee.
  p.push(part(new THREE.CylinderGeometry(0.2, 0.27, 0.44, 8), { ch: CH.pants, bit: F.skirt, at: [0, hip - 0.12, 0], scale: [0.85, 1, 1.15] }));
  // The torso, and the open jacket over it with the shirt showing in front.
  p.push(part(box(0.24, shoulder - hip + 0.08, 0.4), { ch: CH.shirt, at: [0, (hip + shoulder) / 2, 0] }));
  p.push(part(box(0.27, shoulder - hip + 0.04, 0.43), { ch: CH.accent, bit: F.jacket, at: [0, (hip + shoulder) / 2 + 0.01, 0] }));
  p.push(part(box(0.02, shoulder - hip - 0.1, 0.13), { ch: CH.shirt, bit: F.jacket, at: [0.136, (hip + shoulder) / 2 + 0.02, 0] }));
  for (const side of [-1, 1]) {
    const sw = arm(side);
    const z = side * 0.26;
    // The upper arm (skin for a tank top), the sleeve, the forearm and the
    // hand, and the long sleeve.
    p.push(part(box(0.085, 0.3, 0.085), { ch: CH.skin, swing: sw, at: [0, shoulder - 0.15, z] }));
    p.push(part(box(0.115, 0.22, 0.115), { ch: CH.sleeve, bit: F.sleeve, swing: sw, at: [0, shoulder - 0.1, z] }));
    p.push(part(box(0.08, 0.32, 0.08), { ch: CH.skin, swing: sw, at: [0, shoulder - 0.44, z] }));
    p.push(part(box(0.1, 0.26, 0.1), { ch: CH.sleeve, bit: F.longSleeve, swing: sw, at: [0, shoulder - 0.36, z] }));
  }
  p.push(part(box(0.1, 0.08, 0.1), { ch: CH.skin, at: [0, shoulder + 0.06, 0] }));
  p.push(part(ball(0.13), { ch: CH.skin, at: [0, head, 0], scale: [0.95, 1.06, 0.9] }));
  // The hair: a cap of hair, an afro, a bun, long hair, locs, a beard.
  p.push(part(dome(0.14), { ch: CH.hair, bit: F.hairShort, at: [-0.02, head + 0.005, 0], scale: [1, 0.9, 0.95] }));
  p.push(part(ball(0.2), { ch: CH.hair, bit: F.afro, at: [-0.04, head + 0.06, 0] }));
  p.push(part(ball(0.07, 0), { ch: CH.hair, bit: F.bun, at: [-0.07, head + 0.15, 0] }));
  p.push(part(box(0.06, 0.34, 0.25), { ch: CH.hair, bit: F.hairLong, at: [-0.1, head - 0.1, 0] }));
  p.push(part(box(0.07, 0.42, 0.2), { ch: CH.hair, bit: F.locs, at: [-0.1, head - 0.14, 0] }));
  for (const side of [-1, 1]) p.push(part(box(0.05, 0.3, 0.04), { ch: CH.hair, bit: F.locs, at: [-0.03, head - 0.13, side * 0.12] }));
  p.push(part(box(0.07, 0.09, 0.17), { ch: CH.hair, bit: F.beard, at: [0.07, head - 0.08, 0] }));
  // The hats: a cap with a brim, and a beanie.
  p.push(part(dome(0.145), { ch: CH.accent, bit: F.cap, at: [-0.01, head + 0.02, 0], scale: [1, 0.85, 0.97] }));
  p.push(part(box(0.13, 0.02, 0.19), { ch: CH.accent, bit: F.cap, at: [0.15, head + 0.03, 0] }));
  p.push(part(ball(0.145), { ch: CH.accent, bit: F.beanie, at: [-0.01, head + 0.06, 0], scale: [1, 0.8, 0.97] }));
  // The glasses and the headphones.
  p.push(part(box(0.02, 0.035, 0.2), { color: 0x151515, bit: F.glasses, at: [0.125, head + 0.02, 0] }));
  p.push(part(box(0.04, 0.03, 0.31), { ch: CH.accent, bit: F.headphones, at: [-0.01, head + 0.14, 0] }));
  for (const side of [-1, 1]) p.push(part(box(0.07, 0.09, 0.04), { ch: CH.accent, bit: F.headphones, at: [0, head, side * 0.14] }));
  // The bags: a backpack, a tote at the side, a crossbody bag and strap.
  p.push(part(box(0.16, 0.4, 0.32), { ch: CH.accent, bit: F.backpack, at: [-0.2, shoulder - 0.25, 0] }));
  p.push(part(box(0.26, 0.3, 0.06), { ch: CH.accent, bit: F.tote, at: [0, hip + 0.05, 0.33] }));
  p.push(part(box(0.025, 0.66, 0.035), { ch: CH.accent, bit: F.crossbody, at: [0.128, (hip + shoulder) / 2 + 0.03, 0], rotX: 0.62 }));
  p.push(part(box(0.07, 0.15, 0.2), { ch: CH.accent, bit: F.crossbody, at: [0.1, hip + 0.06, -0.2] }));
  const g = mergeGeometries(p);
  for (const q of p) q.dispose();
  return g;
}

// The walk in the vertex shader. pedAnim = (phase, stride, genes): the phase
// advances with the distance walked (src/sim/peds.js), the stride (0..1) is
// how far the limbs swing (0 standing), and the genes are the feature bits.
// A part turns about its joint on the z axis (the figure faces +x), so the
// normal turns too. A part whose bit is off folds to one point and draws
// nothing.
const WALK_GLSL = /* glsl */ `
attribute vec3 pedPart;
attribute vec2 pedInfo;
attribute vec3 pedAnim;
vec3 pedTurn(vec3 v, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(v.x * c - v.y * s, v.x * s + v.y * c, v.z);
}
bool pedGene(int bit) {
  return ((int(pedAnim.z + 0.5) >> bit) & 1) == 1;
}`;

// Pure on the shader: the walk and the feature fold, on any material with
// <beginnormal_vertex> and <begin_vertex>. A mesh without the ped
// attributes reads them as 0: no swing, no bob, every part on. So the
// override material of the AO and ink pass (post.js) takes it too, and
// draws the walkers as the main pass does.
export function patchPedVertex(shader) {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\n${WALK_GLSL}`)
    .replace(
        "#include <beginnormal_vertex>",
        `bool pedIs = pedInfo.x > ${(PED_MARK - 0.5).toFixed(1)};
float pedSwing = pedIs ? sin(pedAnim.x) * pedAnim.y : 0.0;
float pedA = (pedPart.x * ${WALK.leg.toFixed(3)} - pedPart.y * ${WALK.arm.toFixed(3)}) * pedSwing;
int pedBit = int(pedInfo.y + 0.5) - 1;
bool pedOn = !pedIs || pedBit < 0 || pedGene(pedBit);
vec3 objectNormal = pedTurn(vec3(normal), pedA);
#ifdef USE_TANGENT
vec3 objectTangent = vec3(tangent.xyz);
#endif`,
      )
      .replace(
        "#include <begin_vertex>",
        `vec3 transformed = vec3(position);
if (pedIs && pedPart.z > 0.0) {
  transformed.y -= pedPart.z;
  transformed = pedTurn(transformed, pedA);
  transformed.y += pedPart.z;
}
// The body is highest when the legs pass each other.
if (pedIs) transformed.y += ${WALK.bob.toFixed(3)} * pedAnim.y * (abs(cos(pedAnim.x)) - 0.5);
#ifdef USE_ALPHAHASH
vPosition = vec3(position);
#endif
if (!pedOn) transformed = vec3(0.0);`,
    );
}

function pedMaterial(look, gradientMap) {
  const mat = litMaterial(look, { vertexColors: true }, { gradientMap });
  mat.onBeforeCompile = (shader) => {
    patchPedVertex(shader);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 pedSkin;\nattribute vec3 pedPants;\nattribute vec3 pedHair;\nattribute vec3 pedAccent;")
      .replace(
        "#include <color_vertex>",
        `vColor = vec4(color, 1.0);
vec3 pedShirt = vec3(1.0);
#ifdef USE_INSTANCING_COLOR
pedShirt = instanceColor.rgb;
#endif
int pedCh = int(pedInfo.x + 0.5) - ${PED_MARK};
if (pedCh == ${CH.shirt}) vColor.rgb = pedShirt;
else if (pedCh == ${CH.pants}) vColor.rgb = pedPants;
else if (pedCh == ${CH.skin}) vColor.rgb = pedSkin;
else if (pedCh == ${CH.hair}) vColor.rgb = pedHair;
else if (pedCh == ${CH.accent}) vColor.rgb = pedAccent;
else if (pedCh == ${CH.shoe}) vColor.rgb = pedGene(${F.shoeWhite}) ? vec3(0.86, 0.86, 0.84) : pedGene(${F.shoeAccent}) ? pedAccent : vColor.rgb;
else if (pedCh == ${CH.sleeve}) vColor.rgb = pedGene(${F.jacket}) ? pedAccent : pedShirt;`,
      );
  };
  mat.customProgramCacheKey = () => `peds-v2-${look}`;
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

export { pedLook };

// Builds the mesh for a pool of walkers. sync(state) packs the live walkers
// into its instances. Call it once a frame.
export function createPedsView(state, { look = "toon" } = {}) {
  const group = new THREE.Group();
  group.name = "peds";
  const material = pedMaterial(look, look === "pbr" ? null : rampTexture());
  const size = state.peds.length;
  const geometry = pedGeometry();
  const attr = (name, n) => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, size) * n), n);
    a.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, a);
    return a;
  };
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, size));
  mesh.name = "peds";
  // The walkers spread around the camera; the template bounds would cull
  // them wrongly.
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.setColorAt(0, new THREE.Color());
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  const skinAttr = attr("pedSkin", 3);
  const pantsAttr = attr("pedPants", 3);
  const hairAttr = attr("pedHair", 3);
  const accentAttr = attr("pedAccent", 3);
  const animAttr = attr("pedAnim", 3);
  mesh.count = 0;
  group.add(mesh);
  const meshes = [mesh];

  // The looks are fixed per walker look number; cache them.
  const looks = new Map();
  const lookOf = (n) => {
    if (!looks.has(n)) {
      // Clear a full cache before the new entry, so the entry stays.
      if (looks.size >= 4096) looks.clear();
      const l = pedLook(n);
      const color = (hex) => new THREE.Color(hex);
      looks.set(n, { ...l, key: lookKey(l), shirtC: color(l.shirt), pantsC: color(l.pants), skinC: color(l.skin), hairC: color(l.hair), accentC: color(l.accent) });
    }
    return looks.get(n);
  };

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  let drawn = 0;
  const put = (a, k, c) => a.setXYZ(k, c.r, c.g, c.b);
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
      return (geometry.attributes.position.count / 3) * mesh.count;
    },
    // The look key of a walker look number (for the variety check), and the
    // walker height (m, the top of the head).
    lookKey(n) {
      return lookOf(n).key;
    },
    heightOf(n) {
      return lookOf(n).height;
    },
    // skip: walker ids drawn elsewhere (the Meshy people of ped-models.js).
    sync(st, skip = null) {
      // Walkers grow in over the outer 15% of the pool, so the ones that
      // come and go at its edge never pop on a clear horizon.
      const [fx, fz] = st.focus;
      const band = 0.15 * st.radius;
      mesh.count = 0;
      drawn = 0;
      for (const w of st.peds) {
        if (!w.live || skip?.has(w.id)) continue;
        const l = lookOf(w.look);
        const grow = Math.min(1, (st.radius - Math.hypot(w.x - fx, w.z - fz)) / band);
        if (grow <= 0) continue;
        q.setFromAxisAngle(up, Math.atan2(-w.fz, w.fx));
        p.set(w.x, w.y, w.z);
        const h = (l.height / HEAD_TOP) * grow;
        s.set(h * l.depth, h, h * l.width);
        m.compose(p, q, s);
        const k = mesh.count;
        mesh.count += 1;
        drawn += 1;
        mesh.setMatrixAt(k, m);
        mesh.setColorAt(k, l.shirtC);
        put(skinAttr, k, l.skinC);
        put(pantsAttr, k, l.pantsC);
        put(hairAttr, k, l.hairC);
        put(accentAttr, k, l.accentC);
        animAttr.setXYZ(k, w.phase, Math.min(1, w.speed / 1.1), l.genes);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      for (const a of [skinAttr, pantsAttr, hairAttr, accentAttr, animAttr]) a.needsUpdate = true;
    },
  };
}
