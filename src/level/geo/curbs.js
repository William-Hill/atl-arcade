// Sidewalk curbs and curb ramps (#136). Pure.
//
// A sidewalk is a strip at the sidewalk height (0.15 m), so its edge is a
// 12 cm curb over the street. Some OSM sidewalk ways go on across a street
// (to the next block), and the sidewalk strip then lay over the street as a
// raised bar. Here each sidewalk strip is split:
//
// - The part of a sidewalk whose center line goes across a street (an
//   angle over 30 degrees; not a service road: a sidewalk goes on over a
//   driveway, as a real one does) is cut out. The street shows there.
// - At each side of a cut the last CURB.ramp m of the sidewalk is an end
//   ramp: a slope from the sidewalk top down to the street, along the
//   sidewalk (a curb cut).
// - At each end of a crosswalk (markings.js, at the named intersections)
//   and of each OSM footway crossing (level.crossings), a sidewalk that
//   runs along the street gets a cross ramp: CURB.crossRamp m of the
//   sidewalk slopes across its width, from the back edge down to the curb.
//   A sidewalk that ends at the crossing gets an end ramp.
//
// The ramps are in the ground sampler (geo-ground.js): over a sidewalk, the
// ramp height wins, so the skater rolls down and up a ramp with no step.
// The ramp slope is 8% or less (0.12 m over 1.5 m), as a real curb ramp.

import { crosswalksOf } from "./lanes.js";
import { slicePolyline } from "./bridges.js";

export const CURB = {
  ramp: 1.5, // m, the run of an end ramp along the sidewalk
  crossRamp: 2.4, // m, the width of a cross ramp along the sidewalk
  step: 0.25, // m between two samples along a sidewalk
  minCut: 0.5, // m, the shortest cut
  minPiece: 0.2, // m, the shortest sidewalk piece
  reach: 2.5, // m past the sidewalk edge where a crossing end finds the sidewalk
  cell: 16, // m, the grid cell of the street search
};

function cumulative(points) {
  const out = [0];
  for (let i = 0; i < points.length - 1; i += 1) out.push(out[i] + Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]));
  return out;
}

// The point and the unit direction at distance s along a polyline.
function frame(points, cum, s) {
  let i = 0;
  while (i < points.length - 2 && cum[i + 1] < s) i += 1;
  const len = cum[i + 1] - cum[i] || 1;
  const t = Math.max(0, Math.min(1, (s - cum[i]) / len));
  const [ax, az] = points[i];
  const [bx, bz] = points[i + 1];
  return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, dx: (bx - ax) / len, dz: (bz - az) / len };
}

// The nearest point on a polyline: { s, d, x, z }.
function project(points, cum, x, z) {
  let best = null;
  for (let i = 0; i < points.length - 1; i += 1) {
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    const l2 = (bx - ax) ** 2 + (bz - az) ** 2;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / l2)) : 0;
    const px = ax + (bx - ax) * t;
    const pz = az + (bz - az) * t;
    const d = Math.hypot(px - x, pz - z);
    if (!best || d < best.d) best = { s: cum[i] + Math.sqrt(l2) * t, d, x: px, z: pz };
  }
  return best;
}

// A test for "on a street" (not a service road, not a bridge): a grid of
// the street segments.
function streetGrid(level) {
  const grid = new Map();
  for (const s of level.strips ?? []) {
    if (s.kind !== "street" || s.highway === "service" || s.bridge) continue;
    for (let i = 0; i < s.points.length - 1; i += 1) {
      const [ax, az] = s.points[i];
      const [bx, bz] = s.points[i + 1];
      const r = s.width / 2;
      for (let ix = Math.floor((Math.min(ax, bx) - r) / CURB.cell); ix <= Math.floor((Math.max(ax, bx) + r) / CURB.cell); ix += 1) {
        for (let iz = Math.floor((Math.min(az, bz) - r) / CURB.cell); iz <= Math.floor((Math.max(az, bz) + r) / CURB.cell); iz += 1) {
          const k = `${ix},${iz}`;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push({ ax, az, bx, bz, r });
        }
      }
    }
  }
  // (ux, uz) is the sidewalk direction there. A sidewalk that runs along a
  // street (30 degrees or less) is not across it: the OSM line of a
  // sidewalk is often inside the default street width.
  return (x, z, ux, uz) => {
    for (const g of grid.get(`${Math.floor(x / CURB.cell)},${Math.floor(z / CURB.cell)}`) ?? []) {
      const dx = g.bx - g.ax;
      const dz = g.bz - g.az;
      const l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - g.ax) * dx + (z - g.az) * dz) / l2)) : 0;
      if (Math.hypot(x - g.ax - dx * t, z - g.az - dz * t) > g.r) continue;
      if (l2 > 0 && Math.abs(ux * dx + uz * dz) / Math.sqrt(l2) > Math.cos(Math.PI / 6)) continue;
      return true;
    }
    return false;
  };
}

// The crossing ends of a level: [{ x, z, ux, uz, source }]. (ux, uz) is the
// unit direction of the crossing at the end, out of the street.
export function crossingEnds(level) {
  const out = [];
  for (const c of crosswalksOf(level)) {
    // The crosswalk center, and its two ends at the street edges.
    const cx = c.x + c.dx * c.at;
    const cz = c.z + c.dz * c.at;
    for (const k of [1, -1]) {
      const ux = -c.dz * k;
      const uz = c.dx * k;
      out.push({ x: cx + ux * (c.w / 2), z: cz + uz * (c.w / 2), ux, uz, source: `crosswalk:${c.x},${c.z}:${c.name}` });
    }
  }
  for (const c of level.crossings ?? []) {
    const P = c.points;
    if (P.length < 2) continue;
    for (const [e, q] of [
      [P[0], P[1]],
      [P[P.length - 1], P[P.length - 2]],
    ]) {
      const l = Math.hypot(e[0] - q[0], e[1] - q[1]);
      if (l < 0.05) continue;
      out.push({ x: e[0], z: e[1], ux: (e[0] - q[0]) / l, uz: (e[1] - q[1]) / l, source: c.id });
    }
  }
  return out;
}

// The sidewalk layout of a level: Map strip id -> { pieces: [[s0, s1]],
// ramps }. `pieces` are the kept ranges of the sidewalk polyline (m along
// it). A ramp is { id, strip, kind: "end" | "cross", a, b, r, h0, h1,
// s0, s1, source }: the slope goes from a (height h0 over the terrain) to
// b (height h1), and the ramp is r m to each side of the line a-b. s0 to s1
// is the range of the sidewalk that the ramp takes. `source` is the
// crossing that made a cross ramp (an OSM way id, or a crosswalk).
// One layout per level object (the sampler, the meshes, the props, and the
// grindables all ask for it).
// Cached by the strips array: the layout reads only the strips, the
// surfaces, and the crossings, so a copy of the level with other buildings
// (the walker ground sampler, src/main.js) reuses it (#190).
const LAYOUTS = new WeakMap();
export function sidewalkLayout(level) {
  const key = level.strips ?? level;
  const hit = LAYOUTS.get(key);
  if (hit && hit.surfaces === level.surfaces && hit.crossings === level.crossings) return hit.layout;
  const layout = buildLayout(level);
  LAYOUTS.set(key, { surfaces: level.surfaces, crossings: level.crossings, layout });
  return layout;
}

function buildLayout(level) {
  const out = new Map();
  const walks = (level.strips ?? []).filter((s) => s.kind === "sidewalk" && !s.bridge);
  if (!walks.length) return out;
  const top = level.surfaces?.sidewalk ?? 0.15;
  const street = level.surfaces?.street ?? 0.03;
  const onStreet = streetGrid(level);
  const info = new Map();
  for (const s of walks) {
    const cum = cumulative(s.points);
    const L = cum[cum.length - 1];
    // The cuts: the runs of samples on a street.
    const cuts = [];
    let run = null;
    const n = Math.max(1, Math.ceil(L / CURB.step));
    for (let k = 0; k <= n; k += 1) {
      const v = (k / n) * L;
      const f = frame(s.points, cum, v);
      if (onStreet(f.x, f.z, f.dx, f.dz)) {
        if (!run) run = [Math.max(0, v - L / n / 2), v];
        run[1] = Math.min(L, v + L / n / 2);
      } else if (run) {
        cuts.push(run);
        run = null;
      }
    }
    if (run) cuts.push(run);
    info.set(s.id, { s, cum, L, cuts: cuts.filter(([a, b]) => b - a >= CURB.minCut || a <= 0 || b >= L), ramps: [] });
  }
  // The end ramps at each side of a cut.
  for (const it of info.values()) {
    const { s, cum, L } = it;
    for (const [c0, c1] of it.cuts) {
      for (const [from, to] of [
        [c0 - CURB.ramp, c0],
        [c1 + CURB.ramp, c1],
      ]) {
        const lo = Math.min(from, to);
        const hi = Math.max(from, to);
        if (lo < 0 || hi > L || it.cuts.some(([a, b]) => a < hi && b > lo && !(b === to || a === to))) continue;
        const a = frame(s.points, cum, from);
        const b = frame(s.points, cum, to);
        it.ramps.push({ id: s.id, strip: s.id, kind: "end", a: [a.x, a.z], b: [b.x, b.z], r: s.width / 2, h0: top, h1: street, s0: lo, s1: hi, source: null });
      }
    }
  }
  // The ramps at the crossing ends.
  for (const e of crossingEnds(level)) {
    let best = null;
    for (const it of info.values()) {
      const { s } = it;
      const p = project(s.points, it.cum, e.x, e.z);
      if (!p || p.d > s.width / 2 + CURB.reach) continue;
      if (!best || p.d < best.p.d) best = { it, p };
    }
    if (!best) continue;
    const { it, p } = best;
    const { s, cum, L } = it;
    const f = frame(s.points, cum, p.s);
    const along = Math.abs(f.dx * e.ux + f.dz * e.uz);
    const taken = (lo, hi) => it.cuts.some(([a, b]) => a < hi && b > lo) || it.ramps.some((r) => r.s0 < hi && r.s1 > lo);
    if (along < 0.5) {
      // The sidewalk runs along the street: a cross ramp.
      const lo = Math.max(0, p.s - CURB.crossRamp / 2);
      const hi = Math.min(L, p.s + CURB.crossRamp / 2);
      if (hi - lo < CURB.crossRamp * 0.6 || taken(lo, hi)) continue;
      const m = frame(s.points, cum, (lo + hi) / 2);
      // The normal (-dz, dx), turned to point out of the street (along u).
      let nx = -m.dz;
      let nz = m.dx;
      if (nx * e.ux + nz * e.uz < 0) {
        nx = -nx;
        nz = -nz;
      }
      const h = s.width / 2;
      it.ramps.push({ id: s.id, strip: s.id, kind: "cross", a: [m.x + nx * h, m.z + nz * h], b: [m.x - nx * h, m.z - nz * h], r: (hi - lo) / 2, h0: top, h1: street, s0: lo, s1: hi, source: e.source });
    } else if (p.s < CURB.ramp + 1 || p.s > L - CURB.ramp - 1) {
      // The sidewalk ends at the crossing: an end ramp at that end.
      const atStart = p.s < L / 2;
      const [from, to] = atStart ? [CURB.ramp, 0] : [L - CURB.ramp, L];
      const lo = Math.min(from, to);
      const hi = Math.max(from, to);
      if (L < CURB.ramp + CURB.minPiece || taken(lo, hi)) continue;
      const a = frame(s.points, cum, from);
      const b = frame(s.points, cum, to);
      it.ramps.push({ id: s.id, strip: s.id, kind: "end", a: [a.x, a.z], b: [b.x, b.z], r: s.width / 2, h0: top, h1: street, s0: lo, s1: hi, source: e.source });
    }
  }
  // The kept pieces: the sidewalk less the cuts and the ramps.
  for (const it of info.values()) {
    const removed = [...it.cuts, ...it.ramps.map((r) => [r.s0, r.s1])].sort((a, b) => a[0] - b[0]);
    const pieces = [];
    let at = 0;
    for (const [a, b] of removed) {
      if (a - at >= CURB.minPiece) pieces.push([at, a]);
      at = Math.max(at, b);
    }
    if (it.L - at >= CURB.minPiece) pieces.push([at, it.L]);
    out.set(it.s.id, { pieces, ramps: it.ramps, cuts: it.cuts });
  }
  return out;
}

// The polyline of a piece range of a strip.
export function piecePoints(points, [s0, s1]) {
  return slicePolyline(points, s0, s1);
}

// The ramp height (over the terrain) and the ramp normal at (x, z), or null
// when the point is not on the ramp. The ramp is a rectangle: from a to b,
// r m to each side.
export function rampAt(ramp, x, z) {
  const [ax, az] = ramp.a;
  const dx = ramp.b[0] - ax;
  const dz = ramp.b[1] - az;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return null;
  const ux = dx / len;
  const uz = dz / len;
  const along = (x - ax) * ux + (z - az) * uz;
  const across = -(x - ax) * uz + (z - az) * ux;
  if (along < 0 || along > len || Math.abs(across) > ramp.r) return null;
  const slope = (ramp.h1 - ramp.h0) / len;
  const l = Math.hypot(slope, 1);
  return { height: ramp.h0 + slope * along, normal: [(-ux * slope) / l, 1 / l, (-uz * slope) / l] };
}

// The mesh of a ramp (flat, not draped): the sloped top, and a side wall
// down to `bottom` on each open side of an end ramp. A cross ramp has the
// sidewalk on its two sides, and the end walls of the sidewalk pieces show
// there.
export function rampMesh(ramp, color, bottom = 0, mesh = { positions: [], indices: [], colors: [] }) {
  const [ax, az] = ramp.a;
  const [bx, bz] = ramp.b;
  const len = Math.hypot(bx - ax, bz - az) || 1;
  const nx = (-(bz - az) / len) * ramp.r;
  const nz = ((bx - ax) / len) * ramp.r;
  const push = (x, y, z) => {
    mesh.positions.push(x, y, z);
    mesh.colors.push(color[0], color[1], color[2]);
    return mesh.positions.length / 3 - 1;
  };
  // The top: corners a+n, b+n, b-n, a-n. Up-facing: (a+n, b-n, b+n)...
  const p0 = push(ax + nx, ramp.h0, az + nz);
  const p1 = push(bx + nx, ramp.h1, bz + nz);
  const p2 = push(bx - nx, ramp.h1, bz - nz);
  const p3 = push(ax - nx, ramp.h0, az - nz);
  // The winding that faces up: the normal of (p0, p2, p1) has y > 0 when
  // n is to the left of a-b.
  const up = (p, q, r) => {
    const P = (i) => mesh.positions.slice(i * 3, i * 3 + 3);
    const [A, B, C] = [P(p), P(q), P(r)];
    const y = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]);
    if (y > 0) mesh.indices.push(p, q, r);
    else mesh.indices.push(p, r, q);
  };
  up(p0, p1, p2);
  up(p0, p2, p3);
  if (ramp.kind === "end") {
    // A side wall on each side: a triangle and a quad from the top edge down.
    for (const k of [1, -1]) {
      const a0 = push(ax + nx * k, bottom, az + nz * k);
      const a1 = push(ax + nx * k, ramp.h0, az + nz * k);
      const b0 = push(bx + nx * k, bottom, bz + nz * k);
      const b1 = push(bx + nx * k, ramp.h1, bz + nz * k);
      // Two sides, so the wall shows from each side.
      mesh.indices.push(a0, b0, b1, a0, b1, a1, a0, b1, b0, a0, a1, b1);
    }
  }
  return mesh;
}
