// The plan layout of the bridges of a geodata level (issue #131). Pure, and
// no terrain: the build (terrain grading) and the runtime (deck, meshes,
// sampler, markings) use the same layout.
//
// An OSM bridge way ends at the abutment. The 8 m terrain grid cannot make a
// vertical abutment, so the terrain near the OSM end is a ramp, and a deck
// that ends there does not meet the road. So each deck goes on past the OSM
// end along its approach road by JOINT_SHIFT m, to the joint J. The terrain
// grading (terrain.js gradeBridgeEnds) makes the ground level across the
// road on the deck line within one grid cell of J, so the deck end and the
// road share one edge. The approach road mesh stops at J.
//
// A bridge next to a wider one in parallel (a sidewalk on a road bridge),
// or next to one of the same width (the two carriageways of a parkway), is
// "hosted": it uses the deck line of its host, so the decks are at one
// height. Two decks at different heights side by side cannot both meet
// their roads on a 4 m terrain grid.

// At least one diagonal of the 8 m terrain grid, so the graded ground at J
// does not reach back under the OSM span.
export const JOINT_SHIFT = 12; // m past the OSM end, along the approach
const MAX_TURN = Math.cos((35 * Math.PI) / 180); // an approach turns less than 35 degrees
const MAX_BEND = Math.cos((20 * Math.PI) / 180); // a run-on bends less than 20 degrees
const HOST_GAP = 12; // m between the edges of a hosted bridge and its host

const cache = new WeakMap();

const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;

export function cumulative(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i += 1) cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  return cum;
}

// The place of (x, z) along a polyline: { s, d }, s the length along it and
// d the distance to the nearest segment line. Each segment owns the band
// between the miter lines at its two ends (the lines that ribbonEdges()
// puts the mesh rows on), and s runs linearly across that band. So s has no
// jump on the inside of a turn, and it matches the mesh rows. Before the
// first point and past the last point, s goes on along the end segment
// (s < 0 or s > total), so a function of s extends in a straight line.
const frames = new WeakMap();
// The unit direction of each segment and the miter tangent at each point.
function frameOf(points) {
  let f = frames.get(points);
  if (f) return f;
  const n = points.length;
  const dirs = [];
  for (let i = 0; i < n - 1; i += 1) {
    const dx = points[i + 1][0] - points[i][0];
    const dz = points[i + 1][1] - points[i][1];
    const l = Math.hypot(dx, dz) || 1;
    dirs.push([dx / l, dz / l]);
  }
  // The tangent of the miter line at each point: the mean direction.
  const tangents = [];
  for (let i = 0; i < n; i += 1) {
    const a = dirs[Math.max(0, i - 1)];
    const b = dirs[Math.min(dirs.length - 1, i)];
    const tx = a[0] + b[0];
    const tz = a[1] + b[1];
    const l = Math.hypot(tx, tz) || 1;
    tangents.push([tx / l, tz / l]);
  }
  f = { dirs, tangents };
  frames.set(points, f);
  return f;
}

export function project(points, cum, x, z) {
  const n = points.length;
  if (n < 2) return { s: 0, d: Math.hypot(x - points[0][0], z - points[0][1]) };
  const { dirs, tangents } = frameOf(points);
  const tangent = (i) => tangents[i];
  let best = null;
  for (let i = 0; i < n - 1; i += 1) {
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    const [ux, uz] = dirs[i];
    const ta = tangent(i);
    const tb = tangent(i + 1);
    // Distances past the miter line at each end, measured along the segment.
    const da = ((x - ax) * ta[0] + (z - az) * ta[1]) / Math.max(1e-6, ux * ta[0] + uz * ta[1]);
    const db = ((bx - x) * tb[0] + (bz - z) * tb[1]) / Math.max(1e-6, ux * tb[0] + uz * tb[1]);
    const first = i === 0;
    const last = i === n - 2;
    if ((da < 0 && !first) || (db < 0 && !last)) continue;
    const len = cum[i + 1] - cum[i];
    const d = Math.abs(-(x - ax) * uz + (z - az) * ux);
    let f = da + db > 1e-9 ? da / (da + db) : 0;
    if (first && da < 0) f = da / len;
    if (last && db < 0) f = 1 - db / len;
    // Off the ends of a segment that is not an end segment, add the gap.
    const gap = Math.max(0, -da) * (first ? 0 : 1) + Math.max(0, -db) * (last ? 0 : 1);
    const score = d + gap;
    if (!best || score < best.score) best = { score, d, s: cum[i] + f * len };
  }
  if (!best) {
    // Outside every band (on the outside of a sharp turn): the nearest point.
    let near = { d: Infinity, s: 0 };
    for (let i = 0; i < n; i += 1) {
      const d = Math.hypot(x - points[i][0], z - points[i][1]);
      if (d < near.d) near = { d, s: cum[i] };
    }
    return near;
  }
  return { s: best.s, d: best.d };
}

// The part of a polyline from length s0 to length s1 (0 <= s0 < s1 <= total).
export function slicePolyline(points, s0, s1) {
  const cum = cumulative(points);
  const at = (s) => {
    for (let i = 0; i < points.length - 1; i += 1) {
      if (s <= cum[i + 1] || i === points.length - 2) {
        const l = cum[i + 1] - cum[i] || 1;
        const k = Math.max(0, Math.min(1, (s - cum[i]) / l));
        return [points[i][0] + (points[i + 1][0] - points[i][0]) * k, points[i][1] + (points[i + 1][1] - points[i][1]) * k];
      }
    }
    return points[points.length - 1];
  };
  const out = [at(s0)];
  for (let i = 1; i < points.length - 1; i += 1) if (cum[i] > s0 + 1e-6 && cum[i] < s1 - 1e-6) out.push(points[i]);
  out.push(at(s1));
  return out;
}

// The approach of a bridge end E (outward direction u): the at-grade strip
// with an end point at E that goes on straightest, and its points from E
// for up to JOINT_SHIFT m.
function approachOf(strips, E, u) {
  let best = null;
  for (const o of strips) {
    if (o.bridge || o.points.length < 2) continue;
    let pts = null;
    if (same(o.points[0], E)) pts = o.points;
    else if (same(o.points[o.points.length - 1], E)) pts = o.points.slice().reverse();
    if (!pts) continue;
    const dx = pts[1][0] - E[0];
    const dz = pts[1][1] - E[1];
    const l = Math.hypot(dx, dz);
    if (l < 1e-6) continue;
    const c = (dx * u[0] + dz * u[1]) / l;
    if (c < MAX_TURN) continue;
    const total = cumulative(pts).at(-1);
    if (total < 1) continue;
    if (!best || c > best.c) best = { c, strip: o, pts, total, reversed: pts !== o.points };
  }
  if (!best) return null;
  // The run-on stops where the approach turns more than MAX_BEND from the
  // deck, so the deck height along the run-on has no jump at a sharp turn.
  const cum = cumulative(best.pts);
  let reach = best.total;
  for (let i = 1; i < best.pts.length - 1; i += 1) {
    const dx = best.pts[i + 1][0] - best.pts[i][0];
    const dz = best.pts[i + 1][1] - best.pts[i][1];
    const l = Math.hypot(dx, dz) || 1;
    if ((dx * u[0] + dz * u[1]) / l < MAX_BEND) {
      reach = cum[i];
      break;
    }
  }
  const shift = Math.min(JOINT_SHIFT, reach);
  return { id: best.strip.id, shift, path: slicePolyline(best.pts, 0, shift), atStart: !best.reversed };
}

// Every bridge of `strips`: Map id -> { id, strip, points, cum, total,
// span: [s0, s1], ends: [{ E, J, shift, approach }], host }. `points` is
// the polyline from J0 to J1, and span is the OSM part of it.
export function bridgeLayouts(strips) {
  let m = cache.get(strips);
  if (m) return m;
  m = new Map();
  const bridges = strips.filter((s) => s.bridge && s.points.length >= 2);
  for (const b of bridges) {
    const P = b.points;
    const ends = [];
    for (const [E, next] of [[P[0], P[1]], [P[P.length - 1], P[P.length - 2]]]) {
      const l = Math.hypot(E[0] - next[0], E[1] - next[1]) || 1;
      const u = [(E[0] - next[0]) / l, (E[1] - next[1]) / l];
      const a = approachOf(strips, E, u);
      ends.push({ E, J: a ? a.path[a.path.length - 1] : E, shift: a ? a.shift : 0, approach: a?.id ?? null, approachAtStart: a?.atStart ?? true, path: a ? a.path : [E] });
    }
    const points = [...ends[0].path.slice().reverse(), ...P.slice(1, -1), ...ends[1].path];
    // Drop repeated points (an end with no approach).
    const clean = [];
    for (const p of points) if (!clean.length || !same(clean[clean.length - 1], p)) clean.push(p);
    const cum = cumulative(clean);
    const total = cum[cum.length - 1];
    m.set(b.id, { id: b.id, strip: b, width: b.width, points: clean, cum, total, span: [ends[0].shift, total - ends[1].shift], ends, host: null });
  }
  // Hosted bridges: a bridge alongside a wider one (or one of the same
  // width with a lower id), in parallel. The host is the root of the chain.
  const ranks = (H, L) => H.width > L.width || (H.width === L.width && H.id < L.id);
  for (const L of m.values()) {
    let best = null;
    for (const H of m.values()) {
      if (H === L || !ranks(H, L)) continue;
      const P = L.strip.points;
      const lim = H.width / 2 + L.width / 2 + HOST_GAP;
      const a = project(H.points, H.cum, P[0][0], P[0][1]);
      const b = project(H.points, H.cum, P[P.length - 1][0], P[P.length - 1][1]);
      if (a.d > lim || b.d > lim) continue;
      // Along the host: both ends within the host, give or take 15 m.
      if (Math.min(a.s, b.s) < -15 || Math.max(a.s, b.s) > H.total + 15) continue;
      // Parallel: the two ends are as far apart along the host as in plan.
      const plan = Math.hypot(P[P.length - 1][0] - P[0][0], P[P.length - 1][1] - P[0][1]);
      if (Math.abs(b.s - a.s) < 0.95 * plan) continue;
      const d = a.d + b.d;
      if (!best || d < best.d) best = { d, id: H.id };
    }
    if (best) L.host = best.id;
  }
  for (const L of m.values()) {
    while (L.host && m.get(L.host).host) L.host = m.get(L.host).host;
  }
  cache.set(strips, m);
  return m;
}

// The layout of one bridge strip of a level (or null).
export function bridgeLayout(level, s) {
  return bridgeLayouts(level.strips ?? []).get(s.id) ?? null;
}

// The approach strips that a deck covers at an end: Map strip id ->
// { start, end }, the length to cut off at each end of its polyline.
export function approachTrims(strips) {
  const out = new Map();
  for (const L of bridgeLayouts(strips).values()) {
    for (const e of L.ends) {
      if (!e.approach || !(e.shift > 0)) continue;
      const t = out.get(e.approach) ?? { start: 0, end: 0 };
      if (e.approachAtStart) t.start = Math.max(t.start, e.shift);
      else t.end = Math.max(t.end, e.shift);
      out.set(e.approach, t);
    }
  }
  return out;
}

// A strip polyline with the trims cut off (null when nothing is left).
export function trimPolyline(points, trim) {
  if (!trim || (!trim.start && !trim.end)) return points;
  const total = cumulative(points).at(-1);
  const s0 = trim.start;
  const s1 = total - trim.end;
  if (s1 - s0 < 0.05) return null;
  return slicePolyline(points, s0, s1);
}

// The two edges of a ribbon of half width r along a polyline, with mitered
// joints (no gap and no overlap at a turn): { left, right }, one point per
// polyline point. `offset` moves the ribbon sideways (+ is left).
export function ribbonEdges(points, r, offset = 0) {
  const n = points.length;
  const dirs = [];
  for (let i = 0; i < n - 1; i += 1) {
    const dx = points[i + 1][0] - points[i][0];
    const dz = points[i + 1][1] - points[i][1];
    const l = Math.hypot(dx, dz) || 1;
    dirs.push([dx / l, dz / l]);
  }
  const left = [];
  const right = [];
  for (let i = 0; i < n; i += 1) {
    const a = dirs[Math.max(0, i - 1)];
    const b = dirs[Math.min(dirs.length - 1, i)];
    // The left normal of each segment is (-dz, dx); the miter is their mean.
    let mx = -(a[1] + b[1]) / 2;
    let mz = (a[0] + b[0]) / 2;
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml;
    mz /= ml;
    // Scale so the edge stays r from each segment (cos of half the turn).
    const c = Math.max(0.5, mx * -b[1] + mz * b[0]);
    const [x, z] = points[i];
    left.push([x + (mx * (offset + r)) / c, z + (mz * (offset + r)) / c]);
    right.push([x + (mx * (offset - r)) / c, z + (mz * (offset - r)) / c]);
  }
  return { left, right };
}

// A polyline with a point at least each `step` m. The old points stay.
export function densify(points, step) {
  const out = [points[0]];
  for (let i = 0; i < points.length - 1; i += 1) {
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 1; k <= n; k += 1) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  return out;
}

// True when (x, z) is on the deck of another bridge than `id`.
function onOtherDeck(layouts, id, x, z) {
  for (const L of layouts.values()) {
    if (L.id === id) continue;
    const { s, d } = project(L.points, L.cum, x, z);
    if (s >= 0 && s <= L.total && d < L.width / 2) return true;
  }
  return false;
}

// The parts of the OSM span of a bridge where a parapet of width `pw`
// stands on side k (+1 left, -1 right): a list of runs { from, to, last,
// points } along the center line. A parapet side on the deck of another
// bridge (a sidewalk bridge on a road bridge) has no parapet, and none where
// `blocked(x, z)` is true (an at-grade way at the deck height).
export function parapetRuns(level, s, k, pw, blocked = null) {
  const L = bridgeLayout(level, s);
  const layouts = bridgeLayouts(level.strips);
  const span = densify(slicePolyline(L.points, L.span[0], L.span[1]), 1.5);
  const { left } = ribbonEdges(span, 0, (s.width / 2 - pw / 2) * k);
  const runs = [];
  let run = null;
  for (let i = 0; i < span.length - 1; i += 1) {
    const mx = (left[i][0] + left[i + 1][0]) / 2;
    const mz = (left[i][1] + left[i + 1][1]) / 2;
    const keep = !onOtherDeck(layouts, s.id, mx, mz) && !blocked?.(mx, mz);
    if (keep && !run) runs.push((run = { from: i, points: [span[i]] }));
    if (keep) run.points.push(span[i + 1]);
    else run = null;
  }
  return runs.map((r) => ({ ...r, to: r.from + r.points.length - 1, last: span.length - 1 }));
}
