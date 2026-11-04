import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { orientRing } from "./extrude.js";
import { pointInRings } from "./geo-ground.js";
import { BULKHEAD, ROOF, bulkheadBox, minRect, roofPlan } from "./roof-plan.js";
import { STYLES, chooseStyle } from "./styles.js";

const LEVEL = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../levels/beltline-eastside/level.json"), "utf8"));
const LOFT = STYLES.find((s) => s.id === "brick-loft");
const STUCCO = STYLES.find((s) => s.id === "stucco-apartment");
const HOUSE = STYLES.find((s) => s.id === "craftsman-house");

// A rectangle turned by `turn` radians about the origin.
function rect(long, short, turn = 0) {
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  return [[0, 0], [long, 0], [long, short], [0, short]].map(([x, z]) => [x * c - z * s, x * s + z * c]);
}

// The 4 corners of a plan part, from its center, yaw, and half sizes.
function corners(p) {
  const u = [Math.cos(p.yaw), -Math.sin(p.yaw)];
  const v = [-u[1], u[0]];
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, c]) => [p.x + u[0] * a * p.ha + v[0] * c * p.hc, p.z + u[1] * a * p.ha + v[1] * c * p.hc]);
}

describe("the roof plan", () => {
  const turn = Math.PI / 7;
  const b = { id: "w-test-roof", outer: rect(40, 18, turn), height: 12 };

  it("puts every part inside the footprint, square to the long walls", () => {
    const plan = roofPlan(b, STUCCO);
    expect(plan.parts.length).toBeGreaterThan(3);
    const ring = orientRing(b.outer, false);
    const r = minRect(ring);
    for (const p of plan.parts) {
      for (const [x, z] of corners(p)) expect(pointInRings(x, z, [ring])).toBe(true);
      // The part +x is the long axis (or its opposite).
      const u = [Math.cos(p.yaw), -Math.sin(p.yaw)];
      expect(Math.abs(u[0] * r.ux + u[1] * r.uz)).toBeCloseTo(1, 6);
    }
  });

  it("keeps the gap between every two parts and the bulkhead", () => {
    const loft = { id: "w-test-loft", outer: rect(34, 16), height: 10 };
    const plan = roofPlan(loft, LOFT);
    expect(plan.bulkhead).not.toBeNull();
    const ring = orientRing(loft.outer, false);
    const r = minRect(ring);
    const toRoof = (x, z) => [(x - r.cx) * r.ux + (z - r.cz) * r.uz, -(x - r.cx) * r.uz + (z - r.cz) * r.ux];
    const boxes = plan.parts.map((p) => ({ c: toRoof(p.x, p.z), ha: p.ha, hc: p.hc }));
    boxes.push({ c: toRoof(plan.bulkhead.cx, plan.bulkhead.cz), ha: plan.bulkhead.ha, hc: plan.bulkhead.hc });
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const A = boxes[i];
        const B = boxes[j];
        const apart = Math.abs(A.c[0] - B.c[0]) >= A.ha + B.ha + ROOF.gap - 1e-6 || Math.abs(A.c[1] - B.c[1]) >= A.hc + B.hc + ROOF.gap - 1e-6;
        expect(apart).toBe(true);
      }
    }
  });

  it("gives a roof of 120 m2 or more at least one roof unit, and more units to a bigger roof", () => {
    const small = roofPlan({ id: "w-small", outer: rect(12, 11), height: 9 }, STUCCO).parts.filter((p) => p.kind === "roof_unit");
    const big = roofPlan({ id: "w-big", outer: rect(50, 24), height: 9 }, STUCCO).parts.filter((p) => p.kind === "roof_unit");
    expect(small.length).toBeGreaterThanOrEqual(1);
    expect(big.length).toBeGreaterThan(small.length);
    expect(big.length).toBeLessThanOrEqual(ROOF.unit.max);
  });

  it("gives vent stacks with a height in the range", () => {
    const vents = roofPlan(b, STUCCO).parts.filter((p) => p.kind === "vent");
    expect(vents.length).toBeGreaterThanOrEqual(ROOF.vent.min);
    for (const v of vents) {
      expect(v.height).toBeGreaterThanOrEqual(ROOF.vent.height[0]);
      expect(v.height).toBeLessThanOrEqual(ROOF.vent.height[1]);
    }
  });

  it("gives a house no roof parts", () => {
    expect(roofPlan({ id: "w-house", outer: rect(12, 9), height: 6 }, HOUSE).parts).toEqual([]);
  });

  it("gives the same plan on every call", () => {
    expect(roofPlan(b, STUCCO)).toEqual(roofPlan(b, STUCCO));
  });

  it("puts the water tower at the end away from the bulkhead", () => {
    // Look for a loft id whose plan has a tower.
    let found = null;
    for (let i = 0; i < 60 && !found; i += 1) {
      const loft = { id: `w-tower-${i}`, outer: rect(34, 16), height: 10 };
      const plan = roofPlan(loft, LOFT);
      if (plan.parts.some((p) => p.kind === "water_tower")) found = { loft, plan };
    }
    expect(found).not.toBeNull();
    const ring = orientRing(found.loft.outer, false);
    const r = minRect(ring);
    const along = (x, z) => (x - r.cx) * r.ux + (z - r.cz) * r.uz;
    const tower = found.plan.parts.find((p) => p.kind === "water_tower");
    expect(Math.sign(along(tower.x, tower.z))).toBe(-Math.sign(along(found.plan.bulkhead.cx, found.plan.bulkhead.cz)));
  });

  it("puts the bulkhead at the crown seed end, as the kit does", () => {
    const ring = orientRing(rect(34, 16), false);
    const box = bulkheadBox(ring, LOFT, 1);
    const r = minRect(ring);
    const along = (box.cx - r.cx) * r.ux + (box.cz - r.cz) * r.uz;
    expect(along).toBeCloseTo(r.long / 2 - BULKHEAD.end - LOFT.crown.bulkhead[0] / 2, 6);
    expect(bulkheadBox(ring, STUCCO, 1)).toBeNull();
  });

  it("plans the BeltLine roofs with every part inside its footprint", () => {
    let parts = 0;
    for (const bd of LEVEL.buildings.slice(0, 400)) {
      const style = STYLES.find((s) => s.id === chooseStyle(bd));
      const plan = roofPlan(bd, style);
      const rings = [orientRing(bd.outer, false), ...(bd.holes ?? [])];
      for (const p of plan.parts) {
        parts += 1;
        for (const [x, z] of corners(p)) expect(pointInRings(x, z, rings)).toBe(true);
      }
      // Only a style with a crown gets a bulkhead.
      if (plan.bulkhead) expect(style.crown).toBeTruthy();
    }
    expect(parts).toBeGreaterThan(100);
  });
});
