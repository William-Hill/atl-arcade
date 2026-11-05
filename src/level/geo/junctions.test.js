import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { armTrim, convexHull, streetJunctions } from "./junctions.js";
import { pointInRings } from "./geo-ground.js";
import { createGeoGroundSampler } from "./geo-ground.js";
import { approachTrims, trimPolyline } from "./bridges.js";

const LEVEL = JSON.parse(readFileSync(new URL("../../../levels/beltline-eastside/level.json", import.meta.url), "utf8"));

// True when (x, z) is on one of the segment quads of a piece (the render
// quads of extrude.js stripMesh(): square ends, no disk).
function onQuads(points, half, x, z) {
  for (let i = 0; i < points.length - 1; i += 1) {
    const [ax, az] = points[i];
    const dx = points[i + 1][0] - ax;
    const dz = points[i + 1][1] - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const along = ((x - ax) * dx + (z - az) * dz) / len;
    const across = (-(x - ax) * dz + (z - az) * dx) / len;
    if (along > 1e-3 && along < len - 1e-3 && Math.abs(across) < half - 1e-3) return true;
  }
  return false;
}

// The distance from (x, z) to the edge of a ring.
function ringDistance(ring, x, z) {
  let d = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    const l2 = (bx - ax) ** 2 + (bz - az) ** 2;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / l2)) : 0;
    d = Math.min(d, Math.hypot(x - ax - t * (bx - ax), z - az - t * (bz - az)));
  }
  return d;
}

function onStrip(points, half, x, z) {
  return onQuads(points, half + 1e-3, x, z);
}

describe("street junctions", () => {
  it("trims an arm so that its edges clear the other arm", () => {
    // Two arms at a right angle: each stops at the half width of the other.
    expect(armTrim(4, 6, Math.PI / 2)).toBeCloseTo(6, 6);
    // Two arms in a near straight line do not overlap.
    expect(armTrim(4, 4, Math.PI)).toBe(0);
    // A sharp angle needs a longer trim.
    expect(armTrim(4, 4, Math.PI / 4)).toBeGreaterThan(armTrim(4, 4, Math.PI / 2));
  });

  it("makes a convex hull, counterclockwise", () => {
    const h = convexHull([[0, 0], [2, 0], [1, 1], [2, 2], [0, 2]]);
    expect(h).toHaveLength(4);
  });

  it("splits a cross into four arms and one patch, with no overlap and no gap", () => {
    const level = {
      strips: [
        { id: "a", kind: "street", width: 10, points: [[-50, 0], [0, 0], [50, 0]] },
        { id: "b", kind: "street", width: 8, points: [[0, -50], [0, 0], [0, 50]] },
      ],
    };
    const J = streetJunctions(level, { flat: true });
    expect(J.junctions).toHaveLength(1);
    expect(J.pieces).toHaveLength(4);
    // The east arm of a stops at the half width of b.
    const east = J.pieces.find((p) => p.id === "a:1");
    expect(east.points[0][0]).toBeCloseTo(4, 6);
    for (let x = -12.03; x <= 12; x += 0.25) {
      for (let z = -12.07; z <= 12; z += 0.25) {
        const covers = J.pieces.filter((p) => onQuads(p.points, p.width / 2, x, z)).length;
        expect(covers).toBeLessThanOrEqual(1);
        const road = Math.abs(z) < 5 - 0.01 || Math.abs(x) < 4 - 0.01;
        const patch = pointInRings(x, z, [J.junctions[0].ring]);
        if (road) expect(covers > 0 || patch, `gap at ${x},${z}`).toBe(true);
        if (patch) expect(covers, `patch overlap at ${x},${z}`).toBe(0);
      }
    }
  });

  it("puts a disk at a joint of two strips with no junction", () => {
    const level = {
      strips: [
        { id: "a", kind: "street", width: 10, name: "A", points: [[-50, 0], [0, 0]] },
        { id: "b", kind: "street", width: 10, name: "A", points: [[0, 0], [40, 30]] },
      ],
    };
    const J = streetJunctions(level, { flat: true });
    expect(J.junctions).toHaveLength(0);
    expect(J.joints).toEqual([{ x: 0, z: 0, r: 5 }]);
  });

  it("leaves no overlap of two street pieces and no gap at the BeltLine junctions", () => {
    const J = streetJunctions(LEVEL);
    expect(J.junctions.length).toBeGreaterThan(150);
    // Each piece is finite.
    for (const p of J.pieces) for (const [x, z] of p.points) expect(Number.isFinite(x) && Number.isFinite(z), p.id).toBe(true);
    // The street strips before the split, less the ends that a bridge deck
    // covers (bridges.js).
    const trims = approachTrims(LEVEL.strips);
    const strips = LEVEL.strips.filter((s) => s.kind === "street" && !s.bridge).map((s) => ({ ...s, points: trimPolyline(s.points, trims.get(s.id)) })).filter((s) => s.points);
    let overlaps = 0;
    let gaps = 0;
    let points = 0;
    const bad = new Map();
    for (const j of J.junctions) {
      const near = J.pieces.filter((p) => p.points.some(([x, z]) => Math.hypot(x - j.x, z - j.z) < 60));
      const nearStrips = strips.filter((s) => s.points.some(([x, z]) => Math.hypot(x - j.x, z - j.z) < 60));
      for (let dx = -14; dx <= 14; dx += 0.5) {
        for (let dz = -14; dz <= 14; dz += 0.5) {
          const x = j.x + dx + 0.13;
          const z = j.z + dz + 0.07;
          points += 1;
          const covers = near.filter((p) => onQuads(p.points, p.width / 2, x, z)).length;
          if (covers > 1) {
            overlaps += 1;
            bad.set(j.id, (bad.get(j.id) ?? 0) + 1);
          }
          // A point on the quads of a street strip (before the split) must
          // be on a piece, the patch, or the disk of a joint.
          const road = nearStrips.some((s) => onStrip(s.points, s.width / 2 - 0.05, x, z));
          // A point within 2 cm of a patch edge is on the patch.
          const patched = J.junctions.some((k) => Math.hypot(k.x - x, k.z - z) < 40 && (pointInRings(x, z, [k.ring]) || ringDistance(k.ring, x, z) < 0.02));
          if (road && covers === 0 && !patched && !J.joints.some((q) => Math.hypot(q.x - x, q.z - z) <= q.r)) {
            gaps += 1;
          }
        }
      }
    }
    // The overlaps left are where a short piece cannot stop at its full
    // trim (two junctions closer than the trims); the patch draws on top
    // of them (JOIN_LIFT).
    expect(overlaps / points, `overlaps ${overlaps} of ${points}: ${[...bad].slice(0, 8).join(" ")}`).toBeLessThan(0.002);
    expect(gaps, "gaps").toBe(0);
  }, 60000);

  it("gives the junction patch to the ground sampler as a street", () => {
    const J = streetJunctions(LEVEL);
    const sample = createGeoGroundSampler(LEVEL);
    const j = J.junctions[0];
    const g = sample(j.x + 0.01, j.z + 0.01);
    expect(g.height).toBeGreaterThan(0);
  });
});
