// Concrete aprons around the storefront buildings of a geodata level. Pure.
//
// A shop meets paving, not grass: each storefront building gets a strip of
// concrete along every wall, `side` meters wide, and `front` meters wide on
// its front wall (frontEdge() in facade-kit.js). A square fills each outside
// corner. The strips use the sidewalk art color, so the surface shader gives
// them the concrete scan.
//
// The apron is `lift` over the ground top: under the park, the streets, the
// paths, and the sidewalks, so a real street or sidewalk draws over it. The
// strips of two buildings can overlap. They are on the same plane with the
// same color, so the overlap does not show.
//
// The output is a list of meshes { tile, mesh: { positions, indices,
// colors } }, one per GEO_TILE square, with the building tile keys of
// buildGeoMeshes() (the tile of the first ring point). The view drapes each
// mesh on the terrain and merges it into the render copy of its surface
// tile, as it does with the road markings. The physics and the ground
// sampler do not see the aprons: the colliders do not change.

import { orientRing } from "./extrude.js";
import { frontEdges } from "./facade-kit.js";
import { GEO_TILE, SURFACE_COLORS } from "./geo-mesh.js";
import { STYLES, STYLE_INDEX, chooseStyle } from "./styles.js";

export const APRON = { side: 1.8, front: 3.5, lift: 0.012, minWall: 0.3 };

// An up-facing quad: the winding is set from the signed area, so the
// triangles face up for any order of the 4 points.
function upQuad(m, a, b, c, d, y, color) {
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) + (c[0] - a[0]) * (d[1] - a[1]) - (c[1] - a[1]) * (d[0] - a[0]);
  if (Math.abs(area) < 1e-6) return;
  const base = m.positions.length / 3;
  for (const p of [a, b, c, d]) {
    m.positions.push(p[0], y, p[1]);
    m.colors.push(color[0], color[1], color[2]);
  }
  // In x-z with y up, a face points up when its x-z winding is clockwise
  // seen from above (a negative cross product here).
  if (area < 0) m.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  else m.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
}

// Pure: the apron of one ring, into mesh `m`. `widths[i]` is the width of
// the strip on wall i (from ring[i] to ring[i + 1]). Returns the number of
// strips.
export function apronRing(m, ring, widths, y, color = SURFACE_COLORS.sidewalk) {
  const n = ring.length;
  const walls = [];
  for (let i = 0; i < n; i += 1) {
    const [px, pz] = ring[i];
    const [qx, qz] = ring[(i + 1) % n];
    const len = Math.hypot(qx - px, qz - pz);
    // The outward normal of an outer ring edge is (-dz, dx); see offsetRing().
    walls.push(len > 1e-9 ? { len, n: [-(qz - pz) / len, (qx - px) / len] } : { len: 0, n: [0, 0] });
  }
  let strips = 0;
  for (let i = 0; i < n; i += 1) {
    const w = walls[i];
    const d = widths[i];
    if (w.len < APRON.minWall || !(d > 0)) continue;
    const p = ring[i];
    const q = ring[(i + 1) % n];
    const o = [w.n[0] * d, w.n[1] * d];
    upQuad(m, p, q, [q[0] + o[0], q[1] + o[1]], [p[0] + o[0], p[1] + o[1]], y, color);
    strips += 1;
  }
  // The corner fill at each outside corner: the parallelogram between the
  // ends of the two strips.
  for (let i = 0; i < n; i += 1) {
    const j = (i - 1 + n) % n;
    const a = walls[j];
    const b = walls[i];
    if (a.len < APRON.minWall || b.len < APRON.minWall) continue;
    // An outside corner turns away from the outward normal of the wall before it.
    const [px, pz] = ring[i];
    const [qx, qz] = ring[(i + 1) % n];
    const t = [(qx - px) / b.len, (qz - pz) / b.len];
    if (a.n[0] * t[0] + a.n[1] * t[1] > -1e-3) continue;
    const da = widths[j];
    const db = widths[i];
    const p = ring[i];
    const pa = [p[0] + a.n[0] * da, p[1] + a.n[1] * da];
    const pb = [p[0] + b.n[0] * db, p[1] + b.n[1] * db];
    upQuad(m, p, pa, [pa[0] + b.n[0] * db, pa[1] + b.n[1] * db], pb, y, color);
  }
  return strips;
}

// Pure: the aprons of a level. `fronts` is the Map of frontEdges() (it is
// an option, so the view can share the map with the kit).
export function storefrontAprons(level, fronts = frontEdges(level)) {
  const y = (level.surfaces?.ground ?? 0) + APRON.lift;
  const tiles = new Map();
  const buildings = (level.buildings ?? []).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const b of buildings) {
    if (!(b.outer?.length >= 3) || !(b.height > 0)) continue;
    if (!STYLES[STYLE_INDEX[chooseStyle(b)]].storefront) continue;
    const ring = orientRing(b.outer, false);
    const front = fronts.get(b.id);
    const widths = ring.map((_, i) => (front && i === front.edge ? APRON.front : APRON.side));
    const [x, z] = b.outer[0];
    const key = `${Math.floor(x / GEO_TILE)},${Math.floor(z / GEO_TILE)}`;
    let m = tiles.get(key);
    if (!m) tiles.set(key, (m = { positions: [], indices: [], colors: [] }));
    apronRing(m, ring, widths, y);
  }
  return [...tiles.entries()]
    .filter(([, m]) => m.indices.length)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([tile, m]) => ({ tile, mesh: { positions: Float32Array.from(m.positions), indices: Uint32Array.from(m.indices), colors: Float32Array.from(m.colors) } }));
}
