import * as THREE from "three";

// The outfit variants of the Meshy people (assets/people/variants/, Meshy
// retexture on the same mesh and UVs; provenance.json there). A look is a
// person and a variant: 0 is the person's own texture, 1.. a variant. The
// pbr walkers get a look that no other walker near them has, so the 5
// people read as 19 different people.

const url = (f) => new URL(`../../assets/people/variants/${f}.jpg`, import.meta.url).href;
export const PED_VARIANTS = {
  walker_sundress: ["walker_sundress_v1", "walker_sundress_v2", "walker_sundress_v3"],
  elder_polo: ["elder_polo_v1", "elder_polo_v2", "elder_polo_v3"],
  jogger: ["jogger_v1", "jogger_v2", "jogger_v3"],
  dog_walker: ["dog_walker_v1", "dog_walker_v2", "dog_walker_v3"],
  // stroller_dad_v1 had lettering on the hoodie: left out.
  stroller_dad: ["stroller_dad_v2", "stroller_dad_v3"],
};
export const PED_VARIANT_URLS = Object.fromEntries(Object.values(PED_VARIANTS).flatMap((list) => list.map((f) => [f, url(f)])));

// The radius (m) in which two walkers never share a look, when the looks
// allow it.
export const LOOK_RADIUS = 40;

// Pure: every look, as { kind, v }.
export function pedLooks(kinds, variants = PED_VARIANTS) {
  return kinds.flatMap((kind) => [{ kind, v: 0 }, ...(variants[kind] ?? []).map((_, i) => ({ kind, v: i + 1 }))]);
}

// Pure: the atlas tile of variant `v` (2x2 tiles of a 1024 px atlas): the
// UV offset with flipY off (the glTF way: v = 0 at the top).
export function lookTile(v) {
  return [(v % 2) * 0.5, Math.floor(v / 2) * 0.5];
}

function hash(n) {
  let h = (n + 1) * 2654435761;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return h >>> 0;
}

// Pure: the look for a walker with seed `seed`: the first look in the
// seeded order that `used` (a Set of look indexes near it) does not hold.
export function pickLook(seed, used, count) {
  const start = hash(seed) % count;
  const step = 1 + (hash(seed ^ 0x9e3779b9) % Math.max(1, count - 1));
  // A step coprime with count visits every look once.
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  let s = step;
  while (gcd(s, count) !== 1) s += 1;
  for (let i = 0; i < count; i += 1) {
    const k = (start + i * s) % count;
    if (!used.has(k)) return k;
  }
  return start;
}

// A look per live walker, kept while the walker lives (a respawn, a new
// `spawns` count, gets a new look). A new walker takes a look that no
// walker within `radius` has.
export function createLookPicker(looks, { radius = LOOK_RADIUS } = {}) {
  const byId = new Map();
  const r2 = radius * radius;
  return {
    looks,
    // Call once a frame with the walker pool (src/sim/peds.js).
    refresh(state) {
      const fresh = [];
      for (const w of state.peds) {
        if (!w.live) continue;
        const a = byId.get(w.id);
        if (!a || a.spawns !== w.spawns) fresh.push(w);
      }
      for (const w of fresh) {
        const used = new Set();
        for (const o of state.peds) {
          if (!o.live || o === w) continue;
          const a = byId.get(o.id);
          if (!a || a.spawns !== o.spawns) continue;
          const dx = o.x - w.x;
          const dz = o.z - w.z;
          if (dx * dx + dz * dz < r2) used.add(a.look);
        }
        byId.set(w.id, { spawns: w.spawns, look: pickLook(w.id * 7919 + (w.spawns ?? 0), used, looks.length) });
      }
    },
    // The look of walker `id` ({ kind, v }), or null before refresh.
    of(id) {
      const a = byId.get(id);
      return a ? looks[a.look] : null;
    },
    index(id) {
      return byId.get(id)?.look ?? -1;
    },
  };
}

// The 1024 px atlas of a person: its own base color and its variants, as
// 2x2 tiles (lookTile). `images` are the variant images, in order.
export function lookAtlas(base, images) {
  const size = 1024;
  const half = size / 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  // A variant that failed to load shows the person's own texture in its
  // tile, as the rigs do (ped-models.js), not an empty (black) tile.
  [base, ...images].forEach((img, v) => {
    const [u, w] = lookTile(v);
    ctx.drawImage(img ?? base, u * size, w * size, half, half);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// A clone of a person material that reads its base color from the atlas
// tile in the batch color (ped-crowd.js sets it per instance: rg = the
// tile offset). The batch color does not tint.
export function atlasMaterial(material, atlas) {
  const mat = material.clone();
  mat.map = atlas;
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <uv_vertex>",
        `#include <uv_vertex>
#if defined( USE_BATCHING_COLOR ) && defined( USE_MAP )
vMapUv = vMapUv * 0.5 + getBatchingColor( getIndirectIndex( gl_DrawID ) ).rg;
#endif`,
      )
      .replace("#include <color_vertex>", "#include <color_vertex>\n#ifdef USE_BATCHING_COLOR\nvColor.rgb = vec3(1.0);\n#endif");
  };
  mat.customProgramCacheKey = () => "ped-look-atlas";
  return mat;
}
