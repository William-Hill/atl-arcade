import * as THREE from "three";
import { createSkaterView } from "./skater-view.js";
import { pbrSkater, toonSkater } from "./toon.js";

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

// The NPC models are hidden beyond this distance from the camera (m), and
// only the `max` nearest ones draw. A skinned NPC and its hull cost about
// 36 K skinned vertices, which is slow on a software GPU, so the low and
// phone tiers draw fewer.
export const NPC_DRAW = {
  high: { distance: 90, max: 5 },
  low: { distance: 45, max: 2 },
  phone: { distance: 45, max: 2 },
};

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
      "#include <map_fragment>",
      `#include <map_fragment>
{
  // The map is in linear space here; the band test works on the sRGB color.
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

// Gives a cloned skater (cloneSkaterModel()) an outfit and the look's
// materials: the toon swap + ink hull, or the pbr env-lit GLB materials.
// `toon: false` keeps the GLB shading (?toon=0).
export function dressNpc(loaded, outfit, { toon = true, look = "toon" } = {}) {
  loaded.root.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map((m) => outfitMaterial(m, outfit)) : outfitMaterial(o.material, outfit);
  });
  return toon ? (look === "pbr" ? pbrSkater : toonSkater)(loaded) : [];
}

// The view. `state` is from createNpcSkaters(). `load(model)` returns a
// promise of a cloned skater (cloneSkaterModel()).
export function createNpcSkatersView(state, { load, toon = true, draw = NPC_DRAW.high, look = "toon" } = {}) {
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
    const entry = { view, ready: false, outfit: npc.spec.outfit };
    views.set(npc.id, entry);
    const outfit = { name: npc.spec.outfit, ...(OUTFITS[npc.spec.outfit] ?? OUTFITS.cobalt) };
    load(npc.spec.model)
      .then((model) => {
        dressNpc(model, outfit, { toon, look });
        view.attachModel(model);
        entry.ready = true;
        loaded += 1;
      })
      .catch((err) => {
        failed += 1;
        console.error(`NPC skater ${npc.id}: ${err?.message ?? err}`);
      });
  }

  let drawn = 0;
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
    // Two draw calls for each NPC drawn under the toon look (the skin and
    // the ink hull); the pbr look draws the skin only.
    get drawCalls() {
      return drawn * (toon && look !== "pbr" ? 2 : 1);
    },
    // Compiles the NPC shader programs before the first NPC comes into view.
    // The outfit gives the NPC skin its own program; without this step, a
    // software GPU stalls for seconds on the frame where the first NPC draws.
    warm(renderer, camera, scene) {
      const hidden = [];
      for (const { view, ready } of views.values()) {
        if (ready && !view.group.visible) {
          view.group.visible = true;
          hidden.push(view.group);
        }
      }
      // compile() collects the objects at once, so the groups can hide again.
      const done = renderer.compileAsync ? renderer.compileAsync(group, camera, scene) : Promise.resolve(renderer.compile(group, camera, scene));
      for (const g of hidden) g.visible = false;
      return done;
    },
    clipOf(id) {
      return views.get(id)?.view.clip ?? null;
    },
    visible(id) {
      return Boolean(views.get(id)?.view.group.visible);
    },
    // dt: the frame time. beat: { time, bpm } or null. eye: the camera
    // position. view: { sees(x, y, z, r) } (src/render/view-cull.js) or
    // null; an NPC out of the view stays drawn (its shadow) and moves to its
    // place, but skips the clip sync until it comes back.
    sync(next, dt, beat, eye, view = null) {
      drawn = 0;
      const ready = next.npcs.filter((n) => views.get(n.id)?.ready);
      const dist = (p) => (eye ? Math.hypot(p[0] - eye.x, p[1] - eye.y, p[2] - eye.z) : 0);
      const pick = pickDrawn(ready.map((n) => ({ id: n.id, d: dist(n.skater.position) })), draw);
      for (const npc of next.npcs) {
        const entry = views.get(npc.id);
        if (!entry) continue;
        entry.view.group.visible = pick.has(npc.id);
        if (!entry.view.group.visible) continue;
        drawn += 1;
        const [x, y, z] = npc.skater.position;
        if (view && !view.sees(x, y + 0.9, z, 1.2)) {
          entry.view.place(npc.skater);
          continue;
        }
        entry.view.sync(npc.skater, dt, beat);
      }
    },
  };
}
