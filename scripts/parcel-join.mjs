// Joins the level buildings to the Fulton County parcel data (issue #406).
// Pure functions: no file and no network access.
//
// The input is raw/fulton-structures.json (scripts/fulton-structures.mjs):
// the Fulton County structure footprints. Each structure has the parcel id,
// the land use code of the parcel, the year built, and the stories. The
// Fulton Tax Parcels layer is not used (owner choice 2026-11-28).
//
// The output is one `parcel` object for each building that joins:
//   { landUse, yearBuilt, stories }
// - landUse: the Fulton land use code (LUC), for example "101".
// - yearBuilt, stories: absent when the structure has no valid value.
// The parcel id and the structure form stay in the raw file only: the level
// file keeps only the fields that the style uses (the first download size).
// src/level/geo/parcel-style.js turns the object into a facade style.

// The year range that a year built must be in to count.
export const YEAR_RANGE = [1800, 2030];
// The story range that a story count must be in to count.
export const STORY_RANGE = [1, 80];

// Is the point [x, z] inside the ring (even-odd rule)?
export function inRing([x, z], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
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

// Is the point inside the rings, by the even-odd count over all of them?
// A hole (a courtyard) is a ring inside the outer ring, so a point in the
// hole has an even count.
export function inRings(p, rings) {
  let n = 0;
  for (const r of rings) if (inRing(p, r)) n += 1;
  return n % 2 === 1;
}

// A point inside the ring and outside its holes: the vertex mean when it is
// inside, else the middle of the longest inside run on a horizontal line
// through the vertex mean (an L or a U footprint has its mean outside, and a
// footprint with a courtyard can have its mean in the courtyard).
export function interiorPoint(ring, holes = []) {
  const rings = [ring, ...holes];
  let x = 0, z = 0;
  for (const p of ring) { x += p[0]; z += p[1]; }
  x /= ring.length;
  z /= ring.length;
  if (inRings([x, z], rings)) return [x, z];
  for (const dz of [0, 0.5, -0.5, 1, -1, 2, -2, 4, -4]) {
    const zz = z + dz;
    const xs = [];
    for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i, i += 1) {
      const [xi, zi] = r[i];
      const [xj, zj] = r[j];
      if (zi > zz !== zj > zz) xs.push(((xj - xi) * (zz - zi)) / (zj - zi) + xi);
    }
    xs.sort((a, b) => a - b);
    let best = null;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const w = xs[k + 1] - xs[k];
      if (!best || w > best.w) best = { w, x: (xs[k] + xs[k + 1]) / 2 };
    }
    if (best) return [best.x, zz];
  }
  return [x, z];
}

const asYear = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= YEAR_RANGE[0] && n <= YEAR_RANGE[1] ? n : null;
};
const asStories = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= STORY_RANGE[0] && n <= STORY_RANGE[1] ? n : null;
};

// Projects the rows of one layer to local meters. `toLocal(lat, lon)` gives
// [x, z]. Each row keeps its outer rings (an ArcGIS ring in clockwise order)
// and a bounding box for a fast reject.
export function projectRows(rows, toLocal) {
  return rows.map((row) => {
    const rings = row.rings.map((r) => r.map(([lon, lat]) => toLocal(lat, lon)));
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const r of rings) for (const [x, z] of r) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const area = rings.reduce((a, r) => a + ringArea(r), 0);
    return { row, rings, box: { minX, maxX, minZ, maxZ }, area };
  });
}

function containing(items, p) {
  const [x, z] = p;
  // A footprint with a hole (a courtyard): the even-odd count over all
  // rings handles it.
  return items.filter((it) => x >= it.box.minX && x <= it.box.maxX && z >= it.box.minZ && z <= it.box.maxZ && inRings(p, it.rings));
}

// The structure for one building footprint: the structure that holds the
// footprint point; else the largest structure whose own point is inside the
// footprint (the OSM and the county outlines differ by a few meters).
// `holes` are the courtyards of the footprint: a structure in a courtyard is
// not the building.
export function structureFor(outer, structures, holes = []) {
  const rings = [outer, ...holes];
  const p = interiorPoint(outer, holes);
  const hit = containing(structures, p);
  if (hit.length) return hit.reduce((a, b) => (b.area > a.area ? b : a));
  const inside = structures.filter((s) => s.point && inRings(s.point, rings));
  return inside.length ? inside.reduce((a, b) => (b.area > a.area ? b : a)) : null;
}

// The parcel object for one joined structure, or null.
export function parcelFields(structure) {
  const s = structure?.row;
  if (!s) return null;
  const out = {};
  if (s.LUC) out.landUse = s.LUC;
  const yearBuilt = asYear(s.YearBuilt);
  if (yearBuilt) out.yearBuilt = yearBuilt;
  const stories = asStories(s.Stories);
  if (stories) out.stories = stories;
  return Object.keys(out).length ? out : null;
}

// Joins every building to the structure footprints. `data` is
// raw/fulton-structures.json, `toLocal(lat, lon)` is the level projection.
// Returns { byId, counts }: byId maps a building id to its parcel object;
// counts has the coverage.
export function joinParcels(buildings, data, toLocal) {
  const structures = projectRows(data.structures ?? [], toLocal);
  // The structure point: inside its first ring and outside every other ring
  // (a courtyard, by the even-odd rule).
  for (const s of structures) s.point = s.rings[0]?.length >= 3 ? interiorPoint(s.rings[0], s.rings.slice(1)) : null;
  const byId = new Map();
  const counts = { buildings: buildings.length, joined: 0, none: 0, landUse: 0, yearBuilt: 0, stories: 0 };
  for (const b of buildings) {
    const fields = parcelFields(structureFor(b.outer, structures, b.holes ?? []));
    if (!fields) {
      counts.none += 1;
      continue;
    }
    byId.set(b.id, fields);
    counts.joined += 1;
    if (fields.landUse) counts.landUse += 1;
    if (fields.yearBuilt) counts.yearBuilt += 1;
    if (fields.stories) counts.stories += 1;
  }
  return { byId, counts };
}
