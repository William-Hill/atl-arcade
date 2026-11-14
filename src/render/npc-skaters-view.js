import * as THREE from "three";
import { createSkaterView } from "./skater-view.js";
import { toonSkater } from "./toon.js";

// Three.js view of the NPC skaters (#134). Each NPC is a clone of a skater
// GLB (src/render/skater-model.js: one parse for each GLB), with its own
// skeleton and its own clip mixer, played by the same skater view as the
// player. Each NPC gets an outfit: a hue shift of the clothes in the base
// color texture. The toon pass then gives it the same look as the player.

// An outfit moves the texels whose hue is inside `band` (degrees) by
// `shift` degrees, and scales their saturation by `sat`. Only texels with a
// saturation of `minSat` or more change, so the skin and the white parts
// keep their color. Nia: the band holds the green pants and wristband (her
// jacket and her skin have the same hue, so the jacket keeps its color).
// Marcus: the band holds the teal jacket, the navy shorts, and the wheels.
export const OUTFITS = {
  cobalt: { model: "nia", band: [70, 170], shift: 110, sat: 1.1, minSat: 0.18 },
  plum: { model: "nia", band: [70, 170], shift: 175, sat: 1.15, minSat: 0.18 },
  sunset: { model: "marcus", band: [150, 250], shift: 185, sat: 1.1, minSat: 0.2 },
  lime: { model: "marcus", band: [150, 250], shift: -85, sat: 1.0, minSat: 0.2 },
  berry: { model: "marcus", band: [150, 250], shift: 130, sat: 1.1, minSat: 0.2 },
};

// The NPC models are hidden beyond `distance` from the camera (m), and
// only the `max` nearest ones draw. A drawn NPC at `lod1From` m or more
// uses the LOD1 model (#280), and at most `full` NPCs use the full model.
// The full model and its hull cost about 74 K skinned vertices (41 K with
// the welded phone model); the LOD1 model and its hull cost about 3 K.
// The values come from scripts/npc-perf.mjs (#280, docs/decisions.md
// 2026-11-14): with LOD1, the phone tier draws 5 NPCs at the FPS of 2 full
// models before.
export const NPC_DRAW = {
  high: { distance: 150, max: 5, lod1From: 25, full: 3 },
  low: { distance: 90, max: 5, lod1From: 25, full: 2 },
  phone: { distance: 90, max: 5, lod1From: 25, full: 2 },
};

// An NPC on LOD1 goes back to the full model only when it comes this much
// (m) nearer than `lod1From`. Thus an NPC at the edge does not flicker
// between the two models.
export const LOD_HYSTERESIS = 2;

// Pure: the level of detail of each drawn NPC: 0 (the full model) or 1 (the
// LOD1 model). `items` is a list of { id, d } (the distance to the eye),
// `prev` is the map of the levels of the frame before. An NPC uses LOD0
// when it is nearer than `lod1From` (`lod1From - hysteresis` when it was on
// LOD1), and only the `full` nearest NPCs can use LOD0.
export function pickLods(items, prev, { lod1From, full = Infinity }, hysteresis = LOD_HYSTERESIS) {
  const out = new Map();
  let near = 0;
  for (const { id, d } of [...items].sort((a, b) => a.d - b.d)) {
    const edge = prev?.get(id) === 1 ? lod1From - hysteresis : lod1From;
    const level = d < edge && near < full ? 0 : 1;
    if (level === 0) near += 1;
    out.set(id, level);
  }
  return out;
}

// Pure: the ids of the NPCs to draw: the `max` nearest within `distance`
// of the eye. `items` is a list of { id, d } (the distance to the eye).
export function pickDrawn(items, { distance, max }) {
  return new Set(
    items
      .filter((i) => i.d < distance)
      .sort((a, b) => a.d - b.d)
      .slice(0, max)
      .map((i) => i.id),
  );
}

// Pure: RGB (0..1) to HSV, with the hue in degrees. The shader does the same.
export function rgbToHsv([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return [h, max > 0 ? d / max : 0, max];
}

// Pure: true when the outfit changes a texel of this color.
export function inOutfitBand(outfit, rgb) {
  const [h, s] = rgbToHsv(rgb);
  return h >= outfit.band[0] && h <= outfit.band[1] && s >= outfit.minSat;
}

const OUTFIT_GLSL = /* glsl */ `
uniform vec4 uOutfit; // band start (deg), band end (deg), shift (deg), saturation scale
uniform float uOutfitMinSat;
vec3 outfitRgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 outfitHsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
`;

// A copy of the GLB material with the outfit hook. toonMaterial() keeps
// the hook and its program key, so the toon pass runs after it.
export function outfitMaterial(source, outfit) {
  const mat = source.clone();
  mat.name = `${source.name ?? "skater"}-${outfit.name ?? "outfit"}`;
  const band = new THREE.Vector4(outfit.band[0] / 360, outfit.band[1] / 360, outfit.shift / 360, outfit.sat);
  mat.userData.outfit = band;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uOutfit = { value: band };
    shader.uniforms.uOutfitMinSat = { value: outfit.minSat };
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>\n${OUTFIT_GLSL}`).replace(
      "#include <color_fragment>",
      `#include <color_fragment>
{
  // After the map and the vertex colors (the LOD1 mesh has vertex colors in
  // place of the map). The color is in linear space here; the band test
  // works on the sRGB color.
  vec3 srgb = pow(max(diffuseColor.rgb, vec3(0.0)), vec3(1.0 / 2.2));
  vec3 hsv = outfitRgb2hsv(srgb);
  if (hsv.x >= uOutfit.x && hsv.x <= uOutfit.y && hsv.y >= uOutfitMinSat) {
    hsv.x = fract(hsv.x + uOutfit.z);
    hsv.y = clamp(hsv.y * uOutfit.w, 0.0, 1.0);
    diffuseColor.rgb = pow(outfitHsv2rgb(hsv), vec3(2.2));
  }
}`,
    );
  };
  mat.customProgramCacheKey = () => "npc-outfit";
  return mat;
}

// Gives a cloned skater (cloneSkaterModel()) an outfit and the toon look.
// `toon: false` keeps the GLB shading (?toon=0).
export function dressNpc(loaded, outfit, { toon = true } = {}) {
  loaded.root.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map((m) => outfitMaterial(m, outfit)) : outfitMaterial(o.material, outfit);
  });
  return toon ? toonSkater(loaded) : [];
}

// The meshes of each level of a dressed NPC: [LOD0 meshes, LOD1 meshes].
// Each level is its skinned mesh and its ink hull. Null when the NPC has no
// LOD1 mesh.
function levelMeshes(model, hulls) {
  if (!model.lod1Mesh) return null;
  const of = (mesh) => [mesh, ...hulls.filter((h) => h.userData.outlineOf === mesh)];
  return [of(model.skinnedMesh), of(model.lod1Mesh)];
}

// Pure: the skinned vertices of a list of meshes.
function vertexCount(meshes) {
  return meshes.reduce((n, m) => n + m.geometry.attributes.position.count, 0);
}

// The view. `state` is from createNpcSkaters(). `load(model, { lod1 })`
// returns a promise of a cloned skater (cloneSkaterModel()). `lod: false`
// keeps the full model at all distances (?npclod=0).
export function createNpcSkatersView(state, { load, toon = true, draw = NPC_DRAW.high, lod = true } = {}) {
  const group = new THREE.Group();
  group.name = "npc-skaters";
  const views = new Map();
  let loaded = 0;
  let failed = 0;
  for (const npc of state.npcs) {
    const view = createSkaterView();
    view.group.name = `npc-skater-${npc.id}`;
    // The capsule stays hidden: an NPC shows only with its model.
    view.group.visible = false;
    group.add(view.group);
    const entry = { view, ready: false, outfit: npc.spec.outfit, levels: null, level: 0, vertices: [0, 0] };
    views.set(npc.id, entry);
    const outfit = { name: npc.spec.outfit, ...(OUTFITS[npc.spec.outfit] ?? OUTFITS.cobalt) };
    load(npc.spec.model, { lod1: lod })
      .then((model) => {
        const hulls = dressNpc(model, outfit, { toon });
        view.attachModel(model);
        entry.levels = lod ? levelMeshes(model, hulls) : null;
        const all = [model.skinnedMesh, ...hulls.filter((h) => h.userData.outlineOf === model.skinnedMesh)];
        entry.vertices = entry.levels ? entry.levels.map(vertexCount) : [vertexCount(all), vertexCount(all)];
        setLevel(entry, 0);
        entry.ready = true;
        loaded += 1;
      })
      .catch((err) => {
        failed += 1;
        console.error(`NPC skater ${npc.id}: ${err?.message ?? err}`);
      });
  }

  // Shows the meshes of one level and hides the meshes of the other.
  function setLevel(entry, level) {
    entry.level = entry.levels ? level : 0;
    if (!entry.levels) return;
    entry.levels.forEach((meshes, i) => {
      for (const m of meshes) m.visible = i === entry.level;
    });
  }

  let drawn = 0;
  let lod1Drawn = 0;
  let skinnedVertices = 0;
  let levels = new Map();
  return {
    group,
    get loaded() {
      return loaded;
    },
    get failed() {
      return failed;
    },
    get drawn() {
      return drawn;
    },
    // The drawn NPCs on the LOD1 model.
    get lod1Drawn() {
      return lod1Drawn;
    },
    // The skinned vertices of the drawn NPCs (the meshes and the hulls).
    get skinnedVertices() {
      return skinnedVertices;
    },
    // Two draw calls for each NPC drawn: the skin and the ink hull.
    get drawCalls() {
      return drawn * (toon ? 2 : 1);
    },
    // Compiles the NPC shader programs before the first NPC comes into view.
    // The outfit gives the NPC skin its own program; without this step, a
    // software GPU stalls for seconds on the frame where the first NPC draws.
    warm(renderer, camera, scene) {
      // The LOD1 meshes have their own programs (vertex colors), so both
      // levels show while the programs compile.
      const hidden = [];
      for (const { view, ready, levels: lv } of views.values()) {
        if (!ready) continue;
        for (const o of [view.group, ...(lv ? lv.flat() : [])]) {
          if (!o.visible) {
            o.visible = true;
            hidden.push(o);
          }
        }
      }
      // compile() collects the objects at once, so the objects can hide again.
      const done = renderer.compileAsync ? renderer.compileAsync(group, camera, scene) : Promise.resolve(renderer.compile(group, camera, scene));
      for (const o of hidden) o.visible = false;
      return done;
    },
    clipOf(id) {
      return views.get(id)?.view.clip ?? null;
    },
    visible(id) {
      return Boolean(views.get(id)?.view.group.visible);
    },
    // The level of detail of an NPC: 0 (the full model) or 1 (LOD1).
    lodOf(id) {
      return views.get(id)?.level ?? 0;
    },
    // dt: the frame time. beat: { time, bpm } or null. eye: the camera position.
    sync(next, dt, beat, eye) {
      drawn = 0;
      lod1Drawn = 0;
      skinnedVertices = 0;
      const ready = next.npcs.filter((n) => views.get(n.id)?.ready);
      const dist = (p) => (eye ? Math.hypot(p[0] - eye.x, p[1] - eye.y, p[2] - eye.z) : 0);
      const items = ready.map((n) => ({ id: n.id, d: dist(n.skater.position) }));
      const pick = pickDrawn(items, draw);
      levels = pickLods(
        items.filter((i) => pick.has(i.id)),
        levels,
        draw,
      );
      for (const npc of next.npcs) {
        const entry = views.get(npc.id);
        if (!entry) continue;
        entry.view.group.visible = pick.has(npc.id);
        if (!entry.view.group.visible) continue;
        setLevel(entry, levels.get(npc.id) ?? 0);
        drawn += 1;
        if (entry.level === 1) lod1Drawn += 1;
        skinnedVertices += entry.vertices[entry.level];
        entry.view.sync(npc.skater, dt, beat);
      }
    },
  };
}
