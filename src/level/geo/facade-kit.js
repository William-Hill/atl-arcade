// The facade kit: real geometry on the building boxes. Pure.
//
// - A cornice: a ledge that sticks out under the parapet.
// - A coping: a thin cap that sticks out on top of the parapet.
// - A belt course: a ledge over the ground floor of a storefront style.
// - A pitched (gable) roof on a house with a near-rectangular footprint.
// - A sill under each upper-floor window, at the window that the facade
//   shader paints, so the wall has real depth.
// - Piers between the storefront bays on the ground floor.
//
// The output is a list of meshes { tile, mesh: { positions, indices,
// colors, facade } }, one per GEO_TILE square, with the building tile keys
// of buildGeoMeshes(). The view merges each tile into the render mesh of
// its building tile, so the kit costs no draw call. The physics does not see
// the kit: the colliders stay the plain boxes.
//
// The sills and the piers are many small boxes (about 740k triangles on the
// BeltLine level). They go in a second list, `depthTiles`, one mesh per
// DEPTH_TILE square, so the view draws only the squares near the camera.
//
// The faces do not share vertices, so each face gets its own flat normal.

import { FACE, orientRing } from "./extrude.js";
import { GEO_TILE } from "./geo-mesh.js";
import { STYLES, STYLE_INDEX, chooseStyle, hash32, wallColor } from "./styles.js";
import { buildingSpan } from "./terrain.js";

export const KIT = {
  cornice: { out: 0.35, height: 0.5, minParapet: 0.5 },
  coping: { out: 0.1, height: 0.14 },
  belt: { out: 0.18, height: 0.28 },
  roof: { pitch: (32 * Math.PI) / 180, overhang: 0.45, maxSpan: 16, minFill: 0.72, maxHeight: 12 },
  // A sill is a small box under a window. A wall shorter than minWall
  // gets no sills (OSM rings have many short corner edges).
  sill: { out: 0.12, height: 0.1, overhang: 0.06, minWall: 1.5 },
  // A pier is a box between two storefront bays, under the belt course.
  pier: { out: 0.16, width: 0.36 },
  // A miter longer than this many offsets is cut off (a sharp corner).
  miterLimit: 3,
};
// A curtain wall and an open parking deck have no sills.
const NO_SILLS = new Set(["glass-office", "parking-deck"]);
// The window frame of the facade shader is 0.07 cells wider and taller than
// the glass, and an upper-floor window is centered at 0.55 of the floor.
const FRAME = 0.07;
const WINDOW_CENTER = 0.55;
// The square size of the depth tiles, in meters.
export const DEPTH_TILE = 50;
const HOUSES = new Set(["craftsman-house", "shotgun-house"]);
// Shingle colors: slate, warm brown, and dark green, as on Inman Park houses.
const SHINGLES = [
  [0.3, 0.32, 0.36],
  [0.42, 0.3, 0.24],
  [0.26, 0.36, 0.3],
  [0.48, 0.24, 0.2],
];

function emptyMesh(normals = false) {
  const m = { positions: [], indices: [], colors: [], facade: [] };
  if (normals) m.normals = [];
  return m;
}

// The shading normals of a soft box: the top tilts SOFT_TOP up from the
// wall normal, the bottom tilts down, and the ends tilt SOFT_END toward the
// wall line. The ink pass draws a crease only past about 49 degrees, so a
// soft box gets no ink on its own edges or at the wall. A sill is under
// 2 px tall at 30 m, and ink on both of its edges made it a dashed black
// line.
const SOFT_TOP = (40 * Math.PI) / 180;
const SOFT_END = (32 * Math.PI) / 180;

// A flat quad a-b-c-d with its front face toward `normal` ([x, y, z]).
// A mesh with a `normals` array also gets a shading normal: `shade`, or the
// unit `normal`.
function quad(m, a, b, c, d, color, normal, style, shade = null) {
  const base = m.positions.length / 3;
  let sn = shade;
  if (m.normals && !sn) {
    const l = Math.hypot(normal[0], normal[1], normal[2]) || 1;
    sn = [normal[0] / l, normal[1] / l, normal[2] / l];
  }
  for (const p of [a, b, c, d]) {
    m.positions.push(p[0], p[1], p[2]);
    m.colors.push(color[0], color[1], color[2]);
    m.facade.push(style, 0, 0, FACE.cornice);
    if (m.normals) m.normals.push(sn[0], sn[1], sn[2]);
  }
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  if (nx * normal[0] + ny * normal[1] + nz * normal[2] >= 0) m.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  else m.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
}

function tri(m, a, b, c, color, normal, style) {
  quad(m, a, b, c, c, color, normal, style);
  // The second triangle of a quad with c = d has no area; drop it.
  m.indices.length -= 3;
}

// The ring moved out by `d` meters. Each vertex moves along its corner
// bisector (a miter), and the miter is limited at a sharp corner. The ring
// must have the outer winding of orientRing().
export function offsetRing(ring, d) {
  const n = ring.length;
  const out = [];
  // The outward normal of edge i (from ring[i] to ring[i + 1]).
  const normals = [];
  for (let i = 0; i < n; i += 1) {
    const [px, pz] = ring[i];
    const [qx, qz] = ring[(i + 1) % n];
    const len = Math.hypot(qx - px, qz - pz) || 1;
    // orientRing() gives the outer ring a negative signed area, so the
    // outward normal of an edge is (-dz, dx).
    normals.push([-(qz - pz) / len, (qx - px) / len]);
  }
  for (let i = 0; i < n; i += 1) {
    const a = normals[(i - 1 + n) % n];
    const b = normals[i];
    let mx = a[0] + b[0];
    let mz = a[1] + b[1];
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) {
      mx = b[0];
      mz = b[1];
    } else {
      mx /= ml;
      mz /= ml;
    }
    const cos = mx * b[0] + mz * b[1];
    const k = Math.min(KIT.miterLimit, 1 / Math.max(cos, 1e-3));
    out.push([ring[i][0] + mx * d * k, ring[i][1] + mz * d * k]);
  }
  return out;
}

// A ledge around a ring: the outer face, the top, and the bottom, from y0
// to y1, sticking out by `out`.
export function ledge(m, ring, y0, y1, out, color, style) {
  const o = offsetRing(ring, out);
  const n = ring.length;
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const [px, pz] = o[i];
    const [qx, qz] = o[j];
    const len = Math.hypot(qx - px, qz - pz) || 1;
    const nrm = [-(qz - pz) / len, 0, (qx - px) / len];
    quad(m, [px, y0, pz], [qx, y0, qz], [qx, y1, qz], [px, y1, pz], color, nrm, style);
    const [ax, az] = ring[i];
    const [bx, bz] = ring[j];
    quad(m, [ax, y1, az], [bx, y1, bz], [qx, y1, qz], [px, y1, pz], color, [0, 1, 0], style);
    quad(m, [ax, y0, az], [bx, y0, bz], [qx, y0, qz], [px, y0, pz], color, [0, -1, 0], style);
  }
}

// A box on a wall: `o` is the wall start [x, z], `t` the unit vector along
// the wall, and `n` the unit outward normal. The box runs from a0 to a1
// along the wall and from y0 to y1, and sticks out by `out`. The back face
// is on the wall and is not built. `bottom` adds the bottom face.
//
// With `soft`, a mesh with normals gets the soft shading normals above.
export function wallBox(m, o, t, n, a0, a1, y0, y1, out, color, style, bottom = true, soft = false) {
  const at = (a, y, d) => [o[0] + t[0] * a + n[0] * d, y, o[1] + t[1] * a + n[1] * d];
  const front = [n[0], 0, n[1]];
  const ct = Math.cos(SOFT_TOP);
  const st = Math.sin(SOFT_TOP);
  const ce = Math.cos(SOFT_END);
  const se = Math.sin(SOFT_END);
  const s = soft
    ? {
        top: [n[0] * ct, st, n[1] * ct],
        bottom: [n[0] * ct, -st, n[1] * ct],
        start: [n[0] * ce - t[0] * se, 0, n[1] * ce - t[1] * se],
        end: [n[0] * ce + t[0] * se, 0, n[1] * ce + t[1] * se],
      }
    : {};
  quad(m, at(a0, y0, out), at(a1, y0, out), at(a1, y1, out), at(a0, y1, out), color, front, style);
  quad(m, at(a0, y1, 0), at(a1, y1, 0), at(a1, y1, out), at(a0, y1, out), color, [0, 1, 0], style, s.top);
  if (bottom) quad(m, at(a0, y0, 0), at(a1, y0, 0), at(a1, y0, out), at(a0, y0, out), color, [0, -1, 0], style, s.bottom);
  quad(m, at(a0, y0, 0), at(a0, y0, out), at(a0, y1, out), at(a0, y1, 0), color, [-t[0], 0, -t[1]], style, s.start);
  quad(m, at(a1, y0, 0), at(a1, y0, out), at(a1, y1, out), at(a1, y1, 0), color, [t[0], 0, t[1]], style, s.end);
}

// The sills and the storefront piers on the outer walls of one building.
// The bays and the floors are the same as in extrudeFootprint(), so each
// sill is under a window of the facade shader. The walls go from `base` to
// `top` (buildingSpan() in terrain.js). Returns { sill, pier }.
export function wallDepth(m, ring, top, style, si, base = 0) {
  const counts = { sill: 0, pier: 0 };
  const floors = Math.max(1, Math.round((top - base) / style.floorHeight));
  const floorH = (top - base) / floors;
  const sills = !NO_SILLS.has(style.id);
  const piers = style.storefront && floors >= 2;
  const [ww, wh] = style.window;
  for (let i = 0; i < ring.length; i += 1) {
    const [px, pz] = ring[i];
    const [qx, qz] = ring[(i + 1) % ring.length];
    const len = Math.hypot(qx - px, qz - pz);
    if (len < KIT.sill.minWall) continue;
    const t = [(qx - px) / len, (qz - pz) / len];
    // The outward normal of an outer ring edge is (-dz, dx); see offsetRing().
    const n = [-t[1], t[0]];
    const bays = Math.max(1, Math.round(len / style.bay));
    const bl = len / bays;
    if (sills) {
      const half = Math.min(((ww + FRAME) / 2) * bl + KIT.sill.overhang, bl / 2 - 0.02);
      // The ground floor of a storefront style is the shop window: no sill.
      for (let level = style.storefront ? 1 : 0; level < floors; level += 1) {
        const y = base + (level + WINDOW_CENTER - (wh + FRAME) / 2) * floorH;
        for (let k = 0; k < bays; k += 1) {
          const c = (k + 0.5) * bl;
          wallBox(m, [px, pz], t, n, c - half, c + half, y - KIT.sill.height, y, KIT.sill.out, style.trim, si, true, true);
          counts.sill += 1;
        }
      }
    }
    if (piers && len >= KIT.pier.width * 2) {
      const w = KIT.pier.width / 2;
      // The top of a pier is under the belt course.
      const y1 = base + floorH - KIT.belt.height / 2;
      for (let k = 0; k <= bays; k += 1) {
        const c = Math.min(Math.max(k * bl, w), len - w);
        wallBox(m, [px, pz], t, n, c - w, c + w, base, y1, KIT.pier.out, style.trim, si, false);
        counts.pier += 1;
      }
    }
  }
  return counts;
}

// The smallest rectangle around the ring, with one side on a ring edge:
// { cx, cz, ux, uz, long, short, area }. (ux, uz) is the long axis.
export function minRect(ring) {
  let best = null;
  for (let i = 0; i < ring.length; i += 1) {
    const [px, pz] = ring[i];
    const [qx, qz] = ring[(i + 1) % ring.length];
    const len = Math.hypot(qx - px, qz - pz);
    if (len < 1e-6) continue;
    const ux = (qx - px) / len;
    const uz = (qz - pz) / len;
    let a0 = Infinity;
    let a1 = -Infinity;
    let b0 = Infinity;
    let b1 = -Infinity;
    for (const [x, z] of ring) {
      const a = x * ux + z * uz;
      const b = -x * uz + z * ux;
      a0 = Math.min(a0, a);
      a1 = Math.max(a1, a);
      b0 = Math.min(b0, b);
      b1 = Math.max(b1, b);
    }
    const area = (a1 - a0) * (b1 - b0);
    if (!best || area < best.area) {
      const ca = (a0 + a1) / 2;
      const cb = (b0 + b1) / 2;
      const r = { cx: ca * ux - cb * uz, cz: ca * uz + cb * ux, ux, uz, long: a1 - a0, short: b1 - b0, area };
      if (r.short > r.long) {
        // Turn the axis so (ux, uz) is the long side.
        r.ux = -uz;
        r.uz = ux;
        [r.long, r.short] = [r.short, r.long];
      }
      best = r;
    }
  }
  return best;
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x0, z0] = ring[i];
    const [x1, z1] = ring[(i + 1) % ring.length];
    a += x0 * z1 - x1 * z0;
  }
  return Math.abs(a / 2);
}

// A gable roof over the footprint's rectangle, with the ridge on the long
// axis. Returns false when the footprint is not near a rectangle or is too
// wide for a house roof.
export function gableRoof(m, ring, top, wall, shingle, style) {
  const r = minRect(ring);
  if (!r || r.short > KIT.roof.maxSpan || ringArea(ring) / r.area < KIT.roof.minFill) return false;
  const oh = KIT.roof.overhang;
  const hl = r.long / 2 + oh;
  const hs = r.short / 2 + oh;
  const rise = (r.short / 2) * Math.tan(KIT.roof.pitch);
  // The eave drops below the wall top by the overhang slope, as on a real
  // house, so the roof edge covers the wall top.
  const eave = top - oh * Math.tan(KIT.roof.pitch);
  const ridge = top + rise;
  const { cx, cz, ux, uz } = r;
  const vx = -uz;
  const vz = ux;
  const at = (a, b, y) => [cx + ux * a + vx * b, y, cz + uz * a + vz * b];
  const e0 = at(-hl, -hs, eave);
  const e1 = at(hl, -hs, eave);
  const e2 = at(hl, hs, eave);
  const e3 = at(-hl, hs, eave);
  const r0 = at(-hl, 0, ridge);
  const r1 = at(hl, 0, ridge);
  const slope = Math.cos(KIT.roof.pitch);
  quad(m, e0, e1, r1, r0, shingle, [-vx * slope, 1, -vz * slope], style);
  quad(m, e3, e2, r1, r0, shingle, [vx * slope, 1, vz * slope], style);
  // The soffit under each eave overhang is left open: it is hidden from the
  // street. The two gable ends are wall color, at the wall line.
  const g0 = at(-r.long / 2, -r.short / 2, top);
  const g1 = at(-r.long / 2, r.short / 2, top);
  const g2 = at(-r.long / 2, 0, ridge);
  tri(m, g0, g1, g2, wall, [-ux, 0, -uz], style);
  const g3 = at(r.long / 2, -r.short / 2, top);
  const g4 = at(r.long / 2, r.short / 2, top);
  const g5 = at(r.long / 2, 0, ridge);
  tri(m, g3, g4, g5, wall, [ux, 0, uz], style);
  // The underside of each slope, so the roof shows no hole from below.
  quad(m, e0, e1, r1, r0, shingle, [vx, -1, vz], style);
  quad(m, e3, e2, r1, r0, shingle, [-vx, -1, -vz], style);
  return true;
}

// The kit parts for one building, into mesh `m`. Returns the part counts.
// `span` ({ base, top }, src/level/geo/terrain.js) is where the walls stand;
// without it the building stands on y = 0. The sills and the piers go into
// mesh `depth` (by default `m`).
export function buildingKit(m, b, span = { base: 0, top: b.height }, depth = m) {
  const style = STYLES[STYLE_INDEX[chooseStyle(b)]];
  const si = STYLE_INDEX[style.id];
  const ring = orientRing(b.outer, false);
  const counts = { cornice: 0, coping: 0, belt: 0, roof: 0, sill: 0, pier: 0 };
  if (ring.length < 3 || !(b.height > 0)) return counts;
  const { base, top } = span;
  // The same floor count as extrudeFootprint(), so the belt course sits on
  // the line of the facade floors.
  const floors = Math.max(1, Math.round((top - base) / style.floorHeight));
  const floorH = (top - base) / floors;
  const d = wallDepth(depth, ring, top, style, si, base);
  counts.sill = d.sill;
  counts.pier = d.pier;
  if (HOUSES.has(style.id) && b.height <= KIT.roof.maxHeight) {
    const shingle = SHINGLES[hash32(`${b.id}:roof`) % SHINGLES.length];
    if (gableRoof(m, ring, top, wallColor(style, b.id), shingle, si)) counts.roof = 1;
    return counts;
  }
  const p = style.parapet ?? 0;
  if (p >= KIT.cornice.minParapet && b.height > 5) {
    ledge(m, ring, top - KIT.cornice.height, top, KIT.cornice.out, style.trim, si);
    counts.cornice = 1;
  }
  if (p > 0) {
    ledge(m, ring, top + p, top + p + KIT.coping.height, KIT.coping.out, style.trim, si);
    counts.coping = 1;
  }
  if (style.storefront && floors >= 2) {
    const y = base + floorH - KIT.belt.height / 2;
    ledge(m, ring, y, y + KIT.belt.height, KIT.belt.out, style.trim, si);
    counts.belt = 1;
  }
  return counts;
}

function packMesh(m) {
  const out = { positions: Float32Array.from(m.positions), indices: Uint32Array.from(m.indices), colors: Float32Array.from(m.colors), facade: Float32Array.from(m.facade) };
  if (m.normals) out.normals = Float32Array.from(m.normals);
  return out;
}

// Returns { tiles: [{ tile, mesh }], one per building tile; depthTiles:
// [{ tile, center: [x, z], mesh }], one per DEPTH_TILE square; counts }.
export function facadeKit(level) {
  const tiles = new Map();
  const depthTiles = new Map();
  const counts = { cornice: 0, coping: 0, belt: 0, roof: 0, sill: 0, pier: 0 };
  const buildings = (level.buildings ?? []).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const b of buildings) {
    const [x, z] = b.outer[0];
    const key = `${Math.floor(x / GEO_TILE)},${Math.floor(z / GEO_TILE)}`;
    let m = tiles.get(key);
    if (!m) tiles.set(key, (m = emptyMesh()));
    const dkey = `${Math.floor(x / DEPTH_TILE)},${Math.floor(z / DEPTH_TILE)}`;
    let dm = depthTiles.get(dkey);
    if (!dm) depthTiles.set(dkey, (dm = emptyMesh(true)));
    const c = buildingKit(m, b, buildingSpan(level, b), dm);
    for (const k of Object.keys(counts)) counts[k] += c[k];
  }
  const out = [...tiles.entries()]
    .filter(([, m]) => m.indices.length)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([tile, m]) => ({ tile, mesh: packMesh(m) }));
  const depthOut = [...depthTiles.entries()]
    .filter(([, m]) => m.indices.length)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([tile, m]) => {
      const [i, j] = tile.split(",").map(Number);
      return { tile, center: [(i + 0.5) * DEPTH_TILE, (j + 0.5) * DEPTH_TILE], mesh: packMesh(m) };
    });
  return { tiles: out, depthTiles: depthOut, counts };
}
