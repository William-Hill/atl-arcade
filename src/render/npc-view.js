import * as THREE from "three";
import { litMaterial } from "./look.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { seededRandom } from "../sim/npc/crowd.js";

// Three.js view of the crowd from src/sim/npc/crowd.js. One instanced mesh
// per NPC type, so the crowd costs one draw call per type. The figures are
// low-poly and built here from primitives with vertex colors. Each instance
// gets its own shirt color and skin tone. The figures face +x, like the
// skater, and stand on y = 0.

const SHIRTS = [0xff5fb2, 0x2ec4b6, 0xffd23f, 0xff8c42, 0x9b5de5, 0x8ac926, 0x3a86ff, 0xf15bb5, 0x00bbf9, 0xfee440];
const SKINS = [0x3b2219, 0x5a3825, 0x6e4430, 0x7a4b2a, 0x9c6b43, 0xb07a52, 0xc68e5e, 0xe0b48a, 0xf1cfa8];
const PANTS = [0x2b2d42, 0x3d405b, 0x4a6fa5, 0x6b8cbf, 0x6b705c, 0xe9d8a6, 0x22223b, 0x8d6346, 0x5c5c5c, 0x556b2f];
const HAIRS = [0x111111, 0x1b1b1b, 0x2e1f14, 0x4b3621, 0x6d4c33, 0x8a8a8a, 0xc8a165, 0x8c3b1e];

// tint: 0 keeps the vertex color, 1 takes the instance shirt color, 2 the
// instance skin tone, 3 the instance pants color, 4 the instance hair color.
const FIXED = 0;
const SHIRT = 1;
const SKIN = 2;
const PANT = 3;
const HAIR = 4;

function part(geometry, color, tint, [x, y, z], rotation = null) {
  // Non-indexed, because the icosahedron head is non-indexed and the merge
  // needs one kind.
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (g !== geometry) geometry.dispose();
  if (rotation) g.rotateX(rotation[0]).rotateY(rotation[1]).rotateZ(rotation[2]);
  g.translate(x, y, z);
  for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal") g.deleteAttribute(name);
  const n = g.attributes.position.count;
  const c = new THREE.Color(color);
  const colors = new Float32Array(n * 3);
  const tints = new Float32Array(n * 4);
  for (let i = 0; i < n; i += 1) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
    tints[i * 4] = tint === SHIRT ? 1 : 0;
    tints[i * 4 + 1] = tint === SKIN ? 1 : 0;
    tints[i * 4 + 2] = tint === PANT ? 1 : 0;
    tints[i * 4 + 3] = tint === HAIR ? 1 : 0;
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  g.setAttribute("tint", new THREE.BufferAttribute(tints, 4));
  return g;
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
// Detail 0: 20 faces. At NPC size a finer head costs triangles and adds no look.
const head = (r) => new THREE.IcosahedronGeometry(r, 0);

// A person, about 1.7 m tall at scale 1. The pants and the hair take the
// instance colors; `hair: false` is for a helmet. The extras change by type.
function person({ scale = 1, at = [0, 0, 0], seated = false, hair = true, extras = [] } = {}) {
  const pants = 0xffffff;
  const parts = [];
  const legH = 0.82;
  if (!seated) {
    parts.push(part(box(0.14, legH, 0.14), pants, PANT, [0, legH / 2, -0.1]));
    parts.push(part(box(0.14, legH, 0.14), pants, PANT, [0, legH / 2, 0.1]));
  } else {
    parts.push(part(box(0.42, 0.13, 0.36), pants, PANT, [0.12, legH - 0.06, 0]));
    parts.push(part(box(0.12, 0.5, 0.12), pants, PANT, [0.3, legH - 0.3, -0.1]));
    parts.push(part(box(0.12, 0.5, 0.12), pants, PANT, [0.3, legH - 0.3, 0.1]));
  }
  parts.push(part(box(0.26, 0.58, 0.42), 0xffffff, SHIRT, [0, legH + 0.29, 0]));
  parts.push(part(box(0.12, 0.5, 0.11), 0xffffff, SHIRT, [0, legH + 0.32, -0.27]));
  parts.push(part(box(0.12, 0.5, 0.11), 0xffffff, SHIRT, [0, legH + 0.32, 0.27]));
  parts.push(part(box(0.1, 0.1, 0.1), 0xffffff, SKIN, [0, legH + 0.03, -0.27]));
  parts.push(part(box(0.1, 0.1, 0.1), 0xffffff, SKIN, [0, legH + 0.03, 0.27]));
  parts.push(part(box(0.1, 0.08, 0.1), 0xffffff, SKIN, [0, legH + 0.62, 0]));
  parts.push(part(head(0.13), 0xffffff, SKIN, [0, legH + 0.78, 0]));
  if (hair) parts.push(part(new THREE.SphereGeometry(0.14, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), 0xffffff, HAIR, [-0.02, legH + 0.79, 0]));
  parts.push(...extras.map((f) => f(legH)));
  for (const p of parts) {
    p.scale(scale, scale, scale);
    p.translate(at[0], at[1], at[2]);
  }
  return parts;
}

function dog(at) {
  const fur = 0xb07a3c;
  const parts = [
    part(box(0.5, 0.2, 0.2), fur, FIXED, [0, 0.38, 0]),
    part(box(0.18, 0.18, 0.16), fur, FIXED, [0.3, 0.5, 0]),
    part(box(0.1, 0.07, 0.1), 0x3b2412, FIXED, [0.42, 0.47, 0]),
    part(box(0.12, 0.05, 0.04), 0x3b2412, FIXED, [-0.28, 0.48, 0], [0, 0, 0.6]),
  ];
  for (const [x, z] of [
    [0.18, -0.07],
    [0.18, 0.07],
    [-0.18, -0.07],
    [-0.18, 0.07],
  ]) {
    parts.push(part(box(0.06, 0.28, 0.06), fur, FIXED, [x, 0.14, z]));
  }
  for (const p of parts) p.translate(at[0], at[1], at[2]);
  return parts;
}

function bike() {
  const frame = 0x222831;
  const wheel = (x) => part(new THREE.TorusGeometry(0.32, 0.035, 4, 12), 0x1a1a1a, FIXED, [x, 0.36, 0]);
  return [
    wheel(0.5),
    wheel(-0.5),
    part(box(0.9, 0.05, 0.05), frame, FIXED, [0, 0.62, 0]),
    part(box(0.05, 0.4, 0.05), frame, FIXED, [-0.2, 0.5, 0], [0, 0, -0.3]),
    part(box(0.05, 0.45, 0.05), frame, FIXED, [0.45, 0.55, 0], [0, 0, 0.2]),
    part(box(0.05, 0.05, 0.5), frame, FIXED, [0.5, 0.82, 0]),
    part(box(0.22, 0.05, 0.12), 0x111111, FIXED, [-0.2, 0.76, 0]),
  ];
}

const shadow = (r) => part(new THREE.CircleGeometry(r, 10).rotateX(-Math.PI / 2), 0x6e6655, FIXED, [0, 0.015, 0]);

// The figure for each NPC type, as one merged geometry.
export function npcGeometry(type) {
  let parts;
  switch (type) {
    case "skater":
      parts = [
        ...person({
          hair: false,
          extras: [
            () => part(box(0.3, 0.12, 0.13), 0xffffff, SHIRT, [0.04, 0.06, -0.1]),
            () => part(box(0.3, 0.12, 0.13), 0xffffff, SHIRT, [0.04, 0.06, 0.1]),
            (h) => part(new THREE.SphereGeometry(0.15, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0xffffff, SHIRT, [0, h + 0.82, 0]),
          ],
        }),
        shadow(0.4),
      ];
      break;
    case "jogger":
      parts = [...person({ extras: [(h) => part(box(0.3, 0.05, 0.28), 0xffffff, SHIRT, [0.05, h + 0.9, 0])] }), shadow(0.35)];
      break;
    case "cyclist":
      parts = [...bike(), ...person({ seated: true, hair: false, at: [-0.15, 0, 0], extras: [(h) => part(new THREE.SphereGeometry(0.15, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0xffffff, SHIRT, [0, h + 0.82, 0])] }), shadow(0.6)];
      break;
    case "dogWalker":
      parts = [...person({ at: [-0.15, 0, -0.18] }), ...dog([0.5, 0, 0.3]), part(box(0.6, 0.02, 0.02), 0xe63946, FIXED, [0.15, 0.7, 0.08], [0, -0.6, -0.6]), shadow(0.6)];
      break;
    case "family":
      parts = [...person({ at: [0, 0, -0.35] }), ...person({ scale: 0.62, at: [0, 0, 0.38] }), shadow(0.8)];
      break;
    default:
      parts = [...person({}), shadow(0.35)];
  }
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  merged.computeBoundingSphere();
  return merged;
}

// The look's material (toon, or pbr cloth roughness) where the tint
// attribute picks the vertex color, the instance shirt color, or the
// instance skin tone.
function crowdMaterial(gradientMap, look = "toon") {
  const mat = litMaterial(look, { vertexColors: true }, { gradientMap, roughness: 0.8, envLight: 0.8 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 tint;\nattribute vec3 instanceSkin;\nattribute vec3 instancePants;\nattribute vec3 instanceHair;")
      .replace(
        "#include <color_vertex>",
        `vColor = vec4(color, 1.0);
#ifdef USE_INSTANCING_COLOR
vColor.rgb = mix(vColor.rgb, instanceColor.rgb, tint.x);
#endif
vColor.rgb = mix(vColor.rgb, instanceSkin, tint.y);
vColor.rgb = mix(vColor.rgb, instancePants, tint.z);
vColor.rgb = mix(vColor.rgb, instanceHair, tint.w);`,
      );
  };
  mat.customProgramCacheKey = () => "crowd-v2";
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

// Pure: the colors and the height scale of crowd NPC `id`, from a seeded
// draw, so two NPCs near each other rarely match.
export function crowdLook(id) {
  const rand = seededRandom((id * 2654435761 + 7) >>> 0);
  rand();
  const at = (list) => list[Math.floor(rand() * list.length) % list.length];
  return { shirt: at(SHIRTS), skin: at(SKINS), pants: at(PANTS), hair: at(HAIRS), scale: 0.92 + rand() * 0.16 };
}

// Bob height (m) and step rate by type: joggers bounce, walkers a little,
// skaters sway side to side, cyclists ride flat.
const GAIT = {
  skater: { bob: 0.02, sway: 0.08 },
  jogger: { bob: 0.07, sway: 0.02 },
  cyclist: { bob: 0, sway: 0.01 },
  dogWalker: { bob: 0.025, sway: 0.02 },
  family: { bob: 0.02, sway: 0.02 },
  walker: { bob: 0.025, sway: 0.02 },
};

// NPCs farther than this from the camera are not drawn (m). The fog hides
// them from 150 m on.
export const NPC_DRAW_DISTANCE = 150;

// Builds the meshes for a crowd. sync(crowd, cameraPosition) packs the NPCs
// near the camera into the first instances of each mesh and draws only
// those. Call it once per frame.
export function createNpcView(crowd, { drawDistance = NPC_DRAW_DISTANCE, look = "toon" } = {}) {
  const group = new THREE.Group();
  group.name = "npcs";
  const material = crowdMaterial(look === "pbr" ? null : rampTexture(), look);
  const byType = new Map();
  for (const n of crowd.npcs) {
    if (!byType.has(n.type)) byType.set(n.type, 0);
    byType.set(n.type, byType.get(n.type) + 1);
  }
  const meshByType = new Map();
  const meshes = [];
  for (const [type, size] of byType) {
    const geometry = npcGeometry(type);
    for (const name of ["instanceSkin", "instancePants", "instanceHair"]) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(size * 3), 3);
      a.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(name, a);
    }
    const mesh = new THREE.InstancedMesh(geometry, material, size);
    mesh.name = `npcs-${type}`;
    // The instances spread over the whole block; the bounding sphere of
    // the template would cull them wrongly.
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, new THREE.Color());
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.userData.gait = GAIT[type] ?? GAIT.walker;
    mesh.count = 0;
    group.add(mesh);
    meshes.push(mesh);
    meshByType.set(type, mesh);
  }

  // The colors and the height of each NPC, from its id.
  const shirt = new Map();
  const skin = new Map();
  const pants = new Map();
  const hair = new Map();
  const heightScale = new Map();
  for (const n of crowd.npcs) {
    const l = crowdLook(n.id);
    shirt.set(n.id, new THREE.Color(l.shirt));
    skin.set(n.id, new THREE.Color(l.skin));
    pants.set(n.id, new THREE.Color(l.pants));
    hair.set(n.id, new THREE.Color(l.hair));
    heightScale.set(n.id, new THREE.Vector3().setScalar(l.scale));
  }

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, "YXZ");
  const p = new THREE.Vector3();
  const far2 = drawDistance * drawDistance;
  let drawn = 0;
  return {
    group,
    meshes,
    get drawCalls() {
      return meshes.length;
    },
    // The look of NPC `n`: the type and the colors (for the variety check).
    lookKey(n) {
      const l = crowdLook(n.id);
      return [n.type, l.shirt, l.skin, l.pants, l.hair, Math.round(l.scale * 20)].join("|");
    },
    // The NPCs drawn in the last sync.
    get drawn() {
      return drawn;
    },
    sync(state, cameraPosition = null) {
      for (const mesh of meshes) mesh.count = 0;
      drawn = 0;
      for (const n of state.npcs) {
        if (cameraPosition) {
          const dx = n.x - cameraPosition.x;
          const dz = n.z - cameraPosition.z;
          if (dx * dx + dz * dz > far2) continue;
        }
        const mesh = meshByType.get(n.type);
        if (!mesh) continue;
        const k = mesh.count;
        mesh.count += 1;
        drawn += 1;
        const gait = mesh.userData.gait;
        const moving = Math.min(1, n.speed / 0.5);
        const bob = gait.bob * Math.abs(Math.sin(n.phase * 2)) * moving;
        // The bump wobble: a lean to the side that dies out. Never a fall.
        const wobble = n.lean ? n.lean * Math.sin(n.bump * 18) : 0;
        e.set(gait.sway * Math.sin(n.phase) * moving + wobble, Math.atan2(-n.fz, n.fx), 0);
        q.setFromEuler(e);
        p.set(n.x, n.y + bob, n.z);
        m.compose(p, q, heightScale.get(n.id));
        mesh.setMatrixAt(k, m);
        mesh.setColorAt(k, shirt.get(n.id));
        for (const [name, c] of [
          ["instanceSkin", skin.get(n.id)],
          ["instancePants", pants.get(n.id)],
          ["instanceHair", hair.get(n.id)],
        ])
          mesh.geometry.attributes[name].setXYZ(k, c.r, c.g, c.b);
      }
      for (const mesh of meshes) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;
        for (const name of ["instanceSkin", "instancePants", "instanceHair"]) mesh.geometry.attributes[name].needsUpdate = true;
      }
    },
  };
}
