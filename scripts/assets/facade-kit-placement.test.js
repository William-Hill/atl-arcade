import { describe, expect, it } from "vitest";
import { orientRing } from "../../src/level/geo/extrude.js";
import { STYLES } from "../../src/level/geo/styles.js";
import { FIRE_ESCAPE_RISE, LOD1, MODULES, byModule, facadePlacements, instanceMatrix, storefrontFor, turnAt, wallOf, wallYaw } from "./facade-kit-placement.js";

const style = (id) => STYLES.find((s) => s.id === id);
const box = (w, d) => orientRing([[0, 0], [w, 0], [w, d], [0, d]], false);

describe("facade kit placement", () => {
  it("turns module +x onto the wall and +z out of the building", () => {
    const ring = box(20, 14);
    for (let i = 0; i < ring.length; i += 1) {
      const w = wallOf(ring, i);
      const m = instanceMatrix({ position: [0, 0, 0], rotationY: wallYaw(w.t), scale: [1, 1, 1] });
      expect(m[0]).toBeCloseTo(w.t[0]);
      expect(m[2]).toBeCloseTo(w.t[1]);
      expect(m[8]).toBeCloseTo(w.n[0]);
      expect(m[10]).toBeCloseTo(w.n[1]);
      // The normal points away from the center (10, 7).
      const mid = [w.o[0] + (w.t[0] * w.len) / 2, w.o[1] + (w.t[1] * w.len) / 2];
      expect((mid[0] - 10) * w.n[0] + (mid[1] - 7) * w.n[1]).toBeGreaterThan(0);
      expect(turnAt(ring, i)).toBeCloseTo(Math.PI / 2);
    }
  });

  it("picks the storefront width closest to the bay opening", () => {
    expect(storefrontFor(2.6 - 0.36)).toBe(26);
    expect(storefrontFor(3.2 - 0.36)).toBe(32);
    expect(storefrontFor(4.5 - 0.36)).toBe(45);
  });

  it("dresses a brick loft storefront: shop bays, windows on the shader grid, cornice, corners, roof units", () => {
    const ring = box(24, 16);
    const s = style("brick-loft");
    const out = facadePlacements({ ring, style: s, base: 0, top: 17, front: { edge: 0, wraps: [] }, seed: 7 });
    const by = byModule(out);
    for (const it of out) expect(MODULES[it.module], it.module).toBeDefined();
    const bays = Math.round(24 / s.bay);
    expect(by.get("storefront_door_32")).toHaveLength(1);
    expect(by.get("storefront_glass_32")).toHaveLength(bays - 1);
    expect(by.get("cornice_segment")).toHaveLength(12);
    // One front wall: no corner between two cornice walls. The parapet cap
    // runs on every wall, on the parapet top, with a corner at each corner.
    expect(by.get("cornice_corner")).toBeUndefined();
    expect(by.get("parapet_cap_corner")).toHaveLength(4);
    for (const it of [...by.get("parapet_cap_segment"), ...by.get("parapet_cap_corner")]) expect(it.position[1]).toBeCloseTo(17 + s.parapet);
    for (const it of by.get("trim_sign_board")) expect(it.tint).toBe("trim");
    expect(by.get("hvac_rooftop")).toHaveLength(1);
    // A window frame bottom sits where the shader frame starts.
    const win = by.get("window_brick_loft")[0];
    const floorH = 17 / Math.round(17 / s.floorHeight);
    const frameBottom = (0.55 - (s.window[1] + 0.07) / 2) * floorH;
    expect((win.position[1] + 1e-9) % floorH).toBeCloseTo(frameBottom);
    for (const it of out) for (const v of it.scale) expect(v).toBeGreaterThan(0.5);
    // Every roof unit is on the roof and inside the footprint.
    for (const it of out.filter((o) => o.wall === null)) {
      expect(it.position[1]).toBe(17);
      expect(it.position[0]).toBeGreaterThan(1.5);
      expect(it.position[0]).toBeLessThan(22.5);
    }
  });

  it("is deterministic for a seed", () => {
    const args = { ring: box(30, 18), style: style("stucco-apartment"), base: 0, top: 13, front: null, seed: 42 };
    expect(facadePlacements(args)).toEqual(facadePlacements(args));
  });

  it("gives houses windows but no parapet or roof units", () => {
    const out = facadePlacements({ ring: box(9, 16), style: style("craftsman-house"), base: 0, top: 4, front: null, seed: 3 });
    const by = byModule(out);
    expect(by.get("window_stucco_apartment")?.length).toBeGreaterThan(0);
    expect(by.has("parapet_cap_segment")).toBe(false);
    expect(by.has("hvac_condenser")).toBe(false);
  });

  it("only names LOD1 nodes that exist as modules", () => {
    for (const m of LOD1) expect(MODULES[m]).toBeDefined();
  });

  it("wraps only the corner bay, scales fire escapes to the stair rise, and keeps clear of murals and courtyards", () => {
    const ring = box(24, 16);
    const s = style("brick-loft");
    const shop = byModule(facadePlacements({ ring, style: s, base: 0, top: 17, front: { edge: 0, wraps: [1] }, seed: 7 }));
    const wrap = [...shop.values()].flat().filter((it) => it.wallIndex === 1 && it.module.startsWith("storefront_"));
    expect(wrap).toHaveLength(1);
    // No window module over the shader's shop glass on any ground floor.
    for (const it of [...shop.values()].flat()) if (it.module === "window_brick_loft") expect(it.position[1]).toBeGreaterThan(17 / 4);

    let fire = null;
    for (let seed = 1; seed < 40 && !fire; seed += 1) {
      fire = byModule(facadePlacements({ ring, style: s, base: 0, top: 17, front: null, seed })).get("fire_escape_floor") ?? null;
    }
    expect(fire).not.toBeNull();
    expect(fire[0].scale[1] * FIRE_ESCAPE_RISE).toBeCloseTo(17 / 4);

    const mural = { edge: 2, t0: 4, t1: 16, y0: 0.8, y1: 12 };
    for (let seed = 1; seed < 10; seed += 1) {
      for (const it of facadePlacements({ ring, style: s, base: 0, top: 17, front: null, mural, seed })) {
        if (it.wallIndex !== 2 || /cornice|parapet|belt/.test(it.module)) continue;
        const w = wallOf(ring, 2);
        const a = (it.position[0] - w.o[0]) * w.t[0] + (it.position[2] - w.o[1]) * w.t[1];
        expect(a < mural.t0 - 0.3 || a > mural.t1 + 0.3 || it.position[1] > mural.y1, it.module).toBe(true);
      }
    }

    const big = box(60, 60);
    const holes = [[[20, 20], [20, 40], [40, 40], [40, 20]]];
    for (let seed = 1; seed < 20; seed += 1) {
      for (const it of facadePlacements({ ring: big, holes, style: s, base: 0, top: 17, front: null, seed }).filter((o) => o.wall === null)) {
        const [x, , z] = it.position;
        expect(x > 18.5 && x < 41.5 && z > 18.5 && z < 41.5, `${it.module} at ${x},${z}`).toBe(false);
      }
    }
  });
});
