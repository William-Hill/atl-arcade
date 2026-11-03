// Turns a geodata level into merged meshes, one per material per tile. Pure.
// The render (src/render/geo-view.js) and the physics (src/physics/world.js)
// both use these meshes, so what the skater sees is what the camera ray hits.
//
// A tile is a square of GEO_TILE meters. One merged mesh per tile keeps the
// draw calls low and still lets Three.js cull the tiles out of view.

import { FACE, extrudeFootprint, flatPolygon, mergeMeshes, orientRing, placeTemplate, stripMesh } from "./extrude.js";
import { createGeoGroundSampler, surfaceTop } from "./geo-ground.js";
import { STYLES, STYLE_INDEX, chooseStyle, hash32, seededRandom, wallColor } from "./styles.js";
import { BRIDGE, bridgeDeck, buildingSpan, drapeMesh, liftMesh, terrainOf } from "./terrain.js";

export const GEO_TILE = 125; // m. Small enough that the camera culls most of the draped terrain.
export const PROP_TILE = 50; // m. Small, so only near props get full detail.

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
};

// Building wall colors: a warm, bright palette (Jet Set Radio style). The
// roof is a lighter tint of the wall.
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
  const base = mesh.positions.length / 3;
  for (const [i, p] of [a, b, c, d].entries()) {
    mesh.positions.push(p[0], p[1], p[2]);
    if (mesh.colors) mesh.colors.push(color[0], color[1], color[2]);
    if (mesh.facade) mesh.facade.push(0, 0, 0, FACE.roof);
    if (mesh.uvs) mesh.uvs.push(uv[i][0], uv[i][1]);
  }
  // Both sides, so an awning shows from below and above.
  mesh.indices.push(base, base + 1, base + 2, base, base + 2, base + 3, base, base + 2, base + 1, base, base + 3, base + 2);
}

// Awnings over the street-facing ground floor of a storefront style.
// `isStreet(x, z)` says if a point is on a street, sidewalk, path, or trail.
export function awningsFor(b, style, isStreet) {
  const mesh = { positions: [], indices: [], colors: [], facade: [] };
  if (!style.storefront || !(style.awnings > 0)) return mesh;
  const ring = orientRing(b.outer, false);
  const rand = seededRandom(hash32(`${b.id}:awning`));
  const color = AWNING_COLORS[hash32(`${b.id}:awning-color`) % AWNING_COLORS.length];
  const y0 = Math.min(style.floorHeight * 0.8, 3.4);
  for (let i = 0; i < ring.length; i += 1) {
    const [px, pz] = ring[i];
    const [qx, qz] = ring[(i + 1) % ring.length];
    const len = Math.hypot(qx - px, qz - pz);
    if (len < 4) continue;
    const nx = -(qz - pz) / len;
    const nz = (qx - px) / len;
    const mx = (px + qx) / 2;
    const mz = (pz + qz) / 2;
    if (!isStreet(mx + nx * 4, mz + nz * 4)) continue;
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

// A bridge: its slab sides and two parapets, in the facade material (no
// windows), lifted onto the deck line. The deck top is a surface strip.

function boxAlong(m, a, b, o0, o1, y0, y1, deck, color) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return;
  const nx = -dz / len;
  const nz = dx / len;
  const P = (p, o, y) => [p[0] + nx * o, y + deck(p[0] + nx * o, p[1] + nz * o), p[1] + nz * o];
  const faces = [
    [P(a, o0, y0), P(b, o0, y0), P(b, o0, y1), P(a, o0, y1), [-nx, 0, -nz]],
    [P(a, o1, y0), P(b, o1, y0), P(b, o1, y1), P(a, o1, y1), [nx, 0, nz]],
    [P(a, o0, y1), P(b, o0, y1), P(b, o1, y1), P(a, o1, y1), [0, 1, 0]],
    [P(a, o0, y0), P(b, o0, y0), P(b, o1, y0), P(a, o1, y0), [0, -1, 0]],
  ];
  for (const [p0, p1, p2, p3, n] of faces) {
    const base = m.positions.length / 3;
    for (const q of [p0, p1, p2, p3]) {
      m.positions.push(q[0], q[1], q[2]);
      m.colors.push(color[0], color[1], color[2]);
      m.facade.push(0, 0, 0, FACE.cornice);
    }
    const ux = p1[0] - p0[0];
    const uy = p1[1] - p0[1];
    const uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0];
    const vy = p2[1] - p0[1];
    const vz = p2[2] - p0[2];
    const dot = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
    if (dot >= 0) m.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else m.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
}

// The structure of one bridge strip: { deck: surface mesh, structure: mesh }.
export function bridgeMeshes(level, s) {
  const top = surfaceTop(level, s.kind);
  const deck = bridgeDeck(level, s);
  // A point each 1.5 m, so the mesh follows the deck arch.
  const pts = [s.points[0]];
  for (let i = 0; i < s.points.length - 1; i += 1) {
    const [ax, az] = s.points[i];
    const [bx, bz] = s.points[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 1.5));
    for (let k = 1; k <= n; k += 1) pts.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  const deckMesh = liftMesh(stripMesh(pts, s.width, top, { color: SURFACE_COLORS[s.kind], jointSides: 0 }), deck);
  const m = { positions: [], indices: [], colors: [], facade: [] };
  const h = s.width / 2;
  const pw = BRIDGE.parapetWidth;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    // The slab under the deck, and a parapet on each side.
    boxAlong(m, a, b, -h, h, top - BRIDGE.slab, top - 0.01, deck, BRIDGE.color);
    boxAlong(m, a, b, -h, -h + pw, top, top + BRIDGE.parapet, deck, BRIDGE.color);
    boxAlong(m, a, b, h - pw, h, top, top + BRIDGE.parapet, deck, BRIDGE.color);
  }
  return { deck: deckMesh, structure: m };
}

// Murals on walls that face the trail: [{ id, a: [x, z], b: [x, z], n: [x, z], y0, y1, cell }].
// Murals, not graffiti: each one is an original design from the atlas.
export function muralWalls(level, { maxCount = 60, maxDistance = 35 } = {}) {
  const trails = (level.strips ?? []).filter((s) => s.kind === "trail").map((s) => s.points);
  const out = [];
  if (!trails.length) return out;
  const buildings = (level.buildings ?? []).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const b of buildings) {
    if (b.height < 5) continue;
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
      if (!best || len > best.len) best = { len, p: [px, pz], q: [qx, qz], n: [nx, nz] };
    }
    if (!best) continue;
    const h = Math.min(b.height - 0.6, 12);
    const w = Math.min(best.len - 2, 3 * (h - 0.8));
    const t = (best.len - w) / 2 / best.len;
    const [px, pz] = best.p;
    const [qx, qz] = best.q;
    // On a slope the mural starts over the higher end of its wall.
    const terrain = terrainOf(level);
    const ma = [px + (qx - px) * t, pz + (qz - pz) * t];
    const mb = [qx - (qx - px) * t, qz - (qz - pz) * t];
    const g = Math.max(terrain.height(ma[0], ma[1]), terrain.height(mb[0], mb[1]));
    const span = buildingSpan(level, b);
    const y1 = Math.min(g + h, span.top - 0.6);
    if (y1 - (g + 0.8) < 2) continue;
    out.push({
      id: b.id,
      a: ma,
      b: mb,
      n: best.n,
      y0: g + 0.8,
      y1,
      cell: hash32(`${b.id}:mural`) % MURAL_CELLS,
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
    if (!entry) tiles.set(key, (entry = [0, 1].map(() => ({ positions: [], indices: [], colors: [], normals: [] }))));
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
      out.push({ material: "props", tile, lod, center: [(ix + 0.5) * PROP_TILE, (iz + 0.5) * PROP_TILE], mesh });
    }
  }
  return out;
}

// Returns [{ material, tile, mesh }] with each mesh merged. With
// `detail: false` the buildings are plain boxes (the M1-03 look).
export function buildGeoMeshes(level, { detail = true } = {}) {
  const parts = new Map();
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
  const drape = (m) => drapeMesh(m, terrain);
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
      add("surface", { outer }, drape(flatPolygon(outer, [], groundTop, { color: SURFACE_COLORS.ground })));
    }
  }

  for (const a of level.areas ?? []) add("surface", a, drape(flatPolygon(a.outer, a.holes ?? [], surfaceTop(level, a.kind), { color: SURFACE_COLORS[a.kind] })));

  for (const s of level.strips ?? []) {
    const top = surfaceTop(level, s.kind);
    const curb = s.kind === "sidewalk";
    if (s.bridge && !terrain.flat) {
      const { deck, structure } = bridgeMeshes(level, s);
      add("surface", s, deck);
      add("building", s, structure);
      continue;
    }
    add("surface", s, drape(stripMesh(s.points, s.width, top, { curb, bottom: 0, color: SURFACE_COLORS[s.kind] })));
  }

  if (detail) {
    const stripKind = new Map((level.strips ?? []).map((s) => [s.id, s.kind]));
    const sample = createGeoGroundSampler(level);
    const isStreet = (x, z) => STREET_KINDS.has(stripKind.get(sample(x, z)?.id));
    for (const b of level.buildings ?? []) {
      const style = STYLES[STYLE_INDEX[chooseStyle(b)]];
      const color = wallColor(style, b.id);
      const facade = { style: STYLE_INDEX[style.id], bay: style.bay, floorHeight: style.floorHeight, parapet: style.parapet, corniceColor: style.trim };
      const span = buildingSpan(level, b);
      add("building", b, extrudeFootprint({ outer: b.outer, holes: b.holes ?? [], base: span.base, top: span.top }, { color, roofColor: tint(color, 0.45), facade }));
      const aw = awningsFor(b, style, isStreet);
      if (aw.indices.length) add("building", b, span.base ? liftMesh(aw, () => span.base) : aw);
    }
    for (const m of muralWalls(level)) add("mural", { points: [m.a] }, muralMesh(m));
  } else {
    for (const b of level.buildings ?? []) {
      const color = buildingColor(b.id);
      const span = buildingSpan(level, b);
      add("building", b, extrudeFootprint({ outer: b.outer, holes: b.holes ?? [], base: span.base, top: span.top }, { color, roofColor: tint(color, 0.35) }));
    }
  }

  const out = [];
  for (const [key, list] of parts) {
    const [material, tile] = key.split("|");
    out.push({ material, tile, mesh: mergeMeshes(list) });
  }
  out.sort((a, b) => GEO_MATERIALS.indexOf(a.material) - GEO_MATERIALS.indexOf(b.material) || (a.tile < b.tile ? -1 : 1));
  return out;
}
