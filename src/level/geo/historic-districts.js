// The City of Atlanta historic districts of a level, and the house style mix
// of each district (issue #407). Pure.
//
// scripts/historic-districts.mjs writes levels/<level>/historic-districts.json
// from the City of Atlanta "Historic District - Open Data" layer. At load
// time withHistoricDistricts() projects the rings to the level frame and
// writes `historicDistrict` (the district id) on each building whose
// footprint center is in a district. The tag is on the building, so every
// chooseStyle(b) call (with or without the level) gives the same style.
//
// districtStyleMix() is the hook of chooseStyle() in styles.js: it changes
// only a house (a craftsman or shotgun pick) in a district with a mix. A
// storefront, an apartment, a named landmark, or a building out of every
// district keeps its style. The facts for each mix and their sources are in
// docs/research/2026-11-28-inman-park-victorian.md.

import { createProjection } from "./projection.js";
import { hash32 } from "./styles.js";

// The house styles that a district mix can change.
const HOUSE_PICKS = new Set(["craftsman-house", "shotgun-house"]);

// The house mix of each district: [style, weight] rows, weights sum to 100.
// - Inman Park (1889 on, Joel Hurt): mostly Queen Anne and other Victorian
//   houses, then the later Craftsman bungalows, and a few cottages.
// - Cabbagetown (the Fulton Bag and Cotton Mill village): mostly mill
//   cottages and shotgun houses.
// - Martin Luther King Jr. Landmark District (Old Fourth Ward, Auburn
//   Avenue): Queen Anne houses on Auburn Avenue, as the MLK Birth Home, with
//   shotgun rows on the side streets.
export const HISTORIC_MIX = {
  "inman-park": [["victorian-house", 70], ["craftsman-house", 22], ["shotgun-house", 8]],
  cabbagetown: [["shotgun-house", 65], ["craftsman-house", 25], ["victorian-house", 10]],
  "martin-luther-king-jr": [["shotgun-house", 50], ["victorian-house", 30], ["craftsman-house", 20]],
};

// The district id of a City district name: lower case, no "historic",
// "landmark", or "district" word. "Inman Park Historic District" ->
// "inman-park".
export function districtSlug(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/\b(historic|histroric|landmark|conservation|district)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function inRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Pure: the districts of the file in the level frame: [{ id, name, rings }]
// with each ring as [x, z] meters. An ArcGIS polygon can have holes; the
// even-odd test over all rings handles them.
export function projectDistricts(file, origin) {
  if (!file?.districts?.length || !origin) return [];
  const proj = createProjection(origin);
  return file.districts.map((d) => ({
    id: d.id,
    name: d.name,
    rings: d.rings.map((r) => r.map(([lon, lat]) => {
      const p = proj.toLocal(lat, lon);
      return Array.isArray(p) ? [p[0], p[1]] : [p.x, p.z];
    })),
  }));
}

// Pure: the id of the district at [x, z], or null.
export function districtAt(x, z, districts) {
  for (const d of districts) {
    let inside = false;
    for (const r of d.rings) if (inRing(x, z, r)) inside = !inside;
    if (inside) return d.id;
  }
  return null;
}

function center(ring) {
  let x = 0;
  let z = 0;
  for (const p of ring) {
    x += p[0];
    z += p[1];
  }
  return [x / ring.length, z / ring.length];
}

// Pure: the level with `historicDistrict` on each building in a district,
// and the City credit on the attribution. The input level does not change.
export function withHistoricDistricts(level, file) {
  const districts = projectDistricts(file, level?.origin);
  if (!districts.length) return level;
  const buildings = (level.buildings ?? []).map((b) => {
    if (!(b.outer?.length >= 3)) return b;
    const id = districtAt(...center(b.outer), districts);
    return id ? { ...b, historicDistrict: id } : b;
  });
  const credit = file.attribution;
  const attribution = credit && level.attribution && !level.attribution.includes(credit) ? `${level.attribution}. ${credit}` : level.attribution;
  return { ...level, buildings, attribution, historicDistricts: districts.map(({ id, name }) => ({ id, name })) };
}

// The style of building `b` after its district mix: `pick` (the style of
// the normal rules) when the building is in no district with a mix, or when
// `pick` is not a house. Deterministic for a building id.
// A house with a Fulton County year built (`b.parcel.yearBuilt`, #406) of
// MIX_YEAR_END or later keeps `pick`: the mix is for the historic stock, not
// for a new house in the district.
export const MIX_YEAR_END = 1945;
export function districtStyleMix(b, pick) {
  const mix = b?.historicDistrict ? HISTORIC_MIX[b.historicDistrict] : null;
  if (!mix || !HOUSE_PICKS.has(pick)) return pick;
  const year = b.parcel?.yearBuilt ?? null;
  if (year !== null && year >= MIX_YEAR_END) return pick;
  const r = hash32(`${b.id}:historic`) % 100;
  let acc = 0;
  for (const [id, w] of mix) {
    acc += w;
    if (r < acc) return id;
  }
  return pick;
}
