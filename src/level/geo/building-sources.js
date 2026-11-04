// The building source file (issue #88): one record for each building in a
// level. Each fact (name, address, height, floors, facade) has a value, a
// source, and a confidence. Pure functions, so Vitest can test them.
//
// Confidence:
//   high    a value for this building from a primary source
//           (an OSM height tag, a City of Atlanta address point).
//   medium  a value for this building that comes from a rule or a model
//           (OSM levels x 3.2 m + 1 m, an Overture height, a published story count).
//   low     a value that does not come from this building (a type default, a cap).
//   none    no source has a value. The value is null.

export const CONFIDENCE = ["high", "medium", "low", "none"];

// The height sources in the level file (heightSource), with the confidence
// for each one.
export const HEIGHT_CONFIDENCE = {
  override: "medium",
  height: "high",
  levels: "medium",
  overture: "medium",
  "overture-capped": "low",
  default: "low",
};

// The OSM building id for a level building id: "w123-0" -> "w123".
export function osmIdOf(id) {
  return String(id).split("-")[0];
}

// Street words in their USPS short form, for the address check.
const STREET_WORDS = {
  AVENUE: "AVE",
  AV: "AVE",
  STREET: "ST",
  BOULEVARD: "BLVD",
  DRIVE: "DR",
  ROAD: "RD",
  PLACE: "PL",
  COURT: "CT",
  LANE: "LN",
  CIRCLE: "CIR",
  PARKWAY: "PKWY",
  TERRACE: "TER",
  TRAIL: "TRL",
  HIGHWAY: "HWY",
  SQUARE: "SQ",
  ALLEY: "ALY",
  WAY: "WAY",
  NORTHEAST: "NE",
  NORTHWEST: "NW",
  SOUTHEAST: "SE",
  SOUTHWEST: "SW",
  NORTH: "N",
  SOUTH: "S",
  EAST: "E",
  WEST: "W",
};

// One form for an address, so the city text and the OSM text can be compared:
// upper case, no punctuation, USPS short street words.
export function normalizeAddress(text) {
  if (!text) return "";
  return String(text)
    .toUpperCase()
    .replace(/[.,#]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => STREET_WORDS[w] ?? w)
    .join(" ");
}

// The street address of a city address point, with no unit: "725 PONCE DE LEON AVE NE".
export function cityAddressText(p) {
  return normalizeAddress(`${p.number}${p.suffix ? p.suffix : ""} ${p.street}`);
}

// The street address from the OSM addr:* tags, or null.
export function osmAddressText(tags) {
  const n = tags?.["addr:housenumber"];
  const s = tags?.["addr:street"];
  if (!n || !s) return null;
  // A list of numbers ("652, 654" or "652;654") becomes one token: "652;654".
  return normalizeAddress(`${String(n).trim().replace(/\s*[,;]\s*/g, ";")} ${s}`);
}

// True when the two addresses agree. An OSM range such as "727-733" agrees
// with a city number in that range, or with its first number.
export function sameAddress(city, osm) {
  if (!city || !osm) return true;
  if (city === osm) return true;
  const [cn, ...cs] = city.split(" ");
  const [on, ...os] = osm.split(" ");
  // A street with no quadrant ("660 RALPH MCGILL BLVD") agrees with the same
  // street in a quadrant ("660 RALPH MCGILL BLVD NE").
  const QUADRANT = /^(NE|NW|SE|SW)$/;
  const street = (w) => (QUADRANT.test(w.at(-1) ?? "") ? w.slice(0, -1) : w).join(" ");
  const quad = (w) => (QUADRANT.test(w.at(-1) ?? "") ? w.at(-1) : null);
  if (street(cs) !== street(os)) return false;
  if (quad(cs) && quad(os) && quad(cs) !== quad(os)) return false;
  if (cn === on) return true;
  if (on.includes(";")) return on.split(";").includes(cn);
  const range = on.match(/^(\d+)-(\d+)$/);
  if (range) {
    const n = Number(cn);
    return n >= Number(range[1]) && n <= Number(range[2]);
  }
  return false;
}

// Point in polygon (even-odd). The ring is [[x, z], ...], not closed.
export function inRing([x, z], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// True when the point is in the outer ring and in no hole.
export function inFootprint(p, building) {
  if (!inRing(p, building.outer)) return false;
  return !(building.holes ?? []).some((h) => inRing(p, h));
}

// A point inside the footprint: the vertex mean when it is inside, else the
// middle of the widest inside span on a horizontal scan line. Deterministic.
export function interiorPoint(building) {
  const ring = building.outer;
  let x = 0;
  let z = 0;
  for (const p of ring) {
    x += p[0];
    z += p[1];
  }
  const mean = [x / ring.length, z / ring.length];
  if (inFootprint(mean, building)) return mean;
  const zs = ring.map((p) => p[1]);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  let best = null;
  for (let k = 1; k < 32; k += 1) {
    const sz = minZ + ((maxZ - minZ) * k) / 32;
    const xs = [];
    for (const r of [ring, ...(building.holes ?? [])]) {
      for (let i = 0, j = r.length - 1; i < r.length; j = i, i += 1) {
        const [xi, zi] = r[i];
        const [xj, zj] = r[j];
        if (zi > sz !== zj > sz) xs.push(xi + ((sz - zi) * (xj - xi)) / (zj - zi));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const w = xs[i + 1] - xs[i];
      if (!best || w > best.w) best = { w, p: [(xs[i] + xs[i + 1]) / 2, sz] };
    }
  }
  return best ? best.p : mean;
}

// Picks one address for a building from the city points inside it: the
// city address that agrees with the OSM address (two sources agree), else
// the street address with the most points (units share one street address),
// then the lowest point id. Returns null when no point is inside.
export function pickCityAddress(points, osmText = null) {
  if (!points.length) return null;
  const groups = new Map();
  for (const p of points) {
    const text = cityAddressText(p);
    const g = groups.get(text) ?? { text, points: [] };
    g.points.push(p);
    groups.set(text, g);
  }
  const list = [...groups.values()].map((g) => ({ ...g, first: g.points.reduce((a, b) => (a.id < b.id ? a : b)) }));
  const agrees = (g) => (osmText && sameAddress(g.text, osmText) ? 1 : 0);
  list.sort((a, b) => agrees(b) - agrees(a) || b.points.length - a.points.length || a.first.id - b.first.id);
  return { text: list[0].text, point: list[0].first, others: list.slice(1).map((g) => g.text) };
}

// True when the fact has a value or says that no source has one.
export function factHasSource(fact) {
  return Boolean(fact && typeof fact.source === "string" && fact.source.length > 0 && CONFIDENCE.includes(fact.confidence));
}

// The list of problems in one record. Empty when the record is good.
export function recordProblems(record) {
  const out = [];
  for (const key of ["name", "address", "height", "floors", "facade"]) {
    if (!factHasSource(record?.[key])) out.push(`${record?.id}: ${key} has no source or confidence`);
  }
  const h = record?.height;
  if (h && !(h.value > 0)) out.push(`${record.id}: height has no value`);
  if (h && h.source === "none") out.push(`${record.id}: height source is "none"`);
  const a = record?.address;
  if (a && a.value !== null && !Array.isArray(a.point)) out.push(`${record.id}: address has no point`);
  return out;
}
