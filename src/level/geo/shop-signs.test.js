import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BOARD, NAME_DENY, shopSignName, shopSigns, signBoard } from "./shop-signs.js";
import { frontEdges } from "./facade-kit.js";
import { muralWalls } from "./geo-mesh.js";
import { orientRing } from "./extrude.js";
import { buildingSpan } from "./terrain.js";

const LEVEL = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../levels/beltline-eastside/level.json"), "utf8"));

describe("the shop name boards (#135)", () => {
  it("shows only positive and neutral uses and names", () => {
    expect(shopSignName({ key: "amenity", value: "restaurant", name: "Beatlecat" })).toBe("Beatlecat");
    expect(shopSignName({ key: "shop", value: "supermarket", name: "  Kroger " })).toBe("Kroger");
    // No name, or a use that is not on the list.
    expect(shopSignName({ key: "amenity", value: "restaurant" })).toBeNull();
    expect(shopSignName({ key: "amenity", value: "parking", name: "Deck" })).toBeNull();
    expect(shopSignName({ key: "shop", value: "pawnbroker", name: "Midtown" })).toBeNull();
    // A name on the deny list, also with a use on the list.
    expect(shopSignName({ key: "shop", value: "convenience", name: "Corner Liquor" })).toBeNull();
    expect(NAME_DENY.test("Venkman's")).toBe(false);
    expect(shopSignName({ key: "shop", value: "gift", name: "x".repeat(40) })).toBeNull();
    expect(shopSignName(null)).toBeNull();
  });

  it("puts a board on the door bay of the front wall, over the door", () => {
    const b = { id: "t-shop", height: 8, outer: [[0, 0], [16, 0], [16, 10], [0, 10]], type: "retail", use: { key: "amenity", value: "cafe", name: "Test Cafe" } };
    const ring = orientRing(b.outer, false);
    const edge = ring.findIndex((p, i) => p[1] === 10 && ring[(i + 1) % 4][1] === 10);
    const s = signBoard(b, { edge, door: 1 }, { base: 0, top: 8, foot: 0 });
    expect(s.name).toBe("Test Cafe");
    // The wall at z = 10 faces +z; the board is BOARD.out in front of it.
    expect(s.z).toBeCloseTo(10 + BOARD.out);
    expect(s.normal[0]).toBeCloseTo(0);
    expect(s.normal[1]).toBeCloseTo(1);
    expect(s.y - s.height / 2).toBeGreaterThan(2.2);
    // Under the belt course of the 2-floor storefront (8 m: 2 floors of 4 m).
    expect(s.y + s.height / 2).toBeLessThan(4);
    // A board on a mural is left out.
    expect(signBoard(b, { edge, door: 1 }, { base: 0, top: 8 }, { edge, t0: 0, t1: 16, y0: 0, y1: 8 })).toBeNull();
    // No front wall, no board.
    expect(signBoard(b, null, { base: 0, top: 8 })).toBeNull();
  });

  it("puts the BeltLine boards on their walls, off the murals, and from the OSM data", () => {
    const boards = shopSigns(LEVEL, frontEdges(LEVEL));
    expect(boards.length).toBeGreaterThanOrEqual(5);
    const names = boards.map((s) => s.name);
    expect(names).toContain("Kroger");
    expect(names).toContain("New Realm Brewing");
    const byId = new Map(LEVEL.buildings.map((b) => [b.id, b]));
    const murals = new Map(muralWalls(LEVEL).map((m) => [m.id, m]));
    for (const s of boards) {
      const b = byId.get(s.id);
      expect(shopSignName(b.use)).toBe(s.name);
      const span = buildingSpan(LEVEL, b);
      expect(s.y - s.height / 2).toBeGreaterThan(span.base + 2.2);
      expect(s.y + s.height / 2).toBeLessThan(span.top);
      // The board is BOARD.out in front of a wall, so its back is on the
      // wall line, and it hangs over the ground, not in the way of a skater.
      const bx = s.x - s.normal[0] * BOARD.out;
      const bz = s.z - s.normal[1] * BOARD.out;
      let near = Infinity;
      const ring = b.outer;
      for (let i = 0; i < ring.length; i += 1) {
        const [ax, az] = ring[i];
        const [cx, cz] = ring[(i + 1) % ring.length];
        const dx = cx - ax;
        const dz = cz - az;
        const t = Math.max(0, Math.min(1, ((bx - ax) * dx + (bz - az) * dz) / (dx * dx + dz * dz)));
        near = Math.min(near, Math.hypot(bx - (ax + t * dx), bz - (az + t * dz)));
      }
      expect(near).toBeLessThan(0.05);
      // A board on a building with a mural is clear of the mural.
      const m = murals.get(s.id);
      if (m) {
        const ring2 = orientRing(b.outer, false);
        const [px, pz] = ring2[m.edge];
        const [qx, qz] = ring2[(m.edge + 1) % ring2.length];
        const len = Math.hypot(qx - px, qz - pz);
        const a = ((bx - px) * (qx - px) + (bz - pz) * (qz - pz)) / len;
        const onWall = Math.abs(((bx - px) * -(qz - pz) + (bz - pz) * (qx - px)) / len) < 0.05;
        const overlap = onWall && a + s.maxWidth / 2 > m.t0 && a - s.maxWidth / 2 < m.t1 && s.y + s.height / 2 > m.y0 && s.y - s.height / 2 < m.y1;
        expect(overlap).toBe(false);
      }
    }
    // The same input gives the same boards.
    expect(shopSigns(LEVEL, frontEdges(LEVEL))).toEqual(boards);
  });
});
