import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { KIT, VICTORIAN, buildingKit, houseFronts, porchPosts, porchSpan, victorianPlan, victorianPorch, victorianRoof, victorianSpan, victorianTurret, wrapWall } from "./facade-kit.js";
import { HOUSE_STYLES, STYLES, STYLE_INDEX, chooseStyle, roofForm } from "./styles.js";
import { orientRing } from "./extrude.js";
import { withHistoricDistricts } from "./historic-districts.js";
import { buildingSpan } from "./terrain.js";

const DIR = resolve(import.meta.dirname, "../../../levels/beltline-eastside");
const LEVEL = withHistoricDistricts(JSON.parse(readFileSync(resolve(DIR, "level.json"), "utf8")), JSON.parse(readFileSync(resolve(DIR, "historic-districts.json"), "utf8")));
const V = STYLES[STYLE_INDEX["victorian-house"]];
const SI = STYLE_INDEX["victorian-house"];
// A 10 by 14 m house. Edge 0 runs along +x at z = 0.
const HOUSE = orientRing([[0, 0], [10, 0], [10, 14], [0, 14]], false);
const empty = (normals = false) => ({ positions: [], indices: [], colors: [], facade: [], ...(normals ? { normals: [] } : {}) });
const maxY = (m) => Math.max(...m.positions.filter((_, i) => i % 3 === 1));

describe("victorian house style (#407)", () => {
  it("is a house style with a gable roof form, tall narrow windows, and the accent set", () => {
    expect(HOUSE_STYLES.has("victorian-house")).toBe(true);
    expect(roofForm({}, V)).toBe("gable");
    expect(V.storefront).toBe(false);
    // The window is tall and narrow: the height is more than 2 times the width in meters.
    expect((V.window[1] * V.floorHeight) / (V.window[0] * V.bay)).toBeGreaterThan(2);
    expect(V.walls.length).toBeGreaterThanOrEqual(4);
    expect(V.accents.length).toBeGreaterThanOrEqual(2);
    // It is the last style, so the shader indices of the other styles do not change.
    expect(SI).toBe(STYLES.length - 1);
  });

  it("plans the turret and the wrap on two different corners, the same for one id", () => {
    const ring = orientRing([[0, 0], [10, 0], [10, 14], [0, 14]], false);
    let turrets = 0;
    for (let i = 0; i < 200; i += 1) {
      const p = victorianPlan(`h${i}`, ring, 0);
      expect(victorianPlan(`h${i}`, ring, 0)).toEqual(p);
      expect(p.wrapEnd).toBe(1 - p.turretEnd);
      expect(p.r).toBeGreaterThanOrEqual(VICTORIAN.turret.minR);
      expect(p.r).toBeLessThanOrEqual(VICTORIAN.turret.maxR);
      if (p.turret) turrets += 1;
    }
    expect(turrets / 200).toBeGreaterThan(0.35);
    expect(turrets / 200).toBeLessThan(0.65);
    // A short front wall gets no turret.
    expect(victorianPlan("h1", orientRing([[0, 0], [5, 0], [5, 9], [0, 9]], false), 0).turret).toBe(false);
  });

  it("makes the porch as wide as the wall, and stops it at the turret", () => {
    const full = victorianSpan(10, 4, 1, { turret: false });
    expect(full.a0).toBeCloseTo(0.2);
    expect(full.a1).toBeCloseTo(9.8);
    expect(porchSpan(10, 4, 1).a1 - porchSpan(10, 4, 1).a0).toBeCloseTo(KIT.porch.width);
    const cut = victorianSpan(10, 4, 3, { turret: true, turretEnd: 1, r: 1.5 });
    expect(cut.a1).toBeCloseTo(10 - (3 - VICTORIAN.turret.out + 0.1));
    expect(cut.door).toBeLessThanOrEqual(cut.a1 - 1);
    const cut0 = victorianSpan(10, 4, 0, { turret: true, turretEnd: 0, r: 1.5 });
    expect(cut0.a0).toBeCloseTo(3 - VICTORIAN.turret.out + 0.1);
    expect(victorianSpan(3, 1, 0, { turret: true, turretEnd: 1, r: 1.7 })).toBeNull();
  });

  it("finds the side wall of the wrap on each end", () => {
    expect(wrapWall(HOUSE, 0, 1)).toEqual({ edge: 1, b0: 0, b1: VICTORIAN.porch.wrap });
    const w0 = wrapWall(HOUSE, 0, 0);
    expect(w0.edge).toBe(HOUSE.length - 1);
    expect(w0.b1 - w0.b0).toBeCloseTo(VICTORIAN.porch.wrap);
  });

  it("spaces the turned posts no more than the post gap, with no post in the stair", () => {
    const posts = porchPosts(0, 10, [4, 5.8]);
    expect(posts[0]).toBe(0);
    expect(posts.at(-1)).toBe(10);
    expect(posts).toContain(4);
    expect(posts).toContain(5.8);
    for (let i = 1; i < posts.length; i += 1) expect(posts[i] - posts[i - 1]).toBeLessThanOrEqual(VICTORIAN.porch.postGap + 1e-9);
    expect(posts.filter((a) => a > 4 && a < 5.8)).toEqual([]);
  });

  it("builds a steep hip roof with a front gable over the house", () => {
    const m = empty();
    expect(victorianRoof(m, HOUSE, 7, V.walls[0], [0.3, 0.3, 0.3], V.accents[0], SI, 0, 1)).toBe(true);
    // The ridge: half the short side at 45 degrees over the wall top.
    expect(maxY(m)).toBeCloseTo(7 + 5 * Math.tan(VICTORIAN.pitch), 1);
    // The gable sticks out over the front wall (z < 0) on edge 0.
    const zs = m.positions.filter((_, i) => i % 3 === 2);
    expect(Math.min(...zs)).toBeLessThan(-KIT.roof.overhang + 0.01);
    expect(m.indices.length / 3).toBeLessThan(60);
    // Not a near-rectangle: no roof.
    expect(victorianRoof(empty(), orientRing([[0, 0], [10, 0], [0, 10]], false), 7, V.walls[0], [0.3, 0.3, 0.3], V.accents[0], SI, 0)).toBe(false);
  });

  it("builds the corner turret over the roof eave, with a cone and windows", () => {
    const plan = { turret: true, turretEnd: 1, r: 1.5, wrapEnd: 0 };
    const m = empty();
    expect(victorianTurret(m, HOUSE, 0, plan, 0, 0, 7, 3.5, V.walls[0], V.accents[0], [0.3, 0.3, 0.3], V.trim, V.glass, SI)).toBe(1);
    const T = VICTORIAN.turret;
    const apex = 7 + T.rise + (1.5 + T.coneOut) * T.cone;
    expect(maxY(m)).toBeCloseTo(apex + 0.55, 3);
    // The tower stands out of the front corner by `out` m.
    const xs = m.positions.filter((_, i) => i % 3 === 0);
    expect(Math.max(...xs)).toBeGreaterThan(10);
    expect(Math.max(...xs)).toBeLessThan(10 + T.out + T.coneOut + 0.01);
    expect(m.indices.length / 3).toBeLessThan(160);
    expect(victorianTurret(empty(), HOUSE, 0, { ...plan, turret: false }, 0, 0, 7, 3.5, V.walls[0], V.accents[0], [0.3, 0.3, 0.3], V.trim, V.glass, SI)).toBe(0);
  });

  it("builds the wrap porch around the corner when the side has room", () => {
    const front = { edge: 0, door: 1, clear: 5, ground: 0 };
    const plan = { turret: false, turretEnd: 0, r: 1.2, wrapEnd: 1, wrapCorner: true };
    const flat = empty(true);
    expect(victorianPorch(flat, HOUSE, V, SI, 0, 3.8, 7.6, front, 0, V.walls[0], V.accents[0], plan)).toBe(1);
    const wrapped = empty(true);
    const side = { ...wrapWall(HOUSE, 0, 1), clear: 5 };
    expect(victorianPorch(wrapped, HOUSE, V, SI, 0, 3.8, 7.6, { ...front, wrap: side }, 0, V.walls[0], V.accents[0], plan)).toBe(1);
    // The wrap run goes past the corner (x > 10) and along the side wall (z > 0).
    const xs = wrapped.positions.filter((_, i) => i % 3 === 0);
    const zs = wrapped.positions.filter((_, i) => i % 3 === 2);
    expect(Math.max(...xs)).toBeGreaterThan(10 + KIT.porch.minDepth);
    expect(Math.max(...zs)).toBeGreaterThan(VICTORIAN.porch.wrap - 0.1);
    expect(wrapped.indices.length).toBeGreaterThan(flat.indices.length);
    // No room in front: no porch.
    expect(victorianPorch(empty(true), HOUSE, V, SI, 0, 3.8, 7.6, { ...front, clear: 1 }, 0, V.walls[0], V.accents[0], plan)).toBe(0);
  });

  it("keeps the triangles of a Victorian house inside the budget of the current house styles", () => {
    const fronts = houseFronts(LEVEL);
    const by = {};
    let turret = 0;
    let porch = 0;
    for (const b of LEVEL.buildings) {
      const s = chooseStyle(b, LEVEL);
      if (!HOUSE_STYLES.has(s)) continue;
      const m = empty();
      const d = empty(true);
      const c = buildingKit(m, b, buildingSpan(LEVEL, b), d, null, fronts.get(b.id) ?? null, LEVEL);
      (by[s] ??= []).push((m.indices.length + d.indices.length) / 3);
      if (s === "victorian-house") {
        turret += c.turret;
        porch += c.porch;
      }
    }
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const old = [...by["craftsman-house"], ...by["shotgun-house"]];
    // Every Victorian house stays under the largest current house, and the
    // mean stays within 10 percent of the shotgun house mean (the larger one).
    expect(Math.max(...by["victorian-house"])).toBeLessThanOrEqual(Math.max(...old));
    expect(mean(by["victorian-house"])).toBeLessThanOrEqual(1.1 * Math.max(mean(by["craftsman-house"]), mean(by["shotgun-house"])));
    expect(by["victorian-house"].length).toBeGreaterThan(150);
    expect(turret).toBeGreaterThan(30);
    expect(porch).toBeGreaterThan(30);
  });
});
