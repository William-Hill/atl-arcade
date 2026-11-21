import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LANDMARKS, LANDMARK_GLB_BUILDINGS, claimLandmarkModels, claimedIds, edgeAnchor, frontClear, interiorPoint, landmarkPlacements, wallPoint } from "./landmarks.js";
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
    // The tower is north of the interior anchor (-z).
    const [, cz] = interiorPoint(b);
    expect(pcm.model.z).toBeLessThan(cz);
  });

  it("puts the Ponce City Market sign west of the tower, facing south (issue #79)", () => {
    const pcm = landmarkPlacements(LEVEL).find((p) => p.id === "ponce-city-market");
    const b = LEVEL.buildings.find((x) => x.id === pcm.building);
    const rings = [b.outer, ...(b.holes ?? [])];
    // Next to the tower: west of it, within 60 m, and a little south.
    expect(pcm.sign.x).toBeLessThan(pcm.model.x - 20);
    expect(Math.hypot(pcm.sign.x - pcm.model.x, pcm.sign.z - pcm.model.z)).toBeLessThan(60);
    expect(pcm.sign.z).toBeGreaterThan(pcm.model.z);
    // The front (+z) faces south (+z).
    expect(Math.cos(pcm.sign.yaw)).toBeCloseTo(1, 6);
    // The whole sign stands on the roof, with 2 m of roof in front of it.
    for (const dx of [-pcm.sign.width / 2, 0, pcm.sign.width / 2]) {
      for (const dz of [-1, 0, 2]) expect(pointInRings(pcm.sign.x + dx, pcm.sign.z + dz, rings)).toBe(true);
    }
  });

  it("puts the Krog Street Market front on the east wall, facing east, on the ground", () => {
    const krog = landmarkPlacements(LEVEL).find((p) => p.id === "krog-street-market");
    const b = LEVEL.buildings.find((x) => x.id === krog.building);
    const rings = [b.outer, ...(b.holes ?? [])];
    expect(krog.model.y).toBe(terrainOf(LEVEL).height(krog.model.x, krog.model.z));
    // On the wall: inside now, outside 1 m farther east.
    expect(pointInRings(krog.model.x, krog.model.z, rings)).toBe(true);
    expect(pointInRings(krog.model.x + 1, krog.model.z, rings)).toBe(false);
    // The model front (+z) turns to +x, square to the wall (the wall is not
    // exactly north-south).
    expect(Math.sin(krog.model.yaw)).toBeGreaterThan(0.98);
    expect(krog.sign).toBeUndefined();
  });

  it("keeps every building box out of the Krog Street Market letters (issue #79)", () => {
    const krog = landmarkPlacements(LEVEL).find((p) => p.id === "krog-street-market");
    const front = LANDMARKS.find((l) => l.id === "krog-street-market").model.front;
    expect(frontClear(LEVEL, krog.model, front)).toBe(true);
    // Each letter card (baked template) is out of every building box, end to end.
    const t = JSON.parse(readFileSync(new URL("../../../assets/landmarks/krog-street-market-front.json", import.meta.url), "utf8"));
    expect(t.cards.map((c) => c.text).join(" ")).toBe("KROG STREET MARKET");
    const c = Math.cos(krog.model.yaw);
    const s = Math.sin(krog.model.yaw);
    for (const card of t.cards) {
      const [px, , pz] = card.position;
      for (let k = 0; k <= 10; k += 1) {
        const lx = px - card.width / 2 + (card.width * k) / 10;
        const x = krog.model.x + lx * c + pz * s;
        const z = krog.model.z - lx * s + pz * c;
        for (const b of LEVEL.buildings) expect(pointInRings(x, z, [b.outer, ...(b.holes ?? [])]), `${card.text} in ${b.id}`).toBe(false);
      }
    }
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

describe("footprint claims", () => {
  it("claims the buildings of landmarks with claim: true", () => {
    const level = { buildings: [{ id: "b1", name: "Ponce City Market", outer: [[0, 0], [1, 0], [1, 1]] }, { id: "b2", name: "Elsewhere", outer: [[0, 0], [1, 0], [1, 1]] }] };
    expect([...claimedIds(level, [{ buildingName: "Ponce City Market", claim: true }])]).toEqual(["b1"]);
    expect(claimedIds(level, [{ buildingName: "Ponce City Market" }]).size).toBe(0);
    // The real level claims nothing today: the PCM tower and the Krog
    // front are add-ons, not replacements.
    expect(claimedIds(LEVEL ?? level).size).toBe(0);
  });
});

describe("landmark GLB claims", () => {
  it("claims every GLB building and drops the tower and sign it replaces", () => {
    const list = claimLandmarkModels(LANDMARKS.map((l) => ({ ...l })));
    for (const name of Object.values(LANDMARK_GLB_BUILDINGS)) expect(list.find((l) => l.buildingName === name)?.claim).toBe(true);
    const pcm = list.find((l) => l.id === "ponce-city-market");
    expect(pcm.model).toBeUndefined();
    expect(pcm.sign).toBeUndefined();
    expect(list.find((l) => l.id === "krog-street-market").model).toBeDefined();
    expect(LANDMARKS.find((l) => l.id === "ponce-city-market").model).toBeDefined();
  });
});
