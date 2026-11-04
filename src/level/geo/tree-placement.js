// Tree placement for a geodata level (issue #137). Pure and seeded: the same
// level and canopy give the same trees, in node and in the browser.
//
// Source: the City of Atlanta Urban Tree Canopy 2018 raster, cut to the
// level grid by scripts/city-canopy.py (<level>/canopy.json). The raster
// gives the position and the crown size of the trees. It does not give the
// species. OpenStreetMap has no `natural=tree` or `tree_row` in the
// beltline-eastside box. Thus the species come from the setting, with a
// seeded hash (see SPECIES_MIX).
//
// Rules (also in docs/decisions.md):
// - Canopy trees: a point each CANOPY_SPACING m on a seeded, jittered grid.
//   A point gets a tree when the raster shows canopy there and around it.
//   Outside a park, only OUTSIDE_PARK_SHARE of the points get a tree, so the
//   parks have the densest canopy.
// - Size: the largest crown radius in CROWN_RADII that the raster fills to
//   CROWN_FILL. The tree scale is that radius over the species crown reach,
//   in SCALE_RANGE.
// - Clearance: a trunk is never on a street, sidewalk, path, the trail, a
//   bridge, or in a building (props.js checks the trunk). A crown with its
//   lowest leaves under LOW_CROWN m must not hang over a skate surface, so
//   the skater never rides through leaves. A crown must not go into a
//   building. fitTree() makes the tree smaller, or swaps the species for a
//   tree with a high crown, until both rules hold.

import { pointInRings } from "./geo-ground.js";
import { hash32 } from "./styles.js";
import { TREE_SPECIES, crownReach } from "./trees.js";

export const CANOPY_SPACING = 7; // m
export const OUTSIDE_PARK_SHARE = 0.6;
export const CROWN_RADII = [7, 6, 5, 4, 3]; // m
export const CROWN_FILL = 0.55;
export const SCALE_RANGE = [0.75, 1.3];
export const LOW_CROWN = 2.4; // m, a skater (1.8 m) and a jump of the arms

// The collider kind of each species (src/level/geo/props.js PROP_SOLID).
export const TREE_KIND = { oak: "tree_round", myrtle: "tree_round", dogwood: "tree_round", street: "tree_round", pine: "tree_tall", magnolia: "tree_tall" };

// The species mix of each setting: [species, cumulative share]. A row tree
// (trail or sidewalk) keeps the kind that props.js gave it, so it uses the
// part of the mix with that kind.
// - street: sidewalk rows, mostly red maple street trees and crape myrtles.
// - trail: the BeltLine plantings, oaks, crape myrtles, and dogwoods.
// - park: an Atlanta park canopy, oaks and pines with dogwoods and
//   magnolias under them.
// - yard: the canopy over yards and lots, oaks and pines.
export const SPECIES_MIX = {
  street: [["street", 0.45], ["myrtle", 0.7], ["oak", 0.85], ["magnolia", 0.93], ["pine", 1]],
  trail: [["oak", 0.3], ["myrtle", 0.5], ["dogwood", 0.65], ["street", 0.72], ["pine", 0.88], ["magnolia", 1]],
  park: [["oak", 0.4], ["pine", 0.6], ["dogwood", 0.75], ["magnolia", 0.88], ["myrtle", 0.95], ["street", 1]],
  yard: [["oak", 0.4], ["pine", 0.7], ["magnolia", 0.82], ["dogwood", 0.94], ["myrtle", 1]],
};

// A high-crown tree of each kind, for fitTree().
const HIGH_CROWN = { tree_round: "street", tree_tall: "pine" };

// Pure: a uniform number in [0, 1) from a key.
function unit(key) {
  return (hash32(key) % 100000) / 100000;
}

// Pure: a species from a setting mix for a key. With `kind`, only the
// species of that collider kind count.
export function pickSpecies(setting, key, kind = null) {
  const mix = SPECIES_MIX[setting];
  const rows = kind ? mix.filter(([s]) => TREE_KIND[s] === kind) : mix;
  // Make the shares of the kept rows cumulative again.
  let prev = 0;
  const parts = rows.map(([s, edge]) => {
    const i = mix.findIndex(([m]) => m === s);
    const share = edge - (i > 0 ? mix[i - 1][1] : 0);
    prev += share;
    return [s, prev];
  });
  const u = unit(key) * prev;
  return (parts.find(([, edge]) => u < edge) ?? parts[parts.length - 1])[0];
}

// Decodes a canopy grid (canopy.json). Returns null for no grid.
export function decodeCanopy(canopy) {
  if (!canopy || !canopy.data) return null;
  const raw = atob(canopy.data);
  const bits = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bits[i] = raw.charCodeAt(i);
  const { cell, x0, z0, cols, rows } = canopy;
  function has(x, z) {
    const c = Math.floor((x - x0) / cell);
    const r = Math.floor((z - z0) / cell);
    if (c < 0 || r < 0 || c >= cols || r >= rows) return false;
    const i = r * cols + c;
    return ((bits[i >> 3] >> (i & 7)) & 1) === 1;
  }
  // The share of 17 points (the center and two rings of 8) with canopy.
  function coverage(x, z, radius) {
    let n = has(x, z) ? 1 : 0;
    for (let k = 0; k < 8; k += 1) {
      const a = (k / 8) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      if (has(x + ca * radius, z + sa * radius)) n += 1;
      if (has(x + ca * radius * 0.5, z + sa * radius * 0.5)) n += 1;
    }
    return n / 17;
  }
  return { cell, x0, z0, cols, rows, has, coverage };
}

// Pure: the largest crown radius that the canopy fills at (x, z), or 0.
export function crownRadiusAt(mask, x, z) {
  for (const r of CROWN_RADII) if (mask.coverage(x, z, r) >= CROWN_FILL) return r;
  return 0;
}

// The ids that a crown may not hang over (the skate surfaces) and may not
// go into (the buildings).
export function clearanceIds(level) {
  const skate = new Set((level.strips ?? []).map((s) => s.id));
  for (const s of level.strips ?? []) skate.add(`${s.id}:parapet`);
  const buildings = new Set((level.buildings ?? []).map((b) => b.id));
  return { skate, buildings };
}

function ringClear(sample, x, z, radius, blocked) {
  for (let k = 0; k < 8; k += 1) {
    const a = (k / 8) * Math.PI * 2;
    const g = sample(x + Math.cos(a) * radius, z + Math.sin(a) * radius);
    if (g && blocked(g.id)) return false;
  }
  return true;
}

// Pure: true when a tree of `species` at `scale` keeps the clearance rules
// at (x, z).
export function treeClear(sample, ids, species, x, z, scale) {
  const reach = crownReach(species) * scale;
  // The crown edge is soft: check the solid part of the crown.
  if (!ringClear(sample, x, z, reach * 0.6, (id) => ids.buildings.has(id))) return false;
  if (TREE_SPECIES[species].clear * scale < LOW_CROWN && !ringClear(sample, x, z, reach * 0.85, (id) => ids.skate.has(id) || ids.buildings.has(id))) return false;
  return true;
}

// Pure: a species and a scale that keep the clearance rules, or null.
// It tries the species at its scale, then smaller, then the high-crown tree
// of the same kind.
export function fitTree(sample, ids, species, kind, x, z, scale) {
  const tries = [];
  for (const s of [species, HIGH_CROWN[kind]]) {
    for (let k = scale; k >= SCALE_RANGE[0] - 1e-9; k -= 0.1) tries.push([s, Math.round(k * 100) / 100]);
    if (scale > SCALE_RANGE[0]) tries.push([s, SCALE_RANGE[0]]);
  }
  for (const [s, k] of tries) if (treeClear(sample, ids, s, x, z, k)) return { species: s, scale: k };
  return null;
}

// The canopy trees of a level, before the open-ground and gap checks of
// props.js: [{ kind, species, x, z, yaw, scale, park }]. Big crowns come
// first, so they get their spot before the small ones.
export function canopyCandidates(level, mask) {
  if (!mask) return [];
  const parks = (level.areas ?? []).filter((a) => a.kind === "park").map((a) => [a.outer, ...(a.holes ?? [])]);
  const inPark = (x, z) => parks.some((rings) => pointInRings(x, z, rings));
  const b = level.bounds;
  const out = [];
  const step = CANOPY_SPACING;
  for (let gz = Math.ceil(b.minZ / step); gz * step <= b.maxZ; gz += 1) {
    for (let gx = Math.ceil(b.minX / step); gx * step <= b.maxX; gx += 1) {
      const key = `canopy:${gx},${gz}`;
      // Rounded as props.js rounds a placement, so the checks see the
      // final spot.
      const x = Math.round((gx * step + (unit(`${key}:x`) - 0.5) * step * 0.7) * 100) / 100;
      const z = Math.round((gz * step + (unit(`${key}:z`) - 0.5) * step * 0.7) * 100) / 100;
      if (!mask.has(x, z)) continue;
      const r = crownRadiusAt(mask, x, z);
      if (r === 0) continue;
      const park = inPark(x, z);
      if (!park && unit(`${key}:keep`) >= OUTSIDE_PARK_SHARE) continue;
      const species = pickSpecies(park ? "park" : "yard", key);
      const scale = Math.min(SCALE_RANGE[1], Math.max(SCALE_RANGE[0], r / crownReach(species)));
      out.push({ kind: TREE_KIND[species], species, x, z, yaw: unit(`${key}:yaw`) * Math.PI * 2, scale: Math.round(scale * 100) / 100, park, r });
    }
  }
  out.sort((p, q) => q.r - p.r || p.z - q.z || p.x - q.x);
  for (const p of out) delete p.r;
  return out;
}
