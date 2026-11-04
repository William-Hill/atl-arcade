// The street names on the signs, from the City of Atlanta street
// centerlines (issue #78). Pure: build-block.mjs calls it with the level
// strips and the centerline segments in local meters.
//
// For each named street strip, in this order:
//   1. A city line near the strip has the same name. Use the OSM name.
//   2. A city line near the strip has the same name without the quadrant,
//      or a spelling one letter apart ("Bishop Way" and "Bishops Way").
//      Use the city label.
//   3. The OSM name is in REVIEWED. Use the OSM name.
//   4. One city line runs along most of the strip. Use its label: the OSM
//      name is a mapper note or a wrong name ("Closed Lake Avenue").
//   5. No city line matches. The OSM name stays the fallback, with
//      nameSource "osm" and no signName. A sign does not show a fallback name.
//
// The strip `name` stays the OSM name (the ODbL data). The sign name goes
// in `signName`, in the short form of a US street sign.
//
// The words keep the OSM capitals where the words are equal ("McGill", not
// the city "Mcgill").

import { shortName } from "../src/level/geo/signs.js";

// OSM names that are correct where the city layer is out of date. Each entry
// needs a reason and a source.
export const REVIEWED = {
  "John Lewis Freedom Parkway Northeast":
    "The city renamed Freedom Parkway for John Lewis in 2018. The city centerlines still have the old labels Freedom Pkwy North NE and Freedom Pkwy South NE. Source: audit #65, production/audits/2026-11-playability/education-accuracy/FINDINGS.md.",
};

const NEAR = 40; // m: a city line this close can give the name (steps 1 and 2).
const ALONG = 15; // m: a city line this close runs along the strip (step 4).
const MIN_SHARE = 0.6; // step 4: the share of the strip length on one label.
const MIN_COS = 0.7; // step 4: the city line and the strip point the same way.
const STEP = 5; // m between the sample points on a strip.

const lower = (s) => shortName(s).toLowerCase();
const base = (s) => lower(s).replace(/\s+(ne|nw|se|sw)$/, "");

function editDistanceAtMostOne(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

// The city label with the OSM capitals on the words that are equal.
export function withOsmCase(label, osmName) {
  const osm = new Map(shortName(osmName).split(" ").map((w) => [w.toLowerCase(), w]));
  return shortName(label)
    .split(" ")
    .map((w) => osm.get(w.toLowerCase()) ?? w)
    .join(" ");
}

// Sample points along a polyline, with the unit direction and the length
// that each sample stands for.
function samples(points) {
  const out = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (!len) continue;
    const n = Math.max(1, Math.ceil(len / STEP));
    for (let k = 0; k < n; k += 1) {
      const t = (k + 0.5) / n;
      out.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, dx: (bx - ax) / len, dz: (bz - az) / len, len: len / n });
    }
  }
  return out;
}

function toSegment(x, z, s) {
  const ex = s.bx - s.ax;
  const ez = s.bz - s.az;
  const l2 = ex * ex + ez * ez || 1;
  const t = Math.max(0, Math.min(1, ((x - s.ax) * ex + (z - s.az) * ez) / l2));
  return Math.hypot(x - s.ax - t * ex, z - s.az - t * ez);
}

// `lines` is [{ label, points: [[x, z], ...] }] in local meters.
// Returns a function: strip -> { signName?, nameSource }.
export function createStreetNamer(lines) {
  const segs = [];
  for (const line of lines) {
    if (!line.label) continue;
    for (let i = 0; i < line.points.length - 1; i += 1) {
      const [ax, az] = line.points[i];
      const [bx, bz] = line.points[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len) segs.push({ label: line.label, ax, az, bx, bz, ux: (bx - ax) / len, uz: (bz - az) / len });
    }
  }

  return function nameOf(strip) {
    const osmName = strip.name;
    const pts = samples(strip.points);
    if (!pts.length) pts.push({ x: strip.points[0][0], z: strip.points[0][1], dx: 1, dz: 0, len: 0 });
    // The city labels near the strip, and the label along each sample.
    const near = new Set();
    const along = new Map();
    let total = 0;
    for (const p of pts) {
      let best = null;
      for (const s of segs) {
        const d = toSegment(p.x, p.z, s);
        if (d <= NEAR) near.add(s.label);
        if (d <= ALONG && Math.abs(s.ux * p.dx + s.uz * p.dz) >= MIN_COS && (!best || d < best.d)) best = { d, label: s.label };
      }
      total += p.len;
      if (best) along.set(best.label, (along.get(best.label) ?? 0) + p.len);
    }
    const labels = [...near].sort();
    // 1. The same name.
    if (labels.some((l) => lower(l) === lower(osmName))) return { signName: shortName(osmName), nameSource: "city" };
    // 2. The same name without the quadrant, or one letter apart.
    const b = base(osmName);
    const same = labels.find((l) => base(l) === b) ?? labels.find((l) => b.length >= 5 && editDistanceAtMostOne(base(l), b));
    if (same) return { signName: withOsmCase(same, osmName), nameSource: "city" };
    // 3. A reviewed OSM name.
    if (REVIEWED[osmName]) return { signName: shortName(osmName), nameSource: "reviewed" };
    // 4. One city line along most of the strip.
    const top = [...along].sort((p, q) => q[1] - p[1] || (p[0] < q[0] ? -1 : 1))[0];
    if (top && total > 0 && top[1] / total >= MIN_SHARE) return { signName: withOsmCase(top[0], osmName), nameSource: "city" };
    // 5. The OSM fallback.
    return { nameSource: "osm" };
  };
}
