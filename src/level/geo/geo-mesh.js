// Turns a geodata level into merged meshes, one per material per tile. Pure.
// The render (src/render/geo-view.js) and the physics (src/physics/world.js)
// both use these meshes, so what the skater sees is what the camera ray hits.
//
// A tile is a square of GEO_TILE meters. One merged mesh per tile keeps the
// draw calls low and still lets Three.js cull the tiles out of view.

import { FACE, extrudeFootprint, flatPolygon, mergeMeshes, orientRing, placeTemplate, stripMesh } from "./extrude.js";
import { createGeoGroundSampler, surfaceTop } from "./geo-ground.js";
import { STYLES, STYLE_INDEX, chooseStyle, hash32, seededRandom, wallColor } from "./styles.js";

export const GEO_TILE = 250; // m.
export const PROP_TILE = 125; // m. Smaller, so far props can be hidden.

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
    out.push({
      id: b.id,
      a: [px + (qx - px) * t, pz + (qz - pz) * t],
      b: [qx - (qx - px) * t, qz - (qz - pz) * t],
      n: best.n,
      y0: 0.8,
      y1: h,
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

// Merges kit props into one mesh per PROP_TILE. `templates` maps a prop
// kind to { positions, indices, colors }.
export function buildPropMeshes(props, templates) {
  const tiles = new Map();
  for (const p of props) {
    const t = templates[p.kind];
    if (!t) continue;
    const key = `${Math.floor(p.x / PROP_TILE)},${Math.floor(p.z / PROP_TILE)}`;
    let mesh = tiles.get(key);
    if (!mesh) tiles.set(key, (mesh = { positions: [], indices: [], colors: [] }));
    placeTemplate(mesh, t, p);
  }
  const out = [];
  for (const [tile, mesh] of [...tiles].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const [ix, iz] = tile.split(",").map(Number);
    out.push({
      material: "props",
      tile,
      center: [(ix + 0.5) * PROP_TILE, (iz + 0.5) * PROP_TILE],
      mesh: { positions: Float32Array.from(mesh.positions), indices: Uint32Array.from(mesh.indices), colors: Float32Array.from(mesh.colors) },
    });
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
      add("surface", { outer }, flatPolygon(outer, [], groundTop, { color: SURFACE_COLORS.ground }));
    }
  }

  for (const a of level.areas ?? []) add("surface", a, flatPolygon(a.outer, a.holes ?? [], surfaceTop(level, a.kind), { color: SURFACE_COLORS[a.kind] }));

  for (const s of level.strips ?? []) {
    const top = surfaceTop(level, s.kind);
    const curb = s.kind === "sidewalk";
    add("surface", s, stripMesh(s.points, s.width, top, { curb, bottom: 0, color: SURFACE_COLORS[s.kind] }));
  }

  if (detail) {
    const stripKind = new Map((level.strips ?? []).map((s) => [s.id, s.kind]));
    const sample = createGeoGroundSampler(level);
    const isStreet = (x, z) => STREET_KINDS.has(stripKind.get(sample(x, z)?.id));
    for (const b of level.buildings ?? []) {
      const style = STYLES[STYLE_INDEX[chooseStyle(b)]];
      const color = wallColor(style, b.id);
      const facade = { style: STYLE_INDEX[style.id], bay: style.bay, floorHeight: style.floorHeight, parapet: style.parapet, corniceColor: style.trim };
      add("building", b, extrudeFootprint({ outer: b.outer, holes: b.holes ?? [], base: 0, top: b.height }, { color, roofColor: tint(color, 0.45), facade }));
      const aw = awningsFor(b, style, isStreet);
      if (aw.indices.length) add("building", b, aw);
    }
    for (const m of muralWalls(level)) add("mural", { points: [m.a] }, muralMesh(m));
  } else {
    for (const b of level.buildings ?? []) {
      const color = buildingColor(b.id);
      add("building", b, extrudeFootprint({ outer: b.outer, holes: b.holes ?? [], base: 0, top: b.height }, { color, roofColor: tint(color, 0.35) }));
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
