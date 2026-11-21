// Street junctions (#138): one clean surface where streets meet. Pure.
//
// The street strips of a level overlap where they meet, at the same height,
// so the render showed flicker (z-fighting) at the intersections. Here each
// street strip is split at its junction nodes, and each piece stops where
// it meets the other arms. One patch polygon fills the junction: the convex
// hull of the corners of the arm ends. The hull edge between two arms is a
// straight cut across the corner, as the curb return of a real corner.
//
// - A junction node is a node where 3 or more street arms meet (an end
//   point gives 1 arm, an inner point 2), or where 2 arms of two strips with
//   different names meet at an angle of 150 degrees or less.
// - An arm stops at the distance where its edges clear the edges of every
//   other arm (armTrim()).
// - Two strips that meet end to end with no junction (a joint) get a disk
//   at the joint, as at an inner point of a strip (extrude.js stripMesh()),
//   so a turn leaves no wedge.
// - A bridge deck and an approach end that a deck covers (bridges.js
//   approachTrims()) take no part.
//
// The patch is JOIN_LIFT over the street top, so where an arm still
// overlaps the patch (a short arm), the patch always draws on top. The
// physics sees the patch as a street (geo-ground.js), so no prop stands on
// the corner of a patch.

import { approachTrims, slicePolyline } from "./bridges.js";

export const JOIN_LIFT = 0.004; // m over the street top
const MIN_ANGLE = (15 * Math.PI) / 180;
const STRAIGHT = (170 * Math.PI) / 180;
const CORNER_ANGLE = (150 * Math.PI) / 180;

const key = (p) => `${p[0]},${p[1]}`;

function length(points) {
  let s = 0;
  for (let i = 0; i < points.length - 1; i += 1) s += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
  return s;
}

// The unit direction from p to the first point of `rest` that is 5 cm or
// more away from p.
function awayDir(p, rest) {
  for (const q of rest) {
    const dx = q[0] - p[0];
    const dz = q[1] - p[1];
    const l = Math.hypot(dx, dz);
    if (l >= 0.05) return [dx / l, dz / l];
  }
  return null;
}

// The distance from the node along arm i where the edges of arm i clear the
// edges of arm j. hi and hj are the half widths, and theta is the angle
// between the two arm directions (0 to pi). Two arms that go on in a near
// straight line do not overlap.
export function armTrim(hi, hj, theta) {
  if (theta >= STRAIGHT) return 0;
  const t = Math.max(MIN_ANGLE, theta);
  return Math.max(0, (hj + hi * Math.cos(t)) / Math.sin(t));
}

// The convex hull of 2D points, counterclockwise in (x, z).
export function convexHull(points) {
  const pts = [...new Map(points.map((p) => [`${p[0].toFixed(4)},${p[1].toFixed(4)}`, p])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (const p of pts.slice().reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

// The street junctions of a level:
// { pieces: [{ id, strip, points, width }], junctions: [{ id, x, z, ring }],
//   joints: [{ x, z, r }] }.
// `pieces` are the at-grade street strips, split at the junction nodes and
// trimmed there. A piece id is the strip id, or `<strip id>:<k>` when the
// strip has more than one piece. A strip with no junction keeps its points
// (and its approach trims). `flat`: true on a level with no terrain (no
// bridge decks).
// Cached by the strips array (the only part of the level it reads), so a
// copy of the level with other buildings reuses it (#190).
const JUNCTIONS = new WeakMap();
export function streetJunctions(level, { flat = false } = {}) {
  const key = level.strips ?? level;
  let byFlat = JUNCTIONS.get(key);
  if (!byFlat) JUNCTIONS.set(key, (byFlat = new Map()));
  if (!byFlat.has(flat)) byFlat.set(flat, buildJunctions(level, flat));
  return byFlat.get(flat);
}

function buildJunctions(level, flat) {
  const streets = (level.strips ?? []).filter((s) => s.kind === "street" && !(s.bridge && !flat));
  const trims = flat ? new Map() : approachTrims(level.strips ?? []);
  // The arms at each node.
  const nodes = new Map();
  const arm = (p, s, i, dir, path) => {
    if (!dir) return;
    const k = key(p);
    let n = nodes.get(k);
    if (!n) nodes.set(k, (n = { x: p[0], z: p[1], arms: [] }));
    n.arms.push({ strip: s, i, dir, half: s.width / 2, path: [p, ...path] });
  };
  for (const s of streets) {
    const P = s.points;
    const trim = trims.get(s.id);
    P.forEach((p, i) => {
      // An end that a bridge deck covers is not at the node any more.
      if (i === 0 && trim?.start > 0) return;
      if (i === P.length - 1 && trim?.end > 0) return;
      if (i > 0) arm(p, s, i, awayDir(p, P.slice(0, i).reverse()), P.slice(0, i).reverse());
      if (i < P.length - 1) arm(p, s, i, awayDir(p, P.slice(i + 1)), P.slice(i + 1));
    });
  }
  const isJunction = (n) => {
    if (n.arms.length >= 3) return true;
    if (n.arms.length !== 2) return false;
    const [a, b] = n.arms;
    if (a.strip.id === b.strip.id || (a.strip.name ?? "") === (b.strip.name ?? "")) return false;
    return Math.acos(Math.max(-1, Math.min(1, a.dir[0] * b.dir[0] + a.dir[1] * b.dir[1]))) <= CORNER_ANGLE;
  };
  const junctionKeys = new Set([...nodes].filter(([, n]) => isJunction(n)).map(([k]) => k));

  // The trim of each arm at each junction node.
  const trimAt = new Map(); // `${stripId}|${pointIndex}|${side}` -> m
  for (const k of junctionKeys) {
    const n = nodes.get(k);
    for (const a of n.arms) {
      let d = 0;
      for (const b of n.arms) {
        if (a === b) continue;
        const theta = Math.acos(Math.max(-1, Math.min(1, a.dir[0] * b.dir[0] + a.dir[1] * b.dir[1])));
        d = Math.max(d, armTrim(a.half, b.half, theta));
      }
      a.trim = d;
    }
  }

  const pieces = [];
  const ends = new Map(); // node key -> [{ point, dir, half }] the piece ends at the node
  for (const s of streets) {
    const P = s.points;
    const trim = trims.get(s.id);
    // Split at the inner junction nodes.
    const cuts = [0];
    for (let i = 1; i < P.length - 1; i += 1) if (junctionKeys.has(key(P[i]))) cuts.push(i);
    cuts.push(P.length - 1);
    const parts = [];
    for (let c = 0; c < cuts.length - 1; c += 1) parts.push({ i0: cuts[c], i1: cuts[c + 1] });
    for (const [k, part] of parts.entries()) {
      const pts = P.slice(part.i0, part.i1 + 1);
      const total = length(pts);
      const armOf = (i, toward) => nodes.get(key(P[i]))?.arms.find((a) => a.strip === s && a.i === i && Math.sign(a.dir[0] * toward[0] + a.dir[1] * toward[1]) > 0);
      let start = part.i0 === 0 ? (trim?.start ?? 0) : 0;
      let end = part.i1 === P.length - 1 ? (trim?.end ?? 0) : 0;
      const d0 = awayDir(pts[0], pts.slice(1));
      const d1 = awayDir(pts[pts.length - 1], pts.slice(0, -1).reverse());
      const atStart = junctionKeys.has(key(pts[0])) && d0 ? armOf(part.i0, d0) : null;
      const atEnd = junctionKeys.has(key(pts[pts.length - 1])) && d1 ? armOf(part.i1, d1) : null;
      if (atStart) start = atStart.trim;
      if (atEnd) end = atEnd.trim;
      // A short piece keeps at least a fifth of its length.
      if (start + end > total * 0.8) {
        const f = (total * 0.8) / (start + end);
        start *= f;
        end *= f;
      }
      const points = start > 0 || end > 0 ? slicePolyline(pts, start, total - end) : pts;
      const id = parts.length > 1 ? `${s.id}:${k}` : s.id;
      pieces.push({ id, strip: s, points, width: s.width });
      for (const [atNode, p, q] of [
        [atStart, points[0], points[1]],
        [atEnd, points[points.length - 1], points[points.length - 2]],
      ]) {
        if (!atNode) continue;
        const nk = atNode === atStart ? key(pts[0]) : key(pts[pts.length - 1]);
        const l = Math.hypot(p[0] - q[0], p[1] - q[1]) || 1;
        if (!ends.has(nk)) ends.set(nk, []);
        ends.get(nk).push({ point: p, dir: [(p[0] - q[0]) / l, (p[1] - q[1]) / l], half: s.width / 2 });
      }
    }
  }

  const junctions = [];
  for (const k of [...junctionKeys].sort()) {
    const n = nodes.get(k);
    // The node and the corners of each arm at the node: the hull then also
    // fills the outer wedge of a bend in a through street.
    const corners = [[n.x, n.z]];
    // Also the corners at each bend of an arm before its trim, so the hull
    // covers the outer side of the bend.
    for (const a of n.arms) {
      let acc = 0;
      for (let i = 0; i < a.path.length - 1 && acc < (a.trim ?? 0); i += 1) {
        const [px, pz] = a.path[i];
        const l = Math.hypot(a.path[i + 1][0] - px, a.path[i + 1][1] - pz);
        if (l < 0.05) continue;
        const nx = -(a.path[i + 1][1] - pz) / l;
        const nz = (a.path[i + 1][0] - px) / l;
        // The segment end, or the trim point on the segment.
        const f = Math.min(1, (a.trim - acc) / l);
        const qx = px + (a.path[i + 1][0] - px) * f;
        const qz = pz + (a.path[i + 1][1] - pz) * f;
        for (const [cx, cz] of [[px, pz], [qx, qz]]) corners.push([cx + nx * a.half, cz + nz * a.half], [cx - nx * a.half, cz - nz * a.half]);
        acc += l;
      }
    }
    for (const e of ends.get(k) ?? []) {
      // The end edge: the left normal of the direction toward the node.
      const nx = -e.dir[1];
      const nz = e.dir[0];
      corners.push([e.point[0] + nx * e.half, e.point[1] + nz * e.half], [e.point[0] - nx * e.half, e.point[1] - nz * e.half]);
    }
    const ring = convexHull(corners);
    if (ring.length >= 3) junctions.push({ id: `junction:${k}`, x: n.x, z: n.z, ring });
  }

  // The joints: two strip ends with no junction.
  const joints = [];
  for (const [k, n] of [...nodes].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (junctionKeys.has(k) || n.arms.length !== 2) continue;
    const [a, b] = n.arms;
    if (a.strip === b.strip) continue;
    // The narrower half width, so the disk never sticks out of the narrower strip.
    joints.push({ x: n.x, z: n.z, r: Math.min(a.half, b.half) });
  }
  return { pieces, junctions, joints };
}
