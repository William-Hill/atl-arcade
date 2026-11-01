import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { edgeAnchor, interiorPoint, landmarkPlacements } from "./landmarks.js";
import { pointInRings } from "./geo-ground.js";

const LEVEL = JSON.parse(readFileSync(new URL("../../../levels/beltline-eastside/level.json", import.meta.url), "utf8"));

describe("landmark placement", () => {
  it("puts the Ponce City Market tower and sign on the real roof", () => {
    const [pcm] = landmarkPlacements(LEVEL);
    const b = LEVEL.buildings.find((x) => x.id === pcm.building);
    expect(b.name).toBe("Ponce City Market");
    for (const p of [pcm.tower, pcm.sign]) {
      expect(pointInRings(p.x, p.z, [b.outer, ...(b.holes ?? [])])).toBe(true);
      expect(p.y).toBe(b.height);
    }
    // The tower is north of the interior anchor (-z), the sign east (+x).
    const [cx, cz] = interiorPoint(b);
    expect(pcm.tower.z).toBeLessThan(cz);
    expect(pcm.sign.x).toBeGreaterThan(cx);
    expect(Math.sin(pcm.sign.yaw)).toBeCloseTo(1, 6);
  });

  it("keeps an anchor the inset in from the edge of a square", () => {
    const sq = { outer: [[-10, -10], [10, -10], [10, 10], [-10, 10]] };
    const [x, z] = edgeAnchor(sq, [1, 0], 3);
    // The grid runs from -10 in 4 m steps: the last x with 3 m clear is 6.
    expect(x).toBe(6);
    expect(Math.abs(z)).toBeLessThanOrEqual(2);
  });

  it("skips a landmark whose building is not in the level", () => {
    expect(landmarkPlacements({ buildings: [] })).toEqual([]);
  });
});
