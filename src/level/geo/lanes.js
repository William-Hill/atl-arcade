// The lanes of a street (#138): the lane count, the lane lines, the edge
// lines, the bike lanes, and the median side of a divided road. Pure, with
// no import of the mesh modules, so markings.js, medians.js, and curbs.js
// can all use it.

import { streetIntersections } from "./signs.js";

export const MAIN = new Set(["trunk", "primary", "secondary", "tertiary"]);
export const EDGE = new Set([...MAIN, "residential"]);
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
  laneMax: 3.6, // m, the widest lane when the lane count comes from the OSM tags
  bike: 1.5, // m, the width of a bike lane
  arrowBack: 3, // m from the stop bar (or the line cut) to the arrow head
  manholeEvery: 45, // m between manhole covers (mean)
  patchEvery: 70, // m between asphalt patches (mean)
};
const S = MARKING_SIZES;

// The lanes of a street: { lane, backward, forward, center, lines, edges,
// bikes }. Offsets are to the right of the strip direction (the normal
// (-dz, dx)). `center` is the offset of the line between the two
// directions (null on a one-way street), `lines` the offsets of the dashed
// lane lines, `edges` the offsets of the two edge line centers (left,
// right), and `bikes` the bike lanes [{ offset, width }]. A forward lane k
// (0 is the leftmost in the travel direction) has its center at
// center + (k + 0.5) * lane, and a backward lane k at center - (k + 0.5) * lane.
export function laneLayout(s, oneway = Boolean(s.oneway)) {
  const inner = s.width / 2 - S.curb;
  const bikeL = s.cycleway === "left" || s.cycleway === "both";
  const bikeR = s.cycleway === "right" || s.cycleway === "both";
  const tagged = Boolean(s.lanes || s.lanesForward || s.lanesBackward);
  const lo = -inner + (bikeL ? S.bike : 0) + S.edgeInset;
  const hi = inner - (bikeR ? S.bike : 0) - S.edgeInset;
  const bikes = [];
  if (bikeL) bikes.push({ offset: -inner + S.bike / 2, width: S.bike });
  if (bikeR) bikes.push({ offset: inner - S.bike / 2, width: S.bike });
  if (!tagged && !bikeL && !bikeR) {
    // No tag: the lanes fill the street, as before #138.
    const n = Math.floor(s.width / S.lane);
    const lane = oneway ? s.width / Math.max(1, n) : s.width / 2 / Math.max(1, Math.floor(n / 2));
    const e = edgeLineOffset(s.width);
    return { lane, backward: oneway ? 0 : Math.floor(n / 2), forward: oneway ? n : Math.floor(n / 2), center: oneway ? null : 0, lines: laneLineOffsets({ width: s.width, oneway }), edges: [-e, e], bikes };
  }
  let forward;
  let backward;
  const n0 = Math.max(1, Math.floor(s.width / S.lane));
  const n = s.lanes ?? ((s.lanesForward ?? 0) + (s.lanesBackward ?? 0) || (oneway ? n0 : 2 * Math.max(1, Math.floor(n0 / 2))));
  if (oneway) {
    forward = n;
    backward = 0;
  } else {
    forward = s.lanesForward ?? (s.lanesBackward !== undefined ? n - s.lanesBackward : Math.ceil(n / 2));
    backward = s.lanesBackward ?? Math.max(0, n - forward);
  }
  forward = Math.max(forward, backward === 0 ? 1 : 0);
  const total = forward + backward;
  const lane = Math.min(tagged ? S.laneMax : Infinity, (hi - lo) / total);
  const g0 = (lo + hi) / 2 - (total * lane) / 2;
  const center = backward > 0 && forward > 0 ? g0 + backward * lane : null;
  const lines = [];
  for (let k = 1; k < backward; k += 1) lines.push(g0 + k * lane);
  for (let k = 1; k < forward; k += 1) lines.push(g0 + (backward + k) * lane);
  const edges = [g0 + S.edgeLine / 2, g0 + total * lane - S.edgeLine / 2];
  return { lane, backward, forward, center: center ?? (oneway ? null : g0), lines, edges, bikes };
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


// The crosswalks of a level: one for each street arm at each intersection
// of two named streets, past the cross street:
// [{ x, z, name, dx, dz, w, crossHalf, oneway, at }]. (x, z) is the node,
// (dx, dz) the arm direction, w the width of the crossed street (the arm),
// crossHalf the half width of the other street, and `at` the distance of
// the crosswalk center from the node.
export function crosswalksOf(level, streets = (level.strips ?? []).filter((s) => s.kind === "street"), isOneway = null) {
  const oneway = isOneway ?? ((s) => Boolean(s.oneway) || medianSide(s, streets) !== 0);
  const out = [];
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
      const ow = stripsOf(ix.names[k]).some(oneway);
      for (const dir of [1, -1]) out.push({ x: ix.x, z: ix.z, name: ix.names[k], dx: dx * dir, dz: dz * dir, w, crossHalf, oneway: ow, at: crossHalf + S.crossOut });
    }
  }
  return out;
}
