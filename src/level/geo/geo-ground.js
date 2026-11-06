// Ground sampler for a geodata level. Pure. Same contract as
// src/level/ground.js: sampleGround(x, z) returns the highest surface under
// the column, { height, normal, id }, or null outside the level.
//
// With terrain (src/level/geo/terrain.js) each surface sits its offset over
// the terrain, with the terrain normal, and a building top is its span top.
// A bridge deck has its own height line. sampleGround(x, z, y) with the
// skater height `y` leaves out a bridge more than BRIDGE_HEADROOM over `y`,
// so the skater rolls under a bridge and not into it.
//
// Buildings and areas are polygons. Streets, sidewalks, paths, and the trail
// are strips: a point is on a strip when it is within width / 2 of the
// center line. A uniform grid keeps each query to a few candidates.

import { BRIDGE, bridgeDeck, buildingSpan, limitGrade, parapetBlocked, terrainOf } from "./terrain.js";
import { bridgeLayout, parapetRuns } from "./bridges.js";
import { streetJunctions } from "./junctions.js";
import { medianStrips } from "./medians.js";
import { piecePoints, rampAt, sidewalkLayout } from "./curbs.js";

export const GEO_CELL = 16; // m, grid cell size.
export const BRIDGE_HEADROOM = 2.5; // m
const UP = [0, 1, 0];

// Even-odd test over the outer ring and the holes.
export function pointInRings(x, z, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, zi] = ring[i];
      const [xj, zj] = ring[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
  }
  return inside;
}

export function distanceToSegment(x, z, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (ax + t * dx), z - (az + t * dz));
}

// The deck normal at (x, z): the deck slope along its segment, from two
// samples 0.5 m apart. The deck is level across its width.
function deckNormal(s, x, z) {
  const dx = s.b[0] - s.a[0];
  const dz = s.b[1] - s.a[1];
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len;
  const uz = dz / len;
  const slope = (s.deck(x + ux * 0.25, z + uz * 0.25) - s.deck(x - ux * 0.25, z - uz * 0.25)) / 0.5;
  if (Math.abs(slope) < 1e-4) return UP;
  const l = Math.hypot(slope, 1);
  return [(-ux * slope) / l, 1 / l, (-uz * slope) / l];
}

function cellKey(ix, iz) {
  return ix * 65536 + iz;
}

// The surface heights (tops) of each strip and area kind, in meters.
export function surfaceTop(level, kind) {
  const top = level.surfaces?.[kind];
  if (typeof top !== "number") throw new Error(`geo level: no surface height for "${kind}"`);
  return top;
}

// Lists the shapes that the sampler tests. Each shape is
// { id, top, kind, rings } or { id, top, kind, a, b, r }.
export function geoShapes(level) {
  const shapes = [];
  const terrain = terrainOf(level);
  for (const b of level.buildings ?? []) {
    // A building top is absolute (it does not follow the terrain).
    shapes.push({ id: b.id, kind: "building", top: buildingSpan(level, b).top, abs: true, rings: [b.outer, ...(b.holes ?? [])] });
  }
  for (const a of level.areas ?? []) {
    shapes.push({ id: a.id, kind: a.kind, top: surfaceTop(level, a.kind), rings: [a.outer, ...(a.holes ?? [])] });
  }
  // The junction patches (junctions.js): a street surface that fills the
  // corner between two arms.
  if ((level.strips ?? []).some((s) => s.kind === "street")) {
    const top = surfaceTop(level, "street");
    for (const j of streetJunctions(level, { flat: terrain.flat }).junctions) shapes.push({ id: j.id, kind: "street", top, rings: [j.ring] });
  }
  // The raised medians (medians.js): a curb at the sidewalk height.
  if (level.surfaces?.sidewalk !== undefined) {
    const top = surfaceTop(level, "sidewalk");
    for (const m of medianStrips(level)) for (let i = 0; i < m.points.length - 1; i += 1) shapes.push({ id: m.id, kind: "median", top, a: m.points[i], b: m.points[i + 1], r: m.width / 2 });
  }
  const walks = sidewalkLayout(level);
  for (const s of level.strips ?? []) {
    const top = surfaceTop(level, s.kind);
    const deck = s.bridge && !terrain.flat ? bridgeDeck(level, s) : null;
    // A deck runs from joint to joint (bridges.js), past the OSM ends. A
    // sidewalk is its pieces and its curb ramps (curbs.js, #136).
    const lay = !deck && s.kind === "sidewalk" ? walks.get(s.id) : null;
    const lines = deck ? [bridgeLayout(level, s).points] : lay ? lay.pieces.map((r) => piecePoints(s.points, r)) : [s.points];
    for (const points of lines) for (let i = 0; i < points.length - 1; i += 1) shapes.push({ id: s.id, kind: s.kind, top, a: points[i], b: points[i + 1], r: s.width / 2, deck });
    for (const ramp of lay?.ramps ?? []) shapes.push({ id: s.id, kind: "ramp", top: ramp.h0, ramp });
    if (!deck) continue;
    // The parapets: a wall on each open side of the OSM span (geo-mesh.js).
    const o = s.width / 2 - BRIDGE.parapetWidth / 2;
    for (const k of [1, -1]) {
      for (const run of parapetRuns(level, s, k, BRIDGE.parapetWidth, parapetBlocked(level, s))) {
        for (let i = 0; i < run.points.length - 1; i += 1) {
          const a = run.points[i];
          const b = run.points[i + 1];
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          const nx = (-(b[1] - a[1]) / len) * o * k;
          const nz = ((b[0] - a[0]) / len) * o * k;
          shapes.push({ id: `${s.id}:parapet`, kind: "parapet", top: top + BRIDGE.parapet, a: [a[0] + nx, a[1] + nz], b: [b[0] + nx, b[1] + nz], r: BRIDGE.parapetWidth / 2, deck });
        }
      }
    }
  }
  return shapes;
}

function shapeBox(s) {
  if (s.ramp) {
    const { a, b, r } = s.ramp;
    return { minX: Math.min(a[0], b[0]) - r, maxX: Math.max(a[0], b[0]) + r, minZ: Math.min(a[1], b[1]) - r, maxZ: Math.max(a[1], b[1]) + r };
  }
  if (s.c) return { minX: s.c[0] - s.r, maxX: s.c[0] + s.r, minZ: s.c[1] - s.r, maxZ: s.c[1] + s.r };
  if (s.rings) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [x, z] of s.rings[0]) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    return { minX, maxX, minZ, maxZ };
  }
  return {
    minX: Math.min(s.a[0], s.b[0]) - s.r,
    maxX: Math.max(s.a[0], s.b[0]) + s.r,
    minZ: Math.min(s.a[1], s.b[1]) - s.r,
    maxZ: Math.max(s.a[1], s.b[1]) + s.r,
  };
}

function contains(s, x, z) {
  if (s.c) return Math.hypot(x - s.c[0], z - s.c[1]) <= s.r;
  if (s.rings) return pointInRings(x, z, s.rings);
  return distanceToSegment(x, z, s.a[0], s.a[1], s.b[0], s.b[1]) <= s.r;
}

// `obstacles` are solid circles { id, c: [x, z], r, top }, for example the
// street props (src/level/geo/props.js).
export function createGeoGroundSampler(level, cell = GEO_CELL, { obstacles = [] } = {}) {
  const shapes = [...geoShapes(level), ...obstacles];
  const grid = new Map();
  for (const s of shapes) {
    const box = shapeBox(s);
    for (let ix = Math.floor(box.minX / cell); ix <= Math.floor(box.maxX / cell); ix += 1) {
      for (let iz = Math.floor(box.minZ / cell); iz <= Math.floor(box.maxZ / cell); iz += 1) {
        const k = cellKey(ix, iz);
        let list = grid.get(k);
        if (!list) grid.set(k, (list = []));
        list.push(s);
      }
    }
  }
  const { minX, maxX, minZ, maxZ } = level.bounds;
  const groundTop = level.surfaces?.ground ?? 0;

  const terrain = terrainOf(level);

  function sampleGround(x, z, y = Infinity) {
    if (x < minX || x > maxX || z < minZ || z > maxZ) return null;
    const flat = terrain.flat;
    const t = flat ? 0 : terrain.height(x, z);
    const n = flat ? UP : limitGrade(terrain.normal(x, z));
    let best = { height: groundTop + t, normal: n, id: "ground" };
    const list = grid.get(cellKey(Math.floor(x / cell), Math.floor(z / cell)));
    let ramp = null;
    if (list) {
      for (const s of list) {
        if (s.ramp) {
          // A curb ramp (curbs.js): it wins over the sidewalk it cuts.
          const r = ramp ? null : rampAt(s.ramp, x, z);
          if (r) ramp = { height: r.height + t, normal: r.normal, id: s.id, top: s.ramp.h0 + t };
          continue;
        }
        let h;
        let normal = n;
        if (s.abs) {
          h = s.top;
          normal = UP;
        } else if (s.deck) {
          h = s.top + s.deck(x, z);
          if (h > y + BRIDGE_HEADROOM) continue;
          normal = limitGrade(deckNormal(s, x, z));
        } else h = s.top + t;
        if (h <= best.height) continue;
        if (contains(s, x, z)) best = { height: h, normal, id: s.id };
      }
    }
    // Over a ramp, nothing higher than the sidewalk (a prop, a building)
    // hides the ramp.
    if (ramp && best.height <= ramp.top + 0.01) return { height: ramp.height, normal: ramp.normal, id: ramp.id };
    return best;
  }
  sampleGround.cellCount = grid.size;
  sampleGround.shapeCount = shapes.length;
  return sampleGround;
}
