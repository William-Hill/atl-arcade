// Placement of landmark models on real footprints. Pure.
//
// A landmark model (from img2threejs, see landmarks/<name>/) covers only the
// parts that the extruded footprint cannot show, for example a tower top.
// This module finds where those parts stand on the real roof.

import { pointInRings } from "./geo-ground.js";
import { buildingSpan, terrainOf } from "./terrain.js";

// model.base: "roof" stands the model on the roof (y = building height);
// "ground" stands it on the ground with its front (+z, z = 0) on the wall
// line of `side`, facing out.
export const LANDMARKS = [
  {
    id: "ponce-city-market",
    buildingName: "Ponce City Market",
    // The tower stands near the north edge (Ponce de Leon Avenue side),
    // and the sign stands on the east edge, facing the BeltLine trail.
    // Both are approximate: the photo is one aerial view.
    model: { side: [0, -1], inset: 14, base: "roof" },
    sign: { side: [1, 0], inset: 6, text: "PONCE CITY MARKET", width: 36, height: 5.5 },
  },
  {
    id: "krog-street-market",
    buildingName: "Krog Street Market",
    // The entrance front faces east, to the parking drive: the photo shows a
    // parking drive in front of it, and the OSM data has open ground then a
    // service road on the east side, but a sidewalk and Krog Street within
    // 6 m on the west side. Approximate. The model holds its own letters,
    // so there is no separate sign.
    model: { side: [1, 0], inset: 14, base: "ground" },
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

// From `start`, the last inside point on the line toward `side`: a point on
// the wall. 0.25 m steps.
export function wallPoint(b, side, start) {
  const rings = [b.outer, ...(b.holes ?? [])];
  let last = start;
  for (let d = 0; d < 1000; d += 0.25) {
    const p = [start[0] + side[0] * d, start[1] + side[1] * d];
    if (!pointInRings(p[0], p[1], rings)) break;
    last = p;
  }
  return last;
}

// Returns [{ id, building, model: { x, y, z, yaw }, sign?: { x, y, z, yaw, ... } }]
// for every landmark whose building is in the level.
export function landmarkPlacements(level) {
  const out = [];
  for (const lm of LANDMARKS) {
    const b = (level.buildings ?? []).find((x) => x.name === lm.buildingName);
    if (!b) continue;
    const a = edgeAnchor(b, lm.model.side, lm.model.inset);
    if (!a) continue;
    let model;
    if (lm.model.base === "ground") {
      const w = wallPoint(b, lm.model.side, a);
      // Yaw that turns the model's +z (its front) toward `side`.
      // On a slope the model stands on the terrain at its wall point.
      model = { x: w[0], y: terrainOf(level).height(w[0], w[1]), z: w[1], yaw: Math.atan2(lm.model.side[0], lm.model.side[1]) };
    } else {
      model = { x: a[0], y: buildingSpan(level, b).top, z: a[1], yaw: 0 };
    }
    const entry = { id: lm.id, building: b.id, model };
    if (lm.sign) {
      const s = edgeAnchor(b, lm.sign.side, lm.sign.inset);
      if (s) {
        entry.sign = { x: s[0], y: buildingSpan(level, b).top, z: s[1], yaw: Math.atan2(lm.sign.side[0], lm.sign.side[1]), text: lm.sign.text, width: lm.sign.width, height: lm.sign.height };
      }
    }
    out.push(entry);
  }
  return out;
}
