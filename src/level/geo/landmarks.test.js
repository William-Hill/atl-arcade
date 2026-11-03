import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { edgeAnchor, interiorPoint, landmarkPlacements, wallPoint } from "./landmarks.js";
import { pointInRings } from "./geo-ground.js";
import { buildingSpan, terrainOf } from "./terrain.js";

const LEVEL = JSON.parse(readFileSync(new URL("../../../levels/beltline-eastside/level.json", import.meta.url), "utf8"));

describe("landmark placement", () => {
  it("puts the Ponce City Market tower and sign on the real roof", () => {
    const pcm = landmarkPlacements(LEVEL).find((p) => p.id === "ponce-city-market");
    const b = LEVEL.buildings.find((x) => x.id === pcm.building);
    expect(b.name).toBe("Ponce City Market");
    for (const p of [pcm.model, pcm.sign]) {
      expect(pointInRings(p.x, p.z, [b.outer, ...(b.holes ?? [])])).toBe(true);
      expect(p.y).toBe(buildingSpan(LEVEL, b).top);
    }
    // The tower is north of the interior anchor (-z), the sign east (+x).
    const [cx, cz] = interiorPoint(b);
    expect(pcm.model.z).toBeLessThan(cz);
    expect(pcm.sign.x).toBeGreaterThan(cx);
    expect(Math.sin(pcm.sign.yaw)).toBeCloseTo(1, 6);
  });

  it("puts the Krog Street Market front on the east wall, facing east, on the ground", () => {
    const krog = landmarkPlacements(LEVEL).find((p) => p.id === "krog-street-market");
    const b = LEVEL.buildings.find((x) => x.id === krog.building);
    const rings = [b.outer, ...(b.holes ?? [])];
    expect(krog.model.y).toBe(terrainOf(LEVEL).height(krog.model.x, krog.model.z));
    // On the wall: inside now, outside 1 m farther east.
    expect(pointInRings(krog.model.x, krog.model.z, rings)).toBe(true);
    expect(pointInRings(krog.model.x + 1, krog.model.z, rings)).toBe(false);
    // The model front (+z) turns to +x.
    expect(Math.sin(krog.model.yaw)).toBeCloseTo(1, 6);
    expect(krog.sign).toBeUndefined();
  });

  it("finds the wall point of a square", () => {
    const sq = { outer: [[-10, -10], [10, -10], [10, 10], [-10, 10]] };
    const [x] = wallPoint(sq, [1, 0], [0, 0]);
    expect(x).toBeGreaterThan(9.7);
    expect(x).toBeLessThanOrEqual(10);
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
