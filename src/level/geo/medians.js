// The medians of the divided roads (#138). Pure.
//
// A divided road is two one-way strips of the same name side by side
// (markings.js medianSide()), as John Lewis Freedom Parkway and Ponce de
// Leon Ave. The OSM center lines of the two carriageways are about 12 m
// apart, and each strip is 14 m wide, so the two strips overlap. The lanes
// (markings.js laneLayout()) use only the middle of each strip. The median
// is the band between the two yellow edge lines on the median side, less a
// clear margin: a raised grass island with a concrete curb, at the
// sidewalk height. The skater sees it as a curb (geo-ground.js), and a tree
// stands on it each MEDIAN.treeStep m where it is wide enough (props.js).

import { laneLayout, medianSide } from "./lanes.js";
import { flatPolygon, stripMesh } from "./extrude.js";
import { ribbonEdges } from "./bridges.js";

export const MEDIAN = {
  step: 3, // m between two samples of the median along the strip
  margin: 0.45, // m from the yellow edge line to the median curb
  minWidth: 1.2, // m, the narrowest median
  maxGap: 30, // m, a wider gap between two center lines is not one road
  treeStep: 18, // m between two median trees
  treeWidth: 2.4, // m, the narrowest median with trees
  rim: 0.25, // m, the width of the concrete curb on each side
};

// The nearest point on a polyline to (x, z): { x, z, d }.
function nearest(points, x, z) {
  let best = null;
  for (let i = 0; i < points.length - 1; i += 1) {
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    const l2 = (bx - ax) ** 2 + (bz - az) ** 2;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / l2)) : 0;
    const px = ax + (bx - ax) * t;
    const pz = az + (bz - az) * t;
    const d = Math.hypot(px - x, pz - z);
    if (!best || d < best.d) best = { x: px, z: pz, d };
  }
  return best;
}

// The offset of the median-side lane edge from the strip center line (m,
// positive): the outer side of the yellow edge line.
function laneEdge(s, side) {
  const L = laneLayout(s, true);
  const e = side > 0 ? L.edges[1] : -L.edges[0];
  return e + 0.06;
}

// The medians of a level: [{ id, strip, twin, points, width }]. Each median
// is a run of center points (one each MEDIAN.step m) with the narrowest
// width of the run. Only the strip with the lower id of a pair makes the
// median, so a median is not made twice. A run stops where the median is
// narrower than MEDIAN.minWidth, 6 m before a junction node, and at a
// bridge.
const MEDIANS = new WeakMap();
export function medianStrips(level) {
  if (!MEDIANS.has(level)) MEDIANS.set(level, buildMedians(level));
  return MEDIANS.get(level);
}

function buildMedians(level) {
  const streets = (level.strips ?? []).filter((s) => s.kind === "street" && !s.bridge);
  // The nodes with 3 or more strips, or with a strip of another name: a
  // median stops before them.
  const nodeStrips = new Map();
  for (const s of level.strips ?? []) {
    if (s.kind !== "street") continue;
    for (const p of s.points) {
      const k = `${p[0]},${p[1]}`;
      if (!nodeStrips.has(k)) nodeStrips.set(k, new Set());
      nodeStrips.get(k).add(s);
    }
  }
  const junctions = [];
  for (const [k, set] of nodeStrips) {
    const list = [...set];
    if (list.length >= 3 || list.some((o) => o.name !== list[0].name) || list.some((o) => o.bridge)) junctions.push(k.split(",").map(Number));
  }
  const out = [];
  const sides = new Map(streets.map((s) => [s.id, medianSide(s, streets)]));
  for (const s of streets.slice().sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const side = sides.get(s.id);
    if (side === 0) continue;
    const twins = streets.filter((o) => o.id !== s.id && o.name === s.name);
    const eS = laneEdge(s, side);
    let run = null;
    const flush = () => {
      if (run && run.points.length >= 3) out.push({ id: `median:${s.id}:${out.filter((m) => m.strip === s.id).length}`, strip: s.id, twin: run.twin, points: run.points, width: Math.min(...run.widths) });
      run = null;
    };
    let acc = 0;
    let next = 0;
    for (let i = 0; i < s.points.length - 1; i += 1) {
      const [ax, az] = s.points[i];
      const [bx, bz] = s.points[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-6) continue;
      const dx = (bx - ax) / len;
      const dz = (bz - az) / len;
      while (next <= acc + len) {
        const t = next - acc;
        next += MEDIAN.step;
        const px = ax + dx * t;
        const pz = az + dz * t;
        const nx = -dz * side;
        const nz = dx * side;
        let best = null;
        for (const o of twins) {
          const q = nearest(o.points, px, pz);
          if (!q || (q.x - px) * nx + (q.z - pz) * nz <= 0) continue;
          if (!best || q.d < best.d) best = { ...q, o };
        }
        const nearJunction = junctions.some(([jx, jz]) => Math.hypot(jx - px, jz - pz) < 6 + s.width);
        if (!best || best.d > MEDIAN.maxGap || nearJunction || (run && run.twin !== best.o.id) || (best.o.id < s.id && sides.get(best.o.id) !== 0)) {
          flush();
          continue;
        }
        // The twin's median side is toward this strip.
        const eT = laneEdge(best.o, sides.get(best.o.id) || 1);
        const lo = eS + MEDIAN.margin;
        const hi = best.d - eT - MEDIAN.margin;
        const width = hi - lo;
        if (width < MEDIAN.minWidth) {
          flush();
          continue;
        }
        const o = (lo + hi) / 2;
        if (!run) run = { twin: best.o.id, points: [], widths: [] };
        run.points.push([px + nx * o, pz + nz * o]);
        run.widths.push(width);
      }
      acc += len;
    }
    flush();
  }
  return out;
}

// The tree spots on the medians: [{ x, z, median }], each MEDIAN.treeStep m
// along a median that is MEDIAN.treeWidth m or wider.
export function medianSpots(level, medians = medianStrips(level)) {
  const out = [];
  for (const m of medians) {
    if (m.width < MEDIAN.treeWidth) continue;
    let acc = 0;
    let next = MEDIAN.treeStep / 2;
    for (let i = 0; i < m.points.length - 1; i += 1) {
      const [ax, az] = m.points[i];
      const [bx, bz] = m.points[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      while (next <= acc + len) {
        const t = (next - acc) / (len || 1);
        out.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, median: m.id });
        next += MEDIAN.treeStep;
      }
      acc += len;
    }
  }
  return out;
}

// The mesh of one median (flat, not draped): the grass top at `top`, a
// curb wall down to the street on each side, and a concrete rim on each
// edge of the top. `colors` is { grass, curb }.
export function medianMesh(m, top, colors) {
  const mesh = stripMesh(m.points, m.width, top, { curb: true, bottom: 0, color: colors.grass });
  for (const side of [1, -1]) {
    const { left, right } = ribbonEdges(m.points, MEDIAN.rim / 2, side * (m.width / 2 - MEDIAN.rim / 2));
    // One quad per segment, so a bend keeps its miter (no fold).
    for (let i = 0; i < left.length - 1; i += 1) flatPolygon([left[i], left[i + 1], right[i + 1], right[i]], [], top + 0.003, { color: colors.curb, mesh });
  }
  return mesh;
}
