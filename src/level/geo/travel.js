// Fast travel (a debug and play-test aid): the skater jumps to a place on
// the full map (src/ui/fullmap.js). Pure.
//
// The skater must land where it can skate, never inside a building. So the
// target point moves to the nearest point on the center line of a trail,
// path, sidewalk, or street strip. The skater faces along that strip.

import { yawFromHeading } from "../../sim/skate/controller.js";

// The strip kinds the skater can land on, in order of preference. The last
// kind (a street) wins only when it is nearer by more than `prefer` meters;
// the kinds between get a part of that.
export const TRAVEL = {
  kinds: ["trail", "path", "sidewalk", "street"],
  prefer: 6,
};

function insideRing(x, z, ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

// The buildings with their boxes, made once for each level.
const boxes = new WeakMap();
function buildingBoxes(level) {
  let list = boxes.get(level);
  if (!list) {
    list = (level.buildings ?? [])
      .filter((b) => b.outer?.length >= 3)
      .map((b) => {
        const xs = b.outer.map((p) => p[0]);
        const zs = b.outer.map((p) => p[1]);
        return { ring: b.outer, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
      });
    boxes.set(level, list);
  }
  return list;
}

// Pure: true when (x, z) is inside a building footprint.
export function inBuilding(level, x, z) {
  return buildingBoxes(level).some((b) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && insideRing(x, z, b.ring));
}

// Pure: the nearest landing spot to (x, z), outside every building:
// { x, z, yaw, strip } or null.
export function travelSpot(level, x, z, { kinds = TRAVEL.kinds, prefer = TRAVEL.prefer } = {}) {
  let best = null;
  const step = kinds.length > 1 ? prefer / (kinds.length - 1) : 0;
  for (const s of level.strips ?? []) {
    const rank = kinds.indexOf(s.kind);
    if (rank < 0 || !(s.points?.length >= 2)) continue;
    for (let i = 1; i < s.points.length; i += 1) {
      const [ax, az] = s.points[i - 1];
      const [bx, bz] = s.points[i];
      const dx = bx - ax;
      const dz = bz - az;
      const l2 = dx * dx + dz * dz;
      if (l2 < 1e-6) continue;
      const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2));
      const px = ax + dx * t;
      const pz = az + dz * t;
      // A small penalty for each step down the preference list.
      const score = Math.hypot(x - px, z - pz) + rank * step;
      if ((!best || score < best.score) && !inBuilding(level, px, pz)) best = { score, x: px, z: pz, yaw: yawFromHeading(dx, dz), strip: s.id ?? null };
    }
  }
  if (!best) return null;
  return { x: best.x, z: best.z, yaw: best.yaw, strip: best.strip };
}

// Pure: the height to sample the ground at for a travel spot (geo-ground.js
// sampleGround(x, z, y)). On a bridge strip, high enough to find the deck;
// on any other strip, the terrain height, so a bridge overhead (more than
// BRIDGE_HEADROOM up) is left out and the skater lands on the lower road.
export function landingProbe(level, spot, ground) {
  const strip = spot.strip ? (level.strips ?? []).find((s) => s.id === spot.strip) : null;
  return strip?.bridge ? ground + 40 : ground;
}
