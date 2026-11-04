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
// model.front ({ x0, x1, depth }, model meters) is the box in front of the
// wall that a "ground" model fills: x0 to x1 along the wall, out to `depth`.
// The placement keeps that box out of every building box, so no wall
// covers the model letters (issue #79).
//
// sign.offset ([x, z], m) puts the sign at that offset from the model
// anchor; sign.side is the direction its front faces.
export const LANDMARKS = [
  {
    id: "ponce-city-market",
    buildingName: "Ponce City Market",
    // The tower stands near the north edge (Ponce de Leon Avenue side).
    // The rooftop sign stands west of the tower and a little south of it,
    // and faces south, to Historic Fourth Ward Park. Two photos show this
    // (Wikimedia Commons, CC BY-SA): "Ponce City Market from Historic
    // Fourth Ward Park" (Tyler Lahti, 2020) and "View of Ponce City Market
    // across the stormwater detention pond at Historic Fourth Ward Park,
    // December 2015" (Marc Merlin). See docs/decisions.md.
    model: { side: [0, -1], inset: 14, base: "roof" },
    sign: { offset: [-45, 12], side: [0, 1], text: "PONCE CITY MARKET", width: 36, height: 5.5 },
  },
  {
    id: "krog-street-market",
    buildingName: "Krog Street Market",
    // The entrance front faces east, to the parking drive: the photo shows a
    // parking drive in front of it, and the OSM data has open ground then a
    // service road on the east side, but a sidewalk and Krog Street within
    // 6 m on the west side. Approximate. The model holds its own letters,
    // so there is no separate sign.
    model: { side: [1, 0], inset: 14, base: "ground", front: { x0: -14.1, x1: 10.4, depth: 4.1 } },
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

// The inside points that keep `inset` meters of roof on every side, best
// score first. The score is how far a point is toward `side` (a unit [x, z]
// direction), less half its offset from the footprint's middle line. The
// penalty keeps the anchor near the middle of that side. A 4 m grid search.
export function edgeAnchors(b, side, inset) {
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
  const out = [];
  for (let x = minX; x <= maxX; x += 4) {
    for (let z = minZ; z <= maxZ; z += 4) {
      if (!clear(x, z)) continue;
      const along = x * side[0] + z * side[1];
      const across = Math.abs(-(x - cx) * side[1] + (z - cz) * side[0]);
      out.push({ x, z, score: along - 0.5 * across });
    }
  }
  // A stable sort: on equal scores the first grid point stays first.
  out.sort((a, b) => (b.score - a.score > 1e-9 ? 1 : a.score - b.score > 1e-9 ? -1 : 0));
  return out.map((p) => [p.x, p.z]);
}

// The best of edgeAnchors(), or null.
export function edgeAnchor(b, side, inset) {
  return edgeAnchors(b, side, inset)[0] ?? null;
}

// The outward unit normal [x, z] of the outer wall nearest to `p`, turned
// toward `side`.
export function wallNormal(b, p, side) {
  let best = null;
  const ring = b.outer;
  for (let i = 0; i < ring.length; i += 1) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz;
    if (l2 < 1e-9) continue;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - az) * dz) / l2));
    const d = Math.hypot(ax + dx * t - p[0], az + dz * t - p[1]);
    if (!best || d < best.d) {
      const l = Math.sqrt(l2);
      let n = [-dz / l, dx / l];
      if (n[0] * side[0] + n[1] * side[1] < 0) n = [-n[0], -n[1]];
      best = { d, n };
    }
  }
  return best ? best.n : side;
}

// True when the model front box (model.front) at `place` ({ x, z, yaw })
// is out of every building box of the level. 0.5 m samples; the samples
// start 0.3 m out from the wall line.
export function frontClear(level, place, front) {
  const c = Math.cos(place.yaw);
  const s = Math.sin(place.yaw);
  const boxes = (level.buildings ?? []).map((b) => [b.outer, ...(b.holes ?? [])]);
  for (let lx = front.x0; lx <= front.x1 + 1e-9; lx += 0.5) {
    for (let lz = 0.3; lz <= front.depth + 1e-9; lz += 0.5) {
      // The model turns by `yaw` about +y: local +z goes to (sin, cos).
      const x = place.x + lx * c + lz * s;
      const z = place.z - lx * s + lz * c;
      for (const rings of boxes) if (pointInRings(x, z, rings)) return false;
    }
  }
  return true;
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
    const anchors = edgeAnchors(b, lm.model.side, lm.model.inset);
    if (!anchors.length) continue;
    let model = null;
    if (lm.model.base === "ground") {
      // The first anchor whose model front is clear of every building box;
      // with no clear anchor, the best anchor.
      for (const a of anchors) {
        const w = wallPoint(b, lm.model.side, a);
        const n = wallNormal(b, w, lm.model.side);
        // Yaw that turns the model's +z (its front) out of the wall.
        // On a slope the model stands on the terrain at its wall point.
        const place = { x: w[0], y: terrainOf(level).height(w[0], w[1]), z: w[1], yaw: Math.atan2(n[0], n[1]) };
        if (!model) model = place;
        if (!lm.model.front || frontClear(level, place, lm.model.front)) {
          model = place;
          break;
        }
      }
    } else {
      model = { x: anchors[0][0], y: buildingSpan(level, b).top, z: anchors[0][1], yaw: 0 };
    }
    const entry = { id: lm.id, building: b.id, model };
    if (lm.sign) {
      const rings = [b.outer, ...(b.holes ?? [])];
      const s = lm.sign.offset ? [model.x + lm.sign.offset[0], model.z + lm.sign.offset[1]] : edgeAnchor(b, lm.sign.side, lm.sign.inset);
      if (s && pointInRings(s[0], s[1], rings)) {
        entry.sign = { x: s[0], y: buildingSpan(level, b).top, z: s[1], yaw: Math.atan2(lm.sign.side[0], lm.sign.side[1]), text: lm.sign.text, width: lm.sign.width, height: lm.sign.height };
      }
    }
    out.push(entry);
  }
  return out;
}

// The footprint claim (the teleoperator approach): a landmark with
// `claim: true` replaces its building — the generic extrusion, facade kit,
// and awnings do not draw it, so a real landmark model does not double-
// build over a stylized box. The footprint's collider stays (geo-mesh.js
// gives it a "claimed" material, which only the render skips).
export function claimedIds(level, landmarks = LANDMARKS) {
  const names = new Set(landmarks.filter((l) => l.claim).map((l) => l.buildingName));
  return new Set((level.buildings ?? []).filter((b) => names.has(b.name)).map((b) => b.id));
}
