// Challenge rings (#219): the render layer. The pure part is in
// landmark-rings-math.js.
//
// All rings are 1 InstancedMesh with 1 shared MeshBasicMaterial and 1 atlas
// texture: 1 draw call, and 0 when no spot is Found (the mesh hides). One
// instance is one ring: 2 band strips (the second one only for the double
// ring) and 1 billboard quad (the number of a line checkpoint). The vertex
// shader sets the radius, keeps the band width in meters, and lays the band
// on the ground from 16 heights per ring.
//
// Toon look: flat and unlit, gold with an ink outline. Pbr look: the same
// picture as an emissive overlay (ringEmissive). userData.overlay keeps the
// mesh out of the AO and ink depth pass (src/render/post.js).
//
// High tier only: a faint cone over each ring (1 more draw call).

import * as THREE from "three";
import { RINGS, claimFade, ringEmissive, ringGround, ringList, ringPulse } from "./landmark-rings-math.js";

const SEGMENTS = 96;
const CELL = 64;

// The atlas: [solid band][dash][1][2][3][cone fade], each 64 px square.
function drawAtlas(k) {
  const canvas = document.createElement("canvas");
  canvas.width = CELL * k.cells.count;
  canvas.height = CELL;
  const g = canvas.getContext("2d");
  const inkPx = Math.round((k.ink / (k.width + 2 * k.ink)) * CELL);
  // Solid band: ink, gold, ink across the band.
  g.fillStyle = k.inkColor;
  g.fillRect(0, 0, CELL, CELL);
  g.fillStyle = k.gold;
  g.fillRect(0, inkPx, CELL, CELL - 2 * inkPx);
  // Dash: 60% of the cell, with the ink all around it.
  const x0 = CELL;
  const dashPx = Math.round(CELL * 0.6);
  g.fillStyle = k.inkColor;
  g.fillRect(x0 + 2, 0, dashPx, CELL);
  g.fillStyle = k.gold;
  g.fillRect(x0 + 2 + 3, inkPx, dashPx - 6, CELL - 2 * inkPx);
  // The checkpoint numbers: gold with an ink outline.
  g.font = `800 ${Math.round(CELL * 0.86)}px system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineJoin = "round";
  for (let i = 0; i < 3; i += 1) {
    const cx = (k.cells.digit + i + 0.5) * CELL;
    g.lineWidth = 9;
    g.strokeStyle = k.inkColor;
    g.strokeText(String(i + 1), cx, CELL * 0.54);
    g.fillStyle = k.gold;
    g.fillText(String(i + 1), cx, CELL * 0.54);
  }
  // The cone fade: gold at the ground, clear at the top.
  const fade = g.createLinearGradient(0, CELL, 0, 0);
  fade.addColorStop(0, "rgba(255, 209, 102, 1)");
  fade.addColorStop(1, "rgba(255, 209, 102, 0)");
  g.fillStyle = fade;
  g.fillRect(k.cells.cone * CELL, 0, CELL, CELL);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

// One ring: 2 strips of SEGMENTS quads and 1 quad.
// position = the unit direction (strips) or the quad corner; uv = (along,
// across); ringPart = (part, side): part 0 the ring, 1 the inner ring, 2 the
// number; side -1 the inner edge, +1 the outer edge.
function ringGeometry() {
  const pos = [];
  const uv = [];
  const part = [];
  const index = [];
  for (let p = 0; p < 2; p += 1) {
    const base = pos.length / 3;
    for (let i = 0; i <= SEGMENTS; i += 1) {
      const a = (i / SEGMENTS) * 2 * Math.PI;
      for (const side of [-1, 1]) {
        pos.push(Math.cos(a), 0, Math.sin(a));
        uv.push(i / SEGMENTS, side < 0 ? 0 : 1);
        part.push(p, side);
      }
    }
    for (let i = 0; i < SEGMENTS; i += 1) {
      const a = base + i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const q = pos.length / 3;
  for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    pos.push(x, 0, y);
    uv.push((x + 1) / 2, (y + 1) / 2);
    part.push(2, 0);
  }
  index.push(q, q + 1, q + 2, q, q + 2, q + 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute("ringPart", new THREE.Float32BufferAttribute(part, 2));
  geo.setIndex(index);
  return geo;
}

const VERTEX_PARS = /* glsl */ `
  attribute vec2 ringPart;
  attribute vec4 iRing;   // radius, shape, alpha, fill
  attribute vec4 iExtra;  // number, dashes, 0, 0
  attribute mat4 iGround; // 16 ground heights around the ring, relative to the center
  uniform vec4 uRing;     // band half width, inner ring share, number half size, number lift
  varying vec4 vRing;
  varying vec3 vRing2;
`;

// Replaces <begin_vertex>.
const VERTEX_BEGIN = /* glsl */ `
  vec3 transformed = vec3(0.0);
  float ringOn = 1.0;
  if (ringPart.x < 1.5) {
    bool inner = ringPart.x > 0.5;
    if (inner && abs(iRing.y - 3.0) > 0.5) ringOn = 0.0;
    float share = inner ? uRing.y : 1.0;
    float f = uv.x * 16.0;
    int i0 = int(mod(floor(f), 16.0));
    int i1 = int(mod(floor(f) + 1.0, 16.0));
    float h = mix(iGround[i0 / 4][i0 - 4 * (i0 / 4)], iGround[i1 / 4][i1 - 4 * (i1 / 4)], fract(f));
    float r = iRing.x * share + ringPart.y * uRing.x;
    transformed = vec3(position.x * r, h * share, position.z * r) * ringOn;
  } else if (abs(iRing.y - 2.0) > 0.5) ringOn = 0.0;
  vRing = vec4(iRing.y, iRing.z * ringOn, ringPart.x, iRing.w);
  vRing2 = vec3(iExtra.x, iExtra.y, 0.0);
`;

// After <project_vertex>: the number is a billboard over the ring center.
const VERTEX_PROJECT = /* glsl */ `
  if (ringPart.x > 1.5) {
    mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, uRing.w, 0.0, 1.0);
    mvPosition.xy += position.xz * uRing.z * ringOn;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAGMENT_PARS = /* glsl */ `
  uniform vec3 uGold;
  uniform vec2 uGain; // the emissive value of the ring, and of its core
  varying vec4 vRing;
  varying vec3 vRing2;
`;

// Replaces <map_fragment>. The atlas has ${RINGS.cells.count} cells in a row.
const FRAGMENT_MAP = /* glsl */ `
  float ringCell;
  vec2 ringUv = vMapUv;
  float ringCore = 0.0;
  if (vRing.z > 1.5) ringCell = ${RINGS.cells.digit}.0 + vRing2.x;
  else {
    bool dashed = vRing.x > 0.5 && vRing.x < 1.5 && vRing.w < 0.5;
    ringCell = dashed ? ${RINGS.cells.dash}.0 : ${RINGS.cells.solid}.0;
    ringUv.x = dashed ? fract(vMapUv.x * vRing2.y) : 0.5;
    ringCore = 1.0 - smoothstep(0.08, 0.2, abs(vMapUv.y - 0.5));
  }
  vec4 ringTexel = texture2D(map, vec2((ringCell + clamp(ringUv.x, 0.03, 0.97)) / ${RINGS.cells.count}.0, ringUv.y));
  ringTexel.rgb = mix(ringTexel.rgb, uGold, vRing.w);
  diffuseColor *= vec4(ringTexel.rgb * mix(uGain.x, uGain.y, ringCore), ringTexel.a * vRing.y);
  if (diffuseColor.a < 0.004) discard;
`;

// `groundAt(x, z, y)` gives the ground height at (x, z) near the height y
// (null for none); `centerAt(x, z)` the ground height of a zone center.
// `reducedMotion()` is true when nothing must move (#97).
export function createLandmarkRings({ capacity, look = "toon", tier = "low", groundAt, centerAt, reducedMotion = () => false, k = RINGS } = {}) {
  const max = Math.max(1, capacity);
  const atlas = drawAtlas(k);
  const uniforms = {
    uRing: { value: new THREE.Vector4(k.width / 2 + k.ink, k.inner, k.digit.size, k.digit.lift) },
    uGold: { value: new THREE.Color(k.gold) },
    uGain: { value: new THREE.Vector2(1, 1) },
  };
  // One shared material for every ring.
  const material = new THREE.MeshBasicMaterial({ map: atlas, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, forceSinglePass: true });
  material.name = "landmark-rings";
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERTEX_PARS}`)
      .replace("#include <begin_vertex>", VERTEX_BEGIN)
      .replace("#include <project_vertex>", `#include <project_vertex>\n${VERTEX_PROJECT}`);
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>\n${FRAGMENT_PARS}`).replace("#include <map_fragment>", FRAGMENT_MAP);
  };
  material.customProgramCacheKey = () => "landmark-rings";

  const geometry = ringGeometry();
  const iRing = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
  const iExtra = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
  const iGround = new THREE.InstancedBufferAttribute(new Float32Array(max * 16), 16);
  for (const a of [iRing, iExtra, iGround]) a.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("iRing", iRing);
  geometry.setAttribute("iExtra", iExtra);
  geometry.setAttribute("iGround", iGround);
  const mesh = new THREE.InstancedMesh(geometry, material, max);
  mesh.name = "landmark-rings";
  mesh.count = 0;
  mesh.visible = false;
  // The instances are spread over the level: no cull box.
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.userData.overlay = true;

  const group = new THREE.Group();
  group.name = "landmark-rings";
  group.add(mesh);

  // The fade cone, high tier only: an open cylinder with the atlas fade.
  let cones = null;
  if (tier === "high") {
    const coneGeo = new THREE.CylinderGeometry(1, 1, 1, 48, 1, true).translate(0, 0.5, 0);
    const cuv = coneGeo.getAttribute("uv");
    for (let i = 0; i < cuv.count; i += 1) cuv.setX(i, (k.cells.cone + 0.5) / k.cells.count);
    const coneMat = new THREE.MeshBasicMaterial({ map: atlas, transparent: true, opacity: k.cone.alpha, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, forceSinglePass: true });
    coneMat.name = "landmark-ring-cones";
    cones = new THREE.InstancedMesh(coneGeo, coneMat, max);
    cones.name = "landmark-ring-cones";
    cones.count = 0;
    cones.visible = false;
    cones.frustumCulled = false;
    cones.renderOrder = 2;
    cones.userData.overlay = true;
    group.add(cones);
  }

  const ground = new Map(); // ring key -> { y, heights }
  const fades = new Map(); // spot id -> { rings, age }
  let lastRings = [];
  let time = 0;
  let hidden = false;
  const info = { rings: 0, fading: 0, shapes: [], ids: [], emissive: { rest: 1, core: 1 }, pulse: 1, cones: 0 };
  const m = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();

  function groundOf(ring) {
    let g = ground.get(ring.key);
    if (!g) {
      g = ringGround(ring, centerAt(ring.x, ring.z), groundAt, k);
      ground.set(ring.key, g);
    }
    return g;
  }

  function write(i, ring, { scale = 1, alpha = 1, fill = 0 } = {}) {
    const g = groundOf(ring);
    m.makeTranslation(ring.x, g.y + k.lift, ring.z);
    mesh.setMatrixAt(i, m);
    iRing.setXYZW(i, ring.r * scale, ring.shape, ring.alpha * alpha, fill);
    iExtra.setXYZW(i, ring.digit, ring.dashes, 0, 0);
    iGround.array.set(g.heights, i * 16);
    if (cones && fill === 0) {
      v.set(ring.x, g.y + Math.min(0, ...g.heights), ring.z);
      s.set(ring.r * scale, k.cone.height, ring.r * scale);
      cones.setMatrixAt(i, m.compose(v, quat, s));
    }
  }

  return {
    group,
    mesh,
    // A spot was claimed: its rings turn gold and fade.
    claim(id) {
      const rings = lastRings.filter((r) => r.id === id);
      if (rings.length) fades.set(id, { rings, age: 0 });
    },
    // A new run: no fade is left.
    reset() {
      fades.clear();
    },
    // For the draw call check: hides or shows every ring.
    setHidden(on) {
      hidden = Boolean(on);
      mesh.visible = !hidden && mesh.count > 0;
      if (cones) cones.visible = !hidden && cones.count > 0;
    },
    // `spots` is landmarkView().spots. `dt` is 0 while the game is paused
    // (photo mode, the full map, the settings menu): then nothing moves.
    update(spots, { dt = 0, timed = true, night = 0 } = {}) {
      time += dt;
      const reduced = reducedMotion();
      const rings = ringList(spots, { timed }, k);
      lastRings = rings;
      const pulse = ringPulse(tier, time, reduced, k);
      let n = 0;
      for (const ring of rings) {
        if (n >= max) break;
        write(n, ring, { scale: pulse });
        n += 1;
      }
      const live = n;
      for (const [id, f] of fades) {
        f.age += dt;
        const look = claimFade(f.age, reduced, k);
        if (look.done) {
          fades.delete(id);
          continue;
        }
        for (const ring of f.rings) {
          if (n >= max) break;
          write(n, { ...ring, alpha: 1 }, look);
          n += 1;
        }
      }
      mesh.count = n;
      mesh.visible = !hidden && n > 0;
      if (n > 0) {
        mesh.instanceMatrix.needsUpdate = true;
        iRing.needsUpdate = true;
        iExtra.needsUpdate = true;
        iGround.needsUpdate = true;
      }
      const e = ringEmissive({ look, night, tier }, k);
      uniforms.uGain.value.set(e.rest, e.core);
      if (cones) {
        // The fading rings come after the live ones: they get no cone.
        cones.count = live;
        cones.visible = !hidden && live > 0;
        cones.material.color.setScalar(e.rest);
        if (live > 0) cones.instanceMatrix.needsUpdate = true;
      }
      info.rings = live;
      info.fading = n - live;
      info.shapes = rings.map((r) => r.shape);
      info.ids = rings.map((r) => r.key);
      info.emissive = e;
      info.pulse = pulse;
      info.cones = cones ? cones.count : 0;
    },
    // For the tests: the rings drawn now, their shapes and the material values.
    get info() {
      return { ...info, shapes: [...info.shapes], ids: [...info.ids], visible: mesh.visible, capacity: max, look, tier, meshes: cones ? 2 : 1, color: k.gold, width: k.width };
    },
    // The center and the size of each ring drawn now, for a screenshot camera.
    get rings() {
      return lastRings.map((r) => ({ ...r, y: groundOf(r).y }));
    },
  };
}
