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
import { BULKHEAD, bulkheadBox, minRect, roofPlan } from "./roof-plan.js";

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
  // A wall of `wideBays` bays or more with an even count gets a 4-bay panel.
  // A wall with 4 more bays than the panel also gets a lower step of one
  // bay on each side, `sideStep` meters over the parapet. The bulkhead is
  // painted steel: `metal` on the walls and `metalCap` on the coping.
  crown: { ...BULKHEAD, minBays: 4, wideBays: 6, sideStep: 0.5, depth: 0.3, copingOut: 0.1, nameOut: 0.04, nameWidth: 0.6, nameHeight: 0.5, bulkheadCoping: [0.06, 0.12], metal: [0.3, 0.33, 0.34], metalCap: [0.2, 0.22, 0.23] },
  // The stacked cornice (in the depth tiles): a bed molding under the
  // cornice and a cap step on top of it, against the parapet. The bed
  // molding stays over the mural top (geo-mesh.js muralWalls(), 0.6 m under
  // the wall top).
  bed: { out: 0.2, height: 0.09 },
  cap: { out: 0.22, height: 0.12 },
  // A stone lintel over each upper window of a brick style. It covers the
  // lintel that the facade shader paints: from the frame top up `rise` of
  // the floor, and `extra` cells wider than the frame on each side.
  lintel: { out: 0.08, rise: 0.065, extra: 0.02, pad: 0.02 },
  // A thin head trim over each window of the other styles with sills.
  head: { out: 0.05, height: 0.1, overhang: 0.05 },
  // The shop entrance on the front wall (shopEntrance()): a painted door
  // with a glass light, a trim surround, and a stone step.
  door: { width: 1.15, height: 2.35, out: 0.06, light: [0.46, 1.25], lightY: 0.95, trim: 0.12, trimOut: 0.1, head: 0.16 },
  step: { height: 0.15, depth: 0.55, width: 1.8 },
  // A wall lamp on each inner pier of the front wall: a bronze plate and a
  // warm glass lantern. `y` is the fraction of the floor, and `maxY` the cap
  // in meters over the base.
  sconce: { y: 0.62, maxY: 2.7, plate: [0.18, 0.34, 0.03], lamp: [0.13, 0.22, 0.13], plateColor: [0.24, 0.2, 0.16], lampColor: [1.0, 0.86, 0.58] },
  // A vent stack on a flat roof (roof-plan.js): a pipe and a wider cap.
  vent: { pipe: 0.11, cap: 0.17, capHeight: 0.07, color: [0.74, 0.76, 0.78] },
  // The shop front: the sign band starts `pierGap` from each pier center
  // and sticks out `out`; it goes from `y0` of the floor to under the belt
  // course. A board is `boardOut` in front of the band.
  sign: { pierGap: 0.24, out: 0.07, y0: 0.84, beltGap: 0.04, boardOut: 0.02, boardWidth: 0.7, boardHeight: 0.6 },
  // A kit awning: the same shape as awningsFor() in geo-mesh.js.
  awning: { out: 1.3, drop: 0.5, valance: 0.3, t0: 0.12, t1: 0.88, minChance: 0.5 },
};
// A curtain wall and an open parking deck have no sills.
const NO_SILLS = new Set(["glass-office", "parking-deck"]);

// True when a building of this style and wall height gets a cornice.
function hasCornice(style, height) {
  return (style.parapet ?? 0) >= KIT.cornice.minParapet && height > 5;
}
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
// mural on wall `edge`: no box goes on the mural or within MURAL_CLEAR of it.
export function wallDepth(m, ring, top, style, si, base = 0, mural = null) {
  const counts = { sill: 0, pier: 0, lintel: 0, head: 0 };
  const floors = Math.max(1, Math.round((top - base) / style.floorHeight));
  const floorH = (top - base) / floors;
  const sills = !NO_SILLS.has(style.id);
  const piers = style.storefront && floors >= 2;
  const [ww, wh] = style.window;
  // A lintel or a head stays under the cornice and its bed molding, and
  // under the eave of a house roof.
  const ceiling = hasCornice(style, top - base) ? top - KIT.cornice.height - KIT.bed.height : HOUSES.has(style.id) ? top - KIT.roof.overhang * Math.tan(KIT.roof.pitch) : top;
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
          if (onMural(c - half, c + half, y - KIT.sill.height, y)) continue;
          wallBox(m, [px, pz], t, n, c - half, c + half, y - KIT.sill.height, y, KIT.sill.out, style.trim, si, true, true);
          counts.sill += 1;
        }
        // Over the window: a stone lintel on brick, a thin head elsewhere.
        const frameTop = base + (level + WINDOW_CENTER + (wh + FRAME) / 2) * floorH;
        const L = KIT.lintel;
        const H = KIT.head;
        const lintelHalf = style.brick ? Math.min(((ww + FRAME) / 2 + L.extra) * bl + L.pad, bl / 2 - 0.02) : Math.min(((ww + FRAME) / 2) * bl + H.overhang, bl / 2 - 0.02);
        const y1 = frameTop + (style.brick ? L.rise * floorH : H.height);
        if (y1 > ceiling - 0.02) continue;
        for (let k = 0; k < bays; k += 1) {
          const c = (k + 0.5) * bl;
          if (onMural(c - lintelHalf, c + lintelHalf, frameTop, y1)) continue;
          wallBox(m, [px, pz], t, n, c - lintelHalf, c + lintelHalf, frameTop, y1, style.brick ? L.out : H.out, style.trim, si, true, true);
          if (style.brick) counts.lintel += 1;
          else counts.head += 1;
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

// The footprint rectangle (roof-plan.js). The roof plan and the kit use
// the same axes.
export { minRect };

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
// center bays, `crown.step` meters over the parapet top, with a stone
// coping and a blank stone name panel. The panel covers 3 bays on an odd bay
// count, 4 bays on an even count of KIT.crown.wideBays or more, and else 2
// bays. A wall with 4 more bays than the panel also gets a lower step of one
// bay on each side, so the crown reads as a stepped parapet, not as a
// chimney. The boxes stand on the roof, so they are closed from the roof
// side. The panel edges are on bay lines, so they are on the window grid.
// Returns 1 when it builds the panel, else 0.
export function crownPanel(m, ring, top, style, si, wall) {
  const c = KIT.crown;
  const i = longestWall(ring);
  if (i < 0) return 0;
  const { o, t, n, len } = wallOf(ring, i);
  const bays = Math.max(1, Math.round(len / style.bay));
  if (bays < c.minBays) return 0;
  const bl = len / bays;
  const k = bays % 2 ? 3 : bays >= c.wideBays ? 4 : 2;
  const a0 = ((bays - k) / 2) * bl;
  const a1 = a0 + k * bl;
  const p = style.parapet ?? 0;
  const y1 = top + p + style.crown.step;
  raisedBox(m, o, t, n, a0, a1, top, top + p, y1, wall, style.trim, si, [true, true]);
  if (bays >= k + 4) {
    // The lower steps: their coping stops at the center box.
    const ys = top + p + c.sideStep;
    raisedBox(m, o, t, n, a0 - bl, a0, top, top + p, ys, wall, style.trim, si, [true, false]);
    raisedBox(m, o, t, n, a1, a1 + bl, top, top + p, ys, wall, style.trim, si, [false, true]);
  }
  // The name panel: blank, with no text.
  const w = (a1 - a0) * c.nameWidth;
  const am = (a0 + a1) / 2;
  const ym = top + p + style.crown.step / 2;
  const h = style.crown.step * c.nameHeight;
  wallBox(m, o, t, n, am - w / 2, am + w / 2, ym - h / 2, ym + h / 2, c.nameOut, style.trim, si);
  return 1;
}

// One raised parapet box on a wall, from a0 to a1, with its front from the
// parapet top `yp` to `y1` and its back down to the roof `top`. The front
// face starts at the parapet top, so it does not cover the parapet face of
// extrudeFootprint(). `ends` [start, end] says on which ends the coping
// sticks out.
function raisedBox(m, o, t, n, a0, a1, top, yp, y1, wall, trim, si, ends) {
  const c = KIT.crown;
  const at = (a, y, d) => [o[0] + t[0] * a + n[0] * d, y, o[1] + t[1] * a + n[1] * d];
  quad(m, at(a0, yp, 0), at(a1, yp, 0), at(a1, y1, 0), at(a0, y1, 0), wall, [n[0], 0, n[1]], si);
  solidBoxNoFront(m, o, t, n, a0, a1, -c.depth, 0, top, y1, wall, si);
  // The coping: out on all sides, and a closed box.
  const co = c.copingOut;
  solidBox(m, o, t, n, a0 - (ends[0] ? co : 0), a1 + (ends[1] ? co : 0), -c.depth - co, co, y1, y1 + KIT.coping.height, trim, si);
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

// The stair bulkhead: a painted steel box on the roof at one end of the
// long axis of the footprint rectangle (`seed & 1` picks the end), with a
// darker steel coping. The box is roof-plan.js bulkheadBox(), so the roof
// props stand clear of it. Returns 1 when it builds the box, else 0. It
// builds no box when the box is too narrow or when it does not stand
// `crown.margin` from every wall.
export function stairBulkhead(m, ring, top, style, si, wall, seed) {
  const c = KIT.crown;
  const box = bulkheadBox(ring, style, seed, c);
  if (!box) return 0;
  const { cx, cz, u, v, ha, hc, height } = box;
  // A box on a "wall" through the center: o is the box center, t is u,
  // and n is v, so a runs along u and d runs along v.
  const o = [cx, cz];
  solidBox(m, o, u, v, -ha, ha, -hc, hc, top, top + height, c.metal, si, false);
  const [co, ch] = c.bulkheadCoping;
  solidBox(m, o, u, v, -ha - co, ha + co, -hc - co, hc + co, top + height, top + height + ch, c.metalCap, si);
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
function signBay(m, { o, t, n, len }, bays, k, y0, y1, color, style, si, board) {
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
  // A blank board on the band. It reads as a shop name at 30 m.
  const bw = (a1 - a0) * g.boardWidth;
  const bh = (y1 - y0) * g.boardHeight;
  const am = (a0 + a1) / 2;
  const ym = (y0 + y1) / 2;
  const d = g.out + g.boardOut;
  quad(m, at(am - bw / 2, ym - bh / 2, d), at(am + bw / 2, ym - bh / 2, d), at(am + bw / 2, ym + bh / 2, d), at(am - bw / 2, ym + bh / 2, d), style.trim, out, si);
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
export function shopFront(m, ring, style, si, base, floorH, front, seed, awningColor = AWNING_COLORS[seed % AWNING_COLORS.length]) {
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
  for (let k = 0; k < bays; k += 1) if (signBay(m, wallOf(ring, front.edge), bays, k, y0, y1, color, style, si, k % 2 === 0)) counts.sign += 1;
  // The sign band turns the corner: the bay at the corner of each wrap wall.
  for (const j of front.wraps ?? []) {
    const wj = wallOf(ring, j);
    const bj = Math.max(1, Math.round(wj.len / style.bay));
    const k = j === (front.edge + 1) % ring.length ? 0 : bj - 1;
    if (signBay(m, wj, bj, k, y0, y1, color, style, si, true)) counts.sign += 1;
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

// The door bay of a front wall: `front.door` (frontWalk()), or the center
// bay. `bays` is the bay count of the wall.
export function doorBay(front, bays) {
  const k = front?.door;
  return Number.isInteger(k) && k >= 0 && k < bays ? k : Math.floor((bays - 1) / 2);
}

// The shop entrance on the wall `front.edge` of one storefront building,
// into mesh `m` (a depth tile): a painted door with a glass light and a
// trim surround in the door bay (doorBay()), a stone step in front of it,
// and a wall lamp on each inner pier. The walls go from `base`, with floors
// of `floorH`. The step goes down to `foot`, so it meets the ground on a
// slope. `color` is the door paint (the sign color). Returns
// { door, step, sconce }.
//
// The door stands 0.15 m over the floor line: the step is the sill of the
// door. The step and the door are render-only, like the rest of the kit.
export function shopEntrance(m, ring, style, si, base, floorH, front, foot = base, color = SIGN_COLORS[0]) {
  const counts = { door: 0, step: 0, sconce: 0 };
  if (!front || front.edge < 0 || front.edge >= ring.length) return counts;
  const w = wallOf(ring, front.edge);
  const { o, t, n, len } = w;
  if (len < KIT.pier.width * 2) return counts;
  const bays = Math.max(1, Math.round(len / style.bay));
  const bl = len / bays;
  const D = KIT.door;
  const S = KIT.step;
  const k = doorBay(front, bays);
  const am = (k + 0.5) * bl;
  const half = D.width / 2;
  // The door and its surround must fit between the piers of the bay.
  if (half + D.trim <= bl / 2 - KIT.pier.width / 2 - 0.05) {
    const y0 = base + S.height;
    const y1 = y0 + D.height;
    // The step: from the foot of the plinth up to the door sill.
    wallBox(m, o, t, n, am - S.width / 2, am + S.width / 2, Math.min(foot, base), y0, S.depth, style.trim.map((v) => v * 0.9), si, false, true);
    counts.step = 1;
    // The door leaf, and a dark glass light in it.
    wallBox(m, o, t, n, am - half, am + half, y0, y1, D.out, color, si, false, true);
    const [lw, lh] = D.light;
    const ly = y0 + D.lightY;
    faceQuad(m, w, am - lw / 2, am + lw / 2, ly, ly + lh, D.out + 0.004, style.glass.map((v) => v * 0.7), si);
    // The trim surround: two jambs and a head.
    wallBox(m, o, t, n, am - half - D.trim, am - half, y0, y1, D.trimOut, style.trim, si, false, true);
    wallBox(m, o, t, n, am + half, am + half + D.trim, y0, y1, D.trimOut, style.trim, si, false, true);
    wallBox(m, o, t, n, am - half - D.trim, am + half + D.trim, y1, y1 + D.head, D.trimOut, style.trim, si, true, true);
    counts.door = 1;
  }
  // A lamp on each inner pier, on the pier face.
  const L = KIT.sconce;
  const ys = base + Math.min(L.y * floorH, L.maxY);
  const po = KIT.pier.out;
  const [pw, ph, pd] = L.plate;
  const [lw2, lh2, ld] = L.lamp;
  for (let p = 1; p < bays; p += 1) {
    const c = p * bl;
    wallBox(m, o, t, n, c - pw / 2, c + pw / 2, ys - ph / 2, ys + ph / 2, po + pd, L.plateColor, si, true, true);
    wallBox(m, o, t, n, c - lw2 / 2, c + lw2 / 2, ys - lh2 / 2, ys + lh2 / 2, po + pd + ld, L.lampColor, si, true, true);
    counts.sconce += 1;
  }
  return counts;
}

// A flat quad on a wall (wallOf()), `d` meters out, facing out.
function faceQuad(m, { o, t, n }, a0, a1, y0, y1, d, color, si) {
  const at = (a, y) => [o[0] + t[0] * a + n[0] * d, y, o[1] + t[1] * a + n[1] * d];
  quad(m, at(a0, y0), at(a1, y0), at(a1, y1), at(a0, y1), color, [n[0], 0, n[1]], si);
}

// The vent stacks of a roof plan (roof-plan.js roofPlan()), into mesh `m`:
// a pipe and a wider cap on each vent, on the roof at `top`. Returns the
// vent count.
export function roofVents(m, parts, top, si) {
  const V = KIT.vent;
  let count = 0;
  for (const p of parts) {
    if (p.kind !== "vent") continue;
    // The plan yaw turns +x toward the long axis: (cos yaw, -sin yaw).
    const u = [Math.cos(p.yaw), -Math.sin(p.yaw)];
    const v = [-u[1], u[0]];
    const o = [p.x, p.z];
    const yc = top + p.height;
    solidBox(m, o, u, v, -V.pipe, V.pipe, -V.pipe, V.pipe, top, yc, V.color, si, false);
    solidBox(m, o, u, v, -V.cap, V.cap, -V.cap, V.cap, yc, yc + V.capHeight, V.color.map((x) => x * 0.8), si);
    count += 1;
  }
  return count;
}

// The part counts of buildingKit() and facadeKit().
const COUNT_KEYS = ["cornice", "coping", "belt", "roof", "sill", "pier", "crown", "bulkhead", "sign", "awning", "lintel", "head", "stack", "door", "step", "sconce", "vent"];

// The kit parts for one building, into mesh `m`. Returns the part counts.
// `span` ({ foot, base, top }, src/level/geo/terrain.js) is where the walls
// stand; without it the building stands on y = 0. The small parts (sills,
// piers, lintels, heads, the stacked cornice, the shop entrance, and the
// vents) go into mesh `depth` (by default `m`).
// `mural` is the mural of the building, if it has one (see wallDepth()).
// `front` ({ edge, street, door }, frontEdges()) is the front wall. Without
// it the building gets no shop front.
export function buildingKit(m, b, span = { base: 0, top: b.height }, depth = m, mural = null, front = null) {
  const style = STYLES[STYLE_INDEX[chooseStyle(b)]];
  const si = STYLE_INDEX[style.id];
  const ring = orientRing(b.outer, false);
  const counts = Object.fromEntries(COUNT_KEYS.map((k) => [k, 0]));
  if (ring.length < 3 || !(b.height > 0)) return counts;
  const { base, top } = span;
  const foot = span.foot ?? base;
  // The same floor count as extrudeFootprint(), so the belt course sits on
  // the line of the facade floors.
  const floors = Math.max(1, Math.round((top - base) / style.floorHeight));
  const floorH = (top - base) / floors;
  const d = wallDepth(depth, ring, top, style, si, base, mural);
  counts.sill = d.sill;
  counts.pier = d.pier;
  counts.lintel = d.lintel;
  counts.head = d.head;
  if (HOUSES.has(style.id) && b.height <= KIT.roof.maxHeight) {
    const shingle = SHINGLES[hash32(`${b.id}:roof`) % SHINGLES.length];
    if (gableRoof(m, ring, top, wallColor(style, b.id), shingle, si)) counts.roof = 1;
    return counts;
  }
  const p = style.parapet ?? 0;
  if (hasCornice(style, b.height)) {
    ledge(m, ring, top - KIT.cornice.height, top, KIT.cornice.out, style.trim, si);
    counts.cornice = 1;
    // The stacked profiles: a bed molding under the cornice and a cap step
    // on it. They are small, so they go in the depth tile.
    ledge(depth, ring, top - KIT.cornice.height - KIT.bed.height, top - KIT.cornice.height, KIT.bed.out, style.trim, si);
    if (p >= KIT.cap.height + 0.1) ledge(depth, ring, top, top + KIT.cap.height, KIT.cap.out, style.trim, si);
    counts.stack = 1;
  }
  // The vent stacks of the roof plan. The roof units and the water tower
  // of the same plan are props (props.js roofProps()).
  counts.vent = roofVents(depth, roofPlan(b, style).parts, top, si);
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
      const seed = hash32(`${b.id}:shop`);
      const c = shopFront(m, ring, style, si, base, floorH, front, seed, awningColor);
      counts.sign = c.sign;
      counts.awning = c.awning;
      const e = shopEntrance(depth, ring, style, si, base, floorH, front, foot, SIGN_COLORS[seed % SIGN_COLORS.length]);
      counts.door = e.door;
      counts.step = e.step;
      counts.sconce = e.sconce;
    }
  }
  return counts;
}

function packMesh(m) {
  const out = { positions: Float32Array.from(m.positions), indices: Uint32Array.from(m.indices), colors: Float32Array.from(m.colors), facade: Float32Array.from(m.facade) };
  if (m.normals) out.normals = Float32Array.from(m.normals);
  return out;
}

// The walk from a shop door to the street (frontWalk()): the test marches
// out from `start` to `far` meters in `step` meter steps, then cuts the
// last step in half `refine` times.
export const WALK = { start: 1, far: 60, step: 2, refine: 5 };

// Pure: the door bay and the walk of the front wall `edge` of a ring. For
// each bay center (the center bays first), the test marches out along the
// wall normal. It stops at the first footprint of another building
// (`isBlocked`), or at the first street, sidewalk, path, or trail
// (`isStreet`). The bay with the nearest street gets the door. Returns
// { door, walk }: `walk` is the distance in meters from the wall to the
// street edge, or null when no bay line reaches a street.
export function frontWalk(ring, edge, bay, isStreet, isBlocked = () => false, w = WALK) {
  const { o, t, n, len } = wallOf(ring, edge);
  const bays = Math.max(1, Math.round(len / bay));
  const bl = len / bays;
  const center = (bays - 1) / 2;
  const order = [...Array(bays).keys()].sort((a, b) => Math.abs(a - center) - Math.abs(b - center) || a - b);
  let best = null;
  for (const k of order) {
    const x0 = o[0] + t[0] * (k + 0.5) * bl;
    const z0 = o[1] + t[1] * (k + 0.5) * bl;
    const at = (d) => [x0 + n[0] * d, z0 + n[1] * d];
    for (let d = w.start; d <= w.far; d += w.step) {
      if (isBlocked(...at(d))) break;
      if (!isStreet(...at(d))) continue;
      // Cut the last step down to the street edge.
      let lo = Math.max(0, d - w.step);
      let hi = d;
      for (let i = 0; i < w.refine; i += 1) {
        const mid = (lo + hi) / 2;
        if (isStreet(...at(mid))) hi = mid;
        else lo = mid;
      }
      if (!best || hi < best.hi - 1e-9) best = { door: k, hi };
      break;
    }
  }
  return best ? { door: best.door, walk: Math.round(best.hi * 1000) / 1000 } : { door: Math.floor(center), walk: null };
}

// The fronts of each level object, so the kit, the aprons, the props, and
// the lab share one computation.
const frontCache = new WeakMap();

// Pure: the front wall (frontEdge()) of every storefront building of a
// level, with its door bay and walk (frontWalk()), as a Map from the
// building id: { edge, street, wraps, door, walk }. The kit, the aprons
// (aprons.js), and the props (props.js) use the same fronts. The Map is
// kept for the level object; do not change it.
export function frontEdges(level) {
  const cached = frontCache.get(level);
  if (cached && cached.buildings === level.buildings) return cached.fronts;
  const sample = createGeoGroundSampler(level);
  const isStreet = streetTest(level, sample);
  const blockedFor = buildingTest(level, sample);
  const out = new Map();
  for (const b of level.buildings ?? []) {
    const style = STYLES[STYLE_INDEX[chooseStyle(b)]];
    if (!(b.outer?.length >= 3) || !style.storefront) continue;
    const ring = orientRing(b.outer, false);
    const blocked = blockedFor(b.id);
    const f = frontEdge(ring, isStreet, blocked);
    out.set(b.id, { ...f, ...frontWalk(ring, f.edge, style.bay, isStreet, blocked) });
  }
  frontCache.set(level, { buildings: level.buildings, fronts: out });
  return out;
}

// Returns { tiles: [{ tile, mesh }], one per building tile; depthTiles:
// [{ tile, center: [x, z], mesh }], one per DEPTH_TILE square; counts }.
// `fronts` is the Map of frontEdges(), to share it with the aprons.
export function facadeKit(level, fronts = frontEdges(level)) {
  const tiles = new Map();
  const depthTiles = new Map();
  const counts = Object.fromEntries(COUNT_KEYS.map((k) => [k, 0]));
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
    const c = buildingKit(m, b, buildingSpan(level, b), dm, murals.get(b.id) ?? null, front);
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
