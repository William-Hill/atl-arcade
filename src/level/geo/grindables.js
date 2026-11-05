// The grindables of a geodata level (#136): the skate features on the
// sidewalks. Pure.
//
// - A bench at an OpenStreetMap bench (a street prop with an `osm` id) is a
//   ledge: the front edge of the seat, along the bench. Its id is
//   `ledge:bench:<OSM node id>`.
// - A curb is a ledge: the street side edge of each sidewalk piece
//   (curbs.js) that runs along a street, at the sidewalk height. Its id is
//   `ledge:curb:<OSM way id>:<k>`.
//
// A grindable is { id, kind, points: [[x, y, z]], total, box } for the
// grind system (src/sim/skate/grind.js). `box` is the ground box of the
// points, so the snap test skips a far grindable at once.

import { piecePoints, sidewalkLayout } from "./curbs.js";
import { terrainOf } from "./terrain.js";

export const GRIND_FEATURES = {
  // The seat of each bench model (m): its height, the half length of the
  // ledge along the bench (+x), and the seat edge offset to the front (+z).
  bench: { seat: 0.47, half: 0.8, front: 0.1 },
  bench_painted: { seat: 0.45, half: 0.5, front: 0.08 },
  curbStep: 2, // m between two points of a curb ledge
  curbMin: 6, // m, the shortest curb ledge
  curbProbe: 0.6, // m past the curb where a street must be
};

function box(points) {
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const [x, , z] of points) {
    b.minX = Math.min(b.minX, x);
    b.maxX = Math.max(b.maxX, x);
    b.minZ = Math.min(b.minZ, z);
    b.maxZ = Math.max(b.maxZ, z);
  }
  return b;
}

function total(points) {
  let s = 0;
  for (let i = 0; i < points.length - 1; i += 1) s += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1], points[i + 1][2] - points[i][2]);
  return s;
}

// The bench ledges: one for each street prop at an OSM bench.
export function benchLedges(level, props) {
  const t = terrainOf(level);
  const out = [];
  for (const p of props) {
    const f = GRIND_FEATURES[p.kind];
    if (!f || !p.osm || p.roof) continue;
    // The template +x is (cos yaw, -sin yaw), and +z (the front) is (sin yaw, cos yaw).
    const ax = Math.cos(p.yaw);
    const az = -Math.sin(p.yaw);
    const fx = Math.sin(p.yaw);
    const fz = Math.cos(p.yaw);
    const cx = p.x + fx * f.front;
    const cz = p.z + fz * f.front;
    const y = (t.flat ? 0 : t.height(p.x, p.z)) + f.seat;
    const points = [-1, 0, 1].map((k) => [cx + ax * f.half * k, y, cz + az * f.half * k]);
    out.push({ id: `ledge:bench:${p.osm}`, kind: "ledge", feature: p.osm, points, total: total(points), box: box(points) });
  }
  return out;
}

// The curb ledges: the street side edges of the sidewalk pieces.
// `isStreet(x, z)` is true on a street.
export function curbLedges(level, isStreet) {
  const t = terrainOf(level);
  const top = level.surfaces?.sidewalk ?? 0.15;
  const layout = sidewalkLayout(level);
  const out = [];
  for (const s of (level.strips ?? []).filter((x) => x.kind === "sidewalk" && !x.bridge).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const lay = layout.get(s.id);
    if (!lay) continue;
    let k = 0;
    for (const range of lay.pieces) {
      if (range[1] - range[0] < GRIND_FEATURES.curbMin) continue;
      const pts = piecePoints(s.points, range);
      for (const side of [1, -1]) {
        // Walk the edge each curbStep m; a run of points with a street
        // past the edge is one ledge.
        let run = [];
        const flush = () => {
          if (run.length >= 2 && total(run) >= GRIND_FEATURES.curbMin) {
            out.push({ id: `ledge:curb:${s.id}:${k}`, kind: "ledge", feature: s.id, points: run, total: total(run), box: box(run) });
            k += 1;
          }
          run = [];
        };
        for (let i = 0; i < pts.length - 1; i += 1) {
          const [ax, az] = pts[i];
          const [bx, bz] = pts[i + 1];
          const len = Math.hypot(bx - ax, bz - az);
          if (len < 1e-6) continue;
          const nx = (-(bz - az) / len) * side;
          const nz = ((bx - ax) / len) * side;
          const n = Math.max(1, Math.round(len / GRIND_FEATURES.curbStep));
          for (let j = i === 0 ? 0 : 1; j <= n; j += 1) {
            const x = ax + ((bx - ax) * j) / n + nx * (s.width / 2);
            const z = az + ((bz - az) * j) / n + nz * (s.width / 2);
            if (isStreet(x + nx * GRIND_FEATURES.curbProbe, z + nz * GRIND_FEATURES.curbProbe)) run.push([x, (t.flat ? 0 : t.height(x, z)) + top, z]);
            else flush();
          }
        }
        flush();
      }
    }
  }
  return out;
}
