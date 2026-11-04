// Street name signs at the real intersections. Pure.
//
// OpenStreetMap ways share a node where two streets cross, so two named
// street strips with an equal point make an intersection. Each intersection
// of two different names gets one sign post with two blades, one along each
// street, as on a real Atlanta corner. Divided roads give several nodes for
// one corner; nodes with the same pair of names closer than MERGE_DISTANCE
// count as one intersection.
//
// The build takes the sign names from the City of Atlanta street
// centerlines into `signName` (scripts/street-names.mjs, issue #78). A strip
// with nameSource "osm" has only the OSM fallback name: the city layer does
// not confirm it. Its intersections still count (the crosswalks use them),
// but `confirmed` is false, and the sign is left out.

const MERGE_DISTANCE = 30; // m
// Highway classes that get a sign. Service roads (alleys, parking aisles,
// driveways) have no street sign.
const SIGNED = new Set(["trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street"]);
const RANK = { trunk: 0, primary: 1, secondary: 2, tertiary: 3, unclassified: 4, residential: 5, living_street: 6 };

// The words on a US street sign: short suffixes and the quadrant.
const SHORT = [
  [/\bNortheast\b/g, "NE"],
  [/\bNorthwest\b/g, "NW"],
  [/\bSoutheast\b/g, "SE"],
  [/\bSouthwest\b/g, "SW"],
  [/\bAvenue\b/g, "Ave"],
  [/\bStreet\b/g, "St"],
  [/\bBoulevard\b/g, "Blvd"],
  [/\bDrive\b/g, "Dr"],
  [/\bPlace\b/g, "Pl"],
  [/\bTerrace\b/g, "Ter"],
  [/\bParkway\b/g, "Pkwy"],
  [/\bRoad\b/g, "Rd"],
  [/\bLane\b/g, "Ln"],
  [/\bCircle\b/g, "Cir"],
  [/\bCourt\b/g, "Ct"],
];

export function shortName(name) {
  let s = String(name);
  for (const [re, to] of SHORT) s = s.replace(re, to);
  return s.replace(/\s+/g, " ").trim();
}

// The direction of a strip at point index i, as a unit (dx, dz).
function directionAt(points, i) {
  const a = points[Math.max(0, i - 1)];
  const b = points[Math.min(points.length - 1, i + 1)];
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz) || 1;
  return [dx / len, dz / len];
}

// Returns [{ x, z, names: [a, b], dirs: [[dx, dz], [dx, dz]], halfWidth, confirmed }],
// sorted by x then z, so the list is stable. names[0] is the higher-class
// street (it goes on the top blade).
export function streetIntersections(level) {
  const nodes = new Map();
  for (const s of level.strips ?? []) {
    if (s.kind !== "street" || !s.name || !SIGNED.has(s.highway)) continue;
    s.points.forEach((p, i) => {
      const key = `${p[0]},${p[1]}`;
      let node = nodes.get(key);
      if (!node) nodes.set(key, (node = { x: p[0], z: p[1], streets: new Map() }));
      const name = s.signName ?? s.name;
      if (!node.streets.has(name)) node.streets.set(name, { rank: RANK[s.highway], dir: directionAt(s.points, i), half: s.width / 2, confirmed: s.nameSource !== "osm" });
    });
  }
  const out = [];
  for (const node of nodes.values()) {
    if (node.streets.size < 2) continue;
    const named = [...node.streets.entries()].sort((a, b) => a[1].rank - b[1].rank || (a[0] < b[0] ? -1 : 1));
    const [a, b] = named;
    const pair = [a[0], b[0]];
    const dup = out.find((o) => o.names[0] === pair[0] && o.names[1] === pair[1] && Math.hypot(o.x - node.x, o.z - node.z) < MERGE_DISTANCE);
    if (dup) continue;
    out.push({ x: node.x, z: node.z, names: pair, dirs: [a[1].dir, b[1].dir], halfWidth: Math.max(a[1].half, b[1].half), confirmed: a[1].confirmed && b[1].confirmed });
  }
  return out.sort((p, q) => p.x - q.x || p.z - q.z);
}

// Candidate corner spots for the sign post around an intersection: on the
// four bisectors between the two streets, past the wider street edge. The
// caller takes the first spot that is free.
export function cornerSpots(ix, gap = 2.2) {
  const [[ax, az], [bx, bz]] = ix.dirs;
  const d = ix.halfWidth + gap;
  const spots = [];
  for (const [sa, sb] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    let vx = ax * sa + bx * sb;
    let vz = az * sa + bz * sb;
    const len = Math.hypot(vx, vz);
    if (len < 1e-3) {
      vx = -az * sa;
      vz = ax * sa;
    } else {
      vx /= len;
      vz /= len;
    }
    // On the bisector the corner sits farther out than d.
    const k = d / Math.max(0.5, Math.sqrt((1 + Math.abs(ax * bx + az * bz)) / 2));
    spots.push([ix.x + vx * Math.min(k, d * 1.6), ix.z + vz * Math.min(k, d * 1.6)]);
  }
  return spots;
}
