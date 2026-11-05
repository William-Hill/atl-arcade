// The facade kit: real geometry on the building boxes. Pure.
//
// - A cornice: a ledge that sticks out under the parapet.
// - A coping: a thin cap that sticks out on top of the parapet.
// - A belt course: a ledge over the ground floor of a storefront style.
// - A pitched (gable) roof on a house with a near-rectangular footprint.
// - A sill under each upper-floor window, at the window that the facade
//   shader paints, so the wall has real depth.
// - Piers between the storefront bays on the ground floor.
// - A crown on a brick loft or warehouse: a raised center parapet with a
//   blank stone name panel, and a stair bulkhead box on the roof.
// - A shop front on the front wall of a storefront style: a painted sign
//   band in each bay, blank cream boards, and awnings when no street wall
//   has them.
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
import { createGeoGroundSampler, pointInRings } from "./geo-ground.js";
import { AWNING_COLORS, GEO_TILE, buildingTest, muralWalls, streetTest, streetWalls } from "./geo-mesh.js";
import { BELT, SIGN_COLORS, STYLES, STYLE_INDEX, awningHeight, chooseStyle, hash32, seededRandom, wallColor } from "./styles.js";
import { buildingSpan } from "./terrain.js";

export const KIT = {
  cornice: { out: 0.35, height: 0.5, minParapet: 0.5 },
  coping: { out: 0.1, height: 0.14 },
  belt: BELT,
  roof: { pitch: (32 * Math.PI) / 180, overhang: 0.45, maxSpan: 16, minFill: 0.72, maxHeight: 12 },
  // A sill is a small box under a window. A wall shorter than minWall
  // gets no sills (OSM rings have many short corner edges).
  sill: { out: 0.12, height: 0.1, overhang: 0.06, minWall: 1.5 },
  // A pier is a box between two storefront bays, under the belt course.
  pier: { out: 0.16, width: 0.36 },
  // A miter longer than this many offsets is cut off (a sharp corner).
  miterLimit: 3,
  // The crown: the raised center panel goes `depth` into the roof from the
  // wall line, its coping sticks out `copingOut`, and the blank name panel
  // sticks out `nameOut`. The bulkhead stands `margin` from every wall,
  // `end` from the end wall, with a coping `bulkheadCoping` [out, height].
  crown: { minBays: 4, depth: 0.3, copingOut: 0.1, nameOut: 0.04, nameWidth: 0.6, nameHeight: 0.5, end: 1.5, margin: 1.0, minAcross: 2.0, bulkheadCoping: [0.06, 0.12] },
  // The shop front: the sign band starts `pierGap` from each pier center
  // and sticks out `out`; it goes from `y0` of the floor to under the belt
  // course. A board is `boardOut` in front of the band.
  sign: { pierGap: 0.24, out: 0.07, y0: 0.84, beltGap: 0.04, boardOut: 0.02, boardWidth: 0.7, boardHeight: 0.6 },
  // A kit awning: the same shape as awningsFor() in geo-mesh.js.
  awning: { out: 1.3, drop: 0.5, valance: 0.3, t0: 0.12, t1: 0.88, minChance: 0.5 },
};
// A curtain wall and an open parking deck have no sills.
const NO_SILLS = new Set(["glass-office", "parking-deck"]);
// The window frame of the facade shader is 0.07 cells wider and taller than
// the glass, and an upper-floor window is centered at 0.55 of the floor.
const FRAME = 0.07;
const WINDOW_CENTER = 0.55;
// The clear margin (m) around a mural: no sill or pier goes there.
const MURAL_CLEAR = 0.3;
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
//
// `mural` ({ edge, t0, t1, y0, y1 }, muralWalls() in geo-mesh.js) is a
// mural on wall `edge`: no box goes on the mural or within MURAL_CLEAR of it,
// and no sill goes on the blank floors (from `floor0` up) of that wall.
export function wallDepth(m, ring, top, style, si, base = 0, mural = null) {
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
    const onMural = mural && mural.edge === i ? (a0, a1, y0, y1) => a1 > mural.t0 - MURAL_CLEAR && a0 < mural.t1 + MURAL_CLEAR && y1 > mural.y0 - MURAL_CLEAR && y0 < mural.y1 + MURAL_CLEAR : () => false;
    if (sills) {
      const half = Math.min(((ww + FRAME) / 2) * bl + KIT.sill.overhang, bl / 2 - 0.02);
      // The ground floor of a storefront style is the shop window: no sill.
      for (let level = style.storefront ? 1 : 0; level < floors; level += 1) {
        const y = base + (level + WINDOW_CENTER - (wh + FRAME) / 2) * floorH;
        for (let k = 0; k < bays; k += 1) {
          const c = (k + 0.5) * bl;
          // The mural wall is blank from mural.floor0 up: no window, no sill.
          if (mural && mural.edge === i && level >= (mural.floor0 ?? 0)) continue;
          if (onMural(c - half, c + half, y - KIT.sill.height, y)) continue;
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
        if (onMural(c - w, c + w, base, y1)) continue;
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

// A closed box on a wall: from a0 to a1 along the wall, from d0 to d1 out
// of the wall line (a negative value is inside the wall), and from y0 to
// y1. It has all 6 faces, so it shows no hole from any side. `bottom: false`
// leaves out the bottom face.
export function solidBox(m, o, t, n, a0, a1, d0, d1, y0, y1, color, style, bottom = true) {
  const at = (a, y, d) => [o[0] + t[0] * a + n[0] * d, y, o[1] + t[1] * a + n[1] * d];
  quad(m, at(a0, y0, d1), at(a1, y0, d1), at(a1, y1, d1), at(a0, y1, d1), color, [n[0], 0, n[1]], style);
  quad(m, at(a0, y0, d0), at(a1, y0, d0), at(a1, y1, d0), at(a0, y1, d0), color, [-n[0], 0, -n[1]], style);
  quad(m, at(a0, y1, d0), at(a1, y1, d0), at(a1, y1, d1), at(a0, y1, d1), color, [0, 1, 0], style);
  if (bottom) quad(m, at(a0, y0, d0), at(a1, y0, d0), at(a1, y0, d1), at(a0, y0, d1), color, [0, -1, 0], style);
  quad(m, at(a0, y0, d0), at(a0, y0, d1), at(a0, y1, d1), at(a0, y1, d0), color, [-t[0], 0, -t[1]], style);
  quad(m, at(a1, y0, d0), at(a1, y0, d1), at(a1, y1, d1), at(a1, y1, d0), color, [t[0], 0, t[1]], style);
}

// The wall i of a ring: { o: start [x, z], t: unit along, n: unit outward
// normal, len }.
function wallOf(ring, i) {
  const [px, pz] = ring[i];
  const [qx, qz] = ring[(i + 1) % ring.length];
  const len = Math.hypot(qx - px, qz - pz) || 1;
  const t = [(qx - px) / len, (qz - pz) / len];
  // The outward normal of an outer ring edge is (-dz, dx); see offsetRing().
  return { o: [px, pz], t, n: [-t[1], t[0]], len };
}

function longestWall(ring, walls = ring.map((_, i) => i)) {
  let best = -1;
  let bestLen = -1;
  for (const i of walls) {
    const len = wallOf(ring, i).len;
    if (len > bestLen) {
      best = i;
      bestLen = len;
    }
  }
  return best;
}

// The raised center parapet on the longest wall: a solid box over the
// center 3 bays (an odd bay count) or 2 bays (an even count), `crown.step`
// meters over the parapet top, with a stone coping and a blank stone name
// panel. The box stands on the roof, so it is closed from the roof side.
// The panel edges are on bay lines, so they are on the window grid.
// Returns 1 when it builds the panel, else 0.
export function crownPanel(m, ring, top, style, si, wall) {
  const c = KIT.crown;
  const i = longestWall(ring);
  if (i < 0) return 0;
  const { o, t, n, len } = wallOf(ring, i);
  const bays = Math.max(1, Math.round(len / style.bay));
  if (bays < c.minBays) return 0;
  const bl = len / bays;
  const k = bays % 2 ? 3 : 2;
  const a0 = ((bays - k) / 2) * bl;
  const a1 = a0 + k * bl;
  const p = style.parapet ?? 0;
  const y1 = top + p + style.crown.step;
  // The box goes down to the roof at the back. Its front starts at the
  // parapet top, so it does not cover the parapet face of extrudeFootprint().
  quad(m, [o[0] + t[0] * a0, top + p, o[1] + t[1] * a0], [o[0] + t[0] * a1, top + p, o[1] + t[1] * a1], [o[0] + t[0] * a1, y1, o[1] + t[1] * a1], [o[0] + t[0] * a0, y1, o[1] + t[1] * a0], wall, [n[0], 0, n[1]], si);
  solidBoxNoFront(m, o, t, n, a0, a1, -c.depth, 0, top, y1, wall, si);
  // The coping: out on all sides, and a closed box.
  const co = c.copingOut;
  solidBox(m, o, t, n, a0 - co, a1 + co, -c.depth - co, co, y1, y1 + KIT.coping.height, style.trim, si);
  // The name panel: blank, with no text.
  const w = (a1 - a0) * c.nameWidth;
  const am = (a0 + a1) / 2;
  const ym = top + p + style.crown.step / 2;
  const h = style.crown.step * c.nameHeight;
  wallBox(m, o, t, n, am - w / 2, am + w / 2, ym - h / 2, ym + h / 2, c.nameOut, style.trim, si);
  return 1;
}

// The back, the top, and the two ends of a box from d0 to d1 (no front and
// no bottom face).
function solidBoxNoFront(m, o, t, n, a0, a1, d0, d1, y0, y1, color, style) {
  const at = (a, y, d) => [o[0] + t[0] * a + n[0] * d, y, o[1] + t[1] * a + n[1] * d];
  quad(m, at(a0, y0, d0), at(a1, y0, d0), at(a1, y1, d0), at(a0, y1, d0), color, [-n[0], 0, -n[1]], style);
  quad(m, at(a0, y1, d0), at(a1, y1, d0), at(a1, y1, d1), at(a0, y1, d1), color, [0, 1, 0], style);
  quad(m, at(a0, y0, d0), at(a0, y0, d1), at(a0, y1, d1), at(a0, y1, d0), color, [-t[0], 0, -t[1]], style);
  quad(m, at(a1, y0, d0), at(a1, y0, d1), at(a1, y1, d1), at(a1, y1, d0), color, [t[0], 0, t[1]], style);
}

// The stair bulkhead: a box on the roof at one end of the long axis of the
// footprint rectangle (`seed & 1` picks the end), with a stone coping.
// Returns 1 when it builds the box, else 0. It builds no box when the box
// is too narrow or when it does not stand `crown.margin` from every wall.
export function stairBulkhead(m, ring, top, style, si, wall, seed) {
  const c = KIT.crown;
  const r = minRect(ring);
  if (!r) return 0;
  const [along, across0, height] = style.crown.bulkhead;
  const across = Math.min(across0, r.short - 2.4);
  if (across < c.minAcross) return 0;
  const side = seed & 1 ? 1 : -1;
  const off = side * (r.long / 2 - c.end - along / 2);
  const cx = r.cx + r.ux * off;
  const cz = r.cz + r.uz * off;
  // u along the long axis, v across it.
  const u = [r.ux, r.uz];
  const v = [-r.uz, r.ux];
  const ha = along / 2;
  const hc = across / 2;
  for (const [sa, sc] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const x = cx + u[0] * sa * (ha + c.margin) + v[0] * sc * (hc + c.margin);
    const z = cz + u[1] * sa * (ha + c.margin) + v[1] * sc * (hc + c.margin);
    if (!pointInRings(x, z, [ring])) return 0;
  }
  // A box on a "wall" through the center: o is the box center, t is u,
  // and n is v, so a runs along u and d runs along v.
  const o = [cx, cz];
  solidBox(m, o, u, v, -ha, ha, -hc, hc, top, top + height, wall, si, false);
  const [co, ch] = c.bulkheadCoping;
  solidBox(m, o, u, v, -ha - co, ha + co, -hc - co, hc + co, top + height, top + height + ch, style.trim, si);
  return 1;
}

// The crown of one building, into mesh `m`: the raised center parapet and
// the stair bulkhead. `top` is the wall top, `wall` the wall color, and
// `seed` a hash of the building id. Returns { crown, bulkhead }.
export function crownKit(m, ring, top, style, si, wall, seed) {
  if (!style.crown) return { crown: 0, bulkhead: 0 };
  return { crown: crownPanel(m, ring, top, style, si, wall), bulkhead: stairBulkhead(m, ring, top, style, si, wall, seed) };
}

// The choice of the front wall when no wall faces a street (frontEdge()).
// A wall can be the front when it is at least `minLength` of the longest
// wall. From 3 points on the wall (`samples`, fractions of the wall), the
// test marches out along the normal from `near` to `far` meters in `step`
// meter steps. It stops at the first footprint of another building. A
// neighbor wall wraps the sign band when it also faces open ground: its
// mean open distance is at least `wrapOpen`, or it faces a street.
export const FRONT = { near: 4, far: 60, step: 2, minLength: 0.7, samples: [0.25, 0.5, 0.75], wrapOpen: 20, minWrap: 4 };

// Pure: what wall i of a ring looks out on. `isStreet(x, z)` is true on a
// street; `isBlocked(x, z)` is true in the footprint of another building or
// out of the level. Returns { street, open }: the median over the sample
// lines of the distance to a street before a footprint (Infinity when a
// line has none), and the mean distance to the first footprint (FRONT.far
// when there is none). The median ignores one stray street sample, such as
// a short drive between the wall and a neighbor.
export function wallOutlook(ring, i, isStreet, isBlocked = () => false, f = FRONT) {
  const { o, t, n, len } = wallOf(ring, i);
  const streets = [];
  let open = 0;
  for (const s of f.samples) {
    const x0 = o[0] + t[0] * len * s;
    const z0 = o[1] + t[1] * len * s;
    let hit = f.far;
    let street = Infinity;
    for (let d = f.near; d <= f.far; d += f.step) {
      const x = x0 + n[0] * d;
      const z = z0 + n[1] * d;
      if (isBlocked(x, z)) {
        hit = d;
        break;
      }
      if (street === Infinity && isStreet(x, z)) street = d;
    }
    streets.push(street);
    open += hit;
  }
  streets.sort((a, b) => a - b);
  return { street: streets[Math.floor(streets.length / 2)], open: open / f.samples.length };
}

// True when the corner between wall i and the next wall is an outside
// corner, so a sign band can turn it.
function outsideCorner(ring, i) {
  const a = wallOf(ring, i);
  const b = wallOf(ring, (i + 1) % ring.length);
  return a.n[0] * b.t[0] + a.n[1] * b.t[1] < -0.5;
}

// The walls next to the front wall `edge` that the sign band wraps onto.
function wrapWalls(ring, edge, isStreet, isBlocked, streets, f) {
  const n = ring.length;
  const out = [];
  const next = (edge + 1) % n;
  const prev = (edge - 1 + n) % n;
  for (const [j, corner] of [[prev, prev], [next, edge]]) {
    if (j === edge || out.includes(j) || !outsideCorner(ring, corner)) continue;
    if (wallOf(ring, j).len < f.minWrap) continue;
    if (streets.includes(j) || wallOutlook(ring, j, isStreet, isBlocked, f).open >= f.wrapOpen) out.push(j);
  }
  return out;
}

// The front wall of a building: the longest wall that faces a street
// (streetWalls() in geo-mesh.js), with `street: true`. Else, of the long
// walls (FRONT.minLength), the wall with the nearest street in front of
// it, then the wall with the most open ground, then the longest wall, with
// `street: false`. So a shop front does not face the back of a neighbor.
// `wraps` lists the next walls that the sign band turns onto (wrapWalls()).
// Returns { edge, street, wraps }.
export function frontEdge(ring, isStreet, isBlocked = () => false, f = FRONT) {
  const walls = streetWalls(ring, isStreet);
  if (walls.length) {
    const edge = longestWall(ring, walls);
    return { edge, street: true, wraps: wrapWalls(ring, edge, isStreet, isBlocked, walls, f) };
  }
  const longest = wallOf(ring, longestWall(ring)).len;
  let best = null;
  for (let i = 0; i < ring.length; i += 1) {
    const len = wallOf(ring, i).len;
    if (len < longest * f.minLength - 1e-9) continue;
    const c = { i, len, ...wallOutlook(ring, i, isStreet, isBlocked, f) };
    if (!best || c.street < best.street || (c.street === best.street && (c.open > best.open + 1e-9 || (Math.abs(c.open - best.open) <= 1e-9 && c.len > best.len + 1e-9)))) best = c;
  }
  return { edge: best.i, street: false, wraps: wrapWalls(ring, best.i, isStreet, isBlocked, walls, f) };
}

// A double-sided quad, so an awning shows from below and from above.
function twoSided(m, a, b, c, d, color, normal, style) {
  quad(m, a, b, c, d, color, normal, style);
  quad(m, a, b, c, d, color, [-normal[0], -normal[1], -normal[2]], style);
}

// The sign band in bay k of a wall (wallOf()) with `bays` bays, from y0 to
// y1, and a blank board on it when `board` is true. The band has only a
// front face and a top face, and the board has only a front face. The
// piers stand in front of the band ends, and this keeps the triangle count
// low (there are about 2,000 bands on the BeltLine level). Returns true
// when it builds the band.
function signBay(m, { o, t, n, len }, bays, k, y0, y1, color, style, si, board, boards = null) {
  const g = KIT.sign;
  const bl = len / bays;
  const w = KIT.pier.width / 2;
  // The pier centers, as in wallDepth().
  const pier = (i) => Math.min(Math.max(i * bl, w), len - w);
  const a0 = pier(k) + g.pierGap;
  const a1 = pier(k + 1) - g.pierGap;
  if (!(y1 > y0) || a1 - a0 < 0.5) return false;
  const at = (a, y, d) => [o[0] + t[0] * a + n[0] * d, y, o[1] + t[1] * a + n[1] * d];
  const out = [n[0], 0, n[1]];
  quad(m, at(a0, y0, g.out), at(a1, y0, g.out), at(a1, y1, g.out), at(a0, y1, g.out), color, out, si);
  quad(m, at(a0, y1, 0), at(a1, y1, 0), at(a1, y1, g.out), at(a0, y1, g.out), color, [0, 1, 0], si);
  if (!board) return true;
  // A blank board on the band. It reads as a shop name at 30 m; the shop
  // name decals (render/shop-names.js) draw the name on it.
  const bw = (a1 - a0) * g.boardWidth;
  const bh = (y1 - y0) * g.boardHeight;
  const am = (a0 + a1) / 2;
  const ym = (y0 + y1) / 2;
  const d = g.out + g.boardOut;
  quad(m, at(am - bw / 2, ym - bh / 2, d), at(am + bw / 2, ym - bh / 2, d), at(am + bw / 2, ym + bh / 2, d), at(am - bw / 2, ym + bh / 2, d), style.trim, out, si);
  if (boards) {
    const [px, , pz] = at(am, ym, d);
    boards.push({ x: px, y: ym, z: pz, w: bw, h: bh, nx: n[0], nz: n[1] });
  }
  return true;
}

// The shop front on the wall `front.edge` (frontEdge()) of one storefront
// building, into mesh `m`: a painted sign band in each bay between the
// piers, a blank cream board on every second bay, the band on the corner
// bay of each wall in `front.wraps`, and awnings when
// `front.street` is false (awningsFor() covers a street wall). The walls go
// from `base`, with floors of `floorH`. `seed` picks the sign color and the
// awning bays. Returns { sign, awning }.
//
// The kit awnings are render-only. They hang under the sign band, so the
// band stays in view.
export function shopFront(m, ring, style, si, base, floorH, front, seed, awningColor = AWNING_COLORS[seed % AWNING_COLORS.length], boards = null) {
  const counts = { sign: 0, awning: 0 };
  if (!front || front.edge < 0 || front.edge >= ring.length) return counts;
  const { o, t, n, len } = wallOf(ring, front.edge);
  if (len < KIT.pier.width * 2) return counts;
  const g = KIT.sign;
  const bays = Math.max(1, Math.round(len / style.bay));
  const bl = len / bays;
  const y0 = base + g.y0 * floorH;
  const y1 = base + floorH - KIT.belt.height / 2 - g.beltGap;
  const color = SIGN_COLORS[seed % SIGN_COLORS.length];
  const at = (a, y, d) => [o[0] + t[0] * a + n[0] * d, y, o[1] + t[1] * a + n[1] * d];
  for (let k = 0; k < bays; k += 1) if (signBay(m, wallOf(ring, front.edge), bays, k, y0, y1, color, style, si, k % 2 === 0, boards)) counts.sign += 1;
  // The sign band turns the corner: the bay at the corner of each wrap wall.
  for (const j of front.wraps ?? []) {
    const wj = wallOf(ring, j);
    const bj = Math.max(1, Math.round(wj.len / style.bay));
    const k = j === (front.edge + 1) % ring.length ? 0 : bj - 1;
    if (signBay(m, wj, bj, k, y0, y1, color, style, si, true, boards)) counts.sign += 1;
  }
  if (front.street || !(style.awnings > 0)) return counts;
  const aw = KIT.awning;
  const rand = seededRandom(seed);
  const chosen = new Set();
  for (let k = 0; k < bays; k += 1) if (rand() < Math.max(style.awnings, aw.minChance)) chosen.add(k);
  if (chosen.size < 2) {
    const c0 = Math.floor((bays - 1) / 2);
    chosen.add(c0);
    chosen.add(Math.min(bays - 1, c0 + 1));
  }
  // Under the sign band, and no higher than the street awnings.
  const top = Math.min(base + awningHeight(style), y0);
  const slope = [n[0] * aw.drop, aw.out, n[1] * aw.drop];
  for (const k of [...chosen].sort((a, b) => a - b)) {
    const a0 = (k + aw.t0) * bl;
    const a1 = (k + aw.t1) * bl;
    const yb = top - aw.drop;
    twoSided(m, at(a0, top, 0.02), at(a1, top, 0.02), at(a1, yb, 0.02 + aw.out), at(a0, yb, 0.02 + aw.out), awningColor, slope, si);
    twoSided(m, at(a0, yb, 0.02 + aw.out), at(a1, yb, 0.02 + aw.out), at(a1, yb - aw.valance, 0.02 + aw.out), at(a0, yb - aw.valance, 0.02 + aw.out), awningColor, [n[0], 0, n[1]], si);
    counts.awning += 1;
  }
  return counts;
}

// The kit parts for one building, into mesh `m`. Returns the part counts.
// `span` ({ base, top }, src/level/geo/terrain.js) is where the walls stand;
// without it the building stands on y = 0. The sills and the piers go into
// mesh `depth` (by default `m`).
// `mural` is the mural of the building, if it has one (see wallDepth()).
// `front` ({ edge, street }, frontEdge()) is the front wall. Without it the
// building gets no shop front.
export function buildingKit(m, b, span = { base: 0, top: b.height }, depth = m, mural = null, front = null, level = null, boards = null) {
  const style = STYLES[STYLE_INDEX[chooseStyle(b, level)]];
  const si = STYLE_INDEX[style.id];
  const ring = orientRing(b.outer, false);
  const counts = { cornice: 0, coping: 0, belt: 0, roof: 0, sill: 0, pier: 0, crown: 0, bulkhead: 0, sign: 0, awning: 0 };
  if (ring.length < 3 || !(b.height > 0)) return counts;
  const { base, top } = span;
  // The same floor count as extrudeFootprint(), so the belt course sits on
  // the line of the facade floors.
  const floors = Math.max(1, Math.round((top - base) / style.floorHeight));
  const floorH = (top - base) / floors;
  const d = wallDepth(depth, ring, top, style, si, base, mural);
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
  if (style.crown) {
    const c = crownKit(m, ring, top, style, si, wallColor(style, b.id), hash32(`${b.id}:crown`));
    counts.crown = c.crown;
    counts.bulkhead = c.bulkhead;
  }
  if (style.storefront && floors >= 2) {
    const y = base + floorH - KIT.belt.height / 2;
    ledge(m, ring, y, y + KIT.belt.height, KIT.belt.out, style.trim, si);
    counts.belt = 1;
    if (front) {
      const awningColor = AWNING_COLORS[hash32(`${b.id}:awning-color`) % AWNING_COLORS.length];
      const c = shopFront(m, ring, style, si, base, floorH, front, hash32(`${b.id}:shop`), awningColor, boards);
      counts.sign = c.sign;
      counts.awning = c.awning;
    }
  }
  return counts;
}

function packMesh(m) {
  const out = { positions: Float32Array.from(m.positions), indices: Uint32Array.from(m.indices), colors: Float32Array.from(m.colors), facade: Float32Array.from(m.facade) };
  if (m.normals) out.normals = Float32Array.from(m.normals);
  return out;
}

// Pure: the front wall (frontEdge()) of every storefront building of a
// level, as a Map from the building id. The kit and the aprons (aprons.js)
// use the same fronts.
export function frontEdges(level) {
  const sample = createGeoGroundSampler(level);
  const isStreet = streetTest(level, sample);
  const blockedFor = buildingTest(level, sample);
  const out = new Map();
  for (const b of level.buildings ?? []) {
    if (!(b.outer?.length >= 3) || !STYLES[STYLE_INDEX[chooseStyle(b, level)]].storefront) continue;
    out.set(b.id, frontEdge(orientRing(b.outer, false), isStreet, blockedFor(b.id)));
  }
  return out;
}

// Returns { tiles: [{ tile, mesh }], one per building tile; depthTiles:
// [{ tile, center: [x, z], mesh }], one per DEPTH_TILE square; counts }.
// `fronts` is the Map of frontEdges(), to share it with the aprons.
export function facadeKit(level, fronts = frontEdges(level), boards = null) {
  const tiles = new Map();
  const depthTiles = new Map();
  const counts = { cornice: 0, coping: 0, belt: 0, roof: 0, sill: 0, pier: 0, crown: 0, bulkhead: 0, sign: 0, awning: 0 };
  const buildings = (level.buildings ?? []).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  const murals = new Map(muralWalls(level).map((mw) => [mw.id, mw]));
  for (const b of buildings) {
    const [x, z] = b.outer[0];
    const key = `${Math.floor(x / GEO_TILE)},${Math.floor(z / GEO_TILE)}`;
    let m = tiles.get(key);
    if (!m) tiles.set(key, (m = emptyMesh()));
    const dkey = `${Math.floor(x / DEPTH_TILE)},${Math.floor(z / DEPTH_TILE)}`;
    let dm = depthTiles.get(dkey);
    if (!dm) depthTiles.set(dkey, (dm = emptyMesh(true)));
    const front = fronts.get(b.id) ?? null;
    const c = buildingKit(m, b, buildingSpan(level, b), dm, murals.get(b.id) ?? null, front, level, boards);
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
