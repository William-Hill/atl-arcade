import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TRAVEL, travelSpot } from "./travel.js";
import { heading } from "../../sim/skate/controller.js";

const LEVEL = {
  strips: [
    { id: "t", kind: "trail", points: [[0, 0], [100, 0]] },
    { id: "s", kind: "street", points: [[0, 20], [100, 20]] },
    { id: "x", kind: "rail", points: [[0, 5], [100, 5]] },
  ],
};

describe("travelSpot", () => {
  it("lands on the nearest strip center line, facing along it", () => {
    const spot = travelSpot(LEVEL, 40, 3);
    expect(spot).toMatchObject({ x: 40, z: 0, strip: "t" });
    const [hx, , hz] = heading(spot.yaw);
    expect(hx).toBeCloseTo(1, 9);
    expect(hz).toBeCloseTo(0, 9);
  });

  it("prefers the trail unless the street is much nearer", () => {
    // 11 m from the trail and 9 m from the street: the trail wins.
    expect(travelSpot(LEVEL, 50, 11).strip).toBe("t");
    // 18 m from the trail and 2 m from the street: the street wins.
    expect(travelSpot(LEVEL, 50, 18).strip).toBe("s");
  });

  it("never lands on a strip kind that is not in the list", () => {
    expect(travelSpot(LEVEL, 50, 5).strip).not.toBe("x");
    expect(travelSpot({ strips: [{ kind: "rail", points: [[0, 0], [1, 0]] }] }, 0, 0)).toBe(null);
  });

  it("keeps to the ends of a strip", () => {
    expect(travelSpot(LEVEL, -30, 0)).toMatchObject({ x: 0, z: 0 });
  });

  it("finds a spot outside every building on the real level", () => {
    const level = JSON.parse(readFileSync(new URL("../../../levels/beltline-eastside/level.json", import.meta.url)));
    const inside = (x, z, ring) => {
      let hit = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const [xi, zi] = ring[i];
        const [xj, zj] = ring[j];
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
      }
      return hit;
    };
    // The center of every 10th building: the spot is on a strip, not in it.
    for (const b of level.buildings.filter((_, i) => i % 10 === 0)) {
      const cx = b.outer.reduce((s, p) => s + p[0], 0) / b.outer.length;
      const cz = b.outer.reduce((s, p) => s + p[1], 0) / b.outer.length;
      const spot = travelSpot(level, cx, cz);
      expect(spot).not.toBe(null);
      expect(inside(spot.x, spot.z, b.outer), b.id).toBe(false);
    }
    expect(TRAVEL.kinds).toContain("street");
  });
});
