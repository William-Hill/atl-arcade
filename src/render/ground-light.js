// The ground light map of the pbr look (#196, #197): one small texture over
// the level that the ground shader (pbr-ground.js) reads with one sample.
//   R: the pool of light under each street and trail lamp (night only).
//   G: the mulch or bare soil patch under each tree (on the lawn only).
// The map replaces one real light per lamp, so the draw calls and the
// lights stay the same. Pure: the same placements give the same map, in
// node and in the browser.

// The lamp head of the kit lamp (assets/kit/street-kit.glb, node "lamp"):
// the warm globe is at x 0.77..1.07, y 3.75..3.97 in the template, on the
// arm that reaches along +x. The pool is under the globe.
export const LAMP_HEAD = { x: 0.92, y: 3.86 };

// The globe of the kit lamp (its vertex color) and its emissive factor at
// night (uLit 1), over the night bloom threshold (pbr-palette.js
// BLOOM_THRESHOLD). The prop material in geo-view.js makes it glow.
export const LAMP_GLOBE = { color: [1.0, 0.85, 0.45], night: 4.0 };

// The pool of a lamp: the radius (m) where the light stops, and the color of
// a 4000 K lamp in linear RGB (sRGB 255, 209, 163).
export const LAMP_POOL = { radius: 8.5, color: [1.0, 0.637, 0.366] };

// The mulch patch under a tree: a radius from `min` to `min + spread` (m),
// from a hash of the tree position, so no two patches are the same.
export const MULCH = { min: 1.3, spread: 1.0 };

// The map size: `texel` m per texel, and no side larger than `maxSide`
// texels (the texel grows on a very large level). `margin` m of empty
// ground around the placements.
export const GROUND_LIGHT_GRID = { texel: 1, maxSide: 2048, margin: 12 };

const unitHash = (x, z) => {
  const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

// Pure: true for a tree placement (the kit trees "tree_round" and
// "tree_tall", the procedural trees, and the GLB trees "tree:oak:0").
export function isTree(kind) {
  return typeof kind === "string" && kind.startsWith("tree");
}

// Pure: the pool centers [{ x, z }] of the lamps in `placements`
// ({ kind, x, z, yaw, scale }). The pool is under the lamp head, on the arm
// (a positive yaw turns +x toward -z, prop-batch.js placementMatrix).
export function lampPools(placements) {
  const out = [];
  for (const p of placements) {
    if (p.kind !== "lamp") continue;
    const s = p.scale ?? 1;
    const yaw = p.yaw ?? 0;
    out.push({ x: p.x + LAMP_HEAD.x * s * Math.cos(yaw), z: p.z - LAMP_HEAD.x * s * Math.sin(yaw) });
  }
  return out;
}

// Pure: the mulch patches [{ x, z, r }] of the trees in `placements`.
export function mulchPatches(placements) {
  const out = [];
  for (const p of placements) {
    if (!isTree(p.kind)) continue;
    out.push({ x: p.x, z: p.z, r: MULCH.min + MULCH.spread * unitHash(p.x, p.z) });
  }
  return out;
}

// Pure: the light of a pool at `d` m from its center, 1 at the center and 0
// at the radius, with a soft edge. Two pools that touch add (clamped to 1).
export function poolFalloff(d, radius = LAMP_POOL.radius) {
  const s = (d * d) / (radius * radius);
  return s >= 1 ? 0 : (1 - s) * (1 - s);
}

// Pure: the weight of a mulch patch of radius `r` at `d` m from the tree.
// Flat inside, then a fast edge (the shader breaks the edge with noise).
export function mulchFalloff(d, r) {
  const s = d / r;
  return s >= 1 ? 0 : 1 - s * s * s * s;
}

// Pure: the grid of the map over the pools and patches: { x0, z0, texel,
// width, height } (x0, z0 are the world position of texel 0's corner).
export function groundLightGrid(pools, patches, { texel = GROUND_LIGHT_GRID.texel, maxSide = GROUND_LIGHT_GRID.maxSide, margin = GROUND_LIGHT_GRID.margin } = {}) {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const p of [...pools, ...patches]) {
    minX = Math.min(minX, p.x);
    minZ = Math.min(minZ, p.z);
    maxX = Math.max(maxX, p.x);
    maxZ = Math.max(maxZ, p.z);
  }
  if (!Number.isFinite(minX)) return null;
  minX -= margin;
  minZ -= margin;
  maxX += margin;
  maxZ += margin;
  const t = Math.max(texel, (maxX - minX) / maxSide, (maxZ - minZ) / maxSide);
  return { x0: minX, z0: minZ, texel: t, width: Math.ceil((maxX - minX) / t), height: Math.ceil((maxZ - minZ) / t) };
}

// Pure: the map of `placements`: { grid, data, pools, patches }. `data` is
// RGBA8 (width x height x 4), row 0 at z0: R the lamp light, G the mulch.
// B and A are 0 and 255. Null when there are no lamps and no trees.
export function bakeGroundLight(placements, options = {}) {
  const pools = lampPools(placements);
  const patches = mulchPatches(placements);
  const grid = groundLightGrid(pools, patches, options);
  if (!grid) return null;
  const { x0, z0, texel, width, height } = grid;
  const r = new Float32Array(width * height);
  const g = new Float32Array(width * height);
  const stamp = (cx, cz, radius, fn, out, add) => {
    const i0 = Math.max(0, Math.floor((cx - radius - x0) / texel));
    const i1 = Math.min(width - 1, Math.ceil((cx + radius - x0) / texel));
    const j0 = Math.max(0, Math.floor((cz - radius - z0) / texel));
    const j1 = Math.min(height - 1, Math.ceil((cz + radius - z0) / texel));
    for (let j = j0; j <= j1; j += 1) {
      const z = z0 + (j + 0.5) * texel;
      for (let i = i0; i <= i1; i += 1) {
        const x = x0 + (i + 0.5) * texel;
        const v = fn(Math.hypot(x - cx, z - cz), radius);
        const k = j * width + i;
        out[k] = add ? out[k] + v : Math.max(out[k], v);
      }
    }
  };
  for (const p of pools) stamp(p.x, p.z, LAMP_POOL.radius, poolFalloff, r, true);
  for (const p of patches) stamp(p.x, p.z, p.r, mulchFalloff, g, false);
  const data = new Uint8Array(width * height * 4);
  for (let k = 0; k < width * height; k += 1) {
    data[k * 4] = Math.round(255 * Math.min(1, r[k]));
    data[k * 4 + 1] = Math.round(255 * Math.min(1, g[k]));
    data[k * 4 + 3] = 255;
  }
  return { grid, data, pools: pools.length, patches: patches.length };
}

// Pure: the value of the map at world (x, z), as the shader reads it with
// linear filtering: [lamp, mulch], 0..1. For the tests and the debug view.
export function sampleGroundLight(map, x, z) {
  const { x0, z0, texel, width, height } = map.grid;
  const fx = Math.min(width - 1, Math.max(0, (x - x0) / texel - 0.5));
  const fz = Math.min(height - 1, Math.max(0, (z - z0) / texel - 0.5));
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const ti = fx - i;
  const tj = fz - j;
  const at = (a, b, c) => map.data[(Math.min(height - 1, b) * width + Math.min(width - 1, a)) * 4 + c] / 255;
  const lerp = (c) => {
    const top = at(i, j, c) * (1 - ti) + at(i + 1, j, c) * ti;
    const bottom = at(i, j + 1, c) * (1 - ti) + at(i + 1, j + 1, c) * ti;
    return top * (1 - tj) + bottom * tj;
  };
  return [lerp(0), lerp(1)];
}
