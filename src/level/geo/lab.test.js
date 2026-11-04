import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LAB_MARGIN, LAB_VIEWS, labBlocked, labBuildings, labCamera, labFront } from "./lab.js";
import { chooseStyle } from "./styles.js";

const LEVEL = JSON.parse(readFileSync(new URL("../../../levels/beltline-eastside/level.json", import.meta.url)));

// A 20 x 10 m box, counterclockwise and clockwise.
const BOX = { id: "w1", height: 12, outer: [[0, 0], [20, 0], [20, 10], [0, 10]] };
const BOX_CW = { ...BOX, outer: BOX.outer.slice().reverse() };

describe("labFront", () => {
  it("picks the longest edge with a normal that points out of the building", () => {
    for (const b of [BOX, BOX_CW]) {
      const f = labFront(b);
      expect(f.length).toBe(20);
      // The long edges are z = 0 and z = 10; out is away from z = 5.
      const outZ = f.mid[1] + f.normal[1];
      expect(Math.abs(outZ - 5)).toBeGreaterThan(Math.abs(f.mid[1] - 5));
    }
  });
});

describe("labCamera", () => {
  it("gives a finite camera for every view, outside the footprint", () => {
    for (const v of LAB_VIEWS) {
      const cam = labCamera(BOX, v);
      expect(cam).toHaveLength(6);
      expect(cam.every(Number.isFinite)).toBe(true);
      const inside = cam[0] > 0 && cam[0] < 20 && cam[2] > 0 && cam[2] < 10;
      expect(inside, v).toBe(false);
    }
  });

  it("goes from near to far", () => {
    const dist = (v) => {
      const c = labCamera(BOX, v);
      return Math.hypot(c[0] - c[3], c[2] - c[5]);
    };
    expect(dist("facade")).toBeLessThan(dist("street"));
    expect(dist("street")).toBeLessThan(dist("mid"));
    expect(dist("mid")).toBeLessThan(dist("far"));
  });

  it("rejects an unknown view", () => {
    expect(() => labCamera(BOX, "orbit")).toThrow(/no view/);
  });
});

describe("labBuildings", () => {
  it("lists only buildings of the style, 5 m or taller", () => {
    const list = labBuildings(LEVEL, "brick-loft");
    expect(list.length).toBeGreaterThan(5);
    for (const b of list) {
      expect(chooseStyle(b)).toBe("brick-loft");
      expect(b.height).toBeGreaterThanOrEqual(5);
    }
  });

  it("puts the most typical height first", () => {
    const list = labBuildings(LEVEL, "modern-apartment");
    const heights = list.map((b) => b.height).sort((a, b) => a - b);
    const median = heights[Math.floor(heights.length / 2)];
    expect(Math.abs(list[0].height - median)).toBeLessThanOrEqual(Math.abs(list.at(-1).height - median));
  });

  it("keeps away from the edge of the level", () => {
    const xs = LEVEL.buildings.map((b) => b.outer.reduce((a, p) => a + p[0], 0) / b.outer.length);
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    for (const b of labBuildings(LEVEL, "brick-loft")) {
      const x = b.outer.reduce((a, p) => a + p[0], 0) / b.outer.length;
      expect(Math.min(x - lo, hi - x)).toBeGreaterThanOrEqual(LAB_MARGIN - 1e-6);
    }
  });

  it("is the same in every run", () => {
    expect(labBuildings(LEVEL, "storefront").map((b) => b.id)).toEqual(labBuildings(LEVEL, "storefront").map((b) => b.id));
  });

  it("rejects an unknown style", () => {
    expect(() => labBuildings(LEVEL, "castle")).toThrow(/no building style/);
  });
});

describe("labBlocked", () => {
  const wall = { b: { id: "w2", height: 10, outer: [[0, 15], [20, 15], [20, 18], [0, 18]] } };
  wall.box = [0, 15, 20, 18];

  it("sees a building that stands between the eye and the target", () => {
    expect(labBlocked([10, 1.7, 30], [10, 5, 10], [wall])).toBe(true);
  });

  it("sees an eye inside a building", () => {
    expect(labBlocked([10, 1.7, 16], [10, 5, 0], [wall])).toBe(true);
  });

  it("lets a view over a low building through", () => {
    expect(labBlocked([10, 40, 30], [10, 30, 10], [wall])).toBe(false);
  });

  it("lets a clear view through", () => {
    expect(labBlocked([40, 1.7, 30], [40, 5, 10], [wall])).toBe(false);
  });
});

describe("labCamera on the real level", () => {
  it("finds a clear view for the street and mid views of the first brick loft", () => {
    const b = labBuildings(LEVEL, "brick-loft")[0];
    const others = LEVEL.buildings.filter((o) => o.id !== b.id).map((o) => {
      const xs = o.outer.map((p) => p[0]);
      const zs = o.outer.map((p) => p[1]);
      return { b: o, box: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] };
    });
    for (const v of ["street", "mid"]) {
      const c = labCamera(b, v, LEVEL);
      expect(labBlocked(c.slice(0, 3), c.slice(3), others), v).toBe(false);
    }
  });
});

describe("labCamera and the kit front", () => {
  it("looks at the wall that the kit gives the shop front", async () => {
    const { frontEdges } = await import("./facade-kit.js");
    const { orientRing } = await import("./extrude.js");
    const b = labBuildings(LEVEL, "brick-loft")[0];
    const front = frontEdges(LEVEL).get(b.id);
    const ring = orientRing(b.outer, false);
    const p = ring[front.edge];
    const q = ring[(front.edge + 1) % ring.length];
    const cam = labCamera(b, "facade", LEVEL);
    // The facade camera looks at the middle of that wall.
    expect(cam[3]).toBeCloseTo((p[0] + q[0]) / 2, 1);
    expect(cam[5]).toBeCloseTo((p[1] + q[1]) / 2, 1);
  });
});

describe("labCamera on a slope", () => {
  it("raises the eye over a rise between the eye and the building", () => {
    const flat = labCamera(BOX, "street");
    const ridge = labCamera(BOX, "street", null, (x, z) => (Math.abs(z - 5) > 9 && Math.abs(z - 5) < 15 ? 4 : 0));
    expect(ridge[1]).toBeCloseTo(flat[1] + 4, 5);
  });

  it("raises the eye when the ground under it is lower than the building base, and keeps it when higher", () => {
    const flat = labCamera(BOX, "street");
    const down = labCamera(BOX, "street", null, (x, z) => (z > 12 || z < -2 ? -3 : 0));
    const up = labCamera(BOX, "street", null, (x, z) => (z > 12 || z < -2 ? 3 : 0));
    expect(down[1]).toBeCloseTo(flat[1] + 3, 5);
    expect(up[1]).toBeCloseTo(flat[1], 5);
  });
});
