// Road markings for a geodata level. Pure.
//
// - A double yellow center line on the main streets (trunk, primary,
//   secondary, tertiary), as on Ponce de Leon Ave, North Ave, and Ralph
//   McGill Blvd. Residential streets have no center line, as in Atlanta.
// - A white zebra crosswalk on each street arm at each intersection of two
//   named streets.
// A center line stops short of every node that its street shares with a
// street that is not a service road, so no line crosses an intersection.
// It goes on past a driveway or an alley, as on a real street.
//
// The output is a list of meshes { tile, mesh: { positions, indices,
// colors } }, one per GEO_TILE square, with the tile keys of
// buildGeoMeshes(). The view merges each tile into the render mesh of its
// surface tile, so the markings cost no draw call. The markings are a few
// cm over the street top. They are a visual only; the ground sampler and
// the physics do not see them.

import { streetIntersections } from "./signs.js";
import { GEO_TILE } from "./geo-mesh.js";

export const MARKING_COLORS = {
  yellow: [0.96, 0.74, 0.16],
  white: [0.94, 0.94, 0.9],
};
const LIFT = 0.02; // m over the street top
const MAIN = new Set(["trunk", "primary", "secondary", "tertiary"]);
const LINE_W = 0.11;
const LINE_GAP = 0.11;
const CLEAR = 2; // m past the cross street edge

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

// A line along a polyline, offset sideways by `offset`, with the parts in
// `cuts` ([{ x, z, r }]) left out.
function line(mesh, points, y, offset, width, cuts, color) {
  for (let i = 0; i < points.length - 1; i += 1) {
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) continue;
    const dx = (bx - ax) / len;
    const dz = (bz - az) / len;
    // Find the kept ranges [t0, t1] on this segment.
    let ranges = [[0, len]];
    for (const c of cuts) {
      // The part of the segment inside the circle.
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
        const out = [];
        if (t0 > r0) out.push([r0, t0]);
        if (t1 < r1) out.push([t1, r1]);
        return out;
      });
    }
    const nx = -dz * offset;
    const nz = dx * offset;
    for (const [t0, t1] of ranges) {
      if (t1 - t0 < 0.3) continue;
      const mid = (t0 + t1) / 2;
      rect(mesh, ax + dx * mid + nx, az + dz * mid + nz, y, dx, dz, t1 - t0, width, color);
    }
  }
}

export function roadMarkings(level) {
  const mesh = { positions: [], indices: [], colors: [] };
  const streetTop = level.surfaces?.street ?? 0;
  const y = streetTop + LIFT;
  const streets = (level.strips ?? []).filter((s) => s.kind === "street");

  // The street strips at each node.
  const nodes = new Map();
  for (const s of streets) {
    for (const p of s.points) {
      const key = `${p[0]},${p[1]}`;
      const n = nodes.get(key) ?? { x: p[0], z: p[1], strips: new Map() };
      n.strips.set(s.id, s);
      nodes.set(key, n);
    }
  }

  for (const s of streets) {
    if (!MAIN.has(s.highway)) continue;
    // A one-lane ramp or a divided carriageway (under 9 m) has no center line.
    if (s.width < 9) continue;
    // Cut the line at each cross street: past the cross street's edge.
    const cuts = [];
    for (const p of s.points) {
      const n = nodes.get(`${p[0]},${p[1]}`);
      const others = [...n.strips.values()].filter((o) => o.id !== s.id && o.highway !== "service" && o.name !== s.name);
      if (others.length) cuts.push({ x: n.x, z: n.z, r: Math.max(...others.map((o) => o.width / 2)) + CLEAR });
    }
    for (const side of [1, -1]) line(mesh, s.points, y, side * (LINE_GAP / 2 + LINE_W / 2), LINE_W, cuts, MARKING_COLORS.yellow);
  }

  // Zebra crosswalks: bars across each street arm, past the cross street.
  for (const ix of streetIntersections(level)) {
    // The intersection names are the sign names (the city name when the
    // build has one, #78), so match on the same name. Use only the strips
    // through this node, so a wider part of the same street far away does
    // not move the crosswalk. If no strip has the node, use all strips with
    // the name.
    const named = (name) => streets.filter((s) => (s.signName ?? s.name) === name);
    const widthOf = (name) => {
      const all = named(name);
      const here = all.filter((s) => s.points.some(([x, z]) => x === ix.x && z === ix.z));
      return Math.max(...(here.length ? here : all).map((s) => s.width));
    };
    for (let k = 0; k < 2; k += 1) {
      const [dx, dz] = ix.dirs[k];
      const w = widthOf(ix.names[k]);
      const crossHalf = widthOf(ix.names[1 - k]) / 2;
      const nx = -dz;
      const nz = dx;
      for (const dir of [1, -1]) {
        const d = crossHalf + 1.8;
        const cx = ix.x + dx * d * dir;
        const cz = ix.z + dz * d * dir;
        const bars = Math.max(2, Math.floor((w - 0.6) / 0.9));
        for (let b = 0; b < bars; b += 1) {
          const o = (b - (bars - 1) / 2) * 0.9;
          // A bar is 2.4 m along the street and 0.45 m across it.
          rect(mesh, cx + nx * o, cz + nz * o, y, dx, dz, 2.4, 0.45, MARKING_COLORS.white);
        }
      }
    }
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
