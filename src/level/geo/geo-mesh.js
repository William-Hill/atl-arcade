// Turns a geodata level into merged meshes, one per material per tile. Pure.
// The render (src/render/geo-view.js) and the physics (src/physics/world.js)
// both use these meshes, so what the skater sees is what the camera ray hits.
//
// A tile is a square of GEO_TILE meters. One merged mesh per tile keeps the
// draw calls low and still lets Three.js cull the tiles out of view.

import { extrudeFootprint, flatPolygon, mergeMeshes, stripMesh } from "./extrude.js";
import { surfaceTop } from "./geo-ground.js";

export const GEO_TILE = 250; // m.

// Material groups. Each group is one material in the render. All flat
// surfaces share one material and get their color from vertex colors.
export const GEO_MATERIALS = ["surface", "building"];

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

// Returns [{ material, tile, mesh }] with each mesh merged.
export function buildGeoMeshes(level) {
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

  for (const b of level.buildings ?? []) {
    const color = buildingColor(b.id);
    add("building", b, extrudeFootprint({ outer: b.outer, holes: b.holes ?? [], base: 0, top: b.height }, { color, roofColor: tint(color, 0.35) }));
  }

  const out = [];
  for (const [key, list] of parts) {
    const [material, tile] = key.split("|");
    out.push({ material, tile, mesh: mergeMeshes(list) });
  }
  out.sort((a, b) => GEO_MATERIALS.indexOf(a.material) - GEO_MATERIALS.indexOf(b.material) || (a.tile < b.tile ? -1 : 1));
  return out;
}
