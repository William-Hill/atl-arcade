// Road markings for a geodata level. Pure.
//
// - A double yellow center line on the main streets (trunk, primary,
//   secondary, tertiary), as on Ponce de Leon Ave, North Ave, and Ralph
//   McGill Blvd. Residential streets have no center line, as in Atlanta.
// - Dashed white lane lines (3 m dash, 9 m gap) on a main street with 2 or
//   more lanes in one direction. A lane is 3.4 m wide.
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

import { streetIntersections } from "./signs.js";
import { GEO_TILE, SURFACE_COLORS } from "./geo-mesh.js";

export const MARKING_COLORS = {
  yellow: [0.96, 0.74, 0.16],
  white: [0.94, 0.94, 0.9],
  // The curb band. It is a little lighter than the sidewalk color, so the
  // band and the sidewalk keep a seam where they touch.
  curb: SURFACE_COLORS.sidewalk.map((c) => Math.min(1, c * 1.06)),
};
const LIFT = 0.02; // m over the street top (the paint)
const CURB_LIFT = 0.012; // m over the street top (under the paint, so a line on a curb band does not flicker)
const MAIN = new Set(["trunk", "primary", "secondary", "tertiary"]);
const EDGE = new Set([...MAIN, "residential"]);
const LINE_W = 0.11;
const LINE_GAP = 0.11;
const CLEAR = 2; // m past the cross street edge
export const MARKING_SIZES = {
  lane: 3.4, // m, the width of one lane
  laneLine: 0.11,
  dash: 3, // m (US practice: 10 ft dash, 30 ft gap)
  dashGap: 9,
  edgeLine: 0.12,
  edgeInset: 0.3, // m from the inner side of the curb band to the edge line
  curb: 0.3, // m, the width of the curb band
  curbClear: 0.5, // m past the cross street edge
  stopDepth: 0.45, // m along the street
  stopGap: 1.0, // m from the crosswalk to the stop bar
  crossDepth: 2.4, // m along the street (one crosswalk bar)
  crossOut: 1.8, // m from the cross street edge to the crosswalk center
};
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

// The lane lines of a street: the offsets (to the left of the strip
// direction) of the white dashed lines. A two-way street has
// floor(width / lane) lanes, split in two halves by the center line.
export function laneLineOffsets(s) {
  // `s.oneway` is the oneway tag, or a half of a divided road.
  const lanes = Math.floor(s.width / S.lane);
  const out = [];
  if (s.oneway) {
    for (let k = 1; k < lanes; k += 1) out.push(-s.width / 2 + (k * s.width) / lanes);
    return out;
  }
  const perSide = Math.floor(lanes / 2);
  for (let k = 1; k < perSide; k += 1) for (const side of [1, -1]) out.push((side * k * s.width) / 2 / perSide);
  return out;
}

// The side of the median of a divided road: +1 when a parallel strip of
// the same name is on the normal side (-dz, dx) of the strip, -1 when it is
// on the other side, 0 when the strip is not one half of a divided road.
// A strip is one half when 30 % or more of its length runs beside a
// parallel strip (directions within 25 degrees) with a gap of 12 m or less.
export function medianSide(s, strips) {
  if (!MAIN.has(s.highway) || !s.name) return 0;
  const twins = strips.filter((o) => o.id !== s.id && o.name === s.name && MAIN.has(o.highway));
  let total = 0;
  let beside = 0;
  let side = 0;
  for (let i = 0; i < s.points.length - 1; i += 1) {
    const [ax, az] = s.points[i];
    const dx = s.points[i + 1][0] - ax;
    const dz = s.points[i + 1][1] - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    total += len;
    for (const f of [0.25, 0.5, 0.75]) {
      const mx = ax + dx * f;
      const mz = az + dz * f;
      let hit = false;
      for (const o of twins) {
        for (let j = 0; j < o.points.length - 1; j += 1) {
          const [cx, cz] = o.points[j];
          const vx = o.points[j + 1][0] - cx;
          const vz = o.points[j + 1][1] - cz;
          const vl = vx * vx + vz * vz;
          if (vl < 1e-4) continue;
          const t = ((mx - cx) * vx + (mz - cz) * vz) / vl;
          if (t < 0 || t > 1) continue;
          const px = cx + vx * t - mx;
          const pz = cz + vz * t - mz;
          const gap = Math.hypot(px, pz) - (s.width + o.width) / 2;
          if (gap < -1.5 || gap > 12) continue;
          if (Math.abs(dx * vx + dz * vz) / (len * Math.sqrt(vl)) < 0.9) continue;
          hit = true;
          side += Math.sign(-dz * px + dx * pz);
        }
      }
      if (hit) beside += len / 3;
    }
  }
  if (total === 0 || beside / total < 0.3 || side === 0) return 0;
  return Math.sign(side);
}

// The offset of the edge line center from the street centerline.
export function edgeLineOffset(width) {
  return width / 2 - S.curb - S.edgeInset - S.edgeLine / 2;
}

export function roadMarkings(level) {
  const mesh = { positions: [], indices: [], colors: [] };
  const streetTop = level.surfaces?.street ?? 0;
  const y = streetTop + LIFT;
  const yCurb = streetTop + CURB_LIFT;
  const streets = (level.strips ?? []).filter((s) => s.kind === "street");
  // One way: the tag, or one half of a divided road.
  const median = new Map(streets.map((s) => [s.id, medianSide(s, streets)]));
  const isOneway = (s) => Boolean(s.oneway) || median.get(s.id) !== 0;

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
  // named streets, past the cross street.
  const crosswalks = [];
  for (const ix of streetIntersections(level)) {
    // The intersection names are the sign names (the city name when the
    // build has one, #78), so match on the same name. Use only the strips
    // through this node, so a wider part of the same street far away does
    // not move the crosswalk. If no strip has the node, use all strips with
    // the name.
    const named = (name) => streets.filter((s) => (s.signName ?? s.name) === name);
    const stripsOf = (name) => {
      const all = named(name);
      const here = all.filter((s) => s.points.some(([x, z]) => x === ix.x && z === ix.z));
      return here.length ? here : all;
    };
    const widthOf = (name) => Math.max(...stripsOf(name).map((s) => s.width));
    for (let k = 0; k < 2; k += 1) {
      const [dx, dz] = ix.dirs[k];
      const w = widthOf(ix.names[k]);
      const crossHalf = widthOf(ix.names[1 - k]) / 2;
      const oneway = stripsOf(ix.names[k]).some(isOneway);
      for (const dir of [1, -1]) crosswalks.push({ x: ix.x, z: ix.z, name: ix.names[k], dx: dx * dir, dz: dz * dir, w, crossHalf, oneway });
    }
  }
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
    // A deck is over the ground; the markings follow the ground, so a deck
    // gets only the old center line.
    const deck = Boolean(s.bridge);
    const lineCuts = cutsOf(s, "line");
    const ends = endsOf(s);
    const oneway = isOneway(s);
    if (MAIN.has(s.highway) && !oneway && s.width >= 9) {
      // A one-lane ramp or a divided carriageway (under 9 m) has no center line.
      for (const side of [1, -1]) line(mesh, s.points, y, side * (LINE_GAP / 2 + LINE_W / 2), LINE_W, lineCuts, MARKING_COLORS.yellow);
    }
    if (deck) continue;
    if (MAIN.has(s.highway)) {
      for (const o of laneLineOffsets({ width: s.width, oneway })) line(mesh, s.points, y, o, S.laneLine, lineCuts, MARKING_COLORS.white, { dash: [S.dash, S.dashGap] });
    }
    if (EDGE.has(s.highway) && edgeLineOffset(s.width) > S.lane / 2) {
      // On a divided road the edge line on the median side is yellow.
      for (const side of [1, -1]) line(mesh, s.points, y, side * edgeLineOffset(s.width), S.edgeLine, lineCuts, side === median.get(s.id) ? MARKING_COLORS.yellow : MARKING_COLORS.white, { ends });
    }
    if (s.highway !== "service") {
      const curbCuts = cutsOf(s, "curb");
      for (const side of [1, -1]) line(mesh, s.points, yCurb, side * (s.width / 2 - S.curb / 2), S.curb, curbCuts, MARKING_COLORS.curb, { ends });
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
  for (let q = 0; q < mesh.positions.length / 12; q += 1) {
    const x = mesh.positions[q * 12];
    const z = mesh.positions[q * 12 + 2];
    const key = `${Math.floor(x / GEO_TILE)},${Math.floor(z / GEO_TILE)}`;
    let t = tiles.get(key);
    if (!t) tiles.set(key, (t = { positions: [], indices: [], colors: [] }));
    const base = t.positions.length / 3;
    for (let k = 0; k < 12; k += 1) {
      t.positions.push(mesh.positions[q * 12 + k]);
      t.colors.push(mesh.colors[q * 12 + k]);
    }
    t.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  return [...tiles.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([tile, t]) => ({ tile, mesh: { positions: Float32Array.from(t.positions), indices: Uint32Array.from(t.indices), colors: Float32Array.from(t.colors) } }));
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
