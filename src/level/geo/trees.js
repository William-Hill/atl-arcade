// Procedural trees for a geodata level. Pure and seeded: the same species
// and variant give the same mesh in node and in the browser.
//
// Six Atlanta trees (issue #137), each in TREE_VARIANTS shapes:
// - oak: a willow oak, a broad round canopy on a clear trunk.
// - pine: a loblolly pine, a tall bare trunk with a small high crown.
// - magnolia: a southern magnolia, a dense dark oval to near the ground.
// - myrtle: a crape myrtle, three leaning trunks and a small crown, most
//   in bloom.
// - dogwood: a flowering dogwood, a low wide crown in layers, white in the
//   spring.
// - street: a red maple street tree, a narrow oval crown on a clear trunk,
//   red in the fall.
//
// Each species has a color for each season (`seasons`): the leaf color, and
// the bloom colors with the share of puffs in bloom. The default season is
// summer.
//
// A crown is a set of "puffs": jittered icospheres. Each puff vertex gets a
// normal that points away from the crown center, so the toon ramp shades
// the whole crown as one soft shape, not as many small balls. The vertex
// colors are darker low and inside the crown, a cheap baked occlusion.
//
// LOD1 is a set of 3 crossed cards: flat crown silhouettes on a thin trunk
// card, for the trees far from the camera. The card normals point away from
// the crown center, so the toon ramp shades a card as a round crown.
//
// Each vertex also has a sway weight (0 at the trunk base, up to 1 at the
// crown edge). The render adds wind from it (src/render/geo-view.js).
//
// Templates have the same shape as the street kit templates: { positions,
// indices, colors, normals } plus `sway`, with +y up and the trunk base at
// the origin. LOD1 is the far card set.
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
// `puffs`: [count, min radius, max radius]. `clear` is the lowest leaf or
// branch height off the trunk at scale 1, over all variants; the tests check
// it. Placement keeps a low crown off the skate surfaces with it.
export const TREE_SPECIES = {
  oak: {
    trunk: { height: 3.6, radius: 0.3, top: 0.2, count: 1, lean: 0.05 },
    crown: [7.2, 4.2, 2.2],
    puffs: [7, 1.7, 2.3],
    branches: 4,
    leaf: [0.5, 0.76, 0.3],
    seasons: { spring: { leaf: [0.62, 0.84, 0.36] }, fall: { leaf: [0.74, 0.56, 0.26] } },
    clear: 3.4,
  },
  pine: {
    trunk: { height: 11, radius: 0.26, top: 0.1, count: 1, lean: 0.03 },
    crown: [13.2, 2.3, 1.8],
    puffs: [5, 1.3, 1.8],
    branches: 3,
    leaf: [0.34, 0.58, 0.36],
    flatten: 0.6,
    clear: 10.5,
  },
  magnolia: {
    trunk: { height: 1.6, radius: 0.24, top: 0.16, count: 1, lean: 0.02 },
    crown: [5, 2.5, 3.1],
    puffs: [7, 1.4, 1.9],
    branches: 2,
    leaf: [0.28, 0.54, 0.3],
    // The big white flowers open in late spring.
    seasons: { spring: { blooms: [[0.96, 0.94, 0.88]], share: 0.15 } },
    clear: 1.4,
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
    seasons: { spring: { leaf: [0.58, 0.78, 0.36], share: 0 }, fall: { leaf: [0.86, 0.46, 0.26], share: 0 } },
    clear: 2.5,
  },
  dogwood: {
    trunk: { height: 1.7, radius: 0.13, top: 0.08, count: 1, lean: 0.12 },
    crown: [3.4, 2.6, 1.2],
    puffs: [6, 1.0, 1.3],
    branches: 3,
    leaf: [0.44, 0.68, 0.32],
    flatten: 0.7,
    // The white bracts cover the tree in April; the leaves go deep red in
    // the fall.
    seasons: { spring: { blooms: [[0.97, 0.96, 0.92], [0.96, 0.84, 0.88]], share: 0.75 }, fall: { leaf: [0.66, 0.2, 0.2] } },
    clear: 1.7,
  },
  street: {
    trunk: { height: 2.9, radius: 0.18, top: 0.12, count: 1, lean: 0.03 },
    crown: [5.7, 2.6, 2.3],
    puffs: [7, 1.4, 1.9],
    branches: 3,
    leaf: [0.46, 0.7, 0.3],
    seasons: { spring: { leaf: [0.66, 0.6, 0.34] }, fall: { leaf: [0.86, 0.26, 0.18] } },
    clear: 3.0,
  },
};

export const SEASONS = ["spring", "summer", "fall"];

// Pure: the leaf color, the bloom colors, and the bloom share of a species
// in a season. A season with no entry uses the summer colors.
export function seasonColors(species, season = "summer") {
  const sp = TREE_SPECIES[species];
  const s = sp.seasons?.[season] ?? {};
  const summer = sp.seasons?.summer ?? {};
  const blooms = s.blooms ?? (season === "summer" ? summer.blooms ?? sp.blooms ?? null : null);
  const share = blooms ? s.share ?? (season === "summer" ? summer.share ?? 0.7 : 0.7) : 0;
  return { leaf: s.leaf ?? sp.leaf, blooms: share > 0 ? blooms : null, share };
}

// The crown reach of a species at scale 1: the half width of the crown
// plus the largest puff (m). Placement sizes a tree from it.
export function crownReach(species) {
  const sp = TREE_SPECIES[species];
  return sp.crown[1] + sp.puffs[2];
}

const BARK = { oak: [0.36, 0.28, 0.22], pine: [0.42, 0.3, 0.22], magnolia: [0.38, 0.34, 0.3], myrtle: [0.66, 0.56, 0.48], dogwood: [0.4, 0.33, 0.28], street: [0.44, 0.4, 0.36] };

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

// The template name for one tree placement. A placement with a `species`
// (src/level/geo/tree-placement.js) keeps it. The variant, and the species
// of an old placement with no species, come from the position, so the same
// spot always gets the same tree.
export function treeKindFor(p) {
  const h = hash32(`tree:${Math.round(p.x * 10)},${Math.round(p.z * 10)}`);
  const u = (h % 1000) / 1000;
  const mix = p.kind === "tree_tall" ? TALL_MIX : ROUND_MIX;
  const species = p.species && TREE_SPECIES[p.species] ? p.species : mix.find(([, edge]) => u < edge)[0];
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
export const LEAF_CARDS = { perPuff: 18, size: 0.95, out: 0.85, core: 0.78 };
function cards(m, center, radius, flatten, rand, ctx) {
  for (let i = 0; i < LEAF_CARDS.perPuff; i += 1) {
    // A uniform point on the sphere, a little more on the top and the sides.
    const y = rand() * 1.7 - 0.7;
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const s = [Math.cos(a) * r, y, Math.sin(a) * r];
    const p = [center[0] + s[0] * radius * LEAF_CARDS.out, center[1] + s[1] * radius * LEAF_CARDS.out * flatten, center[2] + s[2] * radius * LEAF_CARDS.out];
    const out = norm(sub(p, ctx.crown));
    const n = norm([out[0] * 0.7 + s[0] * 0.3, out[1] * 0.7 + s[1] * 0.3, out[2] * 0.7 + s[2] * 0.3]);
    // Two axes in the card plane, turned by a random angle.
    const ref = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const t0 = norm(cross(n, ref));
    const b0 = cross(n, t0);
    const turn = rand() * Math.PI * 2;
    const half = (radius * LEAF_CARDS.size) / 2;
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

// One tree template. `lod` 0 is detailed, 1 is the far card set. `season`
// picks the leaf colors; with `cards`, a detailed tree also gets the leaf
// cards (the pbr look).
export function treeTemplate(species, variant, lod = 0, season = "summer", { cards: withCards = false } = {}) {
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

  // The leaf colors: the species color in the season, each variant a little
  // different; a tree in bloom mixes the bloom color into some puffs. The
  // colors take no numbers from `rand`, so the shape is the same in each
  // season.
  const colors = seasonColors(species, season);
  const tint = seededRandom(hash32(`${species}:${variant}:tint`));
  const hue = 0.92 + tint() * 0.16;
  const leaf = [colors.leaf[0] * hue, colors.leaf[1], colors.leaf[2] * (2 - hue)];
  const bloom = colors.blooms ? colors.blooms[variant % colors.blooms.length] : null;
  // The colors have their own random stream, with the same number of draws
  // in each season, so the season does not change the shape.
  const paint = seededRandom(hash32(`${species}:${variant}:paint`));
  const colorAt = () => {
    const k = 0.92 + paint() * 0.16;
    const b = paint();
    if (bloom && b < colors.share) return shade(bloom, k);
    return shade(leaf, k);
  };

  if (lod === 1) return cardTree(species, sp, rand, grow, crown, halfW, halfH, top, swayOf, colorAt);

  // Trunks.
  const bark = BARK[species];
  const sides = 6;
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
  const n = count;
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
  // Branches from the trunk top to some puffs.
  for (let i = 0; i < Math.min(sp.branches, centers.length - 1); i += 1) {
    const from = trunkTops[i % trunkTops.length];
    const c = centers[i + 1];
    const to = [from[0] + (c[0] - from[0]) * 0.7, from[1] + (c[1] - from[1]) * 0.7, from[2] + (c[2] - from[2]) * 0.7];
    tube(m, from, to, sp.trunk.top * 0.8, sp.trunk.top * 0.4, 4, bark, swayOf);
  }

  let bottom = Infinity;
  for (const c of centers) bottom = Math.min(bottom, c[1] - c[3] * (sp.flatten ?? 1));
  const ctx = {
    crown,
    bottom,
    top,
    reach: halfW + rMax,
    swayOf,
    colorAt,
  };
  const leafy = withCards && lod === 0;
  for (const c of centers) puff(m, [c[0], c[1], c[2]], leafy ? c[3] * LEAF_CARDS.core : c[3], sp.flatten ?? 1, SPHERES[1], rand, ctx);
  // The cards use their own random stream, so the trunk and the puffs keep
  // the same shape with and without cards.
  if (leafy) {
    const cardRand = seededRandom(hash32(`${species}:${variant}:cards`));
    for (const c of centers) cards(m, [c[0], c[1], c[2]], c[3], sp.flatten ?? 1, cardRand, ctx);
  }
  return packed(m, leafy);
}

// With `leafy`, the mesh keeps its leaf attribute (the leaf cards).
function packed(m, leafy = false) {
  return {
    positions: Float32Array.from(m.positions),
    indices: Uint32Array.from(m.indices),
    colors: Float32Array.from(m.colors),
    normals: Float32Array.from(m.normals),
    sway: Float32Array.from(m.sway),
    ...(leafy ? { leaf: Float32Array.from(m.leaf) } : {}),
  };
}

const LOD1_CARDS = 3;
const CARD_RIM = 8;

// LOD1: LOD1_CARDS vertical cards through the crown center, at equal angles.
// Each card is a trunk quad and a crown silhouette (a fan of CARD_RIM rim
// points on the crown ellipse, with a seeded bump), with a front and a back
// copy. The crown is the same size as the LOD0 crown.
function cardTree(species, sp, rand, grow, crown, halfW, halfH, top, swayOf, colorAt) {
  const m = newMesh();
  const bark = BARK[species];
  const flatten = sp.flatten ?? 1;
  const reachW = halfW * 0.85 + sp.puffs[2] * 0.7;
  const reachH = halfH + sp.puffs[2] * 0.6 * flatten;
  const trunkTop = crown[1] - reachH * 0.5;
  const trunkR = sp.trunk.radius * Math.max(1, sp.trunk.count * 0.7);
  const bumps = Array.from({ length: CARD_RIM }, () => 0.86 + rand() * 0.2);
  for (let c = 0; c < LOD1_CARDS; c += 1) {
    const a = (c / LOD1_CARDS) * Math.PI + rand() * 0.2;
    const u = [Math.cos(a), 0, Math.sin(a)];
    const facing = [-u[2], 0, u[0]];
    for (const side of [1, -1]) {
      const f = [facing[0] * side, 0, facing[2] * side];
      const flip = (i0, i1, i2) => (side === 1 ? [i0, i1, i2] : [i0, i2, i1]);
      // The trunk card.
      const t = [];
      for (const [s, y] of [[-1, -0.2], [1, -0.2], [1, trunkTop], [-1, trunkTop]]) {
        const p = [u[0] * s * trunkR, y, u[2] * s * trunkR];
        t.push(vertex(m, p, norm([u[0] * s * 0.5 + f[0], 0, u[2] * s * 0.5 + f[2]]), shade(bark, 0.85), swayOf(p)));
      }
      m.indices.push(...flip(t[0], t[1], t[2]), ...flip(t[0], t[2], t[3]));
      // The crown fan.
      const centerP = [crown[0], crown[1], crown[2]];
      const center = vertex(m, centerP, norm([f[0], 0.35, f[2]]), shade(colorAt(rand), 1.04), swayOf(centerP));
      const rim = [];
      for (let i = 0; i < CARD_RIM; i += 1) {
        const t2 = (i / CARD_RIM) * Math.PI * 2;
        const k = bumps[i];
        const p = [crown[0] + u[0] * Math.cos(t2) * reachW * k, crown[1] + Math.sin(t2) * reachH * k, crown[2] + u[2] * Math.cos(t2) * reachW * k];
        const out = norm(sub(p, centerP));
        const n = norm([out[0] * 0.75 + f[0] * 0.45, out[1] * 0.75, out[2] * 0.75 + f[2] * 0.45]);
        // Baked occlusion: darker low on the crown.
        const ao = 0.8 + 0.2 * clamp01((Math.sin(t2) + 1) / 2);
        rim.push(vertex(m, p, n, shade(colorAt(rand), ao), swayOf(p)));
      }
      for (let i = 0; i < CARD_RIM; i += 1) m.indices.push(...flip(center, rim[i], rim[(i + 1) % CARD_RIM]));
    }
  }
  return packed(m);
}

// Every tree template, keyed as treeKindFor() names them, with the LOD1
// cards under `<name>_lod1` (the street kit convention). `season` is one of
// SEASONS; another value gives summer. With `cards`, the detailed trees get
// the leaf cards (the pbr look).
export function treeTemplates({ season = "summer", cards = false } = {}) {
  const s = SEASONS.includes(season) ? season : "summer";
  const out = {};
  for (const species of Object.keys(TREE_SPECIES)) {
    for (let v = 0; v < TREE_VARIANTS; v += 1) {
      out[`tree:${species}:${v}`] = treeTemplate(species, v, 0, s, { cards });
      out[`tree:${species}:${v}_lod1`] = treeTemplate(species, v, 1, s);
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
