// Terrain for a geodata level. Pure.
//
// `level.terrain` is a grid of `cell` meters from (x0, z0), with the heights
// in cm (int16, base64), from scripts/terrain-dem.py (USGS 3DEP). The height
// between the nodes is piecewise linear on two triangles per cell, split on
// the diagonal from (1, 0) to (0, 1). So the terrain is a triangle mesh, and
// a flat piece inside one terrain triangle stays flat when it is moved up by
// the terrain height. drapeMesh() uses that: it cuts each triangle of a mesh
// on the terrain triangles, so a street a few cm over the ground stays a few
// cm over the ground everywhere, with no gap and no overlap.
//
// A level with no terrain gets the flat terrain (height 0 everywhere).

import { bridgeLayouts, project } from "./bridges.js";

const cache = new WeakMap();
const UP = [0, 1, 0];

export const FLAT_TERRAIN = {
  flat: true,
  height: () => 0,
  normal: () => UP,
};

export function encodeHeights(heights) {
  const view = new DataView(new ArrayBuffer(heights.length * 2));
  heights.forEach((h, i) => view.setInt16(i * 2, Math.round(h * 100), true));
  const bytes = new Uint8Array(view.buffer);
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function decodeHeights(base64, count) {
  return decode(base64, count);
}

function decode(base64, count) {
  let bytes;
  if (typeof Buffer !== "undefined") bytes = Uint8Array.from(Buffer.from(base64, "base64"));
  else bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i += 1) out[i] = view.getInt16(i * 2, true) / 100;
  return out;
}

// Makes a terrain from a grid { cell, x0, z0, cols, rows, heights } (heights
// in meters, row-major). Exported for the tests.
export function createTerrain({ cell, x0, z0, cols, rows, heights }) {
  function node(i, j) {
    const ci = Math.max(0, Math.min(cols - 1, i));
    const cj = Math.max(0, Math.min(rows - 1, j));
    return heights[cj * cols + ci];
  }
  // The terrain triangle under (x, z): its 3 corner nodes as [x, y, z].
  function triangle(x, z) {
    const fx = (x - x0) / cell;
    const fz = (z - z0) / cell;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const X = (k) => x0 + k * cell;
    const Z = (k) => z0 + k * cell;
    if (u + v <= 1) return [[X(i), node(i, j), Z(j)], [X(i + 1), node(i + 1, j), Z(j)], [X(i), node(i, j + 1), Z(j + 1)]];
    return [[X(i + 1), node(i + 1, j + 1), Z(j + 1)], [X(i), node(i, j + 1), Z(j + 1)], [X(i + 1), node(i + 1, j), Z(j)]];
  }
  function height(x, z) {
    const fx = (x - x0) / cell;
    const fz = (z - z0) / cell;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    if (u + v <= 1) {
      const h = node(i, j);
      return h + u * (node(i + 1, j) - h) + v * (node(i, j + 1) - h);
    }
    const h = node(i + 1, j + 1);
    return h + (1 - u) * (node(i, j + 1) - h) + (1 - v) * (node(i + 1, j) - h);
  }
  function normal(x, z) {
    const [a, b, c] = triangle(x, z);
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    if (ny < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  }
  return { flat: false, cell, x0, z0, cols, rows, height, normal };
}

// The terrain of a level (cached per level object).
export function terrainOf(level) {
  if (!level?.terrain) return FLAT_TERRAIN;
  let t = cache.get(level);
  if (!t) {
    const g = level.terrain;
    t = createTerrain({ ...g, heights: decode(g.data, g.cols * g.rows) });
    cache.set(level, t);
  }
  return t;
}

const coarse = new WeakMap();
// The level terrain with every `step`-th node (for a far level of detail).
// The same function on the shared nodes; between them it is coarser.
export function coarseTerrainOf(level, step = 2) {
  const t = terrainOf(level);
  if (t.flat || step <= 1) return t;
  let m = coarse.get(level);
  if (!m) coarse.set(level, (m = new Map()));
  if (!m.has(step)) {
    const g = level.terrain;
    const h = decode(g.data, g.cols * g.rows);
    const cols = Math.ceil((g.cols - 1) / step) + 1;
    const rows = Math.ceil((g.rows - 1) / step) + 1;
    const heights = new Float32Array(cols * rows);
    for (let j = 0; j < rows; j += 1) for (let i = 0; i < cols; i += 1) heights[j * cols + i] = h[Math.min(g.rows - 1, j * step) * g.cols + Math.min(g.cols - 1, i * step)];
    m.set(step, createTerrain({ cell: g.cell * step, x0: g.x0, z0: g.z0, cols, rows, heights }));
  }
  return m.get(step);
}

const spans = new WeakMap();
// The plinth of a building goes this far (m) under its lowest ground, so no
// wall floats on a slope.
export const PLINTH_DEPTH = 0.5;
// The step (m) of the ground samples along the walls and under the footprint.
const SPAN_STEP = 2;
// The walls at 1 m: the graded ground near a way bends more between samples.
const WALL_STEP = 1;

function insideRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Where a building stands. The ground floor starts at `base`: the highest
// ground along the walls and under the footprint, so the ground never
// covers the ground floor or a shop window. A plinth fills the walls from
// `foot` (PLINTH_DEPTH under the lowest ground along the walls) up to
// `base`; on a slope it shows on the low side, as on a real building.
// `top` is the data height over `base`. `ground` is the same as `base`.
export function buildingSpan(level, b) {
  let m = spans.get(level);
  if (!m) spans.set(level, (m = new Map()));
  let s = m.get(b.id);
  if (s) return s;
  const t = terrainOf(level);
  if (t.flat) s = { foot: 0, base: 0, ground: 0, top: b.height };
  else {
    let lo = Infinity;
    let hi = -Infinity;
    const ring = b.outer;
    for (let i = 0; i < ring.length; i += 1) {
      const [px, pz] = ring[i];
      const [qx, qz] = ring[(i + 1) % ring.length];
      const n = Math.max(1, Math.ceil(Math.hypot(qx - px, qz - pz) / WALL_STEP));
      for (let k = 0; k < n; k += 1) {
        const h = t.height(px + ((qx - px) * k) / n, pz + ((qz - pz) * k) / n);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
    }
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const [x, z] of ring) {
      x0 = Math.min(x0, x);
      z0 = Math.min(z0, z);
      x1 = Math.max(x1, x);
      z1 = Math.max(z1, z);
    }
    for (let x = x0 + SPAN_STEP / 2; x < x1; x += SPAN_STEP) {
      for (let z = z0 + SPAN_STEP / 2; z < z1; z += SPAN_STEP) if (insideRing(x, z, ring)) hi = Math.max(hi, t.height(x, z));
    }
    s = { foot: lo - PLINTH_DEPTH, base: hi, ground: hi, top: hi + b.height };
  }
  m.set(b.id, s);
  return s;
}

// A bridge deck. bridges.js puts the joint J of each end JOINT_SHIFT m past
// the OSM end, on the approach road. On the OSM span the deck runs straight
// in height from the ground at the first joint to the ground at the last
// joint. Where the span crosses a way at grade with less than
// DECK_CLEARANCE, the deck rises in a smooth arch to that clearance; the
// arch is 0 at the OSM ends. From the OSM end to J (the run-on), the deck
// blends from that line down to the ground: at J it is on the ground, so it
// meets the approach road, which is on the ground too, with no step and no
// gap (issue #131). It never goes under the ground. A hosted bridge (a
// sidewalk on a road bridge) has the line and the arch of its host, and its
// own run-ons.
//
// Returns deck(x, z), the deck height (without the surface offset) at the
// nearest point of the center line.
export const DECK_CLEARANCE = 4.5;
const ARCH_GRADE = 0.12;
const decks = new WeakMap();
const raws = new WeakMap();

// The straight deck line of a bridge layout on terrain t: line(x, z).
// `heights` can give the end heights; the default is the ground at J.
// `lands` are level landings (m) at the ends: the line holds the end height
// over each one, and slopes between them.
function deckLine(L, t, heights = null, lands = [0, 0]) {
  const [J0, J1] = [L.points[0], L.points[L.points.length - 1]];
  const h0 = heights?.[0] ?? t.height(J0[0], J0[1]);
  const h1 = heights?.[1] ?? t.height(J1[0], J1[1]);
  const total = L.total || 1;
  const run = total - lands[0] - lands[1];
  const [l0, span] = run >= 1 ? [lands[0], run] : [0, total];
  const at = (s) => h0 + (h1 - h0) * Math.max(0, Math.min(1, (s - l0) / span));
  const line = (x, z) => at(project(L.points, L.cum, x, z).s);
  line.at = at;
  line.ends = [h0, h1];
  line.slope = (h1 - h0) / span;
  return line;
}

// The line and the arch of a host layout (no run-ons): raw(x, z). An end
// with no approach road that is on another deck (a footway spur off a
// footway bridge) starts at the height of that deck, not of the ground, and
// holds it level to just past the edge of that deck, so the spur meets the
// deck with no step (w1118177210 had a 0.68 m step, a wall to the skater).
function rawDeck(level, L, seen = new Set()) {
  let m = raws.get(level);
  if (!m) raws.set(level, (m = new Map()));
  if (m.has(L.id)) return m.get(L.id);
  seen.add(L.id);
  const t = terrainOf(level);
  const pts = L.points;
  const cum = L.cum;
  const [a0, a1] = L.span;
  const layouts = bridgeLayouts(level.strips);
  const lands = [0, 0];
  const heights = L.ends.map((e, k) => {
    if (e.approach) return null;
    const J = k ? pts[pts.length - 1] : pts[0];
    for (const O of layouts.values()) {
      const root = O.host ?? O.id;
      if (root === L.id || seen.has(root)) continue;
      const { s, d } = project(O.points, O.cum, J[0], J[1]);
      if (s >= 0 && s <= O.total && d <= O.width / 2) {
        lands[k] = O.width / 2 - d + 0.5;
        return rawDeck(level, layouts.get(root), seen)(J[0], J[1]);
      }
    }
    return null;
  });
  const line = deckLine(L, t, heights, lands);
  // The arch: the largest lift that a crossing needs, at its distance along.
  // A way that meets the OSM end is the approach, not a way under the deck.
  let lift = 0;
  let at = (a0 + a1) / 2;
  for (let i = 0; i < pts.length - 1; i += 1) {
    for (const o of level.strips ?? []) {
      if (o.bridge) continue;
      for (let j = 0; j < o.points.length - 1; j += 1) {
        const x = segmentsCross(pts[i], pts[i + 1], o.points[j], o.points[j + 1]);
        if (!x) continue;
        const a = cum[i] + Math.hypot(x[0] - pts[i][0], x[1] - pts[i][1]);
        if (a < a0 + 3 || a > a1 - 3) continue;
        const need = t.height(x[0], x[1]) + DECK_CLEARANCE - line.at(a);
        if (need > lift) {
          lift = need;
          at = a;
        }
      }
    }
  }
  // No arch steeper than ARCH_GRADE on average (a short span gets less lift).
  lift = Math.max(0, Math.min(lift, ARCH_GRADE * Math.min(at - a0, a1 - at)));
  // A sine arch from 0 at each OSM end to `lift` at `at`.
  const arch = (a) => {
    if (!(lift > 0) || a <= a0 || a >= a1) return 0;
    return lift * Math.sin((Math.PI / 2) * (a < at ? (a - a0) / (at - a0) : (a1 - a) / (a1 - at)));
  };
  const raw = (x, z) => {
    const a = project(pts, cum, x, z).s;
    return line.at(a) + arch(a);
  };
  raw.line = line;
  raw.lift = lift;
  m.set(L.id, raw);
  return raw;
}

export function bridgeDeck(level, s) {
  let m = decks.get(level);
  if (!m) decks.set(level, (m = new Map()));
  if (m.has(s.id)) return m.get(s.id);
  const layouts = bridgeLayouts(level.strips);
  const L = layouts.get(s.id);
  const raw = rawDeck(level, layouts.get(L.host ?? L.id));
  const t = terrainOf(level);
  // The run-on weight: 0 at J, 1 a little before the OSM end, so the whole
  // mitered end edge of the span (a turn of up to 35 degrees) is on the line.
  const half = L.width / 2;
  const e0 = L.span[0];
  const e1 = L.total - L.span[1];
  const full0 = Math.max(e0 / 2, e0 - 0.35 * half);
  const full1 = Math.max(e1 / 2, e1 - 0.35 * half);
  const weight = (a) => {
    if (e0 > 0 && a < e0) return Math.max(0, Math.min(1, a / full0));
    if (e1 > 0 && a > L.total - e1) return Math.max(0, Math.min(1, (L.total - a) / full1));
    return 1;
  };
  // On a run-on the deck blends from the line to the ground on the joint
  // edge (the ground at J, at the same offset across the road): at J it is
  // the approach road, and the blend has no kink from the terrain grid under
  // the run-on. The deck never goes under the ground: where the ground is
  // higher (near an OSM end, where another graded corridor meets this one)
  // the deck rides on it.
  const joints = [0, 1].map((k) => {
    const P = L.points;
    const [J, next] = k ? [P[P.length - 1], P[P.length - 2]] : [P[0], P[1]];
    const l = Math.hypot(next[0] - J[0], next[1] - J[1]) || 1;
    return { J, n: [-(next[1] - J[1]) / l, (next[0] - J[0]) / l] };
  });
  const deck = (x, z) => {
    const r = raw(x, z);
    const a = project(L.points, L.cum, x, z).s;
    const w = weight(a);
    const g = t.height(x, z);
    if (w >= 1) return Math.max(r, g);
    // Past a joint (the round end of a sampler strip) the deck is the ground.
    if (a <= 0 || a >= L.total) return g;
    const { J, n } = joints[a < L.total / 2 ? 0 : 1];
    const o = (x - J[0]) * n[0] + (z - J[1]) * n[1];
    const gJ = t.height(J[0] + n[0] * o, J[1] + n[1] * o);
    return Math.max(g, r + (gJ - r) * (1 - w));
  };
  deck.weight = weight;
  // The line and the arch without the run-ons or the ground (level across).
  deck.raw = raw;
  deck.slope = raw.line.slope;
  deck.ends = raw.line.ends;
  deck.lift = raw.lift;
  m.set(s.id, deck);
  return deck;
}

// True where a parapet of bridge `s` would stand in an at-grade way at the
// deck height (a sidewalk that goes on past the end of its own deck), other
// than the approaches of the bridge. A way far under the deck is not in it.
const blockers = new WeakMap();
export function parapetBlocked(level, s) {
  let m = blockers.get(level);
  if (!m) blockers.set(level, (m = new Map()));
  if (m.has(s.id)) return m.get(s.id);
  const L = bridgeLayouts(level.strips).get(s.id);
  const own = new Set(L.ends.map((e) => e.approach));
  const t = terrainOf(level);
  const deck = bridgeDeck(level, s);
  const top = level.surfaces?.[s.kind] ?? 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of L.points) {
    minX = Math.min(minX, x - 30);
    maxX = Math.max(maxX, x + 30);
    minZ = Math.min(minZ, z - 30);
    maxZ = Math.max(maxZ, z + 30);
  }
  const near = (level.strips ?? []).filter((o) => !o.bridge && !own.has(o.id) && o.points.some(([x, z]) => x >= minX && x <= maxX && z >= minZ && z <= maxZ));
  const blocked = (x, z) => {
    const y = deck(x, z) + top;
    for (const o of near) {
      const oy = t.height(x, z) + (level.surfaces?.[o.kind] ?? 0);
      if (Math.abs(oy - y) > 0.6) continue;
      for (let i = 0; i < o.points.length - 1; i += 1) {
        const [ax, az] = o.points[i];
        const [bx, bz] = o.points[i + 1];
        const dx = bx - ax;
        const dz = bz - az;
        const l2 = dx * dx + dz * dz || 1;
        const k = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
        if (Math.hypot(x - ax - k * dx, z - az - k * dz) < o.width / 2) return true;
      }
    }
    return false;
  };
  m.set(s.id, blocked);
  return blocked;
}

// A bridge: the slab under the deck and a parapet on each side (m).
export const BRIDGE = { slab: 0.9, parapet: 1.0, parapetWidth: 0.25, color: [0.8, 0.78, 0.74] };

// The clearance under a bridge deck over a way at grade (m).
export const BRIDGE_CLEARANCE = 5;
const EMBANKMENT = { length: 80, side: 6 };

function segmentsCross(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]];
  const q = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * q[1] - r[1] * q[0];
  if (Math.abs(den) < 1e-9) return null;
  const u = ((c[0] - a[0]) * q[1] - (c[1] - a[1]) * q[0]) / den;
  const v = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? [a[0] + u * r[0], a[1] + u * r[1]] : null;
}

// Raises the terrain grid into an embankment at each end of a bridge that
// is too low over a way at grade. A 4 m grid smooths a railroad embankment,
// so the DEM alone gives the BeltLine bridges about 2 m of clearance. Each
// end rises to the height that gives BRIDGE_CLEARANCE over the lowest way
// under the deck, and falls back to the terrain over EMBANKMENT.length m.
// Pure: returns new heights and a list of the changes.
export function raiseEmbankments(grid, strips) {
  const t = createTerrain(grid);
  const heights = Float32Array.from(grid.heights);
  const { cell, x0, z0, cols, rows } = grid;
  const changes = [];
  const atGrade = strips.filter((s) => !s.bridge);
  for (const b of strips.filter((s) => s.bridge)) {
    const p = b.points;
    let need = -Infinity;
    for (let i = 0; i < p.length - 1; i += 1) {
      for (const o of atGrade) {
        for (let j = 0; j < o.points.length - 1; j += 1) {
          const x = segmentsCross(p[i], p[i + 1], o.points[j], o.points[j + 1]);
          // A way that joins the bridge at an end is its approach, not a way under it.
          const nearEnd = x && Math.min(Math.hypot(x[0] - p[0][0], x[1] - p[0][1]), Math.hypot(x[0] - p[p.length - 1][0], x[1] - p[p.length - 1][1])) < 3;
          if (x && !nearEnd) need = Math.max(need, t.height(x[0], x[1]) + BRIDGE_CLEARANCE);
        }
      }
    }
    if (!(need > -Infinity)) continue;
    for (const [end, next] of [[p[0], p[1]], [p[p.length - 1], p[p.length - 2]]]) {
      const h0 = t.height(end[0], end[1]);
      if (h0 >= need) continue;
      // The outward direction of the approach, away from the span.
      const l = Math.hypot(end[0] - next[0], end[1] - next[1]) || 1;
      const ux = (end[0] - next[0]) / l;
      const uz = (end[1] - next[1]) / l;
      const half = b.width / 2 + 1;
      const reach = EMBANKMENT.length + half + EMBANKMENT.side;
      const i0 = Math.max(0, Math.floor((end[0] - reach - x0) / cell));
      const i1 = Math.min(cols - 1, Math.ceil((end[0] + reach - x0) / cell));
      const j0 = Math.max(0, Math.floor((end[1] - reach - z0) / cell));
      const j1 = Math.min(rows - 1, Math.ceil((end[1] + reach - z0) / cell));
      for (let j = j0; j <= j1; j += 1) {
        for (let i = i0; i <= i1; i += 1) {
          const x = x0 + i * cell;
          const z = z0 + j * cell;
          const along = (x - end[0]) * ux + (z - end[1]) * uz;
          const side = Math.abs(-(x - end[0]) * uz + (z - end[1]) * ux);
          // Only past the end (not under the span), to cell / 2 back.
          if (along < -cell / 2 || along > EMBANKMENT.length || side > half + EMBANKMENT.side) continue;
          const k = 1 - Math.max(0, along) / EMBANKMENT.length;
          const s = side <= half ? 1 : 1 - (side - half) / EMBANKMENT.side;
          const k2 = k * k * (3 - 2 * k);
          // Toward `need`, never over it, and never lower than the ground.
          const g = heights[j * cols + i];
          if (g < need) heights[j * cols + i] = g + (need - g) * k2 * s;
        }
      }
      changes.push({ id: b.id, from: Math.round(h0 * 10) / 10, to: Math.round(need * 10) / 10 });
    }
  }
  return { heights, changes };
}

// The Eastside Trail is an old railroad bed: its real grade is a few percent.
// The DEM under it has the cuts and fills of the streets and buildings next
// to it, so its raw profile has short ramps of 40% and more. gradeTrail()
// sets the grid in the trail corridor to a smooth profile: at each point of
// the trail center line, the mean ground of the at-grade trail points within
// TRAIL_GRADE.radius. The middle half of each bridge (along its full length)
// keeps the ground under it (the road under the deck). Pure: returns new heights.
export const TRAIL_GRADE = { radius: 60, step: 4, side: 8 };

// True when (x, z) is within width / 2 + 2 m of the bridge center line, and
// its nearest point on the line is in the middle half of the full length.
// `cum` gives the length at each point, and `total` the full length.
export function bridgeMiddle(b, cum, total, x, z) {
  if (!(total > 0)) return false;
  let best = Infinity;
  let at = 0;
  for (let i = 0; i < b.points.length - 1; i += 1) {
    const [ax, az] = b.points[i];
    const [bx, bz] = b.points[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    const d = Math.hypot(x - (ax + t * dx), z - (az + t * dz));
    if (d < best) {
      best = d;
      at = cum[i] + t * (cum[i + 1] - cum[i]);
    }
  }
  const k = at / total;
  return k > 0.25 && k < 0.75 && best < b.width / 2 + 2;
}

export function gradeTrail(grid, strips) {
  const t = createTerrain(grid);
  const heights = Float32Array.from(grid.heights);
  const { cell, x0, z0, cols, rows } = grid;
  const trail = strips.filter((s) => s.kind === "trail" && !s.bridge);
  const spans = strips.filter((s) => s.bridge);
  // The center line points, each TRAIL_GRADE.step m.
  const pts = [];
  for (const s of trail) {
    for (let i = 0; i < s.points.length - 1; i += 1) {
      const [ax, az] = s.points[i];
      const [bx, bz] = s.points[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / TRAIL_GRADE.step));
      for (let k = 0; k <= n; k += 1) {
        const x = ax + ((bx - ax) * k) / n;
        const z = az + ((bz - az) * k) / n;
        pts.push({ x, z, h: t.height(x, z), w: s.width });
      }
    }
  }
  if (!pts.length) return { heights, points: 0 };
  // A bucket grid for the neighbor search.
  const B = TRAIL_GRADE.radius;
  const buckets = new Map();
  const bkey = (x, z) => `${Math.floor(x / B)},${Math.floor(z / B)}`;
  for (const p of pts) {
    const k = bkey(p.x, p.z);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(p);
  }
  const near = (x, z, r) => {
    const out = [];
    const bx = Math.floor(x / B);
    const bz = Math.floor(z / B);
    for (let i = -1; i <= 1; i += 1) for (let j = -1; j <= 1; j += 1) for (const p of buckets.get(`${bx + i},${bz + j}`) ?? []) if (Math.hypot(p.x - x, p.z - z) <= r) out.push(p);
    return out;
  };
  for (const p of pts) {
    const list = near(p.x, p.z, TRAIL_GRADE.radius);
    p.smooth = list.reduce((a, q) => a + q.h, 0) / list.length;
  }
  // The middle half of each bridge, along the full length of its polyline
  // (issue #59): the deck ends sit on the graded approach.
  const spanLines = spans.map((b) => {
    const cum = [0];
    for (let i = 0; i < b.points.length - 1; i += 1) cum.push(cum[i] + Math.hypot(b.points[i + 1][0] - b.points[i][0], b.points[i + 1][1] - b.points[i][1]));
    return { b, cum, total: cum[cum.length - 1] };
  });
  const underSpan = (x, z) => spanLines.some(({ b, cum, total }) => bridgeMiddle(b, cum, total, x, z));
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const x = x0 + i * cell;
      const z = z0 + j * cell;
      const list = near(x, z, 30);
      if (!list.length) continue;
      let best = list[0];
      let d = Infinity;
      for (const q of list) {
        const dq = Math.hypot(q.x - x, q.z - z);
        if (dq < d) {
          d = dq;
          best = q;
        }
      }
      const half = best.w / 2 + 1;
      if (d > half + TRAIL_GRADE.side || underSpan(x, z)) continue;
      const k = d <= half ? 1 : 1 - (d - half) / TRAIL_GRADE.side;
      const h = heights[j * cols + i];
      heights[j * cols + i] = h + (best.smooth - h) * k * k * (3 - 2 * k);
    }
  }
  return { heights, points: pts.length };
}

// Grades the ground under each building on a slope (issue #135). Without
// it, buildingSpan() puts the ground floor on the highest ground, so a
// building on a steep lot gets a very tall plinth on its low side.
//
// For each building with a drop of `minDrop` m or more along its walls, a
// pad height P is the mean of the ground samples along the walls. Each grid
// node within `reach` m of the footprint goes to P, and the nodes from
// `reach` to `reach + blend` m blend back to the old ground. A node moves
// `cap` m or less, so a big building on a hill keeps part of its slope and
// a part of its plinth, as on a real building. Where two pads meet, a node
// takes the mean of the pads, by weight. A node within `wayMargin` m of the
// edge of a way (a street, a sidewalk, or a path in `strips`) keeps its
// height, so the pads do not put a bump in a way. Run it after
// gradeTrail(): a node within `trailMargin` m of the trail edge (the band
// that gradeTrail() changes) keeps its height, so the trail does not
// change. Pure: returns new heights.
export const FOOTPRINT_GRADE = { minDrop: 1.0, cap: 2.5, reach: 8, blend: 8, step: 2, wayMargin: 1.5, trailMargin: TRAIL_GRADE.side + 2.5 };

// True for each grid node within margin m of the edge of a way.
function wayNodes(grid, strips, margin) {
  const { cell, x0, z0, cols, rows } = grid;
  const out = new Uint8Array(cols * rows);
  for (const s of strips) {
    const r = (s.width ?? 0) / 2 + margin;
    for (let i = 0; i < s.points.length - 1; i += 1) {
      const [ax, az] = s.points[i];
      const [bx, bz] = s.points[i + 1];
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - r - x0) / cell));
      const i1 = Math.min(cols - 1, Math.ceil((Math.max(ax, bx) + r - x0) / cell));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - r - z0) / cell));
      const j1 = Math.min(rows - 1, Math.ceil((Math.max(az, bz) + r - z0) / cell));
      const dx = bx - ax;
      const dz = bz - az;
      const l2 = dx * dx + dz * dz;
      for (let j = j0; j <= j1; j += 1) {
        for (let k = i0; k <= i1; k += 1) {
          const x = x0 + k * cell;
          const z = z0 + j * cell;
          const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
          if (Math.hypot(x - (ax + t * dx), z - (az + t * dz)) <= r) out[j * cols + k] = 1;
        }
      }
    }
  }
  return out;
}

function ringDistance(x, z, ring) {
  if (insideRing(x, z, ring)) return 0;
  let best = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return best;
}

export function gradeFootprints(grid, buildings, strips = [], g = FOOTPRINT_GRADE) {
  const t = createTerrain(grid);
  const { cell, x0, z0, cols, rows } = grid;
  const onWay = wayNodes(grid, strips.filter((s) => !s.bridge && s.kind !== "trail"), g.wayMargin);
  const onTrail = wayNodes(grid, strips.filter((s) => s.kind === "trail"), g.trailMargin);
  const heights = Float32Array.from(grid.heights);
  const sumW = new Float32Array(cols * rows);
  const sumWP = new Float32Array(cols * rows);
  const maxW = new Float32Array(cols * rows);
  let graded = 0;
  for (const b of buildings) {
    const ring = b.outer;
    if (!(ring?.length >= 3)) continue;
    let lo = Infinity;
    let hi = -Infinity;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < ring.length; i += 1) {
      const [px, pz] = ring[i];
      const [qx, qz] = ring[(i + 1) % ring.length];
      const k = Math.max(1, Math.ceil(Math.hypot(qx - px, qz - pz) / g.step));
      for (let s = 0; s < k; s += 1) {
        const h = t.height(px + ((qx - px) * s) / k, pz + ((qz - pz) * s) / k);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
        sum += h;
        n += 1;
      }
    }
    if (!(hi - lo >= g.minDrop)) continue;
    graded += 1;
    const pad = sum / n;
    const r = g.reach + g.blend;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [x, z] of ring) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    const i0 = Math.max(0, Math.floor((minX - r - x0) / cell));
    const i1 = Math.min(cols - 1, Math.ceil((maxX + r - x0) / cell));
    const j0 = Math.max(0, Math.floor((minZ - r - z0) / cell));
    const j1 = Math.min(rows - 1, Math.ceil((maxZ + r - z0) / cell));
    for (let j = j0; j <= j1; j += 1) {
      for (let i = i0; i <= i1; i += 1) {
        const d = ringDistance(x0 + i * cell, z0 + j * cell, ring);
        if (d >= r) continue;
        const k = d <= g.reach ? 1 : 1 - (d - g.reach) / g.blend;
        const w = k * k * (3 - 2 * k);
        const at = j * cols + i;
        sumW[at] += w;
        sumWP[at] += w * pad;
        maxW[at] = Math.max(maxW[at], w);
      }
    }
  }
  for (let at = 0; at < heights.length; at += 1) {
    if (!(sumW[at] > 0) || onWay[at] || onTrail[at]) continue;
    const h = heights[at];
    const delta = Math.max(-g.cap, Math.min(g.cap, sumWP[at] / sumW[at] - h));
    heights[at] = h + delta * maxW[at];
  }
  return { heights, graded };
}

// Grades the ground at the bridge joints (issue #131). Near each joint J
// (bridges.js) the ground goes on the deck line, level across the road:
// from one cell diagonal before J to one cell diagonal past it, and to one
// cell diagonal past each road edge. Then it blends back to the old ground
// over BRIDGE_GRADE.blend m along and BRIDGE_GRADE.sideBlend m across.
// The deck line is linear, and every grid node of each terrain triangle at
// J is on it, so the ground at J is exactly the deck end height: the deck
// end and the road meet with no step. The nodes of such a triangle are up
// to one cell diagonal from J, so the bands are at least that wide. Under the rest of the deck, the ground
// stays at least BRIDGE_GRADE.under m below the deck line, so no terrain
// shows through a deck. Where two corridors meet, the nearer center line
// wins. Run it after raiseEmbankments(). Pure: returns new heights.
export const BRIDGE_GRADE = { blend: 24, sideBlend: 8, under: 0.05 };

export function gradeBridgeEnds(grid, strips) {
  const t = createTerrain(grid);
  // The nodes of a terrain triangle are at most one cell diagonal apart.
  const CRITICAL = grid.cell * Math.SQRT2 + 0.01;
  const G = { ...BRIDGE_GRADE, inward: CRITICAL, out: CRITICAL, side: CRITICAL };
  const heights = Float32Array.from(grid.heights);
  const { cell, x0, z0, cols, rows } = grid;
  const layouts = bridgeLayouts(strips);
  const lines = new Map();
  for (const L of layouts.values()) if (!L.host) lines.set(L.id, deckLine(L, t));
  const reach = G.out + G.blend + G.side + G.sideBlend;
  const items = [...layouts.values()].map((L) => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [x, z] of L.points) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    const r = reach + L.width / 2;
    return { L, family: L.host ?? L.id, line: lines.get(L.host ?? L.id), box: [minX - r, maxX + r, minZ - r, maxZ + r] };
  });
  // A way under a deck keeps its ground along its whole length (no fill on
  // a road or the trail under a bridge, and no blend from a joint band near
  // it): there the grade only lowers the ground under a span. A deck run-on
  // follows the ground at its joint, so a joint near such a way still meets
  // its road.
  const under = new Set();
  for (const L of layouts.values()) {
    const P = L.points;
    for (let i = 0; i < P.length - 1; i += 1) {
      for (const o of strips) {
        if (o.bridge || under.has(o)) continue;
        for (let j = 0; j < o.points.length - 1; j += 1) {
          const x = segmentsCross(P[i], P[i + 1], o.points[j], o.points[j + 1]);
          if (!x) continue;
          const a = L.cum[i] + Math.hypot(x[0] - P[i][0], x[1] - P[i][1]);
          if (a >= L.span[0] + 3 && a <= L.span[1] - 3) under.add(o);
        }
      }
    }
  }
  const keep = [...under].map((o) => {
    const r = o.width / 2 + CRITICAL;
    const xs = o.points.map((p) => p[0]);
    const zs = o.points.map((p) => p[1]);
    return { o, r, box: [Math.min(...xs) - r, Math.max(...xs) + r, Math.min(...zs) - r, Math.max(...zs) + r] };
  });
  const keepsGround = (x, z) =>
    keep.some(({ o, r, box }) => {
      if (x < box[0] || x > box[1] || z < box[2] || z > box[3]) return false;
      for (let j = 0; j < o.points.length - 1; j += 1) {
        const [ax, az] = o.points[j];
        const [bx, bz] = o.points[j + 1];
        const dx = bx - ax;
        const dz = bz - az;
        const l2 = dx * dx + dz * dz || 1;
        const k = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
        if (Math.hypot(x - ax - k * dx, z - az - k * dz) <= r) return true;
      }
      return false;
    });
  const smooth = (k) => k * k * (3 - 2 * k);
  let changed = 0;
  for (let j = 0; j < rows; j += 1) {
    const z = z0 + j * cell;
    for (let i = 0; i < cols; i += 1) {
      const x = x0 + i * cell;
      let set = null;
      const clamps = [];
      for (const { L, family, line, box } of items) {
        if (x < box[0] || x > box[1] || z < box[2] || z > box[3]) continue;
        const { s, d } = project(L.points, L.cum, x, z);
        const half = L.width / 2;
        // a: the distance out past each joint (negative: in toward the span).
        for (const a of [-s, s - L.total]) {
          if (a < -G.inward) continue;
          const wa = a <= G.out ? 1 : 1 - (a - G.out) / G.blend;
          const ws = d <= half + G.side ? 1 : 1 - (d - half - G.side) / G.sideBlend;
          if (!(wa > 0 && ws > 0)) continue;
          const w = smooth(wa) * smooth(ws);
          // A node of a terrain triangle at the joint edge is critical: it
          // wins over the blend band of another bridge.
          const critical = Math.abs(a) <= CRITICAL && d <= half + CRITICAL;
          const better = !set || critical > set.critical || (critical === set.critical && (d < set.d - 1e-9 || (Math.abs(d - set.d) <= 1e-9 && w > set.w)));
          if (better) set = { d, w, critical, family, v: line(x, z) };
        }
        if (s > G.inward && s < L.total - G.inward && d <= half + G.side) clamps.push({ family, v: line(x, z) - G.under });
      }
      if (set && keepsGround(x, z)) set = null;
      if (!set && !clamps.length) continue;
      const k = j * cols + i;
      let h = heights[k];
      if (set) h += (set.v - h) * set.w;
      // A deck of the same family as the set is on the same line, so the set
      // ground is already under it.
      for (const c of clamps) if (!(set && set.w >= 1 && c.family === set.family)) h = Math.min(h, c.v);
      if (Math.abs(h - heights[k]) > 1e-6) changed += 1;
      heights[k] = h;
    }
  }
  return { heights, changed };
}

// Grades the ground on the playable ways to a skating grade. The DEM under
// a street, a sidewalk, or a path has the cuts and fills of the lots next
// to it, so short ramps of 30% to 50% stay after gradeTrail(), and a skater
// cannot push up them. The trail (`fixed` kinds) has its rail grade from
// gradeTrail() in its cut under the Freedom Parkway bridges: it is pinned,
// so the clearance under the decks stays.
//
// Each grid node within `margin` m of the edge of an at-grade way (by
// default the nodes of every terrain triangle under the way) is in the way
// network. Two next nodes of the network (along x or along z) may differ by
// at most L = `max` / sqrt(2) per meter, so both legs of each terrain
// triangle under a way, and so its grade in any direction, stay at `max` or
// less. The new height of a node is the mean of two exact envelopes on the
// network graph (Dijkstra, a fixed order, so the result is deterministic):
// the highest L-limited ground under the old ground (it cuts the humps)
// and the lowest one over it (it fills the dips). The mean of two L-limited
// functions is L-limited, and the cut and the fill balance. A `pinned` node
// (a bridge joint, the ground under a deck) keeps its height, and the
// others stay within L of it along the network. Then each node from
// `margin` to `margin + blend` m off the network takes the mean change of
// the network nodes near it, fading to 0 (smoothstep), so the grade has no
// step at the edge of the network. Pure: returns new heights, the network
// node count, and the largest change.
export const WAY_GRADE = { max: 0.1, blend: 32, kinds: ["street", "sidewalk", "path"], fixed: ["trail"] };

// One envelope of the heights on the network graph, by Dijkstra from every
// node at once: sign 1 gives min over j of (h_j + step * hops), sign -1 gives
// max over j of (h_j - step * hops). The heap holds [key, node] pairs (ties
// by node index), so the order is deterministic.
function envelope(heights, inNet, cols, rows, step, sign) {
  const n = heights.length;
  const key = new Float64Array(n).fill(Infinity);
  const heap = [];
  const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const push = (e) => {
    heap.push(e);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(heap[i], heap[p])) break;
      [heap[i], heap[p]] = [heap[p], heap[i]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && less(heap[l], heap[m])) m = l;
        if (r < heap.length && less(heap[r], heap[m])) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]];
        i = m;
      }
    }
    return top;
  };
  for (let k = 0; k < n; k += 1) {
    if (!inNet[k] || !Number.isFinite(heights[k])) continue;
    key[k] = sign * heights[k];
    push([key[k], k]);
  }
  const done = new Uint8Array(n);
  while (heap.length) {
    const [kv, v] = pop();
    if (done[v] || kv > key[v]) continue;
    done[v] = 1;
    const i = v % cols;
    const j = (v - i) / cols;
    for (const w of [i > 0 ? v - 1 : -1, i + 1 < cols ? v + 1 : -1, j > 0 ? v - cols : -1, j + 1 < rows ? v + cols : -1]) {
      if (w < 0 || !inNet[w] || done[w]) continue;
      const kw = kv + step;
      if (kw < key[w]) {
        key[w] = kw;
        push([kw, w]);
      }
    }
  }
  const out = new Float64Array(n);
  for (let k = 0; k < n; k += 1) out[k] = sign * key[k];
  return out;
}

export function gradeWays(grid, strips, { pinned: given = null, ...opts } = {}) {
  const g = { ...WAY_GRADE, ...opts };
  const { cell, cols, rows } = grid;
  const margin = g.margin ?? cell * Math.SQRT2 + 0.01;
  const ways = strips.filter((s) => !s.bridge && g.kinds.includes(s.kind));
  const inNet = wayNodes(grid, ways, margin);
  // The trail keeps its rail grade (gradeTrail()): its nodes are in the
  // network, pinned, so the ways meet the trail and not the other way.
  const fixed = wayNodes(grid, strips.filter((s) => !s.bridge && g.fixed.includes(s.kind)), margin);
  let pinned = given;
  if (fixed.some((v) => v)) {
    pinned = Uint8Array.from(fixed, (v, k) => (v || given?.[k] ? 1 : 0));
    for (let k = 0; k < inNet.length; k += 1) inNet[k] ||= fixed[k];
  }
  const step = (g.max / Math.SQRT2) * cell;
  const base = grid.heights;
  const heights = Float32Array.from(base);
  const upper = envelope(base, inNet, cols, rows, step, 1);
  const lower = envelope(base, inNet, cols, rows, step, -1);
  // The cones of the pinned nodes: every network node stays within L of
  // each pinned node along the network.
  let hi = null;
  let lo = null;
  if (pinned) {
    const pins = Uint8Array.from(inNet, (v, k) => (v && pinned[k] ? 1 : 0));
    if (pins.some((v) => v)) {
      const sources = Float64Array.from(base, (h, k) => (pins[k] ? h : NaN));
      hi = envelope(sources, inNet, cols, rows, step, 1);
      lo = envelope(sources, inNet, cols, rows, step, -1);
    }
  }
  for (let k = 0; k < heights.length; k += 1) {
    if (!inNet[k]) continue;
    let h = (upper[k] + lower[k]) / 2;
    if (hi) {
      const a = lo[k];
      const b = hi[k];
      h = a <= b ? Math.max(a, Math.min(b, h)) : (a + b) / 2;
      if (pinned[k]) h = base[k];
    }
    heights[k] = h;
  }
  // The blend band off the network.
  const R = Math.ceil(g.blend / cell);
  const out = Float32Array.from(heights);
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const at = j * cols + i;
      if (inNet[at] || pinned?.[at]) continue;
      let sw = 0;
      let swd = 0;
      let near = Infinity;
      for (let dj = -R; dj <= R; dj += 1) {
        const jj = j + dj;
        if (jj < 0 || jj >= rows) continue;
        for (let di = -R; di <= R; di += 1) {
          const ii = i + di;
          if (ii < 0 || ii >= cols) continue;
          const k = jj * cols + ii;
          if (!inNet[k]) continue;
          const d = Math.hypot(di, dj) * cell;
          if (d > g.blend) continue;
          const w = 1 / (d * d);
          sw += w;
          swd += w * (heights[k] - base[k]);
          near = Math.min(near, d);
        }
      }
      if (!(sw > 0)) continue;
      const k = 1 - near / g.blend;
      out[at] = base[at] + (swd / sw) * k * k * (3 - 2 * k);
    }
  }
  let moved = 0;
  let count = 0;
  for (let k = 0; k < out.length; k += 1) {
    moved = Math.max(moved, Math.abs(out[k] - base[k]));
    count += inNet[k];
  }
  return { heights: out, nodes: count, moved };
}

// The grade limit of the skating ground. gradeWays() grades the ground under
// the ways to WAY_GRADE.max, but a few short ramps stay: where a deck meets
// a road or the ground (bridge stairs, w1118177210 drops 2 to 5 m in 10 m),
// at the bridge ends, and off the ways (lawns, embankments). At 47% gravity
// on the slope (20 m/s^2 x 0.42) is more than the push (8 m/s^2), so the
// skater cannot climb, and she rolls back. The ground sampler bends each
// terrain and deck normal to at most `GRADE_LIMIT` (the height stays the
// real one), so the slope pull on the skater is at most 20 x 0.29 = 5.7
// m/s^2, under the push, and she can push up anything that is not a wall (a
// rise over SKATE.maxStep in one step). The trail and the ways (10% or less)
// are under the limit, so it changes nothing on them.
// Near-cliffs: with the bent normal the controller's wall probe (a rise
// over SKATE.maxStep within the body ring, about 77% or more) now reads a
// cliff face as a wall, so the skater bonks off it instead of rolling back.
export const GRADE_LIMIT = 0.3;

export function limitGrade(n, max = GRADE_LIMIT) {
  const h = Math.hypot(n[0], n[2]);
  if (!(n[1] > 0) || h <= max * n[1]) return n;
  const ny = 1 / Math.sqrt(1 + max * max);
  const k = (max * ny) / h;
  return [n[0] * k, ny, n[2] * k];
}

// The grid nodes that the bridge grades own: each node within one cell
// diagonal of a deck (bridges.js layout, joint to joint, plus one cell
// diagonal past each joint and each side). gradeWays() pins them after
// gradeBridgeEnds(), so each deck end still meets its road and the ground
// under each deck keeps its clearance.
export function bridgeNodes(grid, strips) {
  const { cell, x0, z0, cols, rows } = grid;
  const CRITICAL = cell * Math.SQRT2 + 0.01;
  const out = new Uint8Array(cols * rows);
  for (const L of bridgeLayouts(strips).values()) {
    const r = L.width / 2 + CRITICAL;
    const xs = L.points.map((p) => p[0]);
    const zs = L.points.map((p) => p[1]);
    const i0 = Math.max(0, Math.floor((Math.min(...xs) - r - x0) / cell));
    const i1 = Math.min(cols - 1, Math.ceil((Math.max(...xs) + r - x0) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(...zs) - r - z0) / cell));
    const j1 = Math.min(rows - 1, Math.ceil((Math.max(...zs) + r - z0) / cell));
    for (let j = j0; j <= j1; j += 1) {
      for (let i = i0; i <= i1; i += 1) {
        const { s, d } = project(L.points, L.cum, x0 + i * cell, z0 + j * cell);
        if (s >= -CRITICAL && s <= L.total + CRITICAL && d <= r) out[j * cols + i] = 1;
      }
    }
  }
  return out;
}

// The steepest grade (rise over run) of the terrain triangles under the
// at-grade ways, sampled every `step` m along each center line and each
// edge. For the build report and the tests.
export function wayGrades(terrain, strips, { step = 1, kinds = WAY_GRADE.kinds } = {}) {
  const out = [];
  for (const s of strips) {
    if (s.bridge || !kinds.includes(s.kind)) continue;
    let worst = 0;
    let at = null;
    const half = (s.width ?? 0) / 2;
    for (let i = 0; i < s.points.length - 1; i += 1) {
      const [ax, az] = s.points[i];
      const [bx, bz] = s.points[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (!(len > 0)) continue;
      const nx = -(bz - az) / len;
      const nz = (bx - ax) / len;
      const n = Math.max(1, Math.ceil(len / step));
      for (let k = 0; k <= n; k += 1) {
        for (const o of [-half * 0.9, 0, half * 0.9]) {
          const x = ax + ((bx - ax) * k) / n + nx * o;
          const z = az + ((bz - az) * k) / n + nz * o;
          const [gx, gy, gz] = terrain.normal(x, z);
          const grade = Math.hypot(gx, gz) / gy;
          if (grade > worst) {
            worst = grade;
            at = [x, z];
          }
        }
      }
    }
    out.push({ id: s.id, kind: s.kind, grade: worst, at });
  }
  return out;
}

// --- Draping a mesh on the terrain ---

const ATTRS = [
  ["colors", 3],
  ["facade", 4],
  ["uvs", 2],
];

// Clips a polygon (a list of vertices { p: [x, y, z], a: { attr: [] } }) to
// the half-plane f(x, z) >= 0, where f is linear.
function clip(poly, f) {
  const out = [];
  for (let i = 0; i < poly.length; i += 1) {
    const A = poly[i];
    const B = poly[(i + 1) % poly.length];
    const fa = f(A.p[0], A.p[2]);
    const fb = f(B.p[0], B.p[2]);
    if (fa >= 0) out.push(A);
    if ((fa >= 0) !== (fb >= 0)) {
      const k = fa / (fa - fb);
      const p = [A.p[0] + (B.p[0] - A.p[0]) * k, A.p[1] + (B.p[1] - A.p[1]) * k, A.p[2] + (B.p[2] - A.p[2]) * k];
      const a = {};
      for (const name in A.a) a[name] = A.a[name].map((v, n) => v + (B.a[name][n] - v) * k);
      out.push({ p, a });
    }
  }
  return out;
}

function area3(a, b, c) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
}

// Returns a new mesh: each triangle cut on the terrain triangles, and each
// vertex moved up by the terrain height under it. The colors, the facade
// attribute, and the uvs are kept (interpolated on the cut edges).
export function drapeMesh(mesh, terrain) {
  if (terrain.flat) return mesh;
  const { cell, x0, z0 } = terrain;
  const P = mesh.positions;
  const names = ATTRS.filter(([n]) => mesh[n]);
  const out = { positions: [], indices: [] };
  for (const [n] of names) out[n] = [];
  const vert = (k) => {
    const a = {};
    for (const [n, size] of names) a[n] = Array.from(mesh[n].slice(k * size, k * size + size));
    return { p: [P[k * 3], P[k * 3 + 1], P[k * 3 + 2]], a };
  };
  // Shared vertices are welded (same position and attributes, to 0.1 mm),
  // so a draped mesh keeps about one vertex per corner. Only the faces of one
  // orientation weld (`facing`, from the flat triangle): the terrain gets
  // smooth normals, and a curb keeps a hard edge between its top and side.
  const welded = new Map();
  let facing = "";
  const vertexIndex = (V) => {
    let key = `${facing}:${Math.round(V.p[0] * 1e4)},${Math.round(V.p[1] * 1e4)},${Math.round(V.p[2] * 1e4)}`;
    for (const [n] of names) key += `|${V.a[n].map((v) => Math.round(v * 1e4)).join(",")}`;
    let k = welded.get(key);
    if (k === undefined) {
      k = out.positions.length / 3;
      welded.set(key, k);
      out.positions.push(V.p[0], V.p[1], V.p[2]);
      for (const [n] of names) out[n].push(...V.a[n]);
    }
    return k;
  };
  const I = mesh.indices;
  for (let t = 0; t < I.length; t += 3) {
    const tri = [vert(I[t]), vert(I[t + 1]), vert(I[t + 2])];
    {
      const [a, b, c] = tri.map((v) => v.p);
      const ux = b[0] - a[0];
      const uy = b[1] - a[1];
      const uz = b[2] - a[2];
      const vx = c[0] - a[0];
      const vy = c[1] - a[1];
      const vz = c[2] - a[2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      facing = `${Math.round((nx / l) * 4)},${Math.round((ny / l) * 4)},${Math.round((nz / l) * 4)}`;
    }
    const xs = tri.map((v) => v.p[0]);
    const zs = tri.map((v) => v.p[2]);
    const i0 = Math.floor((Math.min(...xs) - x0) / cell);
    const i1 = Math.floor((Math.max(...xs) - x0) / cell);
    const j0 = Math.floor((Math.min(...zs) - z0) / cell);
    const j1 = Math.floor((Math.max(...zs) - z0) / cell);
    // A triangle with a position that is not finite has no cells. Without
    // this check an infinite range makes the cell loop run without end.
    if (![i0, i1, j0, j1].every(Number.isFinite)) continue;
    for (let i = i0; i <= i1; i += 1) {
      for (let j = j0; j <= j1; j += 1) {
        const cx = x0 + i * cell;
        const cz = z0 + j * cell;
        const u = (x) => (x - cx) / cell;
        const v = (z) => (z - cz) / cell;
        let cellPoly = clip(clip(clip(clip(tri, (x) => u(x)), (x) => 1 - u(x)), (x, z) => v(z)), (x, z) => 1 - v(z));
        if (cellPoly.length < 3) continue;
        for (const half of [(x, z) => 1 - u(x) - v(z), (x, z) => u(x) + v(z) - 1]) {
          const poly = clip(cellPoly, half);
          if (poly.length < 3) continue;
          const moved = poly.map(({ p, a }) => ({ p: [p[0], p[1] + terrain.height(p[0], p[2]), p[2]], a }));
          for (let k = 1; k < moved.length - 1; k += 1) {
            const A = moved[0];
            const B = moved[k];
            const C = moved[k + 1];
            if (area3(A.p, B.p, C.p) < 1e-6) continue;
            for (const V of [A, B, C]) out.indices.push(vertexIndex(V));
          }
        }
        cellPoly = null;
      }
    }
  }
  const res = { positions: Float32Array.from(out.positions), indices: Uint32Array.from(out.indices) };
  for (const [n] of names) res[n] = Float32Array.from(out[n]);
  return res;
}

// Moves every vertex of a mesh up by `dy(x, z)` (for a mesh that must not be
// cut, for example a bridge deck that follows its own line).
export function liftMesh(mesh, dy) {
  const P = Float32Array.from(mesh.positions);
  for (let i = 0; i < P.length; i += 3) P[i + 1] += dy(P[i], P[i + 2]);
  return { ...mesh, positions: P };
}
