// Procedural trees for a geodata level. Pure and seeded: the same species
// and variant give the same mesh in node and in the browser.
//
// Four Atlanta street and trail trees, each in TREE_VARIANTS shapes:
// - oak: a willow oak, a broad round canopy on a clear trunk.
// - pine: a loblolly pine, a tall bare trunk with a small high crown.
// - magnolia: a southern magnolia, a dense dark oval to near the ground.
// - myrtle: a crape myrtle, three leaning trunks and a small crown, most
//   in bloom.
//
// A crown is a set of "puffs": jittered icospheres. Each puff vertex gets a
// normal that points away from the crown center, so the toon ramp shades
// the whole crown as one soft shape, not as many small balls. The vertex
// colors are darker low and inside the crown, a cheap baked occlusion.
//
// Each vertex also has a sway weight (0 at the trunk base, up to 1 at the
// crown edge). The render adds wind from it (src/render/geo-view.js).
//
// Templates have the same shape as the street kit templates: { positions,
// indices, colors, normals } plus `sway`, with +y up and the trunk base at
// the origin. LOD1 is a low-poly copy for far tiles.
//
// With `cards` (the pbr look) a near tree also gets leaf cards: small quads
// on the surface of each puff, which face out of the crown. The render cuts
// a cluster of leaves out of each card (src/render/geo-view.js), so the crown
// gets a broken, leafy edge and light through the gaps. The puffs get
// smaller, to be the dense core of the crown. A card vertex has a `leaf`
// attribute [u, v, seed]; seed 0 means "not a card".

import { hash32, seededRandom } from "./styles.js";

export const TREE_VARIANTS = 3;

// Sizes in meters. `crown`: [center height, half width, half height].
// `puffs`: [count, min radius, max radius]. `clear` is the lowest crown
// height at scale 1; the tests check it.
export const TREE_SPECIES = {
  oak: {
    trunk: { height: 3.6, radius: 0.3, top: 0.2, count: 1, lean: 0.05 },
    crown: [7.2, 4.2, 2.2],
    puffs: [7, 1.7, 2.3],
    branches: 4,
    leaf: [0.5, 0.76, 0.3],
    clear: 2.8,
  },
  pine: {
    trunk: { height: 11, radius: 0.26, top: 0.1, count: 1, lean: 0.03 },
    crown: [13.2, 2.3, 1.8],
    puffs: [5, 1.3, 1.8],
    branches: 3,
    leaf: [0.34, 0.58, 0.36],
    flatten: 0.6,
    clear: 9,
  },
  magnolia: {
    trunk: { height: 1.6, radius: 0.24, top: 0.16, count: 1, lean: 0.02 },
    crown: [5, 2.5, 3.1],
    puffs: [7, 1.4, 1.9],
    branches: 2,
    leaf: [0.28, 0.54, 0.3],
    clear: 0.7,
  },
  myrtle: {
    trunk: { height: 3.1, radius: 0.1, top: 0.07, count: 3, lean: 0.32 },
    crown: [4.4, 2.1, 1.3],
    puffs: [5, 1.0, 1.4],
    branches: 0,
    leaf: [0.48, 0.72, 0.34],
    // Crape myrtle blooms all summer in Atlanta: pink, magenta, or white.
    blooms: [
      [0.86, 0.45, 0.64],
      [0.76, 0.3, 0.55],
      [0.93, 0.9, 0.92],
    ],
    clear: 2.1,
  },
};

const BARK = { oak: [0.36, 0.28, 0.22], pine: [0.42, 0.3, 0.22], magnolia: [0.38, 0.34, 0.3], myrtle: [0.66, 0.56, 0.48] };

// The street kit has two tree kinds. tree_tall gets the tall species.
const ROUND_MIX = [
  ["oak", 0.6],
  ["myrtle", 0.85],
  ["magnolia", 1],
];
const TALL_MIX = [
  ["pine", 0.7],
  ["magnolia", 1],
];

export function isTreeKind(kind) {
  return kind === "tree_round" || kind === "tree_tall";
}

// The template name for one tree placement, from its position, so the same
// spot always gets the same tree.
export function treeKindFor(p) {
  const h = hash32(`tree:${Math.round(p.x * 10)},${Math.round(p.z * 10)}`);
  const u = (h % 1000) / 1000;
  const mix = p.kind === "tree_tall" ? TALL_MIX : ROUND_MIX;
  const species = mix.find(([, edge]) => u < edge)[0];
  return `tree:${species}:${(h >>> 10) % TREE_VARIANTS}`;
}

// --- small mesh builder ---------------------------------------------------

function newMesh() {
  return { positions: [], indices: [], colors: [], normals: [], sway: [], leaf: [] };
}

// The colors in this file are sRGB, as a painter picks them. Vertex colors
// are linear in three.js (the street kit GLB stores them linear too).
const toLinear = (v) => Math.pow(Math.max(0, v), 2.2);

function vertex(m, p, n, c, sway) {
  m.positions.push(p[0], p[1], p[2]);
  m.normals.push(n[0], n[1], n[2]);
  m.colors.push(toLinear(c[0]), toLinear(c[1]), toLinear(c[2]));
  m.sway.push(sway);
  m.leaf.push(0, 0, 0);
  return m.positions.length / 3 - 1;
}

// Leaf cards for one puff. Each card is a square of side `size`, at a random
// point on the puff surface, turned about its normal by a random angle.
export const CARDS = { perPuff: 18, size: 0.95, out: 0.85, core: 0.78 };
function cards(m, center, radius, flatten, rand, ctx) {
  for (let i = 0; i < CARDS.perPuff; i += 1) {
    // A uniform point on the sphere, a little more on the top and the sides.
    const y = rand() * 1.7 - 0.7;
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const s = [Math.cos(a) * r, y, Math.sin(a) * r];
    const p = [center[0] + s[0] * radius * CARDS.out, center[1] + s[1] * radius * CARDS.out * flatten, center[2] + s[2] * radius * CARDS.out];
    const out = norm(sub(p, ctx.crown));
    const n = norm([out[0] * 0.7 + s[0] * 0.3, out[1] * 0.7 + s[1] * 0.3, out[2] * 0.7 + s[2] * 0.3]);
    // Two axes in the card plane, turned by a random angle.
    const ref = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const t0 = norm(cross(n, ref));
    const b0 = cross(n, t0);
    const turn = rand() * Math.PI * 2;
    const half = (radius * CARDS.size) / 2;
    const t = [0, 1, 2].map((k) => (t0[k] * Math.cos(turn) + b0[k] * Math.sin(turn)) * half);
    const b = [0, 1, 2].map((k) => (b0[k] * Math.cos(turn) - t0[k] * Math.sin(turn)) * half);
    const lift = clamp01((p[1] - ctx.bottom) / (ctx.top - ctx.bottom));
    const color = shade(ctx.colorAt(rand), Math.min(1.1, 0.86 + 0.2 * lift));
    // The seed (0..1, never 0) picks the leaf layout in the shader.
    const seed = 0.05 + rand() * 0.95;
    const base = m.positions.length / 3;
    for (const [u, v] of [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]) {
      const q = [0, 1, 2].map((k) => p[k] + t[k] * (u * 2 - 1) + b[k] * (v * 2 - 1));
      vertex(m, q, n, color, ctx.swayOf(q));
      m.leaf.splice(m.leaf.length - 3, 3, u, v, seed);
    }
    m.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

// A tapered tube from a to b, open at both ends (the ends are inside the
// ground or the crown).
function tube(m, a, b, r0, r1, sides, color, swayOf) {
  const axis = norm(sub(b, a));
  const ref = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(axis, ref));
  const v = cross(axis, u);
  const base = m.positions.length / 3;
  for (const [p, r] of [
    [a, r0],
    [b, r1],
  ]) {
    for (let i = 0; i < sides; i += 1) {
      const t = (i / sides) * Math.PI * 2;
      const n = [u[0] * Math.cos(t) + v[0] * Math.sin(t), u[1] * Math.cos(t) + v[1] * Math.sin(t), u[2] * Math.cos(t) + v[2] * Math.sin(t)];
      const q = [p[0] + n[0] * r, p[1] + n[1] * r, p[2] + n[2] * r];
      vertex(m, q, n, shade(color, 0.8 + 0.2 * Math.max(0, n[0] * 0.5 + n[2] * 0.5)), swayOf(q));
    }
  }
  for (let i = 0; i < sides; i += 1) {
    const j = (i + 1) % sides;
    m.indices.push(base + i, base + j, base + sides + j, base + i, base + sides + j, base + sides + i);
  }
}

// The unit icosahedron, then `levels` midpoint splits.
function icosphere(levels) {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ].map(norm);
  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let l = 0; l < levels; l += 1) {
    const cache = new Map();
    const mid = (a, b) => {
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      if (!cache.has(k)) {
        verts.push(norm([(verts[a][0] + verts[b][0]) / 2, (verts[a][1] + verts[b][1]) / 2, (verts[a][2] + verts[b][2]) / 2]));
        cache.set(k, verts.length - 1);
      }
      return cache.get(k);
    };
    const next = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b);
      const bc = mid(b, c);
      const ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  return { verts, faces };
}

const SPHERES = [icosphere(0), icosphere(1)];

// One crown puff. `crown` is the crown center: the normals point away from
// it, mixed with the puff's own normal, so the crown shades as one shape.
function puff(m, center, radius, flatten, sphere, rand, ctx) {
  const base = m.positions.length / 3;
  for (const s of sphere.verts) {
    const k = 1 + (rand() - 0.5) * 0.18;
    const p = [center[0] + s[0] * radius * k, center[1] + s[1] * radius * k * flatten, center[2] + s[2] * radius * k];
    const out = norm(sub(p, ctx.crown));
    const n = norm([out[0] * 0.8 + s[0] * 0.2, out[1] * 0.8 + s[1] * 0.2, out[2] * 0.8 + s[2] * 0.2]);
    // Baked occlusion: dark low in the crown and on the inside.
    const lift = clamp01((p[1] - ctx.bottom) / (ctx.top - ctx.bottom));
    const edge = clamp01(len(sub(p, ctx.crown)) / ctx.reach);
    const ao = 0.78 + 0.18 * lift + 0.1 * edge;
    const color = ctx.colorAt(rand);
    vertex(m, p, n, shade(color, Math.min(1.08, ao)), ctx.swayOf(p));
  }
  for (const [a, b, c] of sphere.faces) m.indices.push(base + a, base + b, base + c);
}

// One tree template. `lod` 0 is detailed, 1 is for far tiles.
export function treeTemplate(species, variant, lod = 0, { cards: withCards = false } = {}) {
  const sp = TREE_SPECIES[species];
  if (!sp) throw new Error(`trees: no species ${species}`);
  // The shape comes from the species and variant only. LOD1 uses the same
  // seed, so the far tree has the same shape as the near one.
  const rand = seededRandom(hash32(`${species}:${variant}`));
  const m = newMesh();
  const [cy, rx, ry] = sp.crown;
  const grow = 0.9 + rand() * 0.25;
  const crown = [(rand() - 0.5) * 0.6, cy * grow, (rand() - 0.5) * 0.6];
  const halfW = rx * grow;
  const halfH = ry * grow;
  const top = crown[1] + halfH + sp.puffs[2];
  const swayOf = (p) => Math.round(clamp01(Math.pow(p[1] / top, 2) * 0.8 + (len([p[0], 0, p[2]]) / (halfW + sp.puffs[2])) * 0.35) * 1000) / 1000;

  // Trunks.
  const bark = BARK[species];
  const sides = lod === 0 ? 6 : 4;
  const trunkTops = [];
  for (let i = 0; i < sp.trunk.count; i += 1) {
    const a = sp.trunk.count === 1 ? 0 : (i / sp.trunk.count) * Math.PI * 2 + rand() * 0.6;
    const lean = sp.trunk.lean * (0.7 + rand() * 0.6);
    const h = sp.trunk.height * grow * (0.9 + rand() * 0.2);
    const base = sp.trunk.count === 1 ? [0, 0, 0] : [Math.cos(a) * 0.15, 0, Math.sin(a) * 0.15];
    const tip = [base[0] + Math.cos(a) * lean * h, h, base[2] + Math.sin(a) * lean * h];
    tube(m, [base[0], -0.2, base[2]], tip, sp.trunk.radius, sp.trunk.top, sides, bark, swayOf);
    trunkTops.push(tip);
  }

  // Puff centers inside the crown ellipsoid: one at the top, the rest
  // around it.
  const [count, rMin, rMax] = sp.puffs;
  const n = lod === 0 ? count : Math.max(2, Math.ceil(count / 2.5));
  const centers = [];
  for (let i = 0; i < n; i += 1) {
    if (i === 0) {
      centers.push([crown[0], crown[1] + halfH * 0.35, crown[2], (rMax + rMin) / 2 + 0.2]);
      continue;
    }
    const a = (i / (n - 1)) * Math.PI * 2 + rand() * 0.8;
    const d = 0.55 + rand() * 0.35;
    const y = (rand() - 0.55) * 1.2;
    centers.push([crown[0] + Math.cos(a) * halfW * d, crown[1] + y * halfH, crown[2] + Math.sin(a) * halfW * d, rMin + rand() * (rMax - rMin)]);
  }
  // LOD1 has fewer, larger puffs to fill the same volume.
  if (lod === 1) for (const c of centers) c[3] *= 1.35;

  // Branches from the trunk top to some puffs.
  if (lod === 0) {
    for (let i = 0; i < Math.min(sp.branches, centers.length - 1); i += 1) {
      const from = trunkTops[i % trunkTops.length];
      const c = centers[i + 1];
      const to = [from[0] + (c[0] - from[0]) * 0.7, from[1] + (c[1] - from[1]) * 0.7, from[2] + (c[2] - from[2]) * 0.7];
      tube(m, from, to, sp.trunk.top * 0.8, sp.trunk.top * 0.4, 4, bark, swayOf);
    }
  }

  // Leaf colors: the species green, each variant a little different; a
  // crape myrtle in bloom mixes the bloom color into most puffs.
  const hue = 0.92 + rand() * 0.16;
  const leaf = [sp.leaf[0] * hue, sp.leaf[1], sp.leaf[2] * (2 - hue)];
  const bloom = sp.blooms ? sp.blooms[variant % sp.blooms.length] : null;
  let bottom = Infinity;
  for (const c of centers) bottom = Math.min(bottom, c[1] - c[3] * (sp.flatten ?? 1));
  const ctx = {
    crown,
    bottom,
    top,
    reach: halfW + rMax,
    swayOf,
    colorAt: (r) => {
      const k = 0.92 + r() * 0.16;
      if (bloom && r() < 0.7) return shade(bloom, k);
      return shade(leaf, k);
    },
  };
  const sphere = SPHERES[lod === 0 ? 1 : 0];
  const leafy = withCards && lod === 0;
  for (const c of centers) puff(m, [c[0], c[1], c[2]], leafy ? c[3] * CARDS.core : c[3], sp.flatten ?? 1, sphere, rand, ctx);
  // The cards use their own random stream, so the trunk and the puffs keep
  // the same shape with and without cards.
  if (leafy) {
    const cardRand = seededRandom(hash32(`${species}:${variant}:cards`));
    for (const c of centers) cards(m, [c[0], c[1], c[2]], c[3], sp.flatten ?? 1, cardRand, ctx);
  }

  return {
    positions: Float32Array.from(m.positions),
    indices: Uint32Array.from(m.indices),
    colors: Float32Array.from(m.colors),
    normals: Float32Array.from(m.normals),
    sway: Float32Array.from(m.sway),
    ...(leafy ? { leaf: Float32Array.from(m.leaf) } : {}),
  };
}

// Every tree template, keyed as treeKindFor() names them, with the LOD1
// copies under `<name>_lod1` (the street kit convention).
export function treeTemplates({ cards = false } = {}) {
  const out = {};
  for (const species of Object.keys(TREE_SPECIES)) {
    for (let v = 0; v < TREE_VARIANTS; v += 1) {
      out[`tree:${species}:${v}`] = treeTemplate(species, v, 0, { cards });
      out[`tree:${species}:${v}_lod1`] = treeTemplate(species, v, 1);
    }
  }
  return out;
}

// Swaps the two kit tree kinds for the procedural trees. The colliders keep
// the kit kinds (src/level/geo/props.js PROP_SOLID), so only the render
// copy changes.
export function withProceduralTrees(placements) {
  return placements.map((p) => (isTreeKind(p.kind) ? { ...p, kind: treeKindFor(p) } : p));
}
