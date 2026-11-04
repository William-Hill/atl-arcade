// Road markings for a geodata level. Pure.
//
// - A double yellow center line on the main streets (trunk, primary,
//   secondary, tertiary), as on Ponce de Leon Ave, North Ave, and Ralph
//   McGill Blvd. Residential streets have no center line, as in Atlanta.
// - Dashed white lane lines (3 m dash, 9 m gap) on a main street with 2 or
//   more lanes in one direction. With the OSM lane tags (`lanes`,
//   `lanesForward`, `lanesBackward`, #138) the lane count comes from the
//   tags and a lane is at most 3.6 m wide; the room that is left is a
//   shoulder outside the edge lines. With no tag, a lane is 3.4 m wide and
//   the lanes fill the street (laneLineOffsets()).
// - White turn arrows in each lane before an intersection, from the OSM
//   `turnLanes` (turn:lanes) tags.
// - A green bike lane (1.5 m) inside the curb band on each side with an
//   OSM cycleway lane.
// - Small decals on the main and residential streets: manhole covers,
//   storm drains at the curb before each intersection, and asphalt
//   patches. They are seeded by the strip id, so each load is the same.
// - A white edge line on each side of the main streets and the residential
//   streets, 0.3 m in from the curb band.
// - A light concrete curb band (the sidewalk color, 0.3 m wide) on the two
//   edges of every street that is not a service road. The road edge then
//   shows also where the level has no sidewalk strip.
// - A white zebra crosswalk on each street arm at each intersection of two
//   named streets, and a white stop bar on the inbound half of the arm
//   before the crosswalk.
// A line stops short of every node that its street shares with another
// street that is not a service road (a cross street, or a node with 3 or
// more street arms), so no line crosses an intersection. On an arm with a
// crosswalk, the lines stop at the stop bar. The lines go on past a
// driveway or an alley, as on a real street.
// The level has no oneway tag. A main street strip with a parallel strip
// of the same name beside it (a divided road, as John Lewis Freedom
// Parkway) is one way: it gets no yellow center line, a yellow edge line on
// the median side, and white lane lines between all of its lanes. A strip
// with `oneway: true` is one way too.
//
// The output is a list of meshes { tile, mesh: { positions, indices,
// colors } }, one per GEO_TILE square, with the tile keys of
// buildGeoMeshes(). The view merges each tile into the render mesh of its
// surface tile, so the markings cost no draw call. The markings are a few
// cm over the street top. They are a visual only; the ground sampler and
// the physics do not see them.
//
// On a bridge the center line is draped on the deck height (terrain.js
// bridgeDeck), not on the ground, and runs on to the deck joint; the lines
// of the approach road start at the joint (bridges.js, issue #131). The deck
// lines are in `deck`, at their final height: the view must not drape them
// again. A deck gets no lane lines, edge lines, or curb band.

import { GEO_TILE, SURFACE_COLORS } from "./geo-mesh.js";
import { approachTrims, bridgeLayout, densify, trimPolyline } from "./bridges.js";
import { mergeMeshes } from "./extrude.js";
import { hash32, seededRandom } from "./styles.js";
import { EDGE, MAIN, MARKING_SIZES, crosswalksOf, edgeLineOffset, laneLayout, laneLineOffsets, medianSide } from "./lanes.js";

export { MARKING_SIZES, edgeLineOffset, laneLayout, laneLineOffsets, medianSide };
import { bridgeDeck, drapeMesh, terrainOf } from "./terrain.js";

export const MARKING_COLORS = {
  yellow: [0.96, 0.74, 0.16],
  white: [0.94, 0.94, 0.9],
  // The decals: a bike lane, cast iron (manhole covers and drain grates),
  // and two asphalt patch tones (geo-mesh.js SURFACE_COLORS).
  bike: SURFACE_COLORS.bike,
  iron: SURFACE_COLORS.iron,
  patchDark: SURFACE_COLORS.patchDark,
  patchLight: SURFACE_COLORS.patchLight,
  // The curb band. It is a little lighter than the sidewalk color, so the
  // band and the sidewalk keep a seam where they touch.
  curb: SURFACE_COLORS.sidewalk.map((c) => Math.min(1, c * 1.06)),
};
const LIFT = 0.02; // m over the street top (the paint)
const CURB_LIFT = 0.012; // m over the street top (under the paint, so a line on a curb band does not flicker)
const PATCH_LIFT = 0.007; // m over the street top (over the junction patch, under the curb band)
const IRON_LIFT = 0.016; // m over the street top (over the curb band, under the paint)
const LINE_W = 0.11;
const LINE_GAP = 0.11;
const CLEAR = 2; // m past the cross street edge
const S = MARKING_SIZES;
const MITER_MAX = 2; // the longest miter, in line widths

function quad(mesh, a, b, c, d, color) {
  const base = mesh.positions.length / 3;
  for (const p of [a, b, c, d]) {
    mesh.positions.push(p[0], p[1], p[2]);
    mesh.colors.push(color[0], color[1], color[2]);
  }
  mesh.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
}

// A flat rectangle centered at (cx, cz), long along (dx, dz).
function rect(mesh, cx, cz, y, dx, dz, along, across, color) {
  const ax = (dx * along) / 2;
  const az = (dz * along) / 2;
  const nx = (-dz * across) / 2;
  const nz = (dx * across) / 2;
  quad(mesh, [cx - ax - nx, y, cz - az - nz], [cx + ax - nx, y, cz + az - nz], [cx + ax + nx, y, cz + az + nz], [cx - ax + nx, y, cz - az + nz], color);
}

// A flat convex polygon (in (x, z)) at height y, as quads of a fan. A
// triangle is a quad with its last corner twice. The corners go the same
// way round as in rect().
function poly(mesh, pts, y, color) {
  let area = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[(i + 1) % pts.length];
    area += ax * bz - bx * az;
  }
  const p = area < 0 ? pts.slice().reverse() : pts;
  for (let i = 1; i < p.length - 1; i += 2) {
    const d = p[Math.min(i + 2, p.length - 1)];
    quad(mesh, [p[0][0], y, p[0][1]], [p[i][0], y, p[i][1]], [p[i + 1][0], y, p[i + 1][1]], [d[0], y, d[1]], color);
  }
}

// The parts of a turn arrow, as convex polygons in a local frame: `a` m
// along the travel direction from the arrow tail, `b` m to the left of it.
// `turns` is one lane of an OSM turn:lanes value ("left;through").
export function arrowShapes(turns) {
  const set = new Set(
    turns
      .split(";")
      .map((t) => t.trim())
      .map((t) => (t === "slight_left" || t === "sharp_left" ? "left" : t === "slight_right" || t === "sharp_right" ? "right" : t)),
  );
  const out = [];
  const w = 0.09; // half the shaft width
  const through = set.has("through");
  const sides = ["left", "right"].filter((t) => set.has(t));
  if (!through && sides.length === 0) return out;
  const top = through ? 2.6 : 2.2;
  out.push([[0, -w], [top, -w], [top, w], [0, w]]);
  if (through) out.push([[2.6, -0.32], [3.4, 0], [2.6, 0.32]]);
  for (const t of sides) {
    const k = t === "left" ? 1 : -1;
    // An elbow out to the side at 1.6 m, then a head that points to the side.
    out.push([[1.6, 0], [1.6 + 2 * w, 0], [1.6 + 2 * w, 0.62 * k], [1.6, 0.62 * k]]);
    out.push([[1.25, 0.62 * k], [1.6 + w, 1.3 * k], [1.95 + 2 * w, 0.62 * k]]);
  }
  return out;
}

// The lane centers in the travel order (left to right) for each direction.
function laneCenters(L, dir) {
  const c = L.center ?? L.edges[0] - S.edgeLine / 2;
  const out = [];
  if (dir > 0) for (let k = 0; k < L.forward; k += 1) out.push(c + (k + 0.5) * L.lane);
  else for (let k = 0; k < L.backward; k += 1) out.push(c - (k + 0.5) * L.lane);
  return out;
}

// The unit direction and the left normal of each segment, and the distance
// along the polyline at each point. Segments under 5 cm are left out.
function polyline(points) {
  const pts = [points[0]];
  for (const p of points.slice(1)) {
    const q = pts[pts.length - 1];
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) >= 0.05) pts.push(p);
  }
  const at = [0];
  const dirs = [];
  for (let i = 0; i < pts.length - 1; i += 1) {
    const len = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    dirs.push([(pts[i + 1][0] - pts[i][0]) / len, (pts[i + 1][1] - pts[i][1]) / len]);
    at.push(at[i] + len);
  }
  return { pts, at, dirs, length: at[at.length - 1] };
}

// The kept ranges [s0, s1] (distance along the polyline) after the cuts
// ([{ x, z, r }]) are left out. A cut is a circle; a segment loses the part
// inside it, measured on the centerline.
function keptRanges(pl, cuts) {
  let out = [];
  for (let i = 0; i < pl.dirs.length; i += 1) {
    const [ax, az] = pl.pts[i];
    const [dx, dz] = pl.dirs[i];
    const len = pl.at[i + 1] - pl.at[i];
    let ranges = [[0, len]];
    for (const c of cuts) {
      const fx = ax - c.x;
      const fz = az - c.z;
      const bq = fx * dx + fz * dz;
      const cq = fx * fx + fz * fz - c.r * c.r;
      const disc = bq * bq - cq;
      if (disc <= 0) continue;
      const s = Math.sqrt(disc);
      const t0 = -bq - s;
      const t1 = -bq + s;
      ranges = ranges.flatMap(([r0, r1]) => {
        if (t1 <= r0 || t0 >= r1) return [[r0, r1]];
        const kept = [];
        if (t0 > r0) kept.push([r0, t0]);
        if (t1 < r1) kept.push([t1, r1]);
        return kept;
      });
    }
    for (const [r0, r1] of ranges) {
      const g0 = pl.at[i] + r0;
      const g1 = pl.at[i] + r1;
      const last = out[out.length - 1];
      // Join a range to the range that ends where it starts.
      if (last && Math.abs(last[1] - g0) < 1e-6) last[1] = g1;
      else out.push([g0, g1]);
    }
  }
  return out.filter(([a, b]) => b - a >= 0.3);
}

// The dashes of a dash pattern (`on` m painted, `off` m clear, from the
// polyline start) inside the ranges.
function dashRanges(ranges, on, off) {
  const out = [];
  const period = on + off;
  for (const [a, b] of ranges) {
    for (let k = Math.floor(a / period); k * period < b; k += 1) {
      const d0 = Math.max(a, k * period);
      const d1 = Math.min(b, k * period + on);
      if (d1 - d0 >= 0.3) out.push([d0, d1]);
    }
  }
  return out;
}

// The point at distance `s` along the polyline, and its segment.
function pointAt(pl, s) {
  let i = 0;
  while (i < pl.dirs.length - 1 && pl.at[i + 1] <= s) i += 1;
  const t = s - pl.at[i];
  return { i, x: pl.pts[i][0] + pl.dirs[i][0] * t, z: pl.pts[i][1] + pl.dirs[i][1] * t };
}

// The offset vector at polyline point i, as a miter between the normals of
// the two segments. `ends` gives the direction of the next street strip
// at the two ends ([before, after], or null), so the line joins it.
function miter(pl, i, ends) {
  const before = i > 0 ? pl.dirs[i - 1] : ends?.[0];
  const after = i < pl.dirs.length ? pl.dirs[i] : ends?.[1];
  const a = before ?? after;
  const b = after ?? before;
  let mx = -a[1] - b[1];
  let mz = a[0] + b[0];
  const len = Math.hypot(mx, mz);
  if (len < 1e-6) return [-b[1], b[0]];
  mx /= len;
  mz /= len;
  // The miter is 1 / cos(half the turn) long, up to MITER_MAX.
  const scale = Math.min(MITER_MAX, 1 / Math.max(1e-6, mx * -b[1] + mz * b[0]));
  return [mx * scale, mz * scale];
}

// A band along the polyline from s0 to s1, with its center `offset` m to
// the side of the normal (-dz, dx). North is -z, so that is the right side
// of the strip direction. The band follows each
// segment; at a joint the two quads share a miter edge, so there is no gap.
function band(mesh, pl, s0, s1, y, offset, width, color, ends) {
  const lo = offset - width / 2;
  const hi = offset + width / 2;
  const corner = (s) => {
    const p = pointAt(pl, s);
    // A joint (a polyline point) gets the miter; a cut end is square.
    const k = pl.at.findIndex((v) => Math.abs(v - s) < 1e-6);
    const [nx, nz] = k >= 0 && (k > 0 || ends?.[0]) && (k < pl.dirs.length || ends?.[1]) ? miter(pl, k, ends) : [-pl.dirs[Math.min(p.i, pl.dirs.length - 1)][1], pl.dirs[Math.min(p.i, pl.dirs.length - 1)][0]];
    return { x: p.x, z: p.z, nx, nz };
  };
  const stops = [s0, ...pl.at.filter((v) => v > s0 + 1e-6 && v < s1 - 1e-6), s1];
  for (let k = 0; k < stops.length - 1; k += 1) {
    const a = corner(stops[k]);
    const b = corner(stops[k + 1]);
    const p = (c, o) => [c.x + c.nx * o, y, c.z + c.nz * o];
    const [a0, a1, b0, b1] = [p(a, lo), p(a, hi), p(b, lo), p(b, hi)];
    // Leave out a quad that folds over itself (the inner side of a tight
    // turn with a large offset).
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    if ((b0[0] - a0[0]) * dx + (b0[2] - a0[2]) * dz <= 0 || (b1[0] - a1[0]) * dx + (b1[2] - a1[2]) * dz <= 0) continue;
    quad(mesh, a0, b0, b1, a1, color);
  }
}

// A line along a polyline, offset sideways by `offset`, with the parts in
// `cuts` ([{ x, z, r }]) left out, and dashed when `dash` is [on, off].
function line(mesh, points, y, offset, width, cuts, color, { dash = null, ends = null } = {}) {
  const pl = polyline(points);
  if (pl.dirs.length === 0) return;
  let ranges = keptRanges(pl, cuts);
  if (dash) ranges = dashRanges(ranges, dash[0], dash[1]);
  for (const [s0, s1] of ranges) band(mesh, pl, s0, s1, y, offset, width, color, ends);
}

export function roadMarkings(level) {
  const mesh = { positions: [], indices: [], colors: [] };
  // The lines on bridge decks: [{ tile, meshes }] at their final height.
  const deckParts = [];
  const streetTop = level.surfaces?.street ?? 0;
  const y = streetTop + LIFT;
  const yCurb = streetTop + CURB_LIFT;
  const streets = (level.strips ?? []).filter((s) => s.kind === "street");
  // One way: the tag, or one half of a divided road.
  const median = new Map(streets.map((s) => [s.id, medianSide(s, streets)]));
  const isOneway = (s) => Boolean(s.oneway) || median.get(s.id) !== 0;
  const flat = terrainOf(level).flat;
  const trims = flat ? new Map() : approachTrims(level.strips ?? []);

  // The street strips at each node, and the street arms at each node (an
  // end point gives 1 arm, a middle point 2). Service roads do not count.
  const nodes = new Map();
  for (const s of streets) {
    s.points.forEach((p, i) => {
      const key = `${p[0]},${p[1]}`;
      const n = nodes.get(key) ?? { x: p[0], z: p[1], strips: new Map(), arms: 0 };
      n.strips.set(s.id, s);
      if (s.highway !== "service") n.arms += i === 0 || i === s.points.length - 1 ? 1 : 2;
      nodes.set(key, n);
    });
  }

  // The crosswalks: one for each street arm at each intersection of two
  // named streets, past the cross street (lanes.js crosswalksOf()).
  const crosswalks = crosswalksOf(level, streets, isOneway);
  // The crosswalk distance from the node, and the far side of the stop bar.
  const crossAt = (c) => c.crossHalf + S.crossOut;
  const stopEnd = (c) => crossAt(c) + S.crossDepth / 2 + S.stopGap + S.stopDepth;

  // The cuts of a strip at the intersections: for the lines ("line") or
  // for the curb band ("curb").
  const cutsOf = (s, kind) => {
    const cuts = [];
    for (const p of s.points) {
      const n = nodes.get(`${p[0]},${p[1]}`);
      const others = [...n.strips.values()].filter((o) => o.id !== s.id && o.highway !== "service");
      const cross = others.filter((o) => o.name !== s.name);
      const junction = cross.length > 0 || (n.arms >= 3 && others.length > 0);
      if (!junction) continue;
      const half = Math.max(...(cross.length ? cross : others).map((o) => o.width / 2));
      let r = half + (kind === "curb" ? S.curbClear : CLEAR);
      const name = s.signName ?? s.name;
      for (const c of crosswalks) {
        if (c.x !== n.x || c.z !== n.z || c.name !== name) continue;
        r = Math.max(r, kind === "curb" ? crossAt(c) + S.crossDepth / 2 + 0.2 : stopEnd(c) + 0.1);
      }
      cuts.push({ x: n.x, z: n.z, r });
    }
    return cuts;
  };

  // The direction of the next strip at each end of a strip, when the end
  // joins one other strip of the same width (a joint, not a junction), so
  // the curb band and the edge line join it with no gap.
  const endsOf = (s) => {
    const dirAt = (end) => {
      // An end that a bridge deck covers stops at the deck joint, not at the
      // node: it gets a square end, not the miter of the joint.
      const tr = trims.get(s.id);
      if ((end === 0 ? tr?.start : tr?.end) > 0) return null;
      const p = end === 0 ? s.points[0] : s.points[s.points.length - 1];
      const n = nodes.get(`${p[0]},${p[1]}`);
      const others = [...n.strips.values()].filter((o) => o.id !== s.id);
      if (others.length !== 1 || n.arms > 2) return null;
      const o = others[0];
      if (Math.abs(o.width - s.width) > 1e-3) return null;
      const i = o.points.findIndex((q) => q[0] === p[0] && q[1] === p[1]);
      const q = i === 0 ? o.points[1] : i === o.points.length - 1 ? o.points[i - 1] : null;
      if (!q) return null;
      // The direction away from the joint (end 1) or to the joint (end 0).
      const vx = end === 0 ? p[0] - q[0] : q[0] - p[0];
      const vz = end === 0 ? p[1] - q[1] : q[1] - p[1];
      const len = Math.hypot(vx, vz);
      return len < 0.05 ? null : [vx / len, vz / len];
    };
    return [dirAt(0), dirAt(1)];
  };

  for (const s of streets) {
    const lineCuts = cutsOf(s, "line");
    const oneway = isOneway(s);
    // A one-lane ramp or a divided carriageway (under 9 m) has no center line.
    const center = MAIN.has(s.highway) && !oneway && s.width >= 9;
    if (s.bridge && !flat) {
      // A deck gets only the center line, from joint to joint, draped on the
      // deck height like the deck top (terrain.js bridgeDeck, geo-mesh.js
      // bridgeMeshes).
      if (!center) continue;
      const deck = bridgeDeck(level, s);
      const L = bridgeLayout(level, s);
      const t = terrainOf(level);
      const flatLine = { positions: [], indices: [], colors: [] };
      const pts = densify(L.points, 1.5);
      for (const side of [1, -1]) line(flatLine, pts, y, side * (LINE_GAP / 2 + LINE_W / 2), LINE_W, lineCuts, MARKING_COLORS.yellow);
      const draped = flatLine.indices.length ? drapeMesh(flatLine, { flat: false, cell: t.cell, x0: t.x0, z0: t.z0, height: deck }) : null;
      const [x0, z0] = s.points[0];
      deckParts.push({ tile: `${Math.floor(x0 / GEO_TILE)},${Math.floor(z0 / GEO_TILE)}`, meshes: draped ? [draped] : [] });
      continue;
    }
    // A road that meets a deck stops at the deck joint (bridges.js).
    const pts = trimPolyline(s.points, trims.get(s.id));
    if (!pts) continue;
    const ends = endsOf(s);
    const L = laneLayout(s, oneway);
    if (center) for (const side of [1, -1]) line(mesh, pts, y, (L.center ?? 0) + side * (LINE_GAP / 2 + LINE_W / 2), LINE_W, lineCuts, MARKING_COLORS.yellow);
    if (MAIN.has(s.highway)) {
      for (const o of L.lines) line(mesh, pts, y, o, S.laneLine, lineCuts, MARKING_COLORS.white, { dash: [S.dash, S.dashGap] });
    }
    if (EDGE.has(s.highway) && edgeLineOffset(s.width) > S.lane / 2) {
      // On a divided road the edge line on the median side is yellow.
      for (const [k, side] of [[0, -1], [1, 1]]) line(mesh, pts, y, L.edges[k], S.edgeLine, lineCuts, side === median.get(s.id) ? MARKING_COLORS.yellow : MARKING_COLORS.white, { ends });
    }
    for (const b of L.bikes) line(mesh, pts, yCurb + 0.002, b.offset, b.width, lineCuts, MARKING_COLORS.bike, { ends });
    if (s.highway !== "service") {
      const curbCuts = cutsOf(s, "curb");
      for (const side of [1, -1]) line(mesh, pts, yCurb, side * (s.width / 2 - S.curb / 2), S.curb, curbCuts, MARKING_COLORS.curb, { ends });
    }
    const pl = polyline(pts);
    if (pl.dirs.length === 0) continue;
    const cutAt = (p) => lineCuts.find((c) => c.x === p[0] && c.z === p[1])?.r ?? null;
    // Turn arrows before an intersection: the forward lanes at the strip
    // end, the backward lanes at the strip start.
    if (MAIN.has(s.highway) || s.turnLanes) {
      for (const [dir, tag, endPoint] of [
        [1, s.turnLanes, s.points[s.points.length - 1]],
        [-1, s.turnLanesBackward, s.points[0]],
      ]) {
        if (!tag || pts[dir > 0 ? pts.length - 1 : 0] !== endPoint) continue;
        const r = cutAt(endPoint);
        if (r === null) continue;
        const head = r + S.arrowBack;
        const tail = head + 3.4;
        const other = cutAt(dir > 0 ? s.points[0] : s.points[s.points.length - 1]) ?? 0;
        if (pl.length - tail < other + 1) continue;
        const sTail = dir > 0 ? pl.length - tail : tail;
        const at = pointAt(pl, sTail);
        const [dx, dz] = pl.dirs[at.i];
        const t = [dx * dir, dz * dir];
        const centers = laneCenters(L, dir);
        const turns = tag.split("|");
        for (let k = 0; k < Math.min(turns.length, centers.length); k += 1) {
          const bx = at.x - dz * centers[k];
          const bz = at.z + dx * centers[k];
          for (const shape of arrowShapes(turns[k])) poly(mesh, shape.map(([a, b]) => [bx + t[0] * a + t[1] * b, bz + t[1] * a - t[0] * b]), y, MARKING_COLORS.white);
        }
      }
    }
    // The decals: manholes, asphalt patches, and storm drains.
    if (EDGE.has(s.highway)) {
      const rand = seededRandom(hash32(`${s.id}:decals`));
      const kept = keptRanges(pl, lineCuts);
      const inKept = (v, m) => kept.some(([a, b]) => v - m >= a && v + m <= b);
      const inner = s.width / 2 - S.curb - 1;
      const place = (v, o) => {
        const p = pointAt(pl, v);
        const [dx, dz] = pl.dirs[p.i];
        return { x: p.x - dz * o, z: p.z + dx * o, dx, dz };
      };
      for (let v = rand() * S.manholeEvery; v < pl.length; v += S.manholeEvery * (0.6 + 0.8 * rand())) {
        const o = (rand() * 2 - 1) * inner * 0.6;
        if (!inKept(v, 0.5)) continue;
        const c = place(v, o);
        const ring = [];
        for (let k = 0; k < 8; k += 1) ring.push([c.x + Math.cos((k * Math.PI) / 4) * 0.33, c.z + Math.sin((k * Math.PI) / 4) * 0.33]);
        poly(mesh, ring, streetTop + IRON_LIFT, MARKING_COLORS.iron);
      }
      for (let v = rand() * S.patchEvery; v < pl.length; v += S.patchEvery * (0.6 + 0.8 * rand())) {
        const along = 1.2 + rand() * 2;
        const across = 0.9 + rand() * 1.4;
        const o = (rand() * 2 - 1) * Math.max(0, inner - across / 2);
        const color = rand() < 0.5 ? MARKING_COLORS.patchDark : MARKING_COLORS.patchLight;
        if (!inKept(v, along / 2)) continue;
        const c = place(v, o);
        rect(mesh, c.x, c.z, streetTop + PATCH_LIFT, c.dx, c.dz, along, across, color);
      }
      if (s.highway !== "service") {
        const curbCuts = cutsOf(s, "curb");
        for (const [end, p] of [[0, s.points[0]], [1, s.points[s.points.length - 1]]]) {
          if (pts[end ? pts.length - 1 : 0] !== p) continue;
          const r = curbCuts.find((c) => c.x === p[0] && c.z === p[1])?.r;
          if (r === undefined) continue;
          const v = end ? pl.length - r - 0.8 : r + 0.8;
          if (v < 1 || v > pl.length - 1) continue;
          for (const side of [1, -1]) {
            const c = place(v, side * (s.width / 2 - S.curb - 0.22));
            rect(mesh, c.x, c.z, streetTop + IRON_LIFT, c.dx, c.dz, 0.9, 0.4, MARKING_COLORS.iron);
          }
        }
      }
    }
  }

  // Zebra crosswalks and stop bars.
  for (const c of crosswalks) {
    const { dx, dz, w } = c;
    const nx = -dz;
    const nz = dx;
    const d = crossAt(c);
    const cx = c.x + dx * d;
    const cz = c.z + dz * d;
    const bars = Math.max(2, Math.floor((w - 0.6) / 0.9));
    for (let b = 0; b < bars; b += 1) {
      const o = (b - (bars - 1) / 2) * 0.9;
      // A bar is 2.4 m along the street and 0.45 m across it.
      rect(mesh, cx + nx * o, cz + nz * o, y, dx, dz, S.crossDepth, 0.45, MARKING_COLORS.white);
    }
    // The stop bar is on the inbound half: the right side of the traffic
    // that comes to the node (north is -z, so the right of a direction
    // (vx, vz) is (-vz, vx)). The traffic goes along (-dx, -dz), so its
    // right is (dz, -dx) = -(nx, nz). A one-way arm gets a full bar.
    const sd = d + S.crossDepth / 2 + S.stopGap + S.stopDepth / 2;
    const inner = c.oneway ? -w / 2 + S.curb : 0.25;
    const outer = w / 2 - S.curb;
    if (outer - inner < 0.5) continue;
    const o = -(inner + outer) / 2;
    rect(mesh, c.x + dx * sd + nx * o, c.z + dz * sd + nz * o, y, dx, dz, S.stopDepth, outer - inner, MARKING_COLORS.white);
  }

  // Split the quads (4 vertices, 6 indices each) into tiles.
  const tiles = new Map();
  const entry = (key) => {
    let e = tiles.get(key);
    if (!e) tiles.set(key, (e = { mesh: { positions: [], indices: [], colors: [] }, deck: [] }));
    return e;
  };
  for (let q = 0; q < mesh.positions.length / 12; q += 1) {
    const x = mesh.positions[q * 12];
    const z = mesh.positions[q * 12 + 2];
    const t = entry(`${Math.floor(x / GEO_TILE)},${Math.floor(z / GEO_TILE)}`).mesh;
    const base = t.positions.length / 3;
    for (let k = 0; k < 12; k += 1) {
      t.positions.push(mesh.positions[q * 12 + k]);
      t.colors.push(mesh.colors[q * 12 + k]);
    }
    t.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  for (const { tile, meshes } of deckParts) entry(tile).deck.push(...meshes.filter((m) => m.indices.length));
  const typed = (t) => ({ positions: Float32Array.from(t.positions), indices: Uint32Array.from(t.indices), colors: Float32Array.from(t.colors) });
  return [...tiles.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([tile, e]) => (e.deck.length ? { tile, mesh: typed(e.mesh), deck: typed(mergeMeshes(e.deck)) } : { tile, mesh: typed(e.mesh) }));
}

// Every tile in one mesh (for the tests).
export function mergeMarkings(tiles) {
  const positions = [];
  const colors = [];
  const indices = [];
  for (const { mesh } of tiles) {
    const base = positions.length / 3;
    positions.push(...mesh.positions);
    colors.push(...mesh.colors);
    for (const i of mesh.indices) indices.push(base + i);
  }
  return { positions, colors, indices };
}
