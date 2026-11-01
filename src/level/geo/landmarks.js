// Placement of landmark models on real footprints. Pure.
//
// A landmark model (from img2threejs, see landmarks/<name>/) covers only the
// parts that the extruded footprint cannot show, for example a tower top.
// This module finds where those parts stand on the real roof.

import { pointInRings } from "./geo-ground.js";

export const LANDMARKS = [
  {
    id: "ponce-city-market",
    buildingName: "Ponce City Market",
    // The tower stands near the north edge (Ponce de Leon Avenue side),
    // and the sign stands on the east edge, facing the BeltLine trail.
    // Both are approximate: the photo is one aerial view.
    tower: { side: [0, -1], inset: 14 },
    sign: { side: [1, 0], inset: 6, text: "PONCE CITY MARKET", width: 36, height: 5.5 },
  },
];

function centroid(ring) {
  let x = 0;
  let z = 0;
  for (const p of ring) {
    x += p[0];
    z += p[1];
  }
  return [x / ring.length, z / ring.length];
}

// The point inside the footprint nearest to its centroid (the centroid of a
// concave footprint can lie outside it). A 2 m grid search.
export function interiorPoint(b) {
  const rings = [b.outer, ...(b.holes ?? [])];
  const [cx, cz] = centroid(b.outer);
  if (pointInRings(cx, cz, rings)) return [cx, cz];
  for (let r = 2; r < 500; r += 2) {
    for (let k = 0; k < 32; k += 1) {
      const a = (k / 32) * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (pointInRings(x, z, rings)) return [x, z];
    }
  }
  return null;
}

// The inside point that keeps `inset` meters of roof on every side and has
// the best score: how far it is toward `side` (a unit [x, z] direction),
// less half its offset from the footprint's middle line. The penalty keeps
// the anchor near the middle of that side. A 4 m grid search.
export function edgeAnchor(b, side, inset) {
  const rings = [b.outer, ...(b.holes ?? [])];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of b.outer) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const [cx, cz] = centroid(b.outer);
  const clear = (x, z) => {
    if (!pointInRings(x, z, rings)) return false;
    for (let k = 0; k < 8; k += 1) {
      const a = (k / 8) * Math.PI * 2;
      if (!pointInRings(x + Math.cos(a) * inset, z + Math.sin(a) * inset, rings)) return false;
    }
    return true;
  };
  let best = null;
  for (let x = minX; x <= maxX; x += 4) {
    for (let z = minZ; z <= maxZ; z += 4) {
      if (!clear(x, z)) continue;
      const along = x * side[0] + z * side[1];
      const across = Math.abs(-(x - cx) * side[1] + (z - cz) * side[0]);
      const score = along - 0.5 * across;
      if (!best || score > best.score + 1e-9) best = { x, z, score };
    }
  }
  return best ? [best.x, best.z] : null;
}

// Returns [{ id, building, tower: { x, y, z }, sign: { x, y, z, yaw, ... } }]
// for every landmark whose building is in the level.
export function landmarkPlacements(level) {
  const out = [];
  for (const lm of LANDMARKS) {
    const b = (level.buildings ?? []).find((x) => x.name === lm.buildingName);
    if (!b) continue;
    const t = edgeAnchor(b, lm.tower.side, lm.tower.inset);
    const s = edgeAnchor(b, lm.sign.side, lm.sign.inset);
    if (!t || !s) continue;
    // Yaw that turns the sign's +z face (the letters) toward `side`.
    const yaw = Math.atan2(lm.sign.side[0], lm.sign.side[1]);
    out.push({
      id: lm.id,
      building: b.id,
      tower: { x: t[0], y: b.height, z: t[1] },
      sign: { x: s[0], y: b.height, z: s[1], yaw, text: lm.sign.text, width: lm.sign.width, height: lm.sign.height },
    });
  }
  return out;
}
