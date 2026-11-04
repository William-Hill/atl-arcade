// Parked cars along the curbs (issue #132). Pure and seeded: the same level
// gives the same cars on every load.
//
// The level data has no `parking:lane` tags and no surface lots: the OSM
// fetch takes only buildings, highways, parks, and grass, and the 2 ways in
// the raw data with a `parking:` tag are not enough to use. Thus the street
// width and class decide (see docs/decisions.md):
// - A named neighborhood street (residential, tertiary, unclassified,
//   living street) 8 m wide or more gets cars on one curb, the side from a
//   seed per street. A street 12 m wide or more gets cars on both curbs.
// - A main street with traffic gets no parked cars, so its lanes stay clear.
// - Never on a bridge, never within 14 m of an intersection, never within
//   10 m of the BeltLine trail or a park path, and never within 25 m of the
//   spawn. Each car stands only on street: its center and its 4 corners
//   sample as a street strip.

import { CAR_COLORS, CAR_SIZE, MAIN_STREETS } from "./traffic.js";
import { streetIntersections } from "../../level/geo/signs.js";
import { distanceToSegment } from "../../level/geo/geo-ground.js";
import { hash32, seededRandom } from "../../level/geo/styles.js";

export const PARKING = {
  classes: ["residential", "tertiary", "unclassified", "living_street"],
  minWidth: 8, // m. A narrower street has no room for a parked car.
  bothSides: 12, // m. A street this wide has cars on both curbs.
  slot: 6.5, // m between two slot centers.
  fill: 0.3, // part of the slots with a car. min 0.2 / typical 0.3 / max 0.6.
  curbGap: 0.35, // m from the curb to the car side.
  intersectionGap: 14, // m
  trailGap: 10, // m
  spawnGap: 25, // m
  max: 600, // a safety cap; the level gives about 500.
};

const KINDS = [
  ["sedan", 0.45],
  ["hatchback", 0.3],
  ["pickup", 0.12],
  ["van", 0.13],
];

function pickKind(r) {
  let acc = 0;
  for (const [kind, w] of KINDS) {
    acc += w;
    if (r < acc) return kind;
  }
  return "sedan";
}

// Calls fn(x, z, dx, dz) at each slot along the points.
function slots(points, step, margin, fn) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  let acc = 0;
  let next = margin;
  for (let i = 0; i < points.length - 1; i += 1) {
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    const dx = (bx - ax) / len;
    const dz = (bz - az) / len;
    while (next <= acc + len && next <= total - margin) {
      const t = next - acc;
      fn(ax + dx * t, az + dz * t, dx, dz);
      next += step;
    }
    acc += len;
  }
}

// Returns [{ id, kind, color, x, z, yaw, y }]. `sample` is the ground
// sampler of the level (src/level/geo/geo-ground.js); `heightAt(x, z)`
// gives the street height (flat by default).
export function parkedCars(level, sample, { heightAt = () => 0, mainStreets = MAIN_STREETS } = {}) {
  const main = new Set(mainStreets.flat());
  const streetIds = new Set((level.strips ?? []).filter((s) => s.kind === "street").map((s) => s.id));
  const nodes = streetIntersections(level);
  const keepOff = (level.strips ?? []).filter((s) => s.kind === "trail" || s.kind === "path");
  const [sx, , sz] = level.spawn?.position ?? [Infinity, 0, Infinity];
  const out = [];
  const strips = (level.strips ?? [])
    .filter((s) => s.kind === "street" && s.name && !s.bridge && !main.has(s.name) && PARKING.classes.includes(s.highway) && s.width >= PARKING.minWidth)
    .sort((a, b) => (a.id < b.id ? -1 : 1));

  function nearTrail(x, z) {
    for (const s of keepOff) {
      for (let i = 0; i < s.points.length - 1; i += 1) {
        const [ax, az] = s.points[i];
        const [bx, bz] = s.points[i + 1];
        if (distanceToSegment(x, z, ax, az, bx, bz) < s.width / 2 + PARKING.trailGap) return true;
      }
    }
    return false;
  }

  function onStreet(x, z, dx, dz, size) {
    const hl = size.length / 2;
    const hw = size.width / 2;
    for (const [a, b] of [[0, 0], [hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw]]) {
      const g = sample(x + dx * a - dz * b, z + dz * a + dx * b);
      if (!g || !streetIds.has(g.id)) return false;
    }
    return true;
  }

  for (const s of strips) {
    const rand = seededRandom(hash32(`park:${s.id}`));
    const sides = s.width >= PARKING.bothSides ? [1, -1] : [rand() < 0.5 ? 1 : -1];
    for (const side of sides) {
      slots(s.points, PARKING.slot, PARKING.slot / 2 + 2, (x, z, dx, dz) => {
        if (out.length >= PARKING.max || rand() > PARKING.fill) return;
        const kind = pickKind(rand());
        const size = CAR_SIZE[kind];
        // The right of (dx, dz) is (-dz, dx), as in src/sim/npc/path.js.
        const off = (s.width / 2 - size.width / 2 - PARKING.curbGap) * side;
        const cx = x - dz * off;
        const cz = z + dx * off;
        if (Math.hypot(cx - sx, cz - sz) < PARKING.spawnGap) return;
        if (nodes.some((n) => Math.hypot(n.x - cx, n.z - cz) < PARKING.intersectionGap)) return;
        if (nearTrail(cx, cz)) return;
        if (!onStreet(cx, cz, dx, dz, size)) return;
        // A car faces the way of traffic on its curb (right-hand traffic).
        const fx = side > 0 ? dx : -dx;
        const fz = side > 0 ? dz : -dz;
        out.push({
          id: out.length,
          kind,
          color: Math.floor(rand() * CAR_COLORS.length),
          x: Math.round(cx * 100) / 100,
          z: Math.round(cz * 100) / 100,
          yaw: Math.round(Math.atan2(-fz, fx) * 1000) / 1000,
          y: heightAt(cx, cz),
        });
      });
    }
  }
  return out;
}
