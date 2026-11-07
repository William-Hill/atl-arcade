// Turns a geodata level into merged meshes, one per material per tile. Pure.
// The render (src/render/geo-view.js) and the physics (src/physics/world.js)
// both use these meshes, so what the skater sees is what the camera ray hits.
//
// A tile is a square of GEO_TILE meters. One merged mesh per tile keeps the
// draw calls low and still lets Three.js cull the tiles out of view.

import { FACE, extrudeFootprint, flatPolygon, mergeMeshes, orientRing, placeTemplate, stripMesh } from "./extrude.js";
import { createGeoGroundSampler, surfaceTop } from "./geo-ground.js";
import { BELT, STYLES, STYLE_INDEX, awningHeight, chooseStyle, floorCount, hash32, seededRandom, wallColor } from "./styles.js";
import { BRIDGE, bridgeDeck, buildingSpan, coarseTerrainOf, drapeMesh, liftMesh, parapetBlocked, terrainOf } from "./terrain.js";
import { JOIN_LIFT, streetJunctions } from "./junctions.js";
import { medianMesh, medianStrips } from "./medians.js";
import { piecePoints, rampMesh, sidewalkLayout } from "./curbs.js";
import { approachTrims, bridgeLayout, bridgeLayouts, densify, parapetRuns, ribbonEdges, slicePolyline, trimPolyline } from "./bridges.js";
import { claimedIds } from "./landmarks.js";

export const GEO_TILE = 125; // m. Small enough that the camera culls most of the draped terrain.
export const PROP_TILE = 50; // m. Small, so only near props get full detail.
// The plinth color of a building on a slope, as a factor on the style trim.
export const PLINTH_SHADE = 0.78;

// Material groups. Each group is one material in the render. All flat
// surfaces share one material and get their color from vertex colors.
// "building" uses the facade shader, "mural" the mural atlas, and "props"
// the kit props (built in the render from the kit templates).
export const GEO_MATERIALS = ["surface", "building", "mural", "props"];

export const AWNING_COLORS = [
  [0.9, 0.3, 0.32],
  [0.16, 0.5, 0.42],
  [0.98, 0.72, 0.2],
  [0.2, 0.42, 0.7],
  [0.96, 0.5, 0.26],
];

export const MURAL_CELLS = 16; // A 4 x 4 atlas.
const STREET_KINDS = new Set(["street", "sidewalk", "path", "trail"]);

// Vertex colors of the flat surfaces, by kind.
export const SURFACE_COLORS = {
  ground: [0.56, 0.68, 0.5],
  park: [0.42, 0.74, 0.4],
  street: [0.34, 0.35, 0.44],
  path: [0.8, 0.77, 0.7],
  sidewalk: [0.74, 0.74, 0.77],
  trail: [0.97, 0.8, 0.48],
  // The street decals (markings.js, #138). Each one is its own color, so the
  // surface shader gives it the asphalt scan and the asphalt albedo
  // (render/geo-view.js GROUND_OF): asphalt patches a little darker and a
  // little lighter than the street, cast iron (manholes and drains), and the
  // green of a bike lane.
  patchDark: [0.29, 0.3, 0.37],
  patchLight: [0.39, 0.4, 0.48],
  iron: [0.17, 0.17, 0.19],
  bike: [0.3, 0.72, 0.45],
  // A path with an OSM brick or paver surface (#158). Within 0.015 of the
  // path color, so the toon look shows it as a path; the pbr surface shader
  // tells the two apart (distance > 0.01) and gives it the brick set.
  brick: [0.8, 0.77, 0.685],
};

// Pure: the art color of a strip: its surface, else its kind.
export function stripColor(s) {
  return SURFACE_COLORS[s.surface] ?? SURFACE_COLORS[s.kind];
}

// Building wall colors: a warm, bright palette (Jet Set Radio style). The
// roof is a lighter tint of the wall, or the style roof color.
export const BUILDING_PALETTE = [
  [0.96, 0.62, 0.42],
  [0.98, 0.8, 0.45],
  [0.55, 0.78, 0.85],
  [0.84, 0.58, 0.78],
  [0.62, 0.82, 0.6],
  [0.95, 0.7, 0.7],
  [0.7, 0.68, 0.92],
  [0.93, 0.86, 0.74],
];

// A stable hash of a string, for a stable color per building.
export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function buildingColor(id) {
  return BUILDING_PALETTE[hashString(id) % BUILDING_PALETTE.length];
}

function tint(c, k) {
  return c.map((v) => v + (1 - v) * k);
}

function tileOf(x, z) {
  return `${Math.floor(x / GEO_TILE)},${Math.floor(z / GEO_TILE)}`;
}

// The ground bounds of a mesh: { minX, maxX, minZ, maxZ }. An item joins
// the tile of its first point, so a long strip runs out of its tile; use
// these bounds, not the tile square, for a distance test.
export function meshBounds(mesh) {
  const p = mesh.positions;
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i < p.length; i += 3) {
    if (p[i] < b.minX) b.minX = p[i];
    if (p[i] > b.maxX) b.maxX = p[i];
    if (p[i + 2] < b.minZ) b.minZ = p[i + 2];
    if (p[i + 2] > b.maxZ) b.maxZ = p[i + 2];
  }
  return b;
}

// The bounds that hold both a and b.
export function unionBounds(a, b) {
  return { minX: Math.min(a.minX, b.minX), maxX: Math.max(a.maxX, b.maxX), minZ: Math.min(a.minZ, b.minZ), maxZ: Math.max(a.maxZ, b.maxZ) };
}

// The ground distance from (x, z) to the bounds (0 inside them).
export function boundsDistance(b, x, z) {
  const dx = Math.max(b.minX - x, 0, x - b.maxX);
  const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
  return Math.hypot(dx, dz);
}

function firstPoint(item) {
  return item.outer ? item.outer[0] : item.points[0];
}

function nearestOnLines(lines, x, z) {
  let best = null;
  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i += 1) {
      const [ax, az] = line[i];
      const [bx, bz] = line[i + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
      const px = ax + t * dx;
      const pz = az + t * dz;
      const d = Math.hypot(x - px, z - pz);
      if (!best || d < best.d) best = { d, x: px, z: pz };
    }
  }
  return best;
}

function quad(mesh, a, b, c, d, color, uv = null) {
  // a, b, c, d are [x, y, z] in order around the face.
  // Both sides, so an awning shows from below and above. Each side has its
  // own 4 vertices: on shared vertices the two sides' normals sum to 0, and
  // a 0 normal is NaN in the shader (the bloom spreads it over the frame).
  const base = mesh.positions.length / 3;
  for (let side = 0; side < 2; side += 1) {
    for (const [i, p] of [a, b, c, d].entries()) {
      mesh.positions.push(p[0], p[1], p[2]);
      if (mesh.colors) mesh.colors.push(color[0], color[1], color[2]);
      if (mesh.facade) mesh.facade.push(0, 0, 0, FACE.roof);
      if (mesh.uvs) mesh.uvs.push(uv[i][0], uv[i][1]);
    }
  }
  mesh.indices.push(base, base + 1, base + 2, base, base + 2, base + 3, base + 4, base + 6, base + 5, base + 4, base + 7, base + 6);
}

// The walls of a ring that face a street: the indices of the walls whose
// midpoint, moved 4 m out along the wall normal, is on a street. A wall
// under 4 m long is left out. `ring` has the outer winding of orientRing().
export function streetWalls(ring, isStreet) {
  const out = [];
  for (let i = 0; i < ring.length; i += 1) {
    const [px, pz] = ring[i];
    const [qx, qz] = ring[(i + 1) % ring.length];
    const len = Math.hypot(qx - px, qz - pz);
    if (len < 4) continue;
    const nx = -(qz - pz) / len;
    const nz = (qx - px) / len;
    if (isStreet((px + qx) / 2 + nx * 4, (pz + qz) / 2 + nz * 4)) out.push(i);
  }
  return out;
}

// A test for a level: `isStreet(x, z)` is true when the point is on a
// street, sidewalk, path, or trail. `sample` is a ground sampler of the
// level, to share one sampler between tests.
export function streetTest(level, sample = createGeoGroundSampler(level)) {
  const stripKind = new Map((level.strips ?? []).map((s) => [s.id, s.kind]));
  return (x, z) => {
    const id = sample(x, z)?.id;
    return STREET_KINDS.has(stripKind.get(id)) || Boolean(id?.startsWith("junction:"));
  };
}

// A test for a level: `blockedFor(id)(x, z)` is true when the point is in
// the footprint of a building other than `id`, or out of the level.
export function buildingTest(level, sample = createGeoGroundSampler(level)) {
  const ids = new Set((level.buildings ?? []).map((b) => b.id));
  return (self) => (x, z) => {
    const g = sample(x, z);
    return g === null || (ids.has(g.id) && g.id !== self);
  };
}

// The roof color of a building with the facade detail: the style roof
// color, or a light tint of the wall.
export function roofColorOf(style, wall) {
  return style.roofColor ?? tint(wall, 0.45);
}

// Awnings over the street-facing ground floor of a storefront style.
// `isStreet(x, z)` says if a point is on a street, sidewalk, path, or trail.
export function awningsFor(b, style, isStreet) {
  const mesh = { positions: [], indices: [], colors: [], facade: [] };
  if (!style.storefront || !(style.awnings > 0)) return mesh;
  const ring = orientRing(b.outer, false);
  const rand = seededRandom(hash32(`${b.id}:awning`));
  const color = AWNING_COLORS[hash32(`${b.id}:awning-color`) % AWNING_COLORS.length];
  const y0 = awningHeight(style);
  for (const i of streetWalls(ring, isStreet)) {
    const [px, pz] = ring[i];
    const [qx, qz] = ring[(i + 1) % ring.length];
    const len = Math.hypot(qx - px, qz - pz);
    const nx = -(qz - pz) / len;
    const nz = (qx - px) / len;
    const bays = Math.max(1, Math.round(len / style.bay));
    for (let k = 0; k < bays; k += 1) {
      if (rand() > style.awnings) continue;
      const t0 = (k + 0.12) / bays;
      const t1 = (k + 0.88) / bays;
      const ax = px + (qx - px) * t0 + nx * 0.02;
      const az = pz + (qz - pz) * t0 + nz * 0.02;
      const bx = px + (qx - px) * t1 + nx * 0.02;
      const bz = pz + (qz - pz) * t1 + nz * 0.02;
      const out = 1.3;
      const drop = 0.5;
      quad(mesh, [ax, y0, az], [bx, y0, bz], [bx + nx * out, y0 - drop, bz + nz * out], [ax + nx * out, y0 - drop, az + nz * out], color);
      quad(mesh, [ax + nx * out, y0 - drop, az + nz * out], [bx + nx * out, y0 - drop, bz + nz * out], [bx + nx * out, y0 - drop - 0.3, bz + nz * out], [ax + nx * out, y0 - drop - 0.3, az + nz * out], color);
    }
  }
  return mesh;
}

// A bridge (issue #131): the deck top is a surface ribbon from joint to
// joint (bridges.js), with mitered turns and its height from bridgeDeck().
// The structure is in the facade material (no windows, FACE.concrete, so
// the pbr look gives it the concrete class, #199): the slab under the
// OSM span, a parapet on each open side of the span, and at each OSM end an
// end post and a wing wall that turns out away from the road and down into
// the ground. A parapet side that is inside another deck (a sidewalk bridge
// on a road bridge) gets no parapet.
export const WING = { length: 4, turn: (30 * Math.PI) / 180, post: 0.4, postRise: 0.15, foot: 0.5 };

// One quad of the structure, wound so that its normal points along `hint`.
function face(m, p0, p1, p2, p3, hint, color) {
  const base = m.positions.length / 3;
  for (const q of [p0, p1, p2, p3]) {
    m.positions.push(q[0], q[1], q[2]);
    m.colors.push(color[0], color[1], color[2]);
    m.facade.push(0, 0, 0, FACE.concrete);
  }
  const ux = p1[0] - p0[0];
  const uy = p1[1] - p0[1];
  const uz = p1[2] - p0[2];
  const vx = p2[0] - p0[0];
  const vy = p2[1] - p0[1];
  const vz = p2[2] - p0[2];
  const dot = (uy * vz - uz * vy) * hint[0] + (uz * vx - ux * vz) * hint[1] + (ux * vy - uy * vx) * hint[2];
  if (dot >= 0) m.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  else m.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
}

// A solid along two edge polylines (left and right, one point each per
// row): the side faces, the top, the bottom, and an end cap at each end.
// y0(x, z) and y1(x, z) give the bottom and the top.
function prism(m, left, right, y0, y1, color, caps = [true, true]) {
  const P = (p, y) => [p[0], y(p[0], p[1]), p[1]];
  const n = left.length;
  for (let i = 0; i < n - 1; i += 1) {
    const [l0, l1, r0, r1] = [left[i], left[i + 1], right[i], right[i + 1]];
    const dx = (l1[0] + r1[0] - l0[0] - r0[0]) / 2;
    const dz = (l1[1] + r1[1] - l0[1] - r0[1]) / 2;
    // The left side faces (-dz, dx), the right side (dz, -dx).
    face(m, P(l0, y0), P(l1, y0), P(l1, y1), P(l0, y1), [-dz, 0, dx], color);
    face(m, P(r0, y0), P(r1, y0), P(r1, y1), P(r0, y1), [dz, 0, -dx], color);
    face(m, P(l0, y1), P(l1, y1), P(r1, y1), P(r0, y1), [0, 1, 0], color);
    face(m, P(l0, y0), P(l1, y0), P(r1, y0), P(r0, y0), [0, -1, 0], color);
  }
  const cap = (i, j) => {
    const [l, r] = [left[i], right[i]];
    const dx = (left[i][0] + right[i][0] - left[j][0] - right[j][0]) / 2;
    const dz = (left[i][1] + right[i][1] - left[j][1] - right[j][1]) / 2;
    face(m, P(l, y0), P(r, y0), P(r, y1), P(l, y1), [dx, 0, dz], color);
  };
  if (caps[0]) cap(0, 1);
  if (caps[1]) cap(n - 1, n - 2);
}

// The structure of one bridge strip: { deck: surface mesh, structure: mesh }.
export function bridgeMeshes(level, s) {
  const top = surfaceTop(level, s.kind);
  const deck = bridgeDeck(level, s);
  const terrain = terrainOf(level);
  const L = bridgeLayout(level, s);
  const h = s.width / 2;
  const pw = BRIDGE.parapetWidth;
  const color = stripColor(s);
  // The deck top, from joint to joint: a row each 1.5 m, so it follows the
  // arch, with mitered turns. The whole top is draped on the deck height
  // (bridgeDeck), cut on the terrain triangles like the approach road it
  // meets. One drape for the whole deck leaves no crack between the span
  // and a run-on where the deck rides on the ground.
  const pts = densify(L.points, 1.5);
  const { left, right } = ribbonEdges(pts, h);
  const flat = { positions: [], indices: [], colors: [] };
  // Each row has a vertex on the center line too, so the deck top there is
  // the deck height itself, the same as the draped center line on it.
  for (let i = 0; i < pts.length - 1; i += 1) {
    for (const [a0, a1, b0, b1] of [
      [left[i], left[i + 1], pts[i], pts[i + 1]],
      [pts[i], pts[i + 1], right[i], right[i + 1]],
    ]) {
      const base = flat.positions.length / 3;
      for (const p of [a0, b0, b1, a1]) {
        flat.positions.push(p[0], top, p[1]);
        flat.colors.push(color[0], color[1], color[2]);
      }
      // The left side first: (a, d, c) and (a, c, b) face up.
      flat.indices.push(base, base + 3, base + 2, base, base + 2, base + 1);
    }
  }
  // A half disk past each joint, as the disk at an inner point of a strip:
  // the road past J can turn there (or end square at a junction), and the
  // half disk fills the wedge between the two ends. Past J the deck height
  // is the ground, so the half disk lies on the road. It stops at the J
  // edge: a triangle across J would not follow the kink in the deck height
  // there and could cover the center line.
  for (const [k, e] of L.ends.entries()) {
    if (!e.approach) continue;
    const P = L.points;
    const [J, next] = k ? [P[P.length - 1], P[P.length - 2]] : [P[0], P[1]];
    const l = Math.hypot(J[0] - next[0], J[1] - next[1]) || 1;
    const out = Math.atan2(J[1] - next[1], J[0] - next[0]);
    const ring = [J];
    for (let i = 0; i <= 12; i += 1) {
      const t = out - Math.PI / 2 + (i / 12) * Math.PI;
      ring.push([J[0] + Math.cos(t) * h, J[1] + Math.sin(t) * h]);
    }
    if (l > 0) flatPolygon(ring, [], top, { color, mesh: flat });
  }
  const deckSurface = drapeMesh(flat, { flat: false, cell: terrain.cell, x0: terrain.x0, z0: terrain.z0, height: deck });
  const m = { positions: [], indices: [], colors: [], facade: [] };
  const onDeck = (y) => (x, z) => y + deck(x, z);
  // The slab under the OSM span, on the straight deck line (level across).
  // The deck top is never under that line, so the slab top stays under the
  // deck top also where the deck rides on higher ground.
  const span = densify(slicePolyline(L.points, L.span[0], L.span[1]), 1.5);
  if (span.length >= 2) {
    const e = ribbonEdges(span, h);
    const onLine = (y) => (x, z) => y + deck.raw(x, z);
    prism(m, e.left, e.right, onLine(top - BRIDGE.slab), onLine(top - 0.05), BRIDGE.color);
  }
  // The parapets, each with an end post and a wing wall at an OSM end.
  for (const k of [1, -1]) {
    for (const run of parapetRuns(level, s, k, pw, parapetBlocked(level, s))) {
      const e = ribbonEdges(run.points, pw / 2, (h - pw / 2) * k);
      prism(m, e.left, e.right, onDeck(top - 0.01), onDeck(top + BRIDGE.parapet), BRIDGE.color);
      // Each OSM end of the run: E, the travel direction f along the span
      // there, and u, the outward direction.
      const ends = [];
      const P = run.points;
      if (run.from === 0) ends.push({ E: P[0], f: [P[1][0] - P[0][0], P[1][1] - P[0][1]], out: -1 });
      if (run.to === run.last) ends.push({ E: P[P.length - 1], f: [P[P.length - 1][0] - P[P.length - 2][0], P[P.length - 1][1] - P[P.length - 2][1]], out: 1 });
      for (const { E, f: f0, out } of ends) {
        const l = Math.hypot(f0[0], f0[1]) || 1;
        const f = [f0[0] / l, f0[1] / l];
        const u = [f[0] * out, f[1] * out];
        // n points from the center line to this parapet (the left normal is (-f.z, f.x)).
        const n = [-f[1] * k, f[0] * k];
        // The parapet end S, and the wing end W: out along u, turned away from the road.
        const S = [E[0] + n[0] * (h - pw / 2), E[1] + n[1] * (h - pw / 2)];
        const c = Math.cos(WING.turn);
        const t = Math.sin(WING.turn);
        const dir = [u[0] * c + n[0] * t, u[1] * c + n[1] * t];
        const W = [S[0] + dir[0] * WING.length, S[1] + dir[1] * WING.length];
        const yS = top + deck(S[0], S[1]);
        const gW = terrain.height(W[0], W[1]);
        const gS = terrain.height(S[0], S[1]);
        const yTop = (x, z) => {
          const f = Math.max(0, Math.min(1, ((x - S[0]) * dir[0] + (z - S[1]) * dir[1]) / WING.length));
          return yS + BRIDGE.parapet + (gW + 0.2 - yS - BRIDGE.parapet) * f;
        };
        const yBot = (x, z) => Math.min(terrain.height(x, z), yS - BRIDGE.slab) - WING.foot;
        const w = ribbonEdges([S, W], pw / 2);
        prism(m, w.left, w.right, yBot, yTop, BRIDGE.color);
        // The end post, a little taller and wider than the parapet.
        const q = WING.post / 2;
        const post = ribbonEdges([[S[0] - u[0] * q, S[1] - u[1] * q], [S[0] + u[0] * q, S[1] + u[1] * q]], q);
        prism(m, post.left, post.right, () => Math.min(gS, yS) - WING.foot, () => yS + BRIDGE.parapet + WING.postRise, BRIDGE.color);
      }
    }
  }
  return { deck: deckSurface, structure: m };
}

// Murals on walls that face the trail: [{ id, a: [x, z], b: [x, z], n: [x, z], y0, y1, cell, edge, t0, t1 }].
// Murals, not graffiti: each one is an original design from the atlas.
// `edge` is the wall index in orientRing(b.outer, false), and t0 to t1 is
// the mural span along that wall (m from its start). The facade kit
// (facade-kit.js) puts no sill or pier in that span. On a storefront style
// the mural starts above the awnings and the belt course, so no ledge
// crosses it.
// Murals go on low walls (a real mural wall is a blank side wall of a
// walk-up, a loft, or a shop), not on towers, glass, or open decks.
export const MURAL_MAX_FLOORS = 5;
const MURAL_SKIP_STYLES = new Set(["glass-office", "parking-deck"]);

export function muralWalls(level, { maxCount = 60, maxDistance = 35 } = {}) {
  const trails = (level.strips ?? []).filter((s) => s.kind === "trail").map((s) => s.points);
  const out = [];
  if (!trails.length) return out;
  const buildings = (level.buildings ?? []).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  // A claimed footprint is drawn by its landmark model, so no mural there.
  const claimed = claimedIds(level);
  for (const b of buildings) {
    if (b.height < 5 || claimed.has(b.id)) continue;
    const style = STYLES[STYLE_INDEX[chooseStyle(b, level)]];
    if (MURAL_SKIP_STYLES.has(style.id)) continue;
    const span = buildingSpan(level, b);
    const floors = Math.max(1, Math.round((span.top - span.base) / style.floorHeight));
    // A storefront keeps its shop floor: one floor is no blank wall.
    if (floors > MURAL_MAX_FLOORS || (style.storefront && floors < 2)) continue;
    const ring = orientRing(b.outer, false);
    let best = null;
    for (let i = 0; i < ring.length; i += 1) {
      const [px, pz] = ring[i];
      const [qx, qz] = ring[(i + 1) % ring.length];
      const len = Math.hypot(qx - px, qz - pz);
      if (len < 10) continue;
      const nx = -(qz - pz) / len;
      const nz = (qx - px) / len;
      const mx = (px + qx) / 2;
      const mz = (pz + qz) / 2;
      const near = nearestOnLines(trails, mx, mz);
      if (!near || near.d > maxDistance) continue;
      const facing = (nx * (near.x - mx) + nz * (near.z - mz)) / Math.max(near.d, 1e-6);
      if (facing < 0.6) continue;
      if (!best || len > best.len) best = { len, edge: i, p: [px, pz], q: [qx, qz], n: [nx, nz] };
    }
    if (!best) continue;
    const h = Math.min(b.height - 0.6, 12);
    const w = Math.min(best.len - 2, 3 * (h - 0.8));
    const t = (best.len - w) / 2 / best.len;
    const [px, pz] = best.p;
    const [qx, qz] = best.q;
    // On a slope the mural starts over the higher end of its wall, and over
    // the plinth: a building on a slope stands on a plain plinth up to its
    // base (terrain.js buildingSpan()), with no blank wall under the base.
    const terrain = terrainOf(level);
    const ma = [px + (qx - px) * t, pz + (qz - pz) * t];
    const mb = [qx - (qx - px) * t, qz - (qz - pz) * t];
    const g = Math.max(terrain.height(ma[0], ma[1]), terrain.height(mb[0], mb[1]), span.base);
    const y1 = Math.min(g + h, span.top - 0.6);
    let y0 = g + 0.8;
    if (style.storefront) {
      // The same floors as the facade kit: the belt course is over the
      // ground floor when the building has two floors or more.
      const floors = floorCount(b, style, span.top - span.base);
      const floorH = (span.top - span.base) / floors;
      if (style.awnings > 0) y0 = Math.max(y0, span.base + awningHeight(style) + 0.1);
      if (floors >= 2) y0 = Math.max(y0, span.base + floorH + BELT.height / 2 + 0.1);
    }
    if (y1 - y0 < 2) continue;
    out.push({
      id: b.id,
      a: ma,
      b: mb,
      n: best.n,
      y0,
      y1,
      cell: hash32(`${b.id}:mural`) % MURAL_CELLS,
      edge: best.edge,
      // The wall has no windows from this floor up (FACE.blank).
      floor0: style.storefront ? 1 : 0,
      t0: (best.len - w) / 2,
      t1: (best.len + w) / 2,
    });
    if (out.length >= maxCount) break;
  }
  return out;
}

export function muralMesh(m) {
  const mesh = { positions: [], indices: [], uvs: [] };
  const off = 0.08;
  const [ax, az] = m.a;
  const [bx, bz] = m.b;
  const [nx, nz] = m.n;
  const cx = m.cell % 4;
  const cy = Math.floor(m.cell / 4);
  const pad = 0.004;
  const u0 = cx / 4 + pad;
  const u1 = (cx + 1) / 4 - pad;
  const v0 = 1 - (cy + 1) / 4 + pad;
  const v1 = 1 - cy / 4 - pad;
  const base = 0;
  const pts = [
    [ax + nx * off, m.y0, az + nz * off],
    [bx + nx * off, m.y0, bz + nz * off],
    [bx + nx * off, m.y1, bz + nz * off],
    [ax + nx * off, m.y1, az + nz * off],
  ];
  for (const p of pts) mesh.positions.push(p[0], p[1], p[2]);
  mesh.uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
  // One side, facing out (n): the same winding as an outer wall.
  mesh.indices.push(base, base + 1, base + 3, base + 1, base + 2, base + 3);
  return mesh;
}

// Merges kit props into one mesh per PROP_TILE and level of detail.
// `templates` maps a prop kind to { positions, indices, colors, normals? };
// the LOD1 template of a kind is `<kind>_lod1`. A kind with no LOD1
// template uses its LOD0 template at both levels. Returns
// [{ material: "props", tile, lod, center, mesh }].
export function buildPropMeshes(props, templates) {
  const tiles = new Map();
  for (const p of props) {
    if (!templates[p.kind]) continue;
    const key = `${Math.floor(p.x / PROP_TILE)},${Math.floor(p.z / PROP_TILE)}`;
    let entry = tiles.get(key);
    if (!entry) tiles.set(key, (entry = [0, 1].map(() => ({ positions: [], indices: [], colors: [], normals: [], sway: [] }))));
    placeTemplate(entry[0], templates[p.kind], p);
    placeTemplate(entry[1], templates[`${p.kind}_lod1`] ?? templates[p.kind], p);
  }
  const out = [];
  for (const [tile, entry] of [...tiles].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const [ix, iz] = tile.split(",").map(Number);
    for (const lod of [0, 1]) {
      const m = entry[lod];
      const mesh = { positions: Float32Array.from(m.positions), indices: Uint32Array.from(m.indices), colors: Float32Array.from(m.colors) };
      if (m.normals.length === m.positions.length) mesh.normals = Float32Array.from(m.normals);
      // Every prop tile has the wind attribute, so the wind shader never reads
      // a missing attribute; a kit prop has 0 there.
      mesh.sway = Float32Array.from(m.sway);
      out.push({ material: "props", tile, lod, center: [(ix + 0.5) * PROP_TILE, (iz + 0.5) * PROP_TILE], mesh });
    }
  }
  return out;
}

// The end points (as "kind:x,z") where two at-grade strips of one kind
// meet end to end within 40 m of a bridge end (issue #131).
function jointEnds(level) {
  const strips = (level.strips ?? []).filter((s) => !s.bridge);
  const near = [];
  for (const L of bridgeLayouts(level.strips ?? []).values()) for (const e of L.ends) near.push(e.E);
  const count = new Map();
  for (const s of strips) {
    for (const p of [s.points[0], s.points[s.points.length - 1]]) {
      const key = `${s.kind}:${p[0]},${p[1]}`;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  }
  const out = new Set();
  for (const [key, n] of count) {
    if (n < 2) continue;
    const [x, z] = key.split(":")[1].split(",").map(Number);
    if (near.some((E) => Math.hypot(E[0] - x, E[1] - z) <= 40)) out.add(key);
  }
  return out;
}

// Returns [{ material, tile, mesh }] with each mesh merged. With
// `detail: false` the buildings are plain boxes (the M1-03 look).
// `terrainStep` > 1 drapes on a coarser terrain (a far level of detail for
// the render only), and `surfacesOnly` leaves out everything but the flat
// surfaces. `shard: { index, count }` builds only the tiles of one shard
// (shardOf()), so `count` workers can share a build (#98); mergeGeoShards()
// joins their results into the same list as one full build.
export function buildGeoMeshes(level, { detail = true, terrainStep = 1, surfacesOnly = false, shard = null } = {}) {
  const parts = new Map();
  // An item is built only in the shard of its tile. Every mesh of a
  // (material, tile) key comes from items of that tile, so each merged mesh
  // is built whole, in one shard, in the same order as a full build.
  const mine = shard ? (item) => shardOf(tileOf(...firstPoint(item)), shard.count) === shard.index : () => true;
  function add(material, item, mesh) {
    const [x, z] = firstPoint(item);
    const key = `${material}|${tileOf(x, z)}`;
    let list = parts.get(key);
    if (!list) parts.set(key, (list = []));
    list.push(mesh);
  }

  const { minX, maxX, minZ, maxZ } = level.bounds;
  const groundTop = level.surfaces?.ground ?? 0;
  const terrain = terrainOf(level);
  // A flat surface follows the terrain: drapeMesh() cuts it on the terrain
  // triangles, so the surface offsets (a few cm) hold everywhere.
  const drapeOn = coarseTerrainOf(level, terrainStep);
  const drape = (m) => drapeMesh(m, drapeOn);
  for (let x0 = Math.floor(minX / GEO_TILE) * GEO_TILE; x0 < maxX; x0 += GEO_TILE) {
    for (let z0 = Math.floor(minZ / GEO_TILE) * GEO_TILE; z0 < maxZ; z0 += GEO_TILE) {
      const ax = Math.max(x0, minX);
      const bx = Math.min(x0 + GEO_TILE, maxX);
      const az = Math.max(z0, minZ);
      const bz = Math.min(z0 + GEO_TILE, maxZ);
      const outer = [
        [ax, az],
        [bx, az],
        [bx, bz],
        [ax, bz],
      ];
      if (mine({ outer })) add("surface", { outer }, drape(flatPolygon(outer, [], groundTop, { color: SURFACE_COLORS.ground })));
    }
  }

  for (const a of level.areas ?? []) if (mine(a)) add("surface", a, drape(flatPolygon(a.outer, a.holes ?? [], surfaceTop(level, a.kind), { color: SURFACE_COLORS[a.kind] })));

  // A deck runs on over the end of its approach road to the joint, so the
  // approach road mesh stops at the joint (bridges.js).
  const trims = terrain.flat ? new Map() : approachTrims(level.strips ?? []);
  const endDisks = terrain.flat ? new Set() : jointEnds(level);
  // The streets: split and trimmed at the junctions, with one patch at each
  // junction and a disk at each joint (junctions.js, #138).
  const J = streetJunctions(level, { flat: terrain.flat });
  const streetTopY = (level.strips ?? []).some((s) => s.kind === "street") ? surfaceTop(level, "street") : 0;
  for (const p of J.pieces) if (mine(p.strip)) add("surface", p.strip, drape(stripMesh(p.points, p.width, streetTopY, { bottom: 0, color: SURFACE_COLORS.street })));
  for (const j of J.junctions) if (mine({ points: [[j.x, j.z]] })) add("surface", { points: [[j.x, j.z]] }, drape(flatPolygon(j.ring, [], streetTopY + JOIN_LIFT, { color: SURFACE_COLORS.street })));
  for (const j of J.joints) {
    if (!mine({ points: [[j.x, j.z]] })) continue;
    const ring = [];
    for (let k = 0; k < 16; k += 1) ring.push([j.x + Math.cos((k / 16) * Math.PI * 2) * j.r, j.z + Math.sin((k / 16) * Math.PI * 2) * j.r]);
    add("surface", { points: [[j.x, j.z]] }, drape(flatPolygon(ring, [], streetTopY, { color: SURFACE_COLORS.street })));
  }
  // The raised grass medians of the divided roads (medians.js).
  if (level.surfaces?.sidewalk !== undefined) {
    for (const m of medianStrips(level)) if (mine(m)) add("surface", m, drape(medianMesh(m, surfaceTop(level, "sidewalk"), { grass: SURFACE_COLORS.park, curb: SURFACE_COLORS.sidewalk })));
  }
  const walks = sidewalkLayout(level);
  for (const s of level.strips ?? []) {
    if (s.kind === "street" && !(s.bridge && !terrain.flat)) continue;
    if (!mine(s)) continue;
    const top = surfaceTop(level, s.kind);
    const curb = s.kind === "sidewalk";
    if (s.bridge && !terrain.flat) {
      const { deck, structure } = bridgeMeshes(level, s);
      add("surface", s, deck);
      if (!surfacesOnly) add("building", s, structure);
      continue;
    }
    const trim = trims.get(s.id);
    const points = trimPolyline(s.points, trim);
    if (!points) continue;
    const lay = s.kind === "sidewalk" ? walks.get(s.id) : null;
    let m;
    if (lay) {
      // A sidewalk: its pieces (cut where it crosses a street) and its curb
      // ramps (curbs.js, #136). The approach trims of a bridge still apply.
      m = { positions: [], indices: [], colors: [] };
      const total = s.points.reduce((acc, p, i) => (i ? acc + Math.hypot(p[0] - s.points[i - 1][0], p[1] - s.points[i - 1][1]) : 0), 0);
      const lo = trim?.start ?? 0;
      const hi = total - (trim?.end ?? 0);
      for (const [a, b] of lay.pieces) {
        const r = [Math.max(a, lo), Math.min(b, hi)];
        if (r[1] - r[0] < 0.05) continue;
        stripMesh(piecePoints(s.points, r), s.width, top, { curb, bottom: 0, color: stripColor(s), mesh: m });
      }
      for (const r of lay.ramps) if (r.s0 >= lo && r.s1 <= hi) rampMesh(r, SURFACE_COLORS.sidewalk, 0, m);
    } else m = stripMesh(points, s.width, top, { curb, bottom: 0, color: stripColor(s) });
    // Two strips that meet end to end near a bridge get a joint disk, as at
    // an inner point, so a turn at the meeting point leaves no wedge.
    for (const [cut, p] of [[trim?.start, s.points[0]], [trim?.end, s.points[s.points.length - 1]]]) {
      if (cut > 0 || !endDisks.has(`${s.kind}:${p[0]},${p[1]}`)) continue;
      const ring = [];
      for (let k = 0; k < 16; k += 1) ring.push([p[0] + Math.cos((k / 16) * Math.PI * 2) * (s.width / 2), p[1] + Math.sin((k / 16) * Math.PI * 2) * (s.width / 2)]);
      flatPolygon(ring, [], top, { color: stripColor(s), mesh: m });
    }
    add("surface", s, drape(m));
  }

  if (surfacesOnly) {
    // Only the surfaces (a far level of detail): no buildings, murals, or bridges.
  } else if (detail) {
    const isStreet = streetTest(level);
    // A landmark with `claim: true` replaces its building's extrusion; the
    // mesh still merges as "claimed", so the physics keeps its collider
    // and the render skips it (geo-view.js).
    const claimed = claimedIds(level);
    const murals = muralWalls(level);
    const muralOf = new Map(murals.map((mw) => [mw.id, mw]));
    for (const b of level.buildings ?? []) {
      if (!mine(b)) continue;
      const style = STYLES[STYLE_INDEX[chooseStyle(b, level)]];
      const color = wallColor(style, b.id);
      const mural = muralOf.get(b.id);
      // The mural wall is blank: no windows behind the mural.
      const blank = mural ? { edge: mural.edge, from: mural.floor0 } : null;
      const span = buildingSpan(level, b);
      // The OSM level count, when it fits the height (styles.js floorCount()).
      const facade = { style: STYLE_INDEX[style.id], bay: style.bay, floorHeight: style.floorHeight, floors: floorCount(b, style, span.top - span.base), parapet: style.parapet, corniceColor: style.trim, blank };
      // The plinth is cast stone: the style trim, a little darker.
      const plinth = { bottom: span.foot, color: style.trim.map((c) => c * PLINTH_SHADE) };
      const bucket = claimed.has(b.id) ? "claimed" : "building";
      add(bucket, b, extrudeFootprint({ outer: b.outer, holes: b.holes ?? [], base: span.base, top: span.top }, { color, roofColor: roofColorOf(style, color), facade, plinth }));
      const aw = awningsFor(b, style, isStreet);
      if (aw.indices.length) add(bucket, b, span.base ? liftMesh(aw, () => span.base) : aw);
    }
    for (const m of murals) if (mine({ points: [m.a] })) add("mural", { points: [m.a] }, muralMesh(m));
  } else {
    const claimed = claimedIds(level);
    for (const b of level.buildings ?? []) {
      if (!mine(b)) continue;
      const color = buildingColor(b.id);
      const span = buildingSpan(level, b);
      add(claimed.has(b.id) ? "claimed" : "building", b, extrudeFootprint({ outer: b.outer, holes: b.holes ?? [], base: span.foot, top: span.top }, { color, roofColor: tint(color, 0.35) }));
    }
  }

  const out = [];
  for (const [key, list] of parts) {
    const [material, tile] = key.split("|");
    out.push({ material, tile, mesh: mergeMeshes(list) });
  }
  return sortGeoMeshes(out);
}

// The order of the merged meshes: by material, then by tile. In place.
export function sortGeoMeshes(list) {
  return list.sort((a, b) => GEO_MATERIALS.indexOf(a.material) - GEO_MATERIALS.indexOf(b.material) || (a.tile < b.tile ? -1 : a.tile > b.tile ? 1 : 0));
}

// The shard (0 to count - 1) of a tile key ("x,z"): diagonal stripes (a
// checkerboard for 2), so neighbor tiles (the dense middle of a level) go to
// different shards.
export function shardOf(tile, count) {
  if (count <= 1) return 0;
  const [i, j] = tile.split(",").map(Number);
  return (((i + j) % count) + count) % count;
}

// Joins the results of the shards of one build: the same list as the full
// build (each key is built in one shard only).
export function mergeGeoShards(results) {
  return sortGeoMeshes(results.flat());
}
