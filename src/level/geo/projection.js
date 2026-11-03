// Projection from WGS84 latitude and longitude to local meters. Pure.
//
// The local frame matches the level axes: +x east, +y up, +z south. The
// origin is a point (usually the center of the bbox). The projection is a
// local equirectangular projection on a sphere with the WGS84 mean radius.
// Over 2 km the error is less than 1 cm per 100 m, which is good for a level.

export const EARTH_RADIUS = 6371008.8; // m, the IUGG mean radius.
const DEG = Math.PI / 180;

export function createProjection(origin) {
  const { lat: lat0, lon: lon0 } = origin;
  const mPerDegLat = EARTH_RADIUS * DEG;
  const mPerDegLon = EARTH_RADIUS * DEG * Math.cos(lat0 * DEG);
  return {
    origin: { lat: lat0, lon: lon0 },
    mPerDegLat,
    mPerDegLon,
    // Returns [x, z] in meters.
    toLocal(lat, lon) {
      return [(lon - lon0) * mPerDegLon, -(lat - lat0) * mPerDegLat];
    },
    // Returns { lat, lon } for a local [x, z].
    toLatLon(x, z) {
      return { lat: lat0 - z / mPerDegLat, lon: lon0 + x / mPerDegLon };
    },
  };
}

// The bbox is { south, west, north, east } in degrees.
export function bboxCenter(bbox) {
  return { lat: (bbox.south + bbox.north) / 2, lon: (bbox.west + bbox.east) / 2 };
}

// Parses "south,west,north,east" (the Overpass order).
export function parseBbox(text) {
  const raw = String(text).split(",").map((s) => s.trim());
  // Number("") is 0: an empty segment must be an error, not the equator.
  const parts = raw.map((s) => (s === "" ? NaN : Number(s)));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) throw new Error(`bbox: expected south,west,north,east, got "${text}"`);
  const [south, west, north, east] = parts;
  if (south >= north || west >= east) throw new Error(`bbox: south must be < north and west must be < east, got "${text}"`);
  if (Math.abs(south) > 90 || Math.abs(north) > 90 || Math.abs(west) > 180 || Math.abs(east) > 180) throw new Error(`bbox: out of range, got "${text}"`);
  return { south, west, north, east };
}

// Great-circle distance in meters (haversine). Used by the tests.
export function haversine(a, b) {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(h));
}
